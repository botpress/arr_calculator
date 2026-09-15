import {
  ACCOUNT_MANAGER_CONFIGS,
  accountManagementQuarterWindow,
  calculateRetentionMetrics,
  dealOwnerAtCutoff,
  retentionMovement,
  type RetentionMetrics,
  type RetentionMovement,
} from "@/lib/accountManagementRules";
import {
  batchReadCompanies,
  batchReadDealPropertyHistory,
  fetchCompanyIdsForDeals,
  fetchDealsByDealType,
  fetchHubspotOwnersById,
  type HubspotDealWithPropertyHistory,
  type HubspotOwner,
} from "@/lib/hubspot";
import { FX_TARGET_CURRENCY, round2 } from "@/lib/logic";
import { generateReport } from "@/lib/report";
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
  ownerSnapshotDate: string;
  targetCurrency: string;
  generatedAt: string;
  allHubspot: RetentionMetrics;
  team: RetentionMetrics;
  outsideTeam: RetentionMetrics & { accounts: AccountManagementOutsideTeamRow[] };
  owners: AccountManagementOwnerRow[];
  warnings: string[];
  methodology: {
    portfolioDealType: string;
    allHubspotCohort: string;
    outsideTeamCohort: string;
    ownerCohort: string;
    carrCalculation: string;
    nrrFormula: string;
  };
};

type PortfolioCandidate = {
  companyId: string;
  ownerId: string;
  ownerAssignedAt: string;
  createdAt: string;
  dealId: string;
  dealName: string;
};

type CompanyCarr = {
  companyName: string;
  previousArr: number;
  currentArr: number;
};

function quarterLabel(quarterKey: string) {
  const [year, quarter] = quarterKey.split("-");
  return `${quarter} ${year}`;
}

function firstNumericId(value: unknown) {
  return (
    String(value || "")
      .split(/[,\s;|]+/)
      .map((part) => part.trim())
      .find((part) => /^\d+$/.test(part)) || ""
  );
}

