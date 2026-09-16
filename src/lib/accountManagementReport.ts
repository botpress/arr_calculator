import {
  ACCOUNT_MANAGER_CONFIGS,
  accountManagementQuarterWindow,
  calculateRetentionMetrics,
  companyCsmOwnerId,
  dealChurnReason,
  isTransactionalTeamPlan,
  retentionMovement,
  type RetentionMetrics,
  type RetentionMovement,
} from "@/lib/accountManagementRules";
import {
  batchReadLineItems,
  batchReadCompanies,
  batchReadDealPropertyHistory,
  fetchCompanyIdsForDeals,
  fetchDealsByDealType,
  fetchHubspotOwnersById,
  fetchLineItemIdsForDeals,
  fetchSalesAssistDealMatches,
  type HubspotOwner,
} from "@/lib/hubspot";
import { FX_TARGET_CURRENCY, round2 } from "@/lib/logic";
import { generateReport } from "@/lib/report";
import { queryStripeThroughMrrCustomerArrFromBigQuery } from "@/lib/stripeBigquery";
import type { HubspotDeal, ReportRow } from "@/lib/types";

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
  portfolioDealChurnReasons: string[];
  revenueSource: "hubspot_carr" | "stripe_arr";
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
  churnReason: string;
  revenueSource: "hubspot_carr" | "stripe_arr";
  workspaceId: string;
};

type CompanyCarr = {
  companyName: string;
  previousArr: number;
  currentArr: number;
};

const TRANSACTIONAL_PLAN_LINE_ITEM_PROPERTIES = ["name", "description", "hs_product_name", "hs_sku"];

