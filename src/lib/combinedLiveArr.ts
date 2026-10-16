import { generateReport } from "@/lib/report";
import {
  resolveEnterprisePrepaidAiSpendExclusions,
  resolveEnterprisePrepaidAiSpendCurrentMonthCarryForwardOffsets,
} from "@/lib/aiSpendEnterprisePrepaidExclusions";
import {
  queryStripeAiSpendFromBigQuery,
  queryStripeBillingOverviewFromBigQuery,
  queryStripeUpcomingCurrentMonthDescriptionAmountFromBigQuery,
  type StripeBillingOverviewResult,
} from "@/lib/stripeBigquery";
import type { ReportResponse, ReportRow } from "@/lib/types";

export type CombinedLiveArrPayload = {
  generatedAtUtc: string;
  monthStartDate: string;
  monthEndDate: string;
  nextMonthStartDate: string;
  targetCurrency: string;
  hubspotCurrentArr: number;
  stripeCurrentArr: number;
  currentMonthArr: number;
  upcomingSnapshotDate: string;
  upcomingLineCount: number;
  upcomingMonthlyAmount: number;
  monthDurationDays: number;
  elapsedDays: number;
  timestampScaleFactor: number;
  upcomingAnnualizedProjection: number;
  projectedSnapshotDate: string;
  projectedLineCount: number;
  projectedArr: number;
  projectedArrBreakdown: {
    aiSpendMonthlyWithoutExclusions: number;
    aiSpendMonthlyWithExclusions: number;
    aiSpendAnnualizedArr: number;
    selfserveTodayArr: number;
    selfserveProjectedArr: number;
    salesledCurrentArr: number;
  };
  projectedArrEomFlatAdjusted: number;
  projectedArrEomFlatFlat: number;
  liveArr: number;
  // Legacy = HubSpot contracts not marked Cloud (blank counts as Legacy). They are being sunset
  // on 2026-12-31, so they're counted in total ARR but kept apart from the Cloud figures above.
  legacyArr: number;
  legacyByDeploymentType: Array<{ deploymentType: string; arr: number; dealCount: number }>;
  legacyDeals: Array<{ dealId: string; dealName: string; accountName: string; deploymentType: string; arr: number }>;
  totalContractedArr: number;
  // AI spend billed in the last full calendar month (usage invoices, after prepaid offsets).
  aiSpendLastMonthStartDate: string;
  aiSpendLastMonthAmount: number;
};

export const COMBINED_LIVE_ARR_CACHE_KEY = "api:combined-live-arr:v2";

