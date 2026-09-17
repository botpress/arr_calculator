import { getMonthlyAverageFxRateForCloseMonth } from "@/lib/fx";
import {
  batchReadCompanies,
  batchReadContacts,
  batchReadLineItems,
  fetchCompanyIdsForDeals,
  fetchContactIdsForCompanies,
  fetchDealsInStage,
  fetchLineItemIdsForDeals,
} from "@/lib/hubspot";
import {
  computeCalculatedArrForLineItem,
  computeWindowForLineItem,
  FX_TARGET_CURRENCY,
  LI_PROPS,
  parseDate,
  round2,
} from "@/lib/logic";
import {
  calculateMigrationGoalMetrics,
  calculateMigrationMetrics,
  isHubspotMigrationUpsellType,
  migrationPlanDisplayName,
  migrationPlanGeneration,
  migrationReportWindow,
  type LegacyPopulationSummary,
  type MigrationGoalMetrics,
  type MigrationPlanGeneration,
} from "@/lib/migrationRules";
import {
  queryStripeLegacyPlanPopulationFromBigQuery,
  queryStripeLegacyToV4MigrationsFromBigQuery,
  type StripeLegacyPlanPopulationResult,
  type StripeLegacyToV4MigrationRow,
} from "@/lib/stripeBigquery";
import type { HubspotLineItem } from "@/lib/types";

export type MigrationSource = "stripe" | "hubspot";

export type MigrationDetailRow = {
  migrationKey: string;
  source: MigrationSource;
  customerId: string;
  customerName: string;
  customerEmail: string;
  workspaceId: string;
  migratedAt: string;
  previousPlan: string;
  currentPlan: string;
  migratedArr: number;
  priorLegacyArr: number;
  migratedV4Arr: number;
  resultingExpansion: number;
  recordUrl: string;
};

export type MigrationCustomerExportRow = {
  source: MigrationSource;
  customerId: string;
  customerName: string;
  customerEmail: string;
  workspaceId: string;
  arr: number;
  arrAfterMigration: number | null;
  resultingExpansion: number | null;
  migratedAt: string;
  previousPlan: string;
  currentPlan: string;
  recordUrl: string;
};

export type MigrationSummary = {
  arrMigrated: number;
  logosMigrated: number;
  resultingExpansion: number;
};

export type MigrationReportResponse = {
  asOfDate: string;
  rangeStart: string;
  rangeEnd: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  currentMonthStart: string;
  targetCurrency: string;
  generatedAt: string;
  fiscalYear: MigrationSummary;
  selectedRange: MigrationSummary;
  currentMonth: MigrationSummary;
  goal: MigrationGoalMetrics & {
    sourcePopulations: Array<{
      source: MigrationSource;
      sourceLabel: string;
      opening: LegacyPopulationSummary;
      current: LegacyPopulationSummary;
    }>;
  };
  sourceBreakdown: Array<{
    source: MigrationSource;
    sourceLabel: string;
    fiscalYear: MigrationSummary;
    selectedRange: MigrationSummary;
    currentMonth: MigrationSummary;
  }>;
  months: Array<{
    monthKey: string;
    monthLabel: string;
    arrMigrated: number;
    logosMigrated: number;
    resultingExpansion: number;
  }>;
  migrations: MigrationDetailRow[];
  customerLists: {
    openingLegacy: MigrationCustomerExportRow[];
    currentLegacy: MigrationCustomerExportRow[];
    migrations: MigrationCustomerExportRow[];
  };
  warnings: string[];
  methodology: string[];
};

const DEFAULT_SALES_PIPELINE_ID = "0cbbc8c6-dccf-4601-8d59-b6a15ed5129b";
const DEFAULT_SALES_CLOSED_WON_STAGE_ID = "f12c408f-f92b-4a95-8b59-9f801b19b105";

type HubspotDealPlanRecord = {
  dealId: string;
  dealName: string;
  closeDate: string;
  currency: string;
  workspaceId: string;
  customerKey: string;
  companyId: string;
  companyName: string;
  companyWorkspaceId: string;
  customerEmail: string;
  migrationUpsell: boolean;
  v2Arr: number;
  v3Arr: number;
  v4Arr: number;
  v2Plans: string[];
  v3Plans: string[];
  v4Plans: string[];
};

