import { FX_TARGET_CURRENCY } from "@/lib/logic";
import {
  getTeamScorecardDefinition,
  isTeamScorecardKey,
  type TeamScorecardKey,
  type TeamScorecardMetricDefinition,
} from "@/lib/teamScorecardDefinitions";
import {
  queryScorecardAccountManagerMetrics,
  queryScorecardCarrMetrics,
  queryScorecardContactMetrics,
  queryScorecardDealMetrics,
  queryScorecardQuotaMetrics,
  type ScorecardAccountManagerMetric,
  type ScorecardCarrMetrics,
  type ScorecardContactMetrics,
  type ScorecardDealMetrics,
  type ScorecardQuotaMetric,
} from "@/lib/teamScorecardBigquery";

export type TeamScorecardValueFormat = "currency" | "percent" | "count" | "number" | "text";

export type TeamScorecardValue = {
  label: string;
  value: number | string;
  format: TeamScorecardValueFormat;
  context?: string;
};

export type TeamScorecardMetric = TeamScorecardMetricDefinition & {
  values: TeamScorecardValue[];
  source: string;
  calculation: string;
  valueKind: "calculated" | "manual" | "blank";
  manualValue?: number;
  manualUpdatedAt?: string;
  manualUpdatedBy?: string;
};

export type TeamScorecardReportResponse = {
  teamKey: TeamScorecardKey;
  teamName: string;
  teamDescription: string;
  startDate: string;
  endDate: string;
  targetCurrency: string;
  generatedAt: string;
  populatedMetricCount: number;
  totalMetricCount: number;
  canEditManualValues: boolean;
  metrics: TeamScorecardMetric[];
  warnings: string[];
};

export type TeamScorecardReportRequest = {
  team?: string;
  startDate?: string;
  endDate?: string;
};