function round2(v: number) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function toIsoDateOnlyUtc(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseTimestampUtc(value: string) {
  const text = String(value || "").trim();
  if (!text) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function isCloudDeploymentType(value: string) {
  return String(value || "").trim().toLowerCase() === "cloud";
}

function hasAnyNonZeroValue(valuesByPeriod: Record<string, number>) {
  return Object.values(valuesByPeriod || {}).some((value) => Math.abs(Number(value) || 0) > 1e-9);
}

function accountGroupingKey(rawAccountId: string) {
  const raw = String(rawAccountId || "").trim();
  if (!raw) return "";
  const numericToken =
    raw
      .split(/[,\s;|]+/)
      .map((part) => part.trim())
      .find((part) => /^\d+$/.test(part)) || "";
  if (numericToken) return numericToken;
  return raw.toLowerCase();
}

function pickTargetCurrency() {
  return (
    String(process.env.STRIPE_BILLING_OVERVIEW_TARGET_CURRENCY || "").trim() ||
    String(process.env.STRIPE_THROUGH_MRR_TARGET_CURRENCY || "").trim() ||
    String(process.env.STRIPE_ARR_CORRECT_TARGET_CURRENCY || "").trim() ||
    "USD"
  );
}

function mapHubRows(report: ReportResponse) {
  return (report.rows || []).map((row: ReportRow) => ({
    accountId: String(row.accountId || ""),
    deploymentType: String(row.deploymentType || ""),
    valuesByPeriod: row.valuesByPeriod || {},
  }));
}

function computeHubspotCurrentArr(report: ReportResponse) {
  const periodKey = String(report.periods?.[0]?.key || "");
  if (!periodKey) return 0;
  const rows = mapHubRows(report)
    .filter((row) => isCloudDeploymentType(row.deploymentType))
    .filter((row) => hasAnyNonZeroValue(row.valuesByPeriod));

  const totalsByAccount = new Map<string, number>();
  for (const row of rows) {
    const accountKey = accountGroupingKey(row.accountId);
    if (!accountKey) continue;
    const periodValue = Number(row.valuesByPeriod[periodKey] || 0);
    totalsByAccount.set(accountKey, round2((totalsByAccount.get(accountKey) || 0) + periodValue));
  }

  return round2(Array.from(totalsByAccount.values()).reduce((sum, value) => sum + value, 0));
}

function legacyDeploymentLabel(value: string) {
  return String(value || "").trim() || "Unlabeled";
}

function computeHubspotLegacyArr(report: ReportResponse) {
  const periodKey = String(report.periods?.[0]?.key || "");
  const deals = new Map<string, CombinedLiveArrPayload["legacyDeals"][number]>();
  if (periodKey) {
    for (const row of report.rows || []) {
      if (isCloudDeploymentType(String(row.deploymentType || ""))) continue;
      const value = Number(row.valuesByPeriod?.[periodKey] || 0);
      if (Math.abs(value) < 1e-9) continue;
      const dealId = String(row.dealId || "");
      const existing = deals.get(dealId);
      if (existing) {
        existing.arr = round2(existing.arr + value);
        continue;
      }
      deals.set(dealId, {
        dealId,
        dealName: String(row.dealName || ""),
        accountName: String(row.accountName || ""),
        deploymentType: legacyDeploymentLabel(String(row.deploymentType || "")),
        arr: round2(value),
      });
    }
  }
  const legacyDeals = Array.from(deals.values()).sort((a, b) => b.arr - a.arr);
  const byType = new Map<string, { deploymentType: string; arr: number; dealCount: number }>();
  for (const deal of legacyDeals) {
    const entry = byType.get(deal.deploymentType) || { deploymentType: deal.deploymentType, arr: 0, dealCount: 0 };
    entry.arr = round2(entry.arr + deal.arr);
    entry.dealCount += 1;
    byType.set(deal.deploymentType, entry);
  }
  return {
    legacyArr: round2(legacyDeals.reduce((sum, deal) => sum + deal.arr, 0)),
    legacyByDeploymentType: Array.from(byType.values()).sort((a, b) => b.arr - a.arr),
    legacyDeals,
  };
}

function computeStripeCurrentArr(stripe: StripeBillingOverviewResult) {
  const hasStripeExactSeries =
    stripe.stripeExactPoints !== undefined || stripe.stripeExactHistoryPoints !== undefined;
  const points = hasStripeExactSeries ? stripe.stripeExactPoints || [] : stripe.points || [];
  if (!points.length) return round2(stripe.currentArr || 0);
  return round2(points[points.length - 1].arr);
}

export async function buildCombinedLiveArrPayload(): Promise<CombinedLiveArrPayload> {
  const nowUtc = new Date();
  const monthStartUtc = new Date(
    Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const lastMonthStartUtc = new Date(
    Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() - 1, 1, 0, 0, 0, 0),
  );
  const nextMonthStartUtc = new Date(
    Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  const monthEndUtc = new Date(
    Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() + 1, 0, 0, 0, 0, 0),
  );

  const monthStartDate = toIsoDateOnlyUtc(monthStartUtc);
  const lastMonthStartDate = toIsoDateOnlyUtc(lastMonthStartUtc);
  const lastMonthEndDate = toIsoDateOnlyUtc(new Date(monthStartUtc.getTime() - 24 * 60 * 60 * 1000));
  const monthEndDate = toIsoDateOnlyUtc(monthEndUtc);
  const nextMonthStartDate = toIsoDateOnlyUtc(nextMonthStartUtc);
  const targetCurrency = pickTargetCurrency();

  const todayDate = toIsoDateOnlyUtc(nowUtc);

  const [lastMonthExclusions, hubspotTodayReport, stripeReport, aiSpendUpcomingWithoutExclusions] = await Promise.all([
    resolveEnterprisePrepaidAiSpendExclusions({
      startDate: lastMonthStartDate,
      endDate: lastMonthEndDate,
      asOfDate: todayDate,
      targetCurrency,
    }).catch(() => ({ customerIds: [], customerMonthPairs: [], customerMonthPrepaidOffsets: [], rows: [] })),
    generateReport({
      startDate: todayDate,
      endDate: todayDate,
      mode: "contracted",
      grain: "daily",
    }),
    queryStripeBillingOverviewFromBigQuery(
      {
        startDate: monthStartDate,
        endDate: monthEndDate,
        grain: "monthly",
        groupBy: "none",
        targetCurrency,
        includeCustomerArrRows: false,
      },
      { profile: "stripe_arr_correct" },
    ),
    queryStripeUpcomingCurrentMonthDescriptionAmountFromBigQuery(
      {
        monthStartDate,
        nextMonthStartDate,
        targetCurrency,
        productDescriptionIncludes: ["ai tokens", "web search and crawl"],
        excludeCustomerIds: [],
        prepaidOffsetByCustomerIds: [],
      },
      { profile: "stripe_arr_correct" },
    ),
  ]);

  const carryForwardAsOfDate = /^\d{4}-\d{2}-\d{2}$/.test(String(aiSpendUpcomingWithoutExclusions.snapshotDate || ""))
    ? String(aiSpendUpcomingWithoutExclusions.snapshotDate)
    : todayDate;
  const currentMonthCarryForwardExclusions = await resolveEnterprisePrepaidAiSpendCurrentMonthCarryForwardOffsets({
    currentMonthStartDate: monthStartDate,
    asOfDate: carryForwardAsOfDate,
    targetCurrency,
  }).catch(() => ({
    currentMonthStartDate: monthStartDate,
    currentMonthEndDate: monthEndDate,
    lastMonthStartDate,
    lastMonthEndDate,
    carriedCustomerIds: [],
    prepaidOffsetByCustomerIds: [],
    excludedCustomers: [],
  }));
  const currentMonthPrepaidOffsetByCustomer = currentMonthCarryForwardExclusions.prepaidOffsetByCustomerIds || [];

  const [aiSpendUpcoming, aiSpendLastMonth] = await Promise.all([
    queryStripeUpcomingCurrentMonthDescriptionAmountFromBigQuery(
      {
        monthStartDate,
        nextMonthStartDate,
        targetCurrency,
        productDescriptionIncludes: ["ai tokens", "web search and crawl"],
        excludeCustomerIds: [],
        prepaidOffsetByCustomerIds: currentMonthPrepaidOffsetByCustomer,
      },
      { profile: "stripe_arr_correct" },
    ),
    queryStripeAiSpendFromBigQuery(
      {
        startDate: lastMonthStartDate,
        endDate: lastMonthEndDate,
        grain: "monthly",
        targetCurrency,
        topLimit: 1,
        detailLimit: 1,
        excludeCustomerIds: [],
        excludeCustomerMonthPairs: [],
        prepaidOffsetByCustomerMonthPairs: (lastMonthExclusions.customerMonthPrepaidOffsets || []).map((entry) => ({
          pairKey: entry.pairKey,
          prepaidAppliedMajor: entry.prepaidAppliedMajor,
        })),
      },
      { profile: "stripe_arr_correct" },
    ),
  ]);

  const hubspotCurrentArr = computeHubspotCurrentArr(hubspotTodayReport);
  const stripeCurrentArr = computeStripeCurrentArr(stripeReport);
  const currentMonthArr = round2(hubspotCurrentArr + stripeCurrentArr);
  const legacy = computeHubspotLegacyArr(hubspotTodayReport);

  const monthDurationMs = Math.max(1, nextMonthStartUtc.getTime() - monthStartUtc.getTime());
  const aiSpendSnapshotTs =
    parseTimestampUtc(aiSpendUpcoming.snapshotTimestampUtc) ||
    parseTimestampUtc(aiSpendUpcomingWithoutExclusions.snapshotTimestampUtc) ||
    nowUtc;
  const projectionAnchorMs = Math.min(
    Math.max(aiSpendSnapshotTs.getTime(), monthStartUtc.getTime()),
    Math.max(monthStartUtc.getTime(), nextMonthStartUtc.getTime() - 1000),
  );
  const elapsedMsRaw = projectionAnchorMs - monthStartUtc.getTime();
  const elapsedMs = Math.max(1000, Math.min(monthDurationMs, elapsedMsRaw));
  const timeScale = monthDurationMs / elapsedMs;

  const aiSpendMonthlyWithoutExclusions = round2(aiSpendUpcomingWithoutExclusions.amountMajorSum);
  const aiSpendCurrentMonthAmount = round2(aiSpendUpcoming.amountMajorSum);
  const aiSpendMonthlyWithExclusions = aiSpendCurrentMonthAmount;
  const aiSpendAnnualizedProjection = round2(aiSpendMonthlyWithExclusions * 12 * timeScale);
  const upcomingAnnualizedProjection = aiSpendAnnualizedProjection;
  const selfserveTodayArr = round2(stripeCurrentArr);
  const selfserveProjectedArr = round2((stripeReport.currentMonthProjection?.projectedEndMrr || 0) * 12);
  const salesledCurrentArr = round2(hubspotCurrentArr);
  const projectedArr = round2(aiSpendAnnualizedProjection + selfserveProjectedArr + salesledCurrentArr);
  const aiSpendLastCalendarMonth = round2(aiSpendLastMonth.totalRevenue);
  const daysInLastMonth = Math.max(
    1,
    (monthStartUtc.getTime() - lastMonthStartUtc.getTime()) / 86_400_000,
  );
  const daysInCurrentMonth = Math.max(
    1,
    (nextMonthStartUtc.getTime() - monthStartUtc.getTime()) / 86_400_000,
  );
  const aiSpendFlatAdjustedAnnualized = round2(
    (aiSpendLastCalendarMonth / daysInLastMonth) * daysInCurrentMonth * 12,
  );
  const aiSpendFlatFlatAnnualized = round2(aiSpendLastCalendarMonth * 12);
  const projectedArrEomFlatAdjusted = round2(
    selfserveProjectedArr + salesledCurrentArr + aiSpendFlatAdjustedAnnualized,
  );
  const projectedArrEomFlatFlat = round2(
    selfserveProjectedArr + salesledCurrentArr + aiSpendFlatFlatAnnualized,
  );
  const liveArr = round2(currentMonthArr + upcomingAnnualizedProjection);

  return {
    generatedAtUtc: nowUtc.toISOString(),
    monthStartDate,
    monthEndDate,
    nextMonthStartDate,
    targetCurrency: String(targetCurrency || "USD").toUpperCase(),
    hubspotCurrentArr,
    stripeCurrentArr,
    currentMonthArr,
    upcomingSnapshotDate: aiSpendUpcoming.snapshotDate,
    upcomingLineCount: aiSpendUpcoming.lineCount,
    upcomingMonthlyAmount: aiSpendCurrentMonthAmount,
    monthDurationDays: monthDurationMs / 86_400_000,
    elapsedDays: elapsedMs / 86_400_000,
    timestampScaleFactor: timeScale,
    upcomingAnnualizedProjection: aiSpendAnnualizedProjection,
    projectedSnapshotDate: aiSpendUpcoming.snapshotDate,
    projectedLineCount: aiSpendUpcoming.lineCount,
    projectedArr,
    projectedArrBreakdown: {
      aiSpendMonthlyWithoutExclusions,
      aiSpendMonthlyWithExclusions,
      aiSpendAnnualizedArr: aiSpendAnnualizedProjection,
      selfserveTodayArr,
      selfserveProjectedArr,
      salesledCurrentArr,
    },
    projectedArrEomFlatAdjusted,
    projectedArrEomFlatFlat,
    liveArr,
    legacyArr: legacy.legacyArr,
    legacyByDeploymentType: legacy.legacyByDeploymentType,
    legacyDeals: legacy.legacyDeals,
    totalContractedArr: round2(currentMonthArr + legacy.legacyArr),
    aiSpendLastMonthStartDate: lastMonthStartDate,
    aiSpendLastMonthAmount: aiSpendLastCalendarMonth,
  };
}