function timestampMs(value: unknown) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function winningOwnerCandidates(candidates: PortfolioCandidate[]) {
  const sorted = candidates.slice().sort((a, b) => {
    const effectiveA = timestampMs(a.ownerAssignedAt) || timestampMs(a.createdAt);
    const effectiveB = timestampMs(b.ownerAssignedAt) || timestampMs(b.createdAt);
    return effectiveB - effectiveA || b.dealId.localeCompare(a.dealId, undefined, { numeric: true });
  });
  const winningOwnerId = sorted[0]?.ownerId || "";
  return sorted.filter((candidate) => candidate.ownerId === winningOwnerId);
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

  const [portfolioDeals, carrReport] = await Promise.all([
    fetchDealsByDealType(
      ["dealname", "dealtype", "hubspot_owner_id", "hubspot_owner_assigneddate", "createdate"],
      "existingbusiness",
    ),
    generateReport({
      startDate: window.previousQuarterEnd,
      endDate: window.currentQuarterEnd,
      mode: "contracted",
      grain: "monthly",
      contractedIncludeAllDeals: true,
    }),
  ]);

  let historyByDealId = new Map<string, HubspotDealWithPropertyHistory>();
  try {
    const reportDealIds = carrReport.rows.map((row) => String(row.dealId || "").trim()).filter(Boolean);
    historyByDealId = await batchReadDealPropertyHistory(
      [...portfolioDeals.map((deal) => String(deal.id || "")), ...reportDealIds],
      ["hubspot_owner_id", "hubspot_owner_assigneddate", "createdate", "dealname"],
    );
  } catch {
    warnings.add(
      "HubSpot owner history was unavailable, so unchanged owners assigned before the snapshot date were used where possible.",
    );
  }

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
    const historyDeal = historyByDealId.get(dealId);
    const ownerAtSnapshot = dealOwnerAtCutoff({
      history: historyDeal?.propertiesWithHistory?.hubspot_owner_id,
      cutoffIso: window.ownerCutoffIso,
      currentOwnerId: currentProperty(deal, "hubspot_owner_id"),
      currentOwnerAssignedAt: currentProperty(deal, "hubspot_owner_assigneddate"),
      createdAt: currentProperty(deal, "createdate"),
    });
    if (ownerAtSnapshot.source === "not_created") continue;

    const companyIds = companyIdsByPortfolioDeal.get(dealId) || [];
    const companyId = companyIds[0] || "";
    if (!companyId) {
      missingPortfolioCompanyCount += 1;
      continue;
    }

    if (!candidatesByCompany.has(companyId)) candidatesByCompany.set(companyId, []);
    candidatesByCompany.get(companyId)!.push({
      companyId,
      ownerId: ownerAtSnapshot.ownerId,
      ownerAssignedAt: ownerAtSnapshot.assignedAt,
      createdAt: currentProperty(deal, "createdate"),
      dealId,
      dealName: currentProperty(deal, "dealname") || `Deal ${dealId}`,
    });
  }

  if (missingPortfolioCompanyCount) {
    warnings.add(
      `${missingPortfolioCompanyCount} Existing Business deal${missingPortfolioCompanyCount === 1 ? " was" : "s were"} excluded because no HubSpot company was associated.`,
    );
  }

  const winningCandidatesByCompany = new Map<string, PortfolioCandidate[]>();
  let conflictingOwnerCount = 0;
  for (const [companyId, candidates] of candidatesByCompany.entries()) {
    if (new Set(candidates.map((candidate) => candidate.ownerId)).size > 1) conflictingOwnerCount += 1;
    winningCandidatesByCompany.set(companyId, winningOwnerCandidates(candidates));
  }

  if (conflictingOwnerCount) {
    warnings.add(
      `${conflictingOwnerCount} compan${conflictingOwnerCount === 1 ? "y had" : "ies had"} Existing Business deals assigned to multiple managers at the snapshot; the most recently assigned deal determined ownership.`,
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

  const allHubspot = calculateRetentionMetrics(Array.from(carrByCompany.values()));

  const carrCandidatesByCompany = new Map<string, PortfolioCandidate[]>();
  for (const [companyId, dealIds] of carrDealIdsByCompany.entries()) {
    for (const dealId of dealIds) {
      const deal = historyByDealId.get(dealId);
      const properties = deal?.properties || {};
      const ownerAtSnapshot = dealOwnerAtCutoff({
        history: deal?.propertiesWithHistory?.hubspot_owner_id,
        cutoffIso: window.ownerCutoffIso,
        currentOwnerId: String(properties.hubspot_owner_id || "").trim(),
        currentOwnerAssignedAt: String(properties.hubspot_owner_assigneddate || "").trim(),
        createdAt: String(properties.createdate || deal?.createdAt || "").trim(),
      });
      if (ownerAtSnapshot.source === "not_created") continue;
      if (!carrCandidatesByCompany.has(companyId)) carrCandidatesByCompany.set(companyId, []);
      carrCandidatesByCompany.get(companyId)!.push({
        companyId,
        ownerId: ownerAtSnapshot.ownerId,
        ownerAssignedAt: ownerAtSnapshot.assignedAt,
        createdAt: String(properties.createdate || deal?.createdAt || "").trim(),
        dealId,
        dealName: String(properties.dealname || "").trim() || carrDealNameById.get(dealId) || `Deal ${dealId}`,
      });
    }
  }
  const winningCarrCandidatesByCompany = new Map(
    Array.from(carrCandidatesByCompany.entries()).map(([companyId, candidates]) => [
      companyId,
      winningOwnerCandidates(candidates),
    ]),
  );

  const companyIdsToRead = Array.from(new Set([
    ...winningCandidatesByCompany.keys(),
    ...carrByCompany.keys(),
  ]));
  const companiesById = companyIdsToRead.length
    ? await batchReadCompanies(companyIdsToRead, ["name"])
    : new Map();
  const accountsByOwnerId = new Map<string, AccountManagementAccountRow[]>(
    ACCOUNT_MANAGER_CONFIGS.map((owner) => [owner.ownerId, []]),
  );

  for (const [companyId, candidates] of winningCandidatesByCompany.entries()) {
    const ownerId = candidates[0]?.ownerId || "";
    if (!accountsByOwnerId.has(ownerId)) continue;
    const carr = carrByCompany.get(companyId) || { companyName: "", previousArr: 0, currentArr: 0 };
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
      `${noBaselineCount} portfolio account${noBaselineCount === 1 ? " has" : "s have"} no prior-quarter CARR and therefore does not affect NRR.`,
    );
  }

  const teamCompanyIds = new Set(allAccounts.map((account) => account.companyId));
  const outsideDrafts = Array.from(carrByCompany.entries())
    .filter(([companyId, carr]) => carr.previousArr > 0 && !teamCompanyIds.has(companyId))
    .map(([companyId, carr]) => {
      const candidates = winningCandidatesByCompany.get(companyId) || winningCarrCandidatesByCompany.get(companyId) || [];
      return { companyId, carr, candidates, ownerId: candidates[0]?.ownerId || "" };
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
      return {
        companyId,
        companyName,
        companyUrl: companyUrl(portalId, companyId),
        ownerId,
        ownerName: ownerDisplayName(hubspotOwnersById.get(ownerId), ownerId),
        portfolioDealIds,
        portfolioDealNames: candidates.map((candidate) => candidate.dealName),
        portfolioDealUrls: portfolioDealIds.map((dealId) => dealUrl(portalId, dealId)),
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
    ownerSnapshotDate: window.previousQuarterEnd,
    targetCurrency: FX_TARGET_CURRENCY,
    generatedAt: new Date().toISOString(),
    allHubspot,
    team: calculateRetentionMetrics(allAccounts),
    outsideTeam: {
      ...calculateRetentionMetrics(outsideAccounts),
      accounts: outsideAccounts,
    },
    owners,
    warnings: Array.from(warnings),
    methodology: {
      portfolioDealType: "All HubSpot deals whose Deal Type is Existing Business, regardless of deal stage.",
      allHubspotCohort:
        "Company-wide NRR includes every company with prior-quarter-end CARR across all deals in the HubSpot CARR report, regardless of deal owner. It is separate from the three-person Account Management team cohort.",
      outsideTeamCohort:
        `The outside-team table is the company-wide prior-quarter NRR cohort minus companies assigned to Chloé, Sam, or Kieran on ${window.previousQuarterEnd}. Deal owners use Existing Business ownership first, then the company's CARR-producing deal ownership when no Existing Business deal is available.`,
      ownerCohort: `Each company is assigned to Chloé, Sam, or Kieran using Existing Business deal-owner history as of ${window.previousQuarterEnd}. If a company has conflicting managers, the most recently assigned deal wins.`,
      carrCalculation:
        "Previous and current ARR use the HubSpot CARR report's contracted-ARR engine: recurring line items are annualized, converted using close-month FX, and included when their contract window covers the month end.",
      nrrFormula:
        "NRR = current quarter-end CARR for the same prior-quarter-end account cohort ÷ prior quarter-end CARR. Accounts with no prior-quarter-end CARR are shown but excluded from both sides of NRR.",
    },
  };
}