export const TEAM_SCORECARD_MIN_DATE = "2022-08-01";

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ${label}; expected YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ${label}; expected YYYY-MM-DD`);
  }
  return parsed;
}

function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

export function normalizeTeamScorecardRequest(request: TeamScorecardReportRequest) {
  const today = isoToday();
  const teamRaw = String(request.team || "").trim().toLowerCase();
  if (!isTeamScorecardKey(teamRaw)) throw new Error("Invalid team scorecard");
  const endDate = String(request.endDate || today).trim();
  const startDate = String(request.startDate || monthStart(endDate)).trim();
  const start = parseIsoDate(startDate, "startDate");
  const end = parseIsoDate(endDate, "endDate");
  if (start > end) throw new Error("startDate must be on or before endDate");
  if (endDate > today) throw new Error("endDate cannot be in the future");
  if (startDate < TEAM_SCORECARD_MIN_DATE) throw new Error(`startDate cannot be before ${TEAM_SCORECARD_MIN_DATE}`);
  return { team: teamRaw, startDate, endDate };
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function money(label: string, value: number, context?: string): TeamScorecardValue {
  return { label, value, format: "currency", context };
}

function count(label: string, value: number, context?: string): TeamScorecardValue {
  return { label, value, format: "count", context };
}

function percent(label: string, value: number, context?: string): TeamScorecardValue {
  return { label, value, format: "percent", context };
}

function reportMetric(definition: TeamScorecardMetricDefinition): TeamScorecardMetric {
  return { ...definition, values: [], source: "", calculation: "", valueKind: "blank" };
}

function populateMetric(
  metrics: TeamScorecardMetric[],
  id: string,
  values: TeamScorecardValue[],
  source: string,
  calculation: string,
) {
  const row = metrics.find((metric) => metric.id === id);
  if (!row) return;
  row.values = values;
  row.source = source;
  row.calculation = calculation;
  row.valueKind = "calculated";
}

function populateProduct(metrics: TeamScorecardMetric[], carr: ScorecardCarrMetrics | null) {
  if (!carr?.hasData) return;
  populateMetric(metrics, "churn-by-motion", [
    money("Product-led churn ARR", Math.abs(carr.selfserveChurnArr)),
    count("Product-led churned logos", carr.selfserveChurnLogos),
    money("Sales-led churn ARR", Math.abs(carr.salesLedChurnArr)),
    count("Sales-led churned logos", carr.salesLedChurnLogos),
  ], "Combined CARR model · BigQuery", "Daily churn movements in the selected range; ARR is shown as a positive magnitude and logos are summed churn events.");

  const selfserveNrr = ratio(
    carr.selfserveOpeningArr + carr.selfserveExpansionArr + carr.selfserveContractionArr + carr.selfserveChurnArr,
    carr.selfserveOpeningArr,
  );
  if (selfserveNrr != null) {
    populateMetric(metrics, "selfserve-nrr", [percent("Self-serve NRR", selfserveNrr)], "Combined CARR model · BigQuery", "(Opening self-serve ARR + expansion + contraction + churn) ÷ opening self-serve ARR. New, reactivation, and motion transfers are excluded.");
  }

  const totalNrr = ratio(
    carr.totalOpeningArr + carr.totalExpansionArr + carr.totalContractionArr + carr.totalChurnArr,
    carr.totalOpeningArr,
  );
  if (totalNrr != null) {
    populateMetric(metrics, "net-revenue-retention", [percent("NRR", totalNrr)], "Combined CARR model · BigQuery", "(Opening ARR + expansion + contraction + churn) ÷ opening ARR across self-serve, Sales Assist, and sales-led motions. New, reactivation, and transfers are excluded.");
  }
}

function populateSales(
  metrics: TeamScorecardMetric[],
  carr: ScorecardCarrMetrics | null,
  deals: ScorecardDealMetrics | null,
  contacts: ScorecardContactMetrics | null,
  quotas: ScorecardQuotaMetric[] | null,
) {
  if (carr?.hasData) {
    populateMetric(metrics, "arr-new-expansion", [money("Sales ARR", carr.salesNewAndExpansionArr)], "Combined CARR model · BigQuery", "New + reactivation + expansion ARR in Sales Assist and sales-led daily CARR movements for the selected range. The V2 target cell is blank, so no plan value is inferred.");
  }
  if (deals) {
    populateMetric(metrics, "pipeline-generated", [
      count("Deals created", deals.pipelineCreatedDeals),
      money("Pipeline ARR", deals.pipelineCreatedArr),
    ], "HubSpot deals replica · BigQuery", "New Business deals created in the Sales Default or Transactional pipeline during the selected range; ARR uses contracted CARR, ARR, or deal amount in that order.");
    const closedTotal = deals.salesLedClosedWon + deals.salesLedClosedLost;
    if (closedTotal > 0) {
      populateMetric(metrics, "sales-led-close-rate", [
        percent("Close rate", deals.salesLedClosedWon / closedTotal),
        count("Closed won", deals.salesLedClosedWon),
        count("Closed lost", deals.salesLedClosedLost),
      ], "HubSpot deals replica · BigQuery", "Closed won ÷ closed won plus closed lost in the Sales Default pipeline for verdicts in the selected range.");
    }
  }
  if (contacts && contacts.mqlCount > 0) {
    populateMetric(metrics, "mql-to-sql", [
      percent("Directional conversion", contacts.sqlCount / contacts.mqlCount),
      count("MQLs", contacts.mqlCount),
      count("SQLs", contacts.sqlCount),
    ], "HubSpot contacts replica · BigQuery", "Contacts entering SQL during the selected range ÷ contacts entering MQL during the selected range. This is a directional period ratio, not a matured-contact cohort conversion.");
  }
  if (quotas) {
    populateMetric(metrics, "isr-quota-attainment", quotas.map((quota) => percent(
      quota.ownerName,
      quota.attainmentPct / 100,
      `${quota.cadence === "quarterly" ? "Quarter" : "Month"} ${quota.periodStart}–${quota.periodEnd} · ${quota.dealCount} deal${quota.dealCount === 1 ? "" : "s"}`,
    )), "HubSpot deals and owners replica · BigQuery", "Closed-won New Business and Existing Business deal amount divided by each ISR's configured monthly or quarterly quota, calculated as of the selected end date.");
  }
}

function populateAccountManagement(
  metrics: TeamScorecardMetric[],
  carr: ScorecardCarrMetrics | null,
  deals: ScorecardDealMetrics | null,
  accountManagers: ScorecardAccountManagerMetric[] | null,
) {
  if (deals) {
    const renewalVerdicts = deals.renewalClosedWon + deals.renewalClosedLost;
    if (renewalVerdicts > 0) {
      populateMetric(metrics, "renewal-rate", [
        percent("Renewal rate", deals.renewalClosedWon / renewalVerdicts),
        count("Closed won", deals.renewalClosedWon),
        count("Closed lost", deals.renewalClosedLost),
      ], "HubSpot deals replica · BigQuery", "Closed-won Existing Business deals ÷ Existing Business deals closed won or lost in the Sales Default and Transactional pipelines during the selected range.");
    }
  }
  if (accountManagers) {
    populateMetric(metrics, "accounts-arr-per-am", accountManagers.flatMap((owner) => [
      count(`${owner.ownerName} accounts`, owner.accountCount),
      money(`${owner.ownerName} ending ARR`, owner.endingArr),
    ]), "Combined CARR + HubSpot deals/owners replica · BigQuery", "Active accounts and ending ARR at the selected end date, assigned using each company's latest current Existing Business deal owner.");

    const openingTeamArr = accountManagers.reduce((sum, owner) => sum + owner.openingCohortArr, 0);
    const endingTeamArr = accountManagers.reduce((sum, owner) => sum + owner.endingCohortArr, 0);
    const nrrValues = accountManagers.flatMap((owner) => owner.nrrPct == null ? [] : [percent(owner.ownerName, owner.nrrPct / 100)]);
    if (openingTeamArr > 0) nrrValues.unshift(percent("Team", endingTeamArr / openingTeamArr));
    if (nrrValues.length) {
      populateMetric(metrics, "nrr-by-am", nrrValues, "Combined CARR + HubSpot deals/owners replica · BigQuery", "Ending ARR ÷ opening ARR for the same opening account cohort. Companies are assigned using their latest current Existing Business deal owner; historical owner changes are not reconstructed.");
    }
  }
  if (carr?.hasData) {
    populateMetric(metrics, "sales-led-expansion", [money("Expansion ARR", carr.salesLedExpansionArr)], "Combined CARR model · BigQuery", "Sales-led expansion ARR from daily CARR movements in the selected range. New ARR and Sales Assist expansion are excluded.");
  }
}

async function safeQuery<T>(label: string, warnings: string[], query: () => Promise<T>): Promise<T | null> {
  try {
    return await query();
  } catch (error: unknown) {
    warnings.push(`${label} unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function generateTeamScorecardReport(rawRequest: TeamScorecardReportRequest): Promise<TeamScorecardReportResponse> {
  const request = normalizeTeamScorecardRequest(rawRequest);
  const definition = getTeamScorecardDefinition(request.team);
  const metrics = definition.metrics.map(reportMetric);
  const warnings: string[] = [];

  if (request.team === "product") {
    const carr = await safeQuery("CARR metrics", warnings, () => queryScorecardCarrMetrics(request.startDate, request.endDate));
    populateProduct(metrics, carr);
  } else if (request.team === "sales") {
    const [carr, deals, contacts, quotas] = await Promise.all([
      safeQuery("CARR metrics", warnings, () => queryScorecardCarrMetrics(request.startDate, request.endDate)),
      safeQuery("HubSpot deal metrics", warnings, () => queryScorecardDealMetrics(request.startDate, request.endDate)),
      safeQuery("HubSpot contact metrics", warnings, () => queryScorecardContactMetrics(request.startDate, request.endDate)),
      safeQuery("ISR quota metrics", warnings, () => queryScorecardQuotaMetrics(request.endDate)),
    ]);
    populateSales(metrics, carr, deals, contacts, quotas);
  } else if (request.team === "account-management") {
    const [carr, deals, accountManagers] = await Promise.all([
      safeQuery("CARR metrics", warnings, () => queryScorecardCarrMetrics(request.startDate, request.endDate)),
      safeQuery("HubSpot deal metrics", warnings, () => queryScorecardDealMetrics(request.startDate, request.endDate)),
      safeQuery("Account-manager metrics", warnings, () => queryScorecardAccountManagerMetrics(request.startDate, request.endDate)),
    ]);
    populateAccountManagement(metrics, carr, deals, accountManagers);
  }

  return {
    teamKey: request.team,
    teamName: definition.name,
    teamDescription: definition.description,
    startDate: request.startDate,
    endDate: request.endDate,
    targetCurrency: String(FX_TARGET_CURRENCY || "USD").toUpperCase(),
    generatedAt: new Date().toISOString(),
    populatedMetricCount: metrics.filter((metric) => metric.values.length > 0).length,
    totalMetricCount: metrics.length,
    canEditManualValues: false,
    metrics,
    warnings,
  };
}
