import {
  ACCOUNT_MANAGER_CONFIGS,
  accountManagementQuarterWindow,
  calculateRetentionMetricsWithExclusions,
  fillZeroArrFromStripe,
  isAccountManagementBaselineEligible,
  isManagedAccountPlan,
  retentionExclusionReason,
  retentionMovement,
  type RetentionMetrics,
  type RetentionExclusionReason,
  type RetentionMovement,
} from "@/lib/accountManagementRules";
import { queryAccountManagementWarehouseData } from "@/lib/accountManagementBigquery";
import { FX_TARGET_CURRENCY, round2 } from "@/lib/logic";
import {
  queryStripeManagedEarlyLifecycleActivityFromBigQuery,
  queryStripeOpeningBoundaryRefundsFromBigQuery,
  queryStripeThroughMrrCustomerArrFromBigQuery,
  queryStripeThroughMrrCustomerPlanFromBigQuery,
} from "@/lib/stripeBigquery";

export type AccountManagementReportRequest = {
  quarter?: string;
};

export type AccountManagementAccountRow = {
  companyId: string;
  companyName: string;
  companyUrl: string;
  portfolioDealIds: string[];
  portfolioDealNames: string[];
  portfolioDealUrls: string[];
  churnType: string;
  earlyLifecycleActivity: boolean;
  excludedFromNrr: boolean;
  exclusionReason: RetentionExclusionReason;
  previousDeployment: "cloud" | "legacy" | "mixed" | "none";
  currentDeployment: "cloud" | "legacy" | "mixed" | "none";
  revenueSource: "hubspot_carr" | "stripe_arr" | "hubspot_stripe_fallback";
  workspaceId: string;
  previousArr: number;
  currentArr: number;
  netChange: number;
  nrrPct: number | null;
  movement: RetentionMovement;
};

export type AccountManagementOwnerRow = RetentionMetrics & {
  ownerKey: string;
  ownerId: string;
  ownerName: string;
  accounts: AccountManagementAccountRow[];
};

export type AccountManagementOutsideTeamRow = AccountManagementAccountRow & {
  ownerId: string;
  ownerName: string;
};

export type AccountManagementReportResponse = {
  quarter: string;
  quarterLabel: string;
  previousQuarterKey: string;
  previousQuarterLabel: string;
  currentQuarterKey: string;
  currentQuarterLabel: string;
  periodStartDate: string;
  periodEndDate: string;
  comparisonStartDate: string;
  targetCurrency: string;
  generatedAt: string;
  allCompanies: RetentionMetrics;
  team: RetentionMetrics;
  outsideTeam: RetentionMetrics & { accounts: AccountManagementOutsideTeamRow[] };
  owners: AccountManagementOwnerRow[];
  warnings: string[];
  methodology: {
    portfolioDealType: string;
    allCompaniesCohort: string;
    outsideTeamCohort: string;
    ownerCohort: string;
    carrCalculation: string;
    nrrFormula: string;
  };
};

type PortfolioCandidate = {
  companyId: string;
  dealId: string;
  dealName: string;
  revenueSource: "hubspot_carr" | "stripe_arr";
  workspaceId: string;
  deploymentType: string;
};

type CompanyCarr = {
  companyName: string;
  previousArr: number;
  currentArr: number;
  previousCloudArr: number;
  currentCloudArr: number;
  previousLegacyArr: number;
  currentLegacyArr: number;
};