function normalizeWorkspaceId(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function lineItemPlanValues(properties: Record<string, unknown> | null | undefined) {
  return TRANSACTIONAL_PLAN_LINE_ITEM_PROPERTIES.map((property) => properties?.[property]);
}

function quarterLabel(quarterKey: string) {
  const [year, quarter] = quarterKey.split("-");
  return `FY${year.slice(-2)} ${quarter}`;
}

function firstNumericId(value: unknown) {
  return (
    String(value || "")
      .split(/[,\s;|]+/)
      .map((part) => part.trim())
      .find((part) => /^\d+$/.test(part)) || ""
  );
}

function ownerDisplayName(owner: HubspotOwner | undefined, ownerId: string) {
  const fullName = [owner?.firstName, owner?.lastName].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  return fullName || String(owner?.email || "").trim() || (ownerId ? `Owner ${ownerId}` : "Unassigned");
}

function dealUrl(portalId: string, dealId: string) {
  return `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}?utm_source=arr_dashboard&utm_medium=internal&utm_campaign=account_management`;
}

function companyUrl(portalId: string, companyId: string) {
  return `https://app.hubspot.com/contacts/${portalId}/record/0-2/${companyId}?utm_source=arr_dashboard&utm_medium=internal&utm_campaign=account_management`;
}

function currentProperty(deal: HubspotDeal, name: string) {
  return String(deal.properties?.[name] || "").trim();
}

function addCarrValue(company: CompanyCarr, row: ReportRow, previousPeriodMonthKey: string, currentPeriodMonthKey: string) {
  company.previousArr = round2(company.previousArr + Number(row.valuesByPeriod?.[previousPeriodMonthKey] || 0));
  company.currentArr = round2(company.currentArr + Number(row.valuesByPeriod?.[currentPeriodMonthKey] || 0));
  if (!company.companyName) company.companyName = String(row.accountName || "").trim();
}

export async function generateAccountManagementReport(
  request: AccountManagementReportRequest,
): Promise<AccountManagementReportResponse> {
  const window = accountManagementQuarterWindow(String(request.quarter || "").trim());
  const portalId = String(process.env.HUBSPOT_PORTAL_ID || "20692578").trim() || "20692578";
  const warnings = new Set<string>();

  const [portfolioDeals, carrReport, salesAssistMatches] = await Promise.all([
    fetchDealsByDealType(
      ["dealname", "dealtype", "loss_reason__c", "other_loss_reason__c", "closed_lost_reason"],
      "existingbusiness",
    ),
    generateReport({
      startDate: window.previousQuarterEnd,
      endDate: window.currentQuarterEnd,
      mode: "contracted",
      grain: "monthly",
      contractedIncludeAllDeals: true,
    }),
    fetchSalesAssistDealMatches(),
  ]);

  const portfolioCompanyPairs = await fetchCompanyIdsForDeals(
    portfolioDeals.map((deal) => String(deal.id || "")),
  );
  const companyIdsByPortfolioDeal = new Map(
    portfolioCompanyPairs.map((pair) => [pair.dealId, pair.ids]),
  );
  const candidatesByCompany = new Map<string, PortfolioCandidate[]>();
  let missingPortfolioCompanyCount = 0;

  for (const deal of portfolioDeals) {
    const dealId = String(deal.id || "").trim();
    if (!dealId) continue;
    const companyIds = companyIdsByPortfolioDeal.get(dealId) || [];
    const companyId = companyIds[0] || "";
    if (!companyId) {
      missingPortfolioCompanyCount += 1;
      continue;
    }

    if (!candidatesByCompany.has(companyId)) candidatesByCompany.set(companyId, []);
    candidatesByCompany.get(companyId)!.push({
      companyId,
      dealId,
      dealName: currentProperty(deal, "dealname") || `Deal ${dealId}`,
      churnReason: dealChurnReason(deal.properties),
      revenueSource: "hubspot_carr",
      workspaceId: "",
    });
  }

  if (missingPortfolioCompanyCount) {
    warnings.add(
      `${missingPortfolioCompanyCount} Existing Business deal${missingPortfolioCompanyCount === 1 ? " was" : "s were"} excluded because no HubSpot company was associated.`,
    );
  }

  const reportDealIdsMissingCompany = Array.from(
    new Set(
      carrReport.rows
        .filter((row) => !firstNumericId(row.accountId))
        .map((row) => String(row.dealId || "").trim())
        .filter(Boolean),
    ),
  );
  const fallbackReportCompanyPairs = reportDealIdsMissingCompany.length
    ? await fetchCompanyIdsForDeals(reportDealIdsMissingCompany)
    : [];
  const fallbackCompanyIdsByDeal = new Map(
    fallbackReportCompanyPairs.map((pair) => [pair.dealId, pair.ids]),
  );
  const carrByCompany = new Map<string, CompanyCarr>();
  const carrDealIdsByCompany = new Map<string, Set<string>>();
  const carrDealNameById = new Map<string, string>();
  let unmappedCarrRowCount = 0;

  for (const row of carrReport.rows) {
    const dealId = String(row.dealId || "").trim();
    const companyId = firstNumericId(row.accountId) || fallbackCompanyIdsByDeal.get(dealId)?.[0] || "";
    if (!companyId) {
      if (
        Number(row.valuesByPeriod?.[window.previousPeriodMonthKey] || 0) !== 0 ||
        Number(row.valuesByPeriod?.[window.currentPeriodMonthKey] || 0) !== 0
      ) {
        unmappedCarrRowCount += 1;
      }
      continue;
    }
    if (!carrByCompany.has(companyId)) {
      carrByCompany.set(companyId, { companyName: String(row.accountName || "").trim(), previousArr: 0, currentArr: 0 });
    }
    if (!carrDealIdsByCompany.has(companyId)) carrDealIdsByCompany.set(companyId, new Set());
    if (dealId) {
      carrDealIdsByCompany.get(companyId)!.add(dealId);
      if (!carrDealNameById.has(dealId)) {
        carrDealNameById.set(dealId, String(row.dealName || "").trim() || `Deal ${dealId}`);
      }
    }
    addCarrValue(carrByCompany.get(companyId)!, row, window.previousPeriodMonthKey, window.currentPeriodMonthKey);
  }

  if (unmappedCarrRowCount) {
    warnings.add(
      `${unmappedCarrRowCount} active CARR line item${unmappedCarrRowCount === 1 ? " was" : "s were"} excluded because its deal had no HubSpot company association.`,
    );
  }

  const existingBusinessCompanyIds = new Set(candidatesByCompany.keys());

  const transactionalMatches = salesAssistMatches.filter(
    (match) =>
      match.matchType === "transactional_closed_won" &&
      match.closedAtMs <= new Date(`${window.currentQuarterEnd}T23:59:59.999Z`).getTime(),
  );
  const transactionalDealIds = transactionalMatches.map((match) => match.dealId);
  const [transactionalLineItemPairs, transactionalCompanyPairs] = await Promise.all([
    fetchLineItemIdsForDeals(transactionalDealIds),
    fetchCompanyIdsForDeals(transactionalDealIds),
  ]);
  const transactionalLineItemIdsByDeal = new Map(
    transactionalLineItemPairs.map((pair) => [pair.dealId, pair.ids]),
  );
  const transactionalCompanyIdsByDeal = new Map(
    transactionalCompanyPairs.map((pair) => [pair.dealId, pair.ids]),
  );
  const transactionalLineItemIds = Array.from(
    new Set(transactionalLineItemPairs.flatMap((pair) => pair.ids || []).filter(Boolean)),
  );
  const transactionalLineItemsById = transactionalLineItemIds.length
    ? await batchReadLineItems(transactionalLineItemIds, TRANSACTIONAL_PLAN_LINE_ITEM_PROPERTIES)
    : new Map();
  const transactionalCandidatesByCompany = new Map<string, PortfolioCandidate[]>();
  const companyIdsByWorkspaceId = new Map<string, Set<string>>();
  let missingTransactionalCompanyCount = 0;
  let missingTransactionalWorkspaceCount = 0;

  for (const match of transactionalMatches) {
    const planValues = (transactionalLineItemIdsByDeal.get(match.dealId) || []).flatMap((lineItemId) =>
      lineItemPlanValues(transactionalLineItemsById.get(lineItemId)?.properties),
    );
    if (!isTransactionalTeamPlan(planValues)) continue;

    const companyId =
      firstNumericId(match.primaryCompanyId) ||
      transactionalCompanyIdsByDeal.get(match.dealId)?.[0] ||
      "";
    if (!companyId) {
      missingTransactionalCompanyCount += 1;
      continue;
    }
    const workspaceId = normalizeWorkspaceId(match.workspaceId);
    if (!workspaceId) {
      missingTransactionalWorkspaceCount += 1;
      continue;
    }

    if (!transactionalCandidatesByCompany.has(companyId)) transactionalCandidatesByCompany.set(companyId, []);
    transactionalCandidatesByCompany.get(companyId)!.push({
      companyId,
      dealId: match.dealId,
      dealName: match.dealName || `Deal ${match.dealId}`,
      churnReason: match.churnReason,
      revenueSource: "stripe_arr",
      workspaceId,
    });
    if (!companyIdsByWorkspaceId.has(workspaceId)) companyIdsByWorkspaceId.set(workspaceId, new Set());
    companyIdsByWorkspaceId.get(workspaceId)!.add(companyId);
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
  for (const companyId of transactionalCandidatesByCompany.keys()) {
    stripeCarrByCompany.set(companyId, { companyName: "", previousArr: 0, currentArr: 0 });
  }
  if (companyIdsByWorkspaceId.size) {
    const stripeArr = await queryStripeThroughMrrCustomerArrFromBigQuery(
      {
        startDate: window.previousQuarterEnd,
        endDate: window.currentQuarterEnd,
        targetCurrency: FX_TARGET_CURRENCY,
        grain: "monthly",
        baseSubscriptionOnly: true,
      },
      { profile: "stripe_arr_correct" },
    );
    let ambiguousStripeCustomerCount = 0;
    for (const row of stripeArr.rows) {
      if (row.periodKey !== window.previousPeriodMonthKey && row.periodKey !== window.currentPeriodMonthKey) continue;
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
      if (row.periodKey === window.previousPeriodMonthKey) {
        company.previousArr = round2(company.previousArr + Number(row.arr || 0));
      }
      if (row.periodKey === window.currentPeriodMonthKey) {
        company.currentArr = round2(company.currentArr + Number(row.arr || 0));
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

  const revenueByCompany = new Map(carrByCompany);
  for (const [companyId, carr] of stripeCarrByCompany.entries()) {
    if (!existingBusinessCompanyIds.has(companyId)) revenueByCompany.set(companyId, carr);
  }
  const allCompanies = calculateRetentionMetrics(Array.from(revenueByCompany.values()));
  const transactionCompaniesWithoutStripeArr = Array.from(stripeCarrByCompany.entries()).filter(
    ([companyId, company]) =>
      !existingBusinessCompanyIds.has(companyId) &&
      company.previousArr === 0 &&
      company.currentArr === 0,
  ).length;
  if (transactionCompaniesWithoutStripeArr) {
    warnings.add(
      `${transactionCompaniesWithoutStripeArr} eligible Transactional Team compan${transactionCompaniesWithoutStripeArr === 1 ? "y has" : "ies have"} no Stripe ARR at either quarter end for its primary workspace ID.`,
    );
  }

  const carrCandidatesByCompany = new Map<string, PortfolioCandidate[]>();
  const carrReasonsByDealId = await batchReadDealPropertyHistory(
    Array.from(carrDealNameById.keys()),
    ["loss_reason__c", "other_loss_reason__c", "closed_lost_reason"],
  );
  for (const [companyId, dealIds] of carrDealIdsByCompany.entries()) {
    for (const dealId of dealIds) {
      if (!carrCandidatesByCompany.has(companyId)) carrCandidatesByCompany.set(companyId, []);
      carrCandidatesByCompany.get(companyId)!.push({
        companyId,
        dealId,
        dealName: carrDealNameById.get(dealId) || `Deal ${dealId}`,
        churnReason: dealChurnReason(carrReasonsByDealId.get(dealId)?.properties),
        revenueSource: "hubspot_carr",
        workspaceId: "",
      });
    }
  }

  const companyIdsToRead = Array.from(new Set([
    ...candidatesByCompany.keys(),
    ...revenueByCompany.keys(),
  ]));
  const companiesById = companyIdsToRead.length
    ? await batchReadCompanies(companyIdsToRead, ["name", "csm_owner"])
    : new Map();
  const accountsByOwnerId = new Map<string, AccountManagementAccountRow[]>(
    ACCOUNT_MANAGER_CONFIGS.map((owner) => [owner.ownerId, []]),
  );

  for (const [companyId, candidates] of candidatesByCompany.entries()) {
    const ownerId = companyCsmOwnerId(companiesById.get(companyId)?.properties);
    if (!accountsByOwnerId.has(ownerId)) continue;
    const carr = revenueByCompany.get(companyId) || { companyName: "", previousArr: 0, currentArr: 0 };
    const companyName =
      String(companiesById.get(companyId)?.properties?.name || "").trim() ||
      carr.companyName ||
      `Company ${companyId}`;
    const previousArr = round2(carr.previousArr);
    const currentArr = round2(carr.currentArr);
    const portfolioDealIds = candidates.map((candidate) => candidate.dealId);
    accountsByOwnerId.get(ownerId)!.push({
      companyId,
      companyName,
      companyUrl: companyUrl(portalId, companyId),
      portfolioDealIds,
      portfolioDealNames: candidates.map((candidate) => candidate.dealName),
      portfolioDealUrls: portfolioDealIds.map((dealId) => dealUrl(portalId, dealId)),
      portfolioDealChurnReasons: candidates.map((candidate) => candidate.churnReason),
      revenueSource: existingBusinessCompanyIds.has(companyId) ? "hubspot_carr" : "stripe_arr",
      workspaceId: candidates.find((candidate) => candidate.workspaceId)?.workspaceId || "",
      previousArr,
      currentArr,
      netChange: round2(currentArr - previousArr),
      nrrPct: previousArr > 0 ? round2((currentArr / previousArr) * 100) : null,
      movement: retentionMovement(previousArr, currentArr),
    });
  }

  const owners = ACCOUNT_MANAGER_CONFIGS.map((owner) => {
    const accounts = (accountsByOwnerId.get(owner.ownerId) || []).sort(
      (a, b) => b.previousArr - a.previousArr || a.companyName.localeCompare(b.companyName),
    );
    return {
      ...owner,
      ...calculateRetentionMetrics(accounts),
      accounts,
    };
  });
  const allAccounts = owners.flatMap((owner) => owner.accounts);
  const noBaselineCount = allAccounts.filter((account) => account.previousArr <= 0).length;
  if (noBaselineCount) {
    warnings.add(
      `${noBaselineCount} portfolio account${noBaselineCount === 1 ? " has" : "s have"} no prior-quarter ARR and therefore does not affect NRR.`,
    );
  }

  const teamCompanyIds = new Set(allAccounts.map((account) => account.companyId));
  const outsideDrafts = Array.from(revenueByCompany.entries())
    .filter(([companyId, carr]) => carr.previousArr > 0 && !teamCompanyIds.has(companyId))
    .map(([companyId, carr]) => {
      const candidates = candidatesByCompany.get(companyId) || carrCandidatesByCompany.get(companyId) || [];
      const ownerId = companyCsmOwnerId(companiesById.get(companyId)?.properties);
      return { companyId, carr, candidates, ownerId };
    });
  let hubspotOwnersById = new Map<string, HubspotOwner>();
  try {
    hubspotOwnersById = await fetchHubspotOwnersById(outsideDrafts.map((draft) => draft.ownerId));
  } catch {
    warnings.add("HubSpot owner names were unavailable for the outside-team list, so owner IDs are shown instead.");
  }
  const outsideAccounts: AccountManagementOutsideTeamRow[] = outsideDrafts
    .map(({ companyId, carr, candidates, ownerId }) => {
      const companyName =
        String(companiesById.get(companyId)?.properties?.name || "").trim() ||
        carr.companyName ||
        `Company ${companyId}`;
      const previousArr = round2(carr.previousArr);
      const currentArr = round2(carr.currentArr);
      const portfolioDealIds = candidates.map((candidate) => candidate.dealId);
      const revenueSource: AccountManagementAccountRow["revenueSource"] = existingBusinessCompanyIds.has(companyId)
        ? "hubspot_carr"
        : "stripe_arr";
      return {
        companyId,
        companyName,
        companyUrl: companyUrl(portalId, companyId),
        ownerId,
        ownerName: ownerDisplayName(hubspotOwnersById.get(ownerId), ownerId),
        portfolioDealIds,
        portfolioDealNames: candidates.map((candidate) => candidate.dealName),
        portfolioDealUrls: portfolioDealIds.map((dealId) => dealUrl(portalId, dealId)),
        portfolioDealChurnReasons: candidates.map((candidate) => candidate.churnReason),
        revenueSource,
        workspaceId: candidates.find((candidate) => candidate.workspaceId)?.workspaceId || "",
        previousArr,
        currentArr,
        netChange: round2(currentArr - previousArr),
        nrrPct: previousArr > 0 ? round2((currentArr / previousArr) * 100) : null,
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
    comparisonStartDate: window.previousQuarterEnd,
    targetCurrency: FX_TARGET_CURRENCY,
    generatedAt: new Date().toISOString(),
    allCompanies,
    team: calculateRetentionMetrics(allAccounts),
    outsideTeam: {
      ...calculateRetentionMetrics(outsideAccounts),
      accounts: outsideAccounts,
    },
    owners,
    warnings: Array.from(warnings),
    methodology: {
      portfolioDealType:
        "All HubSpot deals whose Deal Type is Existing Business, plus closed-won deals in the Transactional pipeline whose line items contain Team and do not contain Plus.",
      allCompaniesCohort:
        "Company-wide NRR includes every company with prior-quarter-end HubSpot CARR plus eligible Transactional Team companies measured from Stripe ARR, regardless of owner. For a Transactional Team company without an Existing Business portfolio deal, Stripe replaces any HubSpot CARR value so the company is counted once.",
      outsideTeamCohort:
        "The outside-team table is the company-wide prior-quarter NRR cohort minus companies whose current HubSpot company CSM owner is Chloé, Sam, or Kieran.",
      ownerCohort: "Each company is assigned using the current value of the CSM owner property (`csm_owner`) on its HubSpot company record. Deal ownership is not used.",
      carrCalculation:
        "Existing Business companies use the HubSpot CARR report's contracted-ARR engine. Closed-won Transactional deals whose line items identify Team and do not mention Plus use Stripe month-end base-subscription ARR, joined through the deal's primary workspace ID. Stripe add-ons, AI tokens, conversation sessions, and web search/crawl revenue are excluded. If a company has both qualifying deal types, Existing Business HubSpot CARR takes precedence to avoid double counting.",
      nrrFormula:
        "NRR = current quarter-end ARR for the same prior-quarter-end account cohort ÷ prior quarter-end ARR. Accounts with no prior-quarter-end ARR are shown but excluded from both sides of NRR.",
    },
  };
}