type HubspotPlanActivity = {
  customerKey: string;
  generation: MigrationPlanGeneration;
  planLabel: string;
  arr: number;
  closeDate: string;
  startDate: string;
  endDate: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  workspaceId: string;
  recordUrl: string;
};

type HubspotMigrationResult = {
  migrations: MigrationDetailRow[];
  opening: LegacyPopulationSummary;
  current: LegacyPopulationSummary;
  openingCustomers: MigrationCustomerExportRow[];
  currentCustomers: MigrationCustomerExportRow[];
};

function envValue(name: string, fallback: string) {
  return String(process.env[name] || fallback).trim() || fallback;
}

function todayInToronto() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function normalizedWorkspaceId(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function hubspotLegacyPopulation(activities: HubspotPlanActivity[], snapshotDate: string) {
  const balances = new Map<string, {
    legacyArr: number;
    v4Arr: number;
    customerId: string;
    customerName: string;
    customerEmail: string;
    workspaceId: string;
    recordUrl: string;
  }>();
  for (const activity of activities) {
    if (
      activity.closeDate > snapshotDate ||
      activity.startDate > snapshotDate ||
      activity.endDate < snapshotDate
    ) {
      continue;
    }
    const balance = balances.get(activity.customerKey) || {
      legacyArr: 0,
      v4Arr: 0,
      customerId: activity.customerId,
      customerName: activity.customerName,
      customerEmail: activity.customerEmail,
      workspaceId: activity.workspaceId,
      recordUrl: activity.recordUrl,
    };
    if (activity.generation === "v4") balance.v4Arr += activity.arr;
    else balance.legacyArr += activity.arr;
    balances.set(activity.customerKey, balance);
  }

  let customers = 0;
  let arr = 0;
  const rows: MigrationCustomerExportRow[] = [];
  for (const balance of balances.values()) {
    if (balance.legacyArr <= 0 || balance.v4Arr > 0) continue;
    customers += 1;
    arr += balance.legacyArr;
    rows.push({
      source: "hubspot",
      customerId: balance.customerId,
      customerName: balance.customerName || balance.customerId,
      customerEmail: balance.customerEmail,
      workspaceId: balance.workspaceId,
      arr: round2(balance.legacyArr),
      arrAfterMigration: null,
      resultingExpansion: null,
      migratedAt: "",
      previousPlan: "",
      currentPlan: "",
      recordUrl: balance.recordUrl,
    });
  }
  rows.sort((a, b) => a.customerName.localeCompare(b.customerName) || a.customerId.localeCompare(b.customerId));
  return { summary: { customers, arr: round2(arr) }, rows };
}

function hubspotPlanLabelsAtSnapshot(activities: HubspotPlanActivity[], snapshotDate: string) {
  const labels = new Map<string, Set<string>>();
  for (const activity of activities) {
    if (
      activity.closeDate > snapshotDate ||
      activity.startDate > snapshotDate ||
      activity.endDate < snapshotDate
    ) {
      continue;
    }
    if (!labels.has(activity.customerKey)) labels.set(activity.customerKey, new Set<string>());
    labels.get(activity.customerKey)!.add(activity.planLabel);
  }
  return new Map(
    Array.from(labels.entries()).map(([customerKey, values]) => [
      customerKey,
      Array.from(values).sort((a, b) => a.localeCompare(b)),
    ]),
  );
}

function hubspotLegacyArrImmediatelyBefore(
  activities: HubspotPlanActivity[],
  customerKey: string,
  migrationDate: string,
) {
  const snapshot = new Date(`${migrationDate}T00:00:00.000Z`);
  snapshot.setUTCDate(snapshot.getUTCDate() - 1);
  const snapshotDate = snapshot.toISOString().slice(0, 10);
  return round2(activities.reduce((sum, activity) => {
    if (
      activity.customerKey !== customerKey ||
      activity.generation === "v4" ||
      activity.closeDate > snapshotDate ||
      activity.startDate > snapshotDate ||
      activity.endDate < snapshotDate
    ) {
      return sum;
    }
    return sum + activity.arr;
  }, 0));
}

function lineItemDescriptions(lineItem: HubspotLineItem | undefined) {
  const properties = lineItem?.properties || {};
  return [properties.name, properties.hs_product_name, properties.description, properties.hs_sku]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function hubspotRecordUrl(portalId: string, dealId: string) {
  return `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}?utm_source=arr_dashboard&utm_medium=internal&utm_campaign=migration`;
}

function hubspotCompanyUrl(portalId: string, companyId: string) {
  return companyId
    ? `https://app.hubspot.com/contacts/${portalId}/record/0-2/${companyId}?utm_source=arr_dashboard&utm_medium=internal&utm_campaign=migration`
    : "";
}

function stripeRecordUrl(customerId: string) {
  return `https://dashboard.stripe.com/customers/${encodeURIComponent(customerId)}`;
}

function monthLabel(monthKey: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${monthKey}-01T12:00:00.000Z`));
}

function monthKeys(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const keys: string[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    keys.push(cursor.toISOString().slice(0, 7));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return keys;
}

function unknownPropertyError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("property") && (message.includes("does not exist") || message.includes("not a valid property"));
}

async function fetchHubspotSalesDeals(properties: string[], closedWonStageId: string) {
  try {
    return await fetchDealsInStage(properties, closedWonStageId);
  } catch (error) {
    if (!unknownPropertyError(error)) throw error;
    return fetchDealsInStage(properties.filter((property) => property !== "workspace_id"), closedWonStageId);
  }
}

async function generateHubspotMigrations(options: {
  startDate: string;
  populationStartDate: string;
  endDate: string;
  targetCurrency: string;
  portalId: string;
  warnings: Set<string>;
}): Promise<HubspotMigrationResult> {
  const salesPipelineId = envValue("HUBSPOT_COMMISSION_SALES_PIPELINE_ID", DEFAULT_SALES_PIPELINE_ID);
  const closedWonStageId = envValue(
    "HUBSPOT_COMMISSION_SALES_CLOSED_WON_STAGE_ID",
    DEFAULT_SALES_CLOSED_WON_STAGE_ID,
  );
  const deals = (
    await fetchHubspotSalesDeals(
      ["dealname", "dealtype", "pipeline", "closedate", "deal_currency_code", "workspace_id", "upsell_type"],
      closedWonStageId,
    )
  ).filter((deal) => String(deal.properties?.pipeline || "").trim() === salesPipelineId);
  if (!deals.length) {
    return {
      migrations: [],
      opening: { customers: 0, arr: 0 },
      current: { customers: 0, arr: 0 },
      openingCustomers: [],
      currentCustomers: [],
    };
  }

  const dealIds = deals.map((deal) => String(deal.id || "").trim()).filter(Boolean);
  const [lineItemPairs, companyPairs] = await Promise.all([
    fetchLineItemIdsForDeals(dealIds),
    fetchCompanyIdsForDeals(dealIds),
  ]);
  const lineItemIdsByDeal = new Map(lineItemPairs.map((pair) => [pair.dealId, pair.ids]));
  const companyIdsByDeal = new Map(companyPairs.map((pair) => [pair.dealId, pair.ids]));
  const allLineItemIds = Array.from(new Set(lineItemPairs.flatMap((pair) => pair.ids)));
  const allCompanyIds = Array.from(new Set(companyPairs.flatMap((pair) => pair.ids.slice(0, 1))));
  const lineItemsById = await batchReadLineItems(allLineItemIds, LI_PROPS);

  let companiesById = new Map<string, { id: string; properties?: Record<string, unknown> }>();
  try {
    companiesById = await batchReadCompanies(allCompanyIds, ["name", "workspaceid"]);
  } catch (error) {
    if (!unknownPropertyError(error)) throw error;
    companiesById = await batchReadCompanies(allCompanyIds, ["name"]);
  }

  const customerEmailsByCompany = new Map<string, string>();
  try {
    const contactPairs = await fetchContactIdsForCompanies(allCompanyIds);
    const allContactIds = Array.from(new Set(contactPairs.flatMap((pair) => pair.ids)));
    const contactsById = await batchReadContacts(allContactIds, ["email"]);
    for (const pair of contactPairs) {
      const emails = Array.from(
        new Set(
          pair.ids
            .map((contactId) => String(contactsById.get(contactId)?.properties?.email || "").trim().toLowerCase())
            .filter((email) => email.includes("@")),
        ),
      ).sort((a, b) => a.localeCompare(b));
      customerEmailsByCompany.set(pair.companyId, emails.join(" | "));
    }
  } catch (error) {
    options.warnings.add(
      `HubSpot contact emails are temporarily unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const dealPlanRecords: HubspotDealPlanRecord[] = [];
  const planActivities: HubspotPlanActivity[] = [];
  const fxCache = new Map<string, Promise<number>>();
  async function fxRate(currency: string, closeDate: string) {
    if (currency === options.targetCurrency) return 1;
    const key = `${currency}|${options.targetCurrency}|${closeDate.slice(0, 7)}`;
    if (!fxCache.has(key)) {
      fxCache.set(
        key,
        getMonthlyAverageFxRateForCloseMonth(
          currency,
          options.targetCurrency,
          new Date(`${closeDate}T12:00:00.000Z`),
        ).then((result) => Number(result.rate || 0)),
      );
    }
    return fxCache.get(key)!;
  }

  for (const deal of deals) {
    const dealId = String(deal.id || "").trim();
    const closeDateValue = parseDate(deal.properties?.closedate);
    const closeDate = closeDateValue && !Number.isNaN(closeDateValue.getTime())
      ? closeDateValue.toISOString().slice(0, 10)
      : "";
    if (!dealId || !closeDate || closeDate > options.endDate) continue;
    const companyId = companyIdsByDeal.get(dealId)?.[0] || "";
    const company = companiesById.get(companyId);
    const companyName = String(company?.properties?.name || "").trim();
    const dealWorkspaceId = normalizedWorkspaceId(deal.properties?.workspace_id);
    const companyWorkspaceId = normalizedWorkspaceId(company?.properties?.workspaceid);
    const customerEmail = customerEmailsByCompany.get(companyId) || "";
    const workspaceId = dealWorkspaceId || companyWorkspaceId;
    const customerKey = companyId ? `company:${companyId}` : workspaceId ? `workspace:${workspaceId}` : `deal:${dealId}`;
    const currency = String(deal.properties?.deal_currency_code || options.targetCurrency).trim().toUpperCase();
    const rate = await fxRate(currency, closeDate);
    if (rate <= 0) {
      options.warnings.add(`Some ${currency} HubSpot migrations could not be converted to ${options.targetCurrency}.`);
      continue;
    }

    const dealName = String(deal.properties?.dealname || "").trim() || `Deal ${dealId}`;
    const migrationUpsell = isHubspotMigrationUpsellType(deal.properties?.upsell_type);
    let v2Arr = 0;
    let v3Arr = 0;
    let v4Arr = 0;
    const v2Plans = new Set<string>();
    const v3Plans = new Set<string>();
    const v4Plans = new Set<string>();
    for (const lineItemId of lineItemIdsByDeal.get(dealId) || []) {
      const lineItem = lineItemsById.get(lineItemId);
      const descriptions = lineItemDescriptions(lineItem);
      const generation = migrationPlanGeneration(
        descriptions,
        migrationUpsell ? "v4" : "v3",
      );
      if (!generation) continue;
      const arr = computeCalculatedArrForLineItem(lineItem?.properties || {});
      const convertedArr = round2(arr * rate);
      if (convertedArr <= 0) continue;
      const planLabel = migrationPlanDisplayName(descriptions, generation);
      if (generation === "v4") {
        v4Arr += convertedArr;
        v4Plans.add(planLabel);
      } else if (generation === "v3") {
        v3Arr += convertedArr;
        v3Plans.add(planLabel);
      } else {
        v2Arr += convertedArr;
        v2Plans.add(planLabel);
      }

      const activityWindow = computeWindowForLineItem(lineItem?.properties || {});
      if (activityWindow) {
        planActivities.push({
          customerKey,
          generation,
          planLabel,
          arr: convertedArr,
          closeDate,
          startDate: localDateKey(activityWindow.start),
          endDate: localDateKey(activityWindow.end),
          customerId: companyId || dealId,
          customerName: companyName || dealName,
          customerEmail,
          workspaceId,
          recordUrl: hubspotCompanyUrl(options.portalId, companyId) || hubspotRecordUrl(options.portalId, dealId),
        });
      }
    }
    if (v2Arr <= 0 && v3Arr <= 0 && v4Arr <= 0) continue;
    dealPlanRecords.push({
      dealId,
      dealName,
      closeDate,
      currency,
      workspaceId,
      customerKey,
      companyId,
      companyName,
      companyWorkspaceId,
      customerEmail,
      migrationUpsell,
      v2Arr: round2(v2Arr),
      v3Arr: round2(v3Arr),
      v4Arr: round2(v4Arr),
      v2Plans: Array.from(v2Plans).sort((a, b) => a.localeCompare(b)),
      v3Plans: Array.from(v3Plans).sort((a, b) => a.localeCompare(b)),
      v4Plans: Array.from(v4Plans).sort((a, b) => a.localeCompare(b)),
    });
  }

  const recordsByCustomer = new Map<string, HubspotDealPlanRecord[]>();
  for (const record of dealPlanRecords) {
    if (!recordsByCustomer.has(record.customerKey)) recordsByCustomer.set(record.customerKey, []);
    recordsByCustomer.get(record.customerKey)!.push(record);
  }

  const currentPlansByCustomer = hubspotPlanLabelsAtSnapshot(planActivities, options.endDate);
  const migrations: MigrationDetailRow[] = [];
  for (const records of recordsByCustomer.values()) {
    const sorted = records.slice().sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.dealId.localeCompare(b.dealId));
    let historicalLegacyArr = 0;
    let historicalLegacyPlans: string[] = [];
    let migrationSeen = false;
    for (const record of sorted) {
      if (!migrationSeen && record.migrationUpsell && record.v4Arr > 0) {
        migrationSeen = true;
        if (record.closeDate >= options.startDate && record.closeDate <= options.endDate) {
          const workspaceId = record.workspaceId || record.companyWorkspaceId;
          const priorLegacyArr = round2(
            hubspotLegacyArrImmediatelyBefore(planActivities, record.customerKey, record.closeDate)
            || historicalLegacyArr
            || record.v2Arr + record.v3Arr,
          );
          const resultingExpansion = round2(record.v4Arr - priorLegacyArr);
          migrations.push({
            migrationKey: `hubspot:${record.customerKey}`,
            source: "hubspot",
            customerId: record.companyId || record.dealId,
            customerName: record.companyName || record.dealName,
            customerEmail: record.customerEmail,
            workspaceId,
            migratedAt: record.closeDate,
            previousPlan: (historicalLegacyPlans.length
              ? historicalLegacyPlans
              : [...record.v2Plans, ...record.v3Plans]
            ).join(" + ") || "V2/V3 plan",
            currentPlan: currentPlansByCustomer.get(record.customerKey)?.join(" + ")
              || record.v4Plans.join(" + ")
              || "No active plan",
            migratedArr: priorLegacyArr,
            priorLegacyArr,
            migratedV4Arr: record.v4Arr,
            resultingExpansion,
            recordUrl: hubspotRecordUrl(options.portalId, record.dealId),
          });
        }
      }
      if (record.v2Arr + record.v3Arr > 0) {
        historicalLegacyArr = record.v2Arr + record.v3Arr;
        historicalLegacyPlans = [...record.v2Plans, ...record.v3Plans];
      }
    }
  }

  const openingPopulation = hubspotLegacyPopulation(planActivities, options.populationStartDate);
  const currentPopulation = hubspotLegacyPopulation(planActivities, options.endDate);
  return {
    migrations,
    opening: openingPopulation.summary,
    current: currentPopulation.summary,
    openingCustomers: openingPopulation.rows,
    currentCustomers: currentPopulation.rows,
  };
}

function stripeMigrationRow(row: StripeLegacyToV4MigrationRow): MigrationDetailRow {
  return {
    migrationKey: `stripe:${row.customerId}`,
    source: "stripe",
    customerId: row.customerId,
    customerName: row.customerName || row.customerId,
    customerEmail: row.customerEmail,
    workspaceId: normalizedWorkspaceId(row.workspaceId),
    migratedAt: row.migratedAt,
    previousPlan: row.previousPlan || "V2/V3 plan",
    currentPlan: row.currentPlan || "No active plan",
    migratedArr: round2(row.migratedArr),
    priorLegacyArr: round2(row.legacyArrBefore),
    migratedV4Arr: round2(row.v4ArrAfter),
    resultingExpansion: round2(row.v4ArrAfter - row.legacyArrBefore),
    recordUrl: stripeRecordUrl(row.customerId),
  };
}

function migrationExportRow(row: MigrationDetailRow): MigrationCustomerExportRow {
  return {
    source: row.source,
    customerId: row.customerId,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    workspaceId: row.workspaceId,
    arr: row.migratedArr,
    arrAfterMigration: row.migratedV4Arr,
    resultingExpansion: row.resultingExpansion,
    migratedAt: row.migratedAt,
    previousPlan: row.previousPlan,
    currentPlan: row.currentPlan,
    recordUrl: row.recordUrl,
  };
}

function stripePopulationExportRow(
  row: StripeLegacyPlanPopulationResult["openingCustomers"][number],
): MigrationCustomerExportRow {
  return {
    source: "stripe",
    customerId: row.customerId,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    workspaceId: row.workspaceId,
    arr: row.arr,
    arrAfterMigration: null,
    resultingExpansion: null,
    migratedAt: "",
    previousPlan: "",
    currentPlan: "",
    recordUrl: row.customerId.includes(" | ") ? "" : stripeRecordUrl(row.customerId),
  };
}

export async function generateMigrationReport(options?: {
  asOfDate?: string;
  startDate?: string;
  endDate?: string;
}): Promise<MigrationReportResponse> {
  const rangeEnd = String(options?.endDate || options?.asOfDate || todayInToronto()).trim();
  const window = migrationReportWindow(rangeEnd, options?.startDate);
  const historyStart = window.rangeStart < window.fiscalYearStart
    ? window.rangeStart
    : window.fiscalYearStart;
  const targetCurrency = String(FX_TARGET_CURRENCY || "USD").trim().toUpperCase();
  const portalId = String(process.env.HUBSPOT_PORTAL_ID || "20692578").trim() || "20692578";
  const warnings = new Set<string>();

  const [stripeResult, stripePopulationResult, hubspotResult] = await Promise.allSettled([
    queryStripeLegacyToV4MigrationsFromBigQuery(
      {
        startDate: historyStart,
        endDate: window.rangeEnd,
        targetCurrency,
      },
      { profile: "stripe_arr_correct" },
    ),
    queryStripeLegacyPlanPopulationFromBigQuery(
      {
        fiscalYearStart: window.fiscalYearStart,
        asOfDate: window.rangeEnd,
        targetCurrency,
      },
      { profile: "stripe_arr_correct" },
    ),
    generateHubspotMigrations({
      startDate: historyStart,
      populationStartDate: window.fiscalYearStart,
      endDate: window.rangeEnd,
      targetCurrency,
      portalId,
      warnings,
    }),
  ]);

  if (stripeResult.status === "rejected" && hubspotResult.status === "rejected") {
    const stripeMessage = stripeResult.reason instanceof Error ? stripeResult.reason.message : String(stripeResult.reason);
    const hubspotMessage = hubspotResult.reason instanceof Error ? hubspotResult.reason.message : String(hubspotResult.reason);
    throw new Error(`Migration sources failed. Stripe: ${stripeMessage}. HubSpot: ${hubspotMessage}.`);
  }
  if (stripeResult.status === "rejected") {
    warnings.add(
      `Stripe / BigQuery migrations are temporarily unavailable: ${
        stripeResult.reason instanceof Error ? stripeResult.reason.message : String(stripeResult.reason)
      }`,
    );
  }
  if (stripePopulationResult.status === "rejected") {
    warnings.add(
      `Stripe / BigQuery V2/V3 population is temporarily unavailable: ${
        stripePopulationResult.reason instanceof Error
          ? stripePopulationResult.reason.message
          : String(stripePopulationResult.reason)
      }`,
    );
  }
  if (hubspotResult.status === "rejected") {
    warnings.add(
      `HubSpot migrations are temporarily unavailable: ${
        hubspotResult.reason instanceof Error ? hubspotResult.reason.message : String(hubspotResult.reason)
      }`,
    );
  }

  const stripeRows = stripeResult.status === "fulfilled" ? stripeResult.value.rows : [];
  const hubspotData: HubspotMigrationResult = hubspotResult.status === "fulfilled"
    ? hubspotResult.value
      : {
        migrations: [],
        opening: { customers: 0, arr: 0 },
        current: { customers: 0, arr: 0 },
        openingCustomers: [],
        currentCustomers: [],
      };
  const stripePopulation: StripeLegacyPlanPopulationResult = stripePopulationResult.status === "fulfilled"
    ? stripePopulationResult.value
    : {
        fiscalYearStart: window.fiscalYearStart,
        asOfDate: window.rangeEnd,
        targetCurrency,
        opening: { customers: 0, arr: 0 },
        current: { customers: 0, arr: 0 },
        openingCustomers: [],
        currentCustomers: [],
      };
  const hubspotMigrations = hubspotData.migrations;

  const stripeMigrations = stripeRows.map(stripeMigrationRow);

  const allMigrations = [...hubspotMigrations, ...stripeMigrations].sort(
    (a, b) => b.migratedAt.localeCompare(a.migratedAt) || a.customerName.localeCompare(b.customerName),
  );
  const migrations = allMigrations.filter(
    (migration) => migration.migratedAt >= window.rangeStart && migration.migratedAt <= window.rangeEnd,
  );
  const fiscalYear = calculateMigrationMetrics(allMigrations, window.fiscalYearStart, window.rangeEnd);
  const selectedRange = calculateMigrationMetrics(allMigrations, window.rangeStart, window.rangeEnd);
  const currentMonth = calculateMigrationMetrics(allMigrations, window.currentMonthStart, window.rangeEnd);
  const customerLists = {
    openingLegacy: [
      ...stripePopulation.openingCustomers.map(stripePopulationExportRow),
      ...hubspotData.openingCustomers,
    ],
    currentLegacy: [
      ...stripePopulation.currentCustomers.map(stripePopulationExportRow),
      ...hubspotData.currentCustomers,
    ],
    migrations: allMigrations.map(migrationExportRow),
  };
  const sourcePopulations = [
    {
      source: "stripe" as const,
      sourceLabel: "Stripe / BigQuery",
      opening: stripePopulation.opening,
      current: stripePopulation.current,
    },
    {
      source: "hubspot" as const,
      sourceLabel: "HubSpot Sales Default Pipeline",
      opening: hubspotData.opening,
      current: hubspotData.current,
    },
  ];
  const openingPopulation = sourcePopulations.reduce<LegacyPopulationSummary>(
    (total, source) => ({
      customers: total.customers + source.opening.customers,
      arr: round2(total.arr + source.opening.arr),
    }),
    { customers: 0, arr: 0 },
  );
  const currentPopulation = sourcePopulations.reduce<LegacyPopulationSummary>(
    (total, source) => ({
      customers: total.customers + source.current.customers,
      arr: round2(total.arr + source.current.arr),
    }),
    { customers: 0, arr: 0 },
  );
  const goal = {
    ...calculateMigrationGoalMetrics({
      opening: openingPopulation,
      current: currentPopulation,
      fiscalYearMigrated: { customers: fiscalYear.logosMigrated, arr: fiscalYear.arrMigrated },
      currentMonthMigrated: { customers: currentMonth.logosMigrated, arr: currentMonth.arrMigrated },
      targetRatePct: 70,
    }),
    sourcePopulations,
  };
  const sourceBreakdown = (["stripe", "hubspot"] as MigrationSource[]).map((source) => {
    const sourceRows = allMigrations.filter((row) => row.source === source);
    return {
      source,
      sourceLabel: source === "stripe" ? "Stripe / BigQuery" : "HubSpot Sales Default Pipeline",
      fiscalYear: calculateMigrationMetrics(sourceRows, window.fiscalYearStart, window.rangeEnd),
      selectedRange: calculateMigrationMetrics(sourceRows, window.rangeStart, window.rangeEnd),
      currentMonth: calculateMigrationMetrics(sourceRows, window.currentMonthStart, window.rangeEnd),
    };
  });
  const months = monthKeys(window.rangeStart, window.rangeEnd).map((monthKey) => {
    const nextMonth = new Date(`${monthKey}-01T00:00:00.000Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    nextMonth.setUTCDate(0);
    const calendarMonthEnd = nextMonth.toISOString().slice(0, 10);
    const startDate = `${monthKey}-01` < window.rangeStart ? window.rangeStart : `${monthKey}-01`;
    const endDate = calendarMonthEnd > window.rangeEnd ? window.rangeEnd : calendarMonthEnd;
    return {
      monthKey,
      monthLabel: monthLabel(monthKey),
      ...calculateMigrationMetrics(allMigrations, startDate, endDate),
    };
  });

  return {
    asOfDate: window.asOfDate,
    rangeStart: window.rangeStart,
    rangeEnd: window.rangeEnd,
    fiscalYearStart: window.fiscalYearStart,
    fiscalYearEnd: window.fiscalYearEnd,
    currentMonthStart: window.currentMonthStart,
    targetCurrency,
    generatedAt: new Date().toISOString(),
    fiscalYear,
    selectedRange,
    currentMonth,
    goal,
    sourceBreakdown,
    months,
    migrations,
    customerLists,
    warnings: Array.from(warnings),
    methodology: [
      "A Stripe customer is counted once, on the first day a V4 plan has positive ARR while that customer had positive V2 or V3 plan ARR immediately beforehand.",
      "Stripe results come from the Stripe data-pipeline subscription-item change events in BigQuery. Add-ons, AI tokens, conversation sessions, and web-search/crawl charges are excluded.",
      "HubSpot results independently use closed-won Sales Default Pipeline deals whose Upsell Type property is Migration. They do not require a matching Stripe customer; v4 ARR is annualized and converted using the HubSpot CARR report conventions.",
      "Stripe / BigQuery and HubSpot Sales Default Pipeline customers are counted as independent migration populations; neither source requires a matching record in the other.",
      "Downloadable CSVs use the same customer rows as the clicked totals. Stripe customers sharing one workspace remain one counted row, with multiple customer IDs or emails pipe-separated in that row.",
      "The selected date range controls the migration totals, source totals, monthly chart, and migrated-customer list. Each chart point groups migrations in that calendar month within the selected range.",
      "ARR migrated is the qualifying V2/V3 ARR immediately before migration. Resulting expansion is signed V4 ARR immediately after migration minus that pre-migration ARR; a negative value represents contraction.",
      "Previous plan is the customer's active V2/V3 base plan immediately before migration. Plan at range end reflects active base-plan subscription items on the selected end date, when available.",
      "The fiscal-year goal is 70% of customers on V2/V3 at the start of April 1. The logo target is rounded up to a whole customer and divided evenly across 12 months.",
      "The ARR goal uses the opening V2/V3 customers' average base-plan ARR multiplied by the logo goal. Add-ons, AI tokens, conversation sessions, and web-search/crawl charges are excluded from the baseline and target.",
    ],
  };
}