function normalizeWorkspaceId(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function quarterLabel(quarterKey: string) {
  const [year, quarter] = quarterKey.split("-");
  return `FY${year.slice(-2)} ${quarter}`;
}


function dealUrl(portalId: string, dealId: string) {
  return `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}?utm_source=arr_dashboard&utm_medium=internal&utm_campaign=account_management`;
}

function companyUrl(portalId: string, companyId: string) {
  return `https://app.hubspot.com/contacts/${portalId}/record/0-2/${companyId}?utm_source=arr_dashboard&utm_medium=internal&utm_campaign=account_management`;
}

function emptyCompanyCarr(companyName = ""): CompanyCarr {
  return {
    companyName,
    previousArr: 0,
    currentArr: 0,
    previousCloudArr: 0,
    currentCloudArr: 0,
    previousLegacyArr: 0,
    currentLegacyArr: 0,
  };
}

function deploymentLabel(cloudArr: number, legacyArr: number): "cloud" | "legacy" | "mixed" | "none" {
  if (cloudArr > 0 && legacyArr > 0) return "mixed";
  if (cloudArr > 0) return "cloud";
  if (legacyArr > 0) return "legacy";
  return "none";
}

function hasArrAtEitherQuarterEnd(company: CompanyCarr) {
  return round2(company.previousArr) !== 0 || round2(company.currentArr) !== 0;
}

export async function generateAccountManagementReport(
  request: AccountManagementReportRequest,
): Promise<AccountManagementReportResponse> {
  const window = accountManagementQuarterWindow(String(request.quarter || "").trim());
  const portalId = String(process.env.HUBSPOT_PORTAL_ID || "20692578").trim() || "20692578";
  const warnings = new Set<string>();
  const warehouse = await queryAccountManagementWarehouseData({
    openingSnapshotDate: window.openingSnapshotDate,
    currentQuarterEnd: window.currentQuarterEnd,
    targetCurrency: FX_TARGET_CURRENCY,
  });
  const candidatesByCompany = new Map<string, PortfolioCandidate[]>();
  let missingPortfolioCompanyCount = 0;
  let missingTransactionalCompanyCount = 0;
  let missingTransactionalWorkspaceCount = 0;
  const transactionalCandidatesByCompany = new Map<string, PortfolioCandidate[]>();

  for (const candidate of warehouse.portfolioCandidates) {
    if (!candidate.companyId) {
      if (candidate.revenueSource === "stripe_arr") missingTransactionalCompanyCount += 1;
      else missingPortfolioCompanyCount += 1;
      continue;
    }
    if (candidate.revenueSource === "stripe_arr" && !candidate.workspaceId) {
      missingTransactionalWorkspaceCount += 1;
      continue;
    }
    const target = candidate.revenueSource === "stripe_arr" ? transactionalCandidatesByCompany : candidatesByCompany;
    if (!target.has(candidate.companyId)) target.set(candidate.companyId, []);
    target.get(candidate.companyId)!.push({ ...candidate });
  }

  if (missingPortfolioCompanyCount) {
    warnings.add(
      `${missingPortfolioCompanyCount} Existing Business deal${missingPortfolioCompanyCount === 1 ? " was" : "s were"} excluded because no HubSpot company was associated.`,
    );
  }

  const carrByCompany = new Map<string, CompanyCarr>(
    warehouse.carrByCompany.map((company) => [company.companyId, { ...company }]),
  );
  const existingBusinessCompanyIds = new Set(candidatesByCompany.keys());
  const carrCandidatesByCompany = new Map<string, PortfolioCandidate[]>();
  for (const candidate of warehouse.carrCandidates) {
    if (!candidate.companyId) continue;
    if (!carrCandidatesByCompany.has(candidate.companyId)) carrCandidatesByCompany.set(candidate.companyId, []);
    carrCandidatesByCompany.get(candidate.companyId)!.push({ ...candidate });
  }
  const companyIdsByWorkspaceId = new Map<string, Set<string>>();

  for (const [companyId, candidates] of transactionalCandidatesByCompany.entries()) {
    for (const candidate of candidates) {
      if (!companyIdsByWorkspaceId.has(candidate.workspaceId)) companyIdsByWorkspaceId.set(candidate.workspaceId, new Set());
      companyIdsByWorkspaceId.get(candidate.workspaceId)!.add(companyId);
    }
  }

  for (const candidateMap of [candidatesByCompany, carrCandidatesByCompany]) {
    for (const [companyId, candidates] of candidateMap.entries()) {
      for (const candidate of candidates) {
        if (!candidate.workspaceId) continue;
        if (!companyIdsByWorkspaceId.has(candidate.workspaceId)) {
          companyIdsByWorkspaceId.set(candidate.workspaceId, new Set());
        }
        companyIdsByWorkspaceId.get(candidate.workspaceId)!.add(companyId);
      }
    }
  }

  if (missingTransactionalCompanyCount) {
    warnings.add(
      `${missingTransactionalCompanyCount} Transactional Team deal${missingTransactionalCompanyCount === 1 ? " was" : "s were"} excluded because no HubSpot company was associated.`,
    );
  }
  if (missingTransactionalWorkspaceCount) {
    warnings.add(
      `${missingTransactionalWorkspaceCount} Transactional Team deal${missingTransactionalWorkspaceCount === 1 ? " was" : "s were"} excluded because its primary workspace ID was blank.`,
    );
  }

  const stripeCarrByCompany = new Map<string, CompanyCarr>();
  const stripeBaselinePlansByCompany = new Map<string, Set<string>>();
  const earlyLifecycleActivityCompanyIds = new Set<string>();
  const openingBoundaryRefundCompanyIds = new Set<string>();
  for (const companyIds of companyIdsByWorkspaceId.values()) {
    for (const companyId of companyIds) {
      stripeCarrByCompany.set(companyId, emptyCompanyCarr());
    }
  }
  if (companyIdsByWorkspaceId.size) {
    const [
      stripeOpeningArr,
      stripeCurrentArr,
      stripeOpeningPlans,
      earlyLifecycleActivity,
      openingBoundaryRefunds,
    ] = await Promise.all([
      queryStripeThroughMrrCustomerArrFromBigQuery(
        {
          startDate: window.openingSnapshotDate,
          endDate: window.openingSnapshotDate,
          targetCurrency: FX_TARGET_CURRENCY,
          grain: "daily",
          baseSubscriptionOnly: true,
        },
        { profile: "stripe_arr_correct" },
      ),
      queryStripeThroughMrrCustomerArrFromBigQuery(
        {
          startDate: window.currentQuarterEnd,
          endDate: window.currentQuarterEnd,
          targetCurrency: FX_TARGET_CURRENCY,
          grain: "daily",
          baseSubscriptionOnly: true,
        },
        { profile: "stripe_arr_correct" },
      ),
      queryStripeThroughMrrCustomerPlanFromBigQuery(
        {
          startDate: window.openingSnapshotDate,
          endDate: window.openingSnapshotDate,
          targetCurrency: FX_TARGET_CURRENCY,
          grain: "daily",
        },
        { profile: "stripe_arr_correct" },
      ),
      queryStripeManagedEarlyLifecycleActivityFromBigQuery(
        {
          workspaceIds: Array.from(companyIdsByWorkspaceId.keys()),
          activityStartDate: window.currentQuarterActivityStart,
          activityEndDate: window.currentQuarterEnd,
          targetCurrency: FX_TARGET_CURRENCY,
          maxAgeDays: 90,
        },
        { profile: "stripe_arr_correct" },
      ),
      queryStripeOpeningBoundaryRefundsFromBigQuery(
        {
          workspaceIds: Array.from(companyIdsByWorkspaceId.keys()),
          openingSnapshotDate: window.openingSnapshotDate,
          targetCurrency: FX_TARGET_CURRENCY,
        },
        { profile: "stripe_arr_correct" },
      ),
    ]);
    const openingManagedCustomerIds = new Set(
      stripeOpeningPlans.rows
        .filter((row) => row.periodKey === window.openingSnapshotDate && isManagedAccountPlan(row.plan))
        .flatMap((row) => row.customerIds),
    );
    const qualifyingOpeningBoundaryRefunds = openingBoundaryRefunds.rows.filter((row) =>
      openingManagedCustomerIds.has(row.customerId),
    );
    const openingBoundaryRefundCustomerIds = new Set(
      qualifyingOpeningBoundaryRefunds.map((row) => row.customerId),
    );
    for (const row of qualifyingOpeningBoundaryRefunds) {
      for (const companyId of companyIdsByWorkspaceId.get(normalizeWorkspaceId(row.workspaceId)) || []) {
        openingBoundaryRefundCompanyIds.add(companyId);
      }
    }
    let ambiguousStripeCustomerCount = 0;
    for (const row of [...stripeOpeningArr.rows, ...stripeCurrentArr.rows]) {
      if (row.periodKey !== window.openingSnapshotDate && row.periodKey !== window.currentQuarterEnd) continue;
      const matchingCompanyIds = Array.from(
        new Set(
          row.workspaceIds.flatMap((workspaceId) =>
            Array.from(companyIdsByWorkspaceId.get(normalizeWorkspaceId(workspaceId)) || []),
          ),
        ),
      ).sort();
      if (!matchingCompanyIds.length) continue;
      if (matchingCompanyIds.length > 1) ambiguousStripeCustomerCount += 1;
      const company = stripeCarrByCompany.get(matchingCompanyIds[0]);
      if (!company) continue;
      if (row.periodKey === window.openingSnapshotDate) {
        if (row.customerIds.some((customerId) => openingBoundaryRefundCustomerIds.has(customerId))) continue;
        company.previousArr = round2(company.previousArr + Number(row.arr || 0));
      }
      if (row.periodKey === window.currentQuarterEnd) {
        company.currentArr = round2(company.currentArr + Number(row.arr || 0));
      }
    }
    for (const row of stripeOpeningPlans.rows) {
      if (row.periodKey !== window.openingSnapshotDate) continue;
      if (row.customerIds.some((customerId) => openingBoundaryRefundCustomerIds.has(customerId))) continue;
      const matchingCompanyIds = Array.from(
        new Set(
          row.workspaceIds.flatMap((workspaceId) =>
            Array.from(companyIdsByWorkspaceId.get(normalizeWorkspaceId(workspaceId)) || []),
          ),
        ),
      ).sort();
      if (!matchingCompanyIds.length) continue;
      const companyId = matchingCompanyIds[0];
      if (!stripeBaselinePlansByCompany.has(companyId)) stripeBaselinePlansByCompany.set(companyId, new Set());
      stripeBaselinePlansByCompany.get(companyId)!.add(row.plan);
    }
    for (const row of earlyLifecycleActivity.rows) {
      for (const companyId of companyIdsByWorkspaceId.get(normalizeWorkspaceId(row.workspaceId)) || []) {
        earlyLifecycleActivityCompanyIds.add(companyId);
      }
    }
    if (ambiguousStripeCustomerCount) {
      warnings.add(
        `${ambiguousStripeCustomerCount} Stripe customer-period row${ambiguousStripeCustomerCount === 1 ? " matched" : "s matched"} more than one HubSpot company through the same workspace ID; ARR was assigned once to the lowest company ID.`,
      );
    }
  }

  for (const [companyId, candidates] of transactionalCandidatesByCompany.entries()) {
    if (!candidatesByCompany.has(companyId)) candidatesByCompany.set(companyId, []);
    candidatesByCompany.get(companyId)!.push(...candidates);
  }

  const companyHasCloudDeal = (companyId: string) =>
    [...(candidatesByCompany.get(companyId) || []), ...(carrCandidatesByCompany.get(companyId) || [])].some(
      (candidate) => candidate.deploymentType.trim().toLowerCase() === "cloud",
    );
  const classifyStripeCarr = (companyId: string, stripeCarr: CompanyCarr, companyName = ""): CompanyCarr => {
    const isCloud = companyHasCloudDeal(companyId);
    return {
      ...stripeCarr,
      companyName: companyName || stripeCarr.companyName,
      previousCloudArr: isCloud ? stripeCarr.previousArr : 0,
      currentCloudArr: isCloud ? stripeCarr.currentArr : 0,
      previousLegacyArr: isCloud ? 0 : stripeCarr.previousArr,
      currentLegacyArr: isCloud ? 0 : stripeCarr.currentArr,
    };
  };

  const revenueByCompany = new Map<string, CompanyCarr>();
  const revenueSourceByCompany = new Map<string, AccountManagementAccountRow["revenueSource"]>();
  for (const [companyId, hubspotCarr] of carrByCompany.entries()) {
    const stripeCarr = stripeCarrByCompany.get(companyId);
    const isTransactionalOnly =
      transactionalCandidatesByCompany.has(companyId) && !existingBusinessCompanyIds.has(companyId);
    if (isTransactionalOnly) {
      revenueByCompany.set(
        companyId,
        classifyStripeCarr(companyId, stripeCarr || emptyCompanyCarr(), hubspotCarr.companyName),
      );
      revenueSourceByCompany.set(companyId, "stripe_arr");
      continue;
    }
    const filled = fillZeroArrFromStripe(hubspotCarr, stripeCarr);
    revenueByCompany.set(companyId, {
      companyName: hubspotCarr.companyName,
      previousArr: round2(filled.previousArr),
      currentArr: round2(filled.currentArr),
      previousCloudArr: filled.usedStripePrevious
        ? (companyHasCloudDeal(companyId) ? round2(filled.previousArr) : 0)
        : hubspotCarr.previousCloudArr,
      currentCloudArr: filled.usedStripeCurrent
        ? (companyHasCloudDeal(companyId) ? round2(filled.currentArr) : 0)
        : hubspotCarr.currentCloudArr,
      previousLegacyArr: filled.usedStripePrevious
        ? (companyHasCloudDeal(companyId) ? 0 : round2(filled.previousArr))
        : hubspotCarr.previousLegacyArr,
      currentLegacyArr: filled.usedStripeCurrent
        ? (companyHasCloudDeal(companyId) ? 0 : round2(filled.currentArr))
        : hubspotCarr.currentLegacyArr,
    });
    revenueSourceByCompany.set(
      companyId,
      filled.usedStripePrevious || filled.usedStripeCurrent ? "hubspot_stripe_fallback" : "hubspot_carr",
    );
  }
  for (const [companyId, stripeCarr] of stripeCarrByCompany.entries()) {
    if (revenueByCompany.has(companyId)) continue;
    revenueByCompany.set(companyId, classifyStripeCarr(companyId, stripeCarr));
    revenueSourceByCompany.set(companyId, "stripe_arr");
  }
  const eligibleCompanyIds = new Set(
    Array.from(revenueByCompany.entries())
      .filter(([companyId, carr]) => {
        if (
          openingBoundaryRefundCompanyIds.has(companyId) &&
          round2(stripeCarrByCompany.get(companyId)?.previousArr || 0) === 0
        ) {
          return false;
        }
        const hubspotCarr = carrByCompany.get(companyId);
        const stripeMeasuredAtBaseline =
          (transactionalCandidatesByCompany.has(companyId) && !existingBusinessCompanyIds.has(companyId)) ||
          round2(hubspotCarr?.previousArr || 0) === 0;
        return isAccountManagementBaselineEligible({
          previousArr: carr.previousArr,
          previousCloudArr: carr.previousCloudArr,
          stripeMeasuredAtBaseline,
          stripeBaselinePlans: Array.from(stripeBaselinePlansByCompany.get(companyId) || []),
        });
      })
      .map(([companyId]) => companyId),
  );
  const ineligiblePortfolioCount = Array.from(candidatesByCompany.keys()).filter(
    (companyId) => !eligibleCompanyIds.has(companyId),
  ).length;
  if (ineligiblePortfolioCount) {
    warnings.add(
      `${ineligiblePortfolioCount} portfolio account${ineligiblePortfolioCount === 1 ? " was" : "s were"} omitted from the selected-quarter book because the account had no Cloud Team, Managed, or Enterprise ARR at the prior quarter end.`,
    );
  }
  if (openingBoundaryRefundCompanyIds.size) {
    warnings.add(
      `${openingBoundaryRefundCompanyIds.size} account${openingBoundaryRefundCompanyIds.size === 1 ? " was" : "s were"} removed from opening ARR because a managed-plan renewal invoice dated on the quarter's first day was fully refunded. The refund is attributed to the prior quarter even when Stripe's MRR event arrives later.`,
    );
  }
  const zeroCarrCompaniesWithoutWorkspace = Array.from(carrByCompany.entries()).filter(
    ([companyId, company]) =>
      hasArrAtEitherQuarterEnd(company) &&
      (company.previousArr === 0 || company.currentArr === 0) &&
      !stripeCarrByCompany.has(companyId),
  ).length;
  if (zeroCarrCompaniesWithoutWorkspace) {
    warnings.add(
      `${zeroCarrCompaniesWithoutWorkspace} compan${zeroCarrCompaniesWithoutWorkspace === 1 ? "y has" : "ies have"} a zero HubSpot ARR column but no primary workspace ID available for the Stripe fallback.`,
    );
  }

  const companiesById = new Map(warehouse.companies.map((company) => [company.companyId, company]));
  const retentionInputs = Array.from(revenueByCompany.entries())
    .filter(([companyId, carr]) => eligibleCompanyIds.has(companyId) && hasArrAtEitherQuarterEnd(carr))
    .map(([companyId, carr]) => ({
      ...carr,
      churnType: String(companiesById.get(companyId)?.churnType || "").trim(),
      earlyLifecycleActivity: earlyLifecycleActivityCompanyIds.has(companyId),
    }));
  const allCompanies = calculateRetentionMetricsWithExclusions(retentionInputs);
  const exclusionReasons = retentionInputs.map(retentionExclusionReason);
  const excludedNewAccountActivityCount = exclusionReasons.filter((reason) => reason === "new_account_activity").length;
  if (excludedNewAccountActivityCount) {
    warnings.add(
      `${excludedNewAccountActivityCount} account${excludedNewAccountActivityCount === 1 ? " was" : "s were"} excluded from NRR because a churn, downgrade, refund, or other ARR reduction occurred within the first 90 days.`,
    );
  }
  const excludedLegacyAccountCount = exclusionReasons.filter((reason) => reason === "legacy_only").length;
  if (excludedLegacyAccountCount) {
    warnings.add(
      `${excludedLegacyAccountCount} legacy-only account${excludedLegacyAccountCount === 1 ? " was" : "s were"} excluded from NRR because neither quarter-end snapshot had Cloud ARR. Legacy-to-Cloud migrations remain included.`,
    );
  }
  const accountsByOwnerId = new Map<string, AccountManagementAccountRow[]>(
    ACCOUNT_MANAGER_CONFIGS.map((owner) => [owner.ownerId, []]),
  );

  for (const [companyId, candidates] of candidatesByCompany.entries()) {
    if (!eligibleCompanyIds.has(companyId)) continue;
    const carr = revenueByCompany.get(companyId) || emptyCompanyCarr();
    if (!hasArrAtEitherQuarterEnd(carr)) continue;
    const ownerId = String(companiesById.get(companyId)?.csmOwnerId || "").trim();
    if (!accountsByOwnerId.has(ownerId)) continue;
    const companyName =
      String(companiesById.get(companyId)?.companyName || "").trim() ||
      carr.companyName ||
      `Company ${companyId}`;
    const previousArr = round2(carr.previousArr);
    const currentArr = round2(carr.currentArr);
    const churnType = String(companiesById.get(companyId)?.churnType || "").trim();
    const exclusionReason = retentionExclusionReason({
      previousArr,
      currentArr,
      previousCloudArr: carr.previousCloudArr,
      currentCloudArr: carr.currentCloudArr,
      churnType,
      earlyLifecycleActivity: earlyLifecycleActivityCompanyIds.has(companyId),
    });
    const excludedFromNrr = exclusionReason !== null;
    const portfolioDealIds = candidates.map((candidate) => candidate.dealId);
    accountsByOwnerId.get(ownerId)!.push({
      companyId,
      companyName,
      companyUrl: companyUrl(portalId, companyId),
      portfolioDealIds,
      portfolioDealNames: candidates.map((candidate) => candidate.dealName),
      portfolioDealUrls: portfolioDealIds.map((dealId) => dealUrl(portalId, dealId)),
      churnType,
      earlyLifecycleActivity: earlyLifecycleActivityCompanyIds.has(companyId),
      excludedFromNrr,
      exclusionReason,
      previousDeployment: deploymentLabel(carr.previousCloudArr, carr.previousLegacyArr),
      currentDeployment: deploymentLabel(carr.currentCloudArr, carr.currentLegacyArr),
      revenueSource: revenueSourceByCompany.get(companyId) || "hubspot_carr",
      workspaceId:
        [...candidates, ...(carrCandidatesByCompany.get(companyId) || [])].find((candidate) => candidate.workspaceId)
          ?.workspaceId || "",
      previousArr,
      currentArr,
      netChange: round2(currentArr - previousArr),
      nrrPct: previousArr > 0 && !excludedFromNrr ? round2((currentArr / previousArr) * 100) : null,
      movement: retentionMovement(previousArr, currentArr),
    });
  }

  const owners = ACCOUNT_MANAGER_CONFIGS.map((owner) => {
    const accounts = (accountsByOwnerId.get(owner.ownerId) || []).sort(
      (a, b) => b.previousArr - a.previousArr || a.companyName.localeCompare(b.companyName),
    );
    return {
      ...owner,
      ...calculateRetentionMetricsWithExclusions(accounts.map((account) => ({
        ...account,
        previousCloudArr: account.previousDeployment === "cloud" || account.previousDeployment === "mixed" ? account.previousArr : 0,
        currentCloudArr: account.currentDeployment === "cloud" || account.currentDeployment === "mixed" ? account.currentArr : 0,
      }))),
      accounts,
    };
  });
  const allAccounts = owners.flatMap((owner) => owner.accounts);
  const noBaselineCount = allAccounts.filter((account) => account.previousArr <= 0).length;
  if (noBaselineCount) {
    warnings.add(
      `${noBaselineCount} portfolio account${noBaselineCount === 1 ? " has" : "s have"} no opening-day ARR and therefore ${noBaselineCount === 1 ? "does" : "do"} not affect NRR.`,
    );
  }

  const teamOwnerIds = new Set(ACCOUNT_MANAGER_CONFIGS.map((owner) => owner.ownerId));
  const outsideDrafts = Array.from(revenueByCompany.entries())
    .filter(([companyId, carr]) => {
      const ownerId = String(companiesById.get(companyId)?.csmOwnerId || "").trim();
      return eligibleCompanyIds.has(companyId) && carr.previousArr > 0 && !teamOwnerIds.has(ownerId);
    })
    .map(([companyId, carr]) => {
      const candidates = candidatesByCompany.get(companyId) || carrCandidatesByCompany.get(companyId) || [];
      const ownerId = String(companiesById.get(companyId)?.csmOwnerId || "").trim();
      return { companyId, carr, candidates, ownerId };
    });
  const outsideAccounts: AccountManagementOutsideTeamRow[] = outsideDrafts
    .map(({ companyId, carr, candidates, ownerId }) => {
      const companyName =
        String(companiesById.get(companyId)?.companyName || "").trim() ||
        carr.companyName ||
        `Company ${companyId}`;
      const previousArr = round2(carr.previousArr);
      const currentArr = round2(carr.currentArr);
      const churnType = String(companiesById.get(companyId)?.churnType || "").trim();
      const exclusionReason = retentionExclusionReason({
        previousArr,
        currentArr,
        previousCloudArr: carr.previousCloudArr,
        currentCloudArr: carr.currentCloudArr,
        churnType,
        earlyLifecycleActivity: earlyLifecycleActivityCompanyIds.has(companyId),
      });
      const excludedFromNrr = exclusionReason !== null;
      const portfolioDealIds = candidates.map((candidate) => candidate.dealId);
      const revenueSource: AccountManagementAccountRow["revenueSource"] =
        revenueSourceByCompany.get(companyId) || "hubspot_carr";
      return {
        companyId,
        companyName,
        companyUrl: companyUrl(portalId, companyId),
        ownerId,
        ownerName: String(companiesById.get(companyId)?.ownerName || "").trim() || (ownerId ? `Owner ${ownerId}` : "Unassigned"),
        portfolioDealIds,
        portfolioDealNames: candidates.map((candidate) => candidate.dealName),
        portfolioDealUrls: portfolioDealIds.map((dealId) => dealUrl(portalId, dealId)),
        churnType,
        earlyLifecycleActivity: earlyLifecycleActivityCompanyIds.has(companyId),
        excludedFromNrr,
        exclusionReason,
        previousDeployment: deploymentLabel(carr.previousCloudArr, carr.previousLegacyArr),
        currentDeployment: deploymentLabel(carr.currentCloudArr, carr.currentLegacyArr),
        revenueSource,
        workspaceId:
          [...candidates, ...(carrCandidatesByCompany.get(companyId) || [])].find((candidate) => candidate.workspaceId)
            ?.workspaceId || "",
        previousArr,
        currentArr,
        netChange: round2(currentArr - previousArr),
        nrrPct: previousArr > 0 && !excludedFromNrr ? round2((currentArr / previousArr) * 100) : null,
        movement: retentionMovement(previousArr, currentArr),
      };
    })
    .sort((a, b) => b.previousArr - a.previousArr || a.companyName.localeCompare(b.companyName));

  return {
    quarter: window.quarter,
    quarterLabel: quarterLabel(window.currentQuarterKey),
    previousQuarterKey: window.previousQuarterKey,
    previousQuarterLabel: quarterLabel(window.previousQuarterKey),
    currentQuarterKey: window.currentQuarterKey,
    currentQuarterLabel: quarterLabel(window.currentQuarterKey),
    periodStartDate: window.currentQuarterStart,
    periodEndDate: window.currentQuarterEnd,
    comparisonStartDate: window.openingSnapshotDate,
    targetCurrency: FX_TARGET_CURRENCY,
    generatedAt: new Date().toISOString(),
    allCompanies,
    team: calculateRetentionMetricsWithExclusions(allAccounts.map((account) => ({
      ...account,
      previousCloudArr: account.previousDeployment === "cloud" || account.previousDeployment === "mixed" ? account.previousArr : 0,
      currentCloudArr: account.currentDeployment === "cloud" || account.currentDeployment === "mixed" ? account.currentArr : 0,
    }))),
    outsideTeam: {
      ...calculateRetentionMetricsWithExclusions(outsideAccounts.map((account) => ({
        ...account,
        previousCloudArr: account.previousDeployment === "cloud" || account.previousDeployment === "mixed" ? account.previousArr : 0,
        currentCloudArr: account.currentDeployment === "cloud" || account.currentDeployment === "mixed" ? account.currentArr : 0,
      }))),
      accounts: outsideAccounts,
    },
    owners,
    warnings: Array.from(warnings),
    methodology: {
      portfolioDealType:
        "The opening-day Cloud book, measured at the end of the first calendar day of the selected quarter so month-end churn and downgrade processing is attributed to the prior quarter. Stripe-measured accounts must be on Team, Managed, or Enterprise on that opening snapshot; Plus, PAYG, Free, and later upgrades enter the book in the following quarter. HubSpot-contracted Cloud Existing Business accounts remain eligible when their opening ARR is measured from HubSpot.",
      allCompaniesCohort:
        "Company-wide NRR is the opening-day Cloud managed-account cohort, regardless of owner. Stripe-measured accounts must have Team, Managed, or Enterprise ARR on the first-day snapshot; Plus, PAYG, Free, and accounts first upgraded later in the selected quarter are omitted until the following quarter. HubSpot-contracted Cloud Existing Business accounts remain eligible when their opening ARR is measured from HubSpot. For a Transactional managed-plan company without an Existing Business portfolio deal, Stripe replaces HubSpot CARR so the company is counted once. For other companies, a zero HubSpot ARR snapshot is filled from Stripe base-subscription ARR when a primary workspace ID is available.",
      outsideTeamCohort:
        "The outside-team table is the company-wide prior-quarter NRR cohort minus companies whose current HubSpot company CSM owner is Chloé, Sam, or Kieran.",
      ownerCohort: "Each company is assigned using the latest BigQuery-replicated value of the CSM owner property (`csm_owner`) on its HubSpot company record. Deal ownership is not used.",
      carrCalculation:
        "Existing Business companies use the BigQuery-replicated HubSpot deal and line-item data with the website's contracted-ARR rules. An Existing Business line cannot begin before that deal's close/effective date, preventing a copied renewal line from overlapping the contract it renews. Each zero quarter-end column is filled from BigQuery Stripe base-subscription ARR when available. All Transactional pipeline deals are classified as Cloud regardless of whether their HubSpot deployment field is blank. Stripe-measured accounts use BigQuery month-end base-subscription ARR joined through the deal's primary workspace ID. Stripe add-ons, AI tokens, conversation sessions, and web search/crawl revenue are excluded. Non-zero HubSpot ARR is never replaced, and each company is counted once.",
      nrrFormula:
        "NRR = current quarter-end ARR for the same opening-day account cohort ÷ opening-day ARR. The opening snapshot is taken at the end of the quarter's first calendar day, so subscriptions ending on the prior month-end are removed before the new quarter begins. A managed-plan renewal invoice dated on that first day and fully refunded is also treated as a prior-quarter churn, even if Stripe emits the MRR reduction later. Accounts with no eligible opening ARR are omitted. If Stripe plan history shows any managed-plan ARR reduction during the account's first 90 days—or HubSpot classifies the reduction as New account (<90 days)—the entire account is excluded from the numerator, denominator, contraction, and churn totals. This includes downgrades to Plus, churns, and refunds. Legacy-to-Cloud migrations are included using total opening ARR and total current ARR, so their migration expansion contributes to NRR.",
    },
  };
}
