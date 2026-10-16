import { buildCombinedLiveArrPayload, COMBINED_LIVE_ARR_CACHE_KEY, type CombinedLiveArrPayload } from "@/lib/combinedLiveArr";
import {
  queryPrecomputedMonthlyArrBySource,
  queryPrecomputedRetentionBySource,
  queryPrecomputedTofuMonthlyCurrent,
} from "@/lib/precomputedFactsRead";
import { generateReport } from "@/lib/report";
import { resolveEnterprisePrepaidAiSpendExclusions } from "@/lib/aiSpendEnterprisePrepaidExclusions";
import { queryStripeAiSpendFromBigQuery } from "@/lib/stripeBigquery";
import { getOrSetCache, readServerCacheSyncStatus, readTtlMs } from "@/lib/serverResponseCache";

export const LEGACY_SUNSET_DATE = "2026-12-31";
const TREND_MONTHS = 12;

export type HomeTrendPoint = {
  monthKey: string;
  selfServeArr: number;
  salesLedCloudArr: number;
  legacyArr: number;
  totalArr: number;
  // Cloud ARR movement during the month (same saved data as the ARR movements page).
  movement?: { newArr: number; expansionArr: number; contractionArr: number; churnArr: number };
};

export type RetentionFigures = { nrrPct: number; grrPct: number; customers: number; startArr: number };

export type HomeSummaryPayload = {
  generatedAtUtc: string;
  live: {
    asOfUtc: string;
    selfServeArr: number;
    salesLedCloudArr: number;
    cloudArr: number;
    legacyArr: number;
    totalArr: number;
    legacyByDeploymentType: CombinedLiveArrPayload["legacyByDeploymentType"];
    legacyDeals: CombinedLiveArrPayload["legacyDeals"];
  };
  aiSpend: {
    // Usage billing, kept out of ARR: what was invoiced in the last full month, and that × 12.
    lastMonthKey: string;
    lastMonthBilled: number;
    annualized: number;
    // Billed AI spend per completed month, same window and offsets as the tile.
    monthly: Array<{ monthKey: string; billed: number }>;
  };
  // Cloud only (Legacy is left out of retention and movement by design). All from completed months.
  retention: {
    startMonth: string;
    endMonth: string;
    combined: RetentionFigures;
    salesLed: RetentionFigures;
    selfServe: RetentionFigures;
  } | null;
  payingCustomers: {
    monthKey: string;
    selfServe: number;
    salesLed: number;
    legacy: number;
    total: number;
    previousTotal: number | null;
  } | null;
  // Change between the last two completed month-ends (same method on both sides). Mid-month
  // figures aren't compared because Stripe period-end cancellations land on the 1st of each month.
  lastMonthChange: { monthKey: string; previousMonthKey: string; change: number } | null;
  trend: HomeTrendPoint[];
  legacySunsetDate: string;
  lastNightlySync: { finishedAtUtc: string; failedTaskCount: number; totalTaskCount: number } | null;
};

function round2(v: number) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function isCloudDeploymentType(value: string) {
  return String(value || "").trim().toLowerCase() === "cloud";
}

// Legacy (non-Cloud) HubSpot ARR at each month end, from the same HubSpot rules as the rest of the app.
async function legacyArrByMonth(startDate: string, endDate: string) {
  const report = await generateReport({ startDate, endDate, mode: "contracted", grain: "monthly" });
  const totals = new Map<string, number>();
  for (const row of report.rows || []) {
    if (isCloudDeploymentType(String(row.deploymentType || ""))) continue;
    for (const period of report.periods || []) {
      const value = Number(row.valuesByPeriod?.[period.key] || 0);
      if (!value) continue;
      totals.set(period.key, (totals.get(period.key) || 0) + value);
    }
  }
  return totals;
}

// AI spend invoiced per month, after enterprise prepaid offsets (same rules as the Live ARR figure).
async function aiSpendByMonth(startDate: string, endDate: string, asOfDate: string) {
  const exclusions = await resolveEnterprisePrepaidAiSpendExclusions({
    startDate,
    endDate,
    asOfDate,
    targetCurrency: "USD",
  }).catch(() => ({ customerMonthPrepaidOffsets: [] as Array<{ pairKey: string; prepaidAppliedMajor: number }> }));
  const result = await queryStripeAiSpendFromBigQuery(
    {
      startDate,
      endDate,
      grain: "monthly",
      targetCurrency: "USD",
      topLimit: 1,
      detailLimit: 1,
      prepaidOffsetByCustomerMonthPairs: (exclusions.customerMonthPrepaidOffsets || []).map((entry) => ({
        pairKey: entry.pairKey,
        prepaidAppliedMajor: entry.prepaidAppliedMajor,
      })),
    },
    { profile: "stripe_arr_correct" },
  );
  return (result.points || []).map((point) => ({
    monthKey: String(point.periodStart || point.key || "").slice(0, 7),
    billed: round2(point.revenue),
  }));
}

function retentionFigures(rows: Array<{ customers: number; startArr: number; endArr: number; retainedArr: number }>): RetentionFigures {
  const startArr = rows.reduce((sum, r) => sum + r.startArr, 0);
  const endArr = rows.reduce((sum, r) => sum + r.endArr, 0);
  const retainedArr = rows.reduce((sum, r) => sum + r.retainedArr, 0);
  return {
    nrrPct: startArr > 0 ? Math.round((endArr / startArr) * 1000) / 10 : 0,
    grrPct: startArr > 0 ? Math.round((retainedArr / startArr) * 1000) / 10 : 0,
    customers: rows.reduce((sum, r) => sum + r.customers, 0),
    startArr: round2(startArr),
  };
}

function shiftMonthKey(monthKey: string, months: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

export async function buildHomeSummaryPayload(): Promise<HomeSummaryPayload> {
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - TREND_MONTHS, 1));
  const lastMonthEnd = new Date(currentMonthStart.getTime() - 86_400_000);
  const trendStartDate = isoDate(trendStart);
  const trendEndDate = isoDate(lastMonthEnd);

  const lastMonthKey = trendEndDate.slice(0, 7);
  const retentionStartMonth = shiftMonthKey(lastMonthKey, -12);
  const [live, monthly, legacyMonthly, lastSync, aiMonthly, retentionRows, tofuRows] = await Promise.all([
    getOrSetCache(
      COMBINED_LIVE_ARR_CACHE_KEY,
      readTtlMs("API_COMBINED_LIVE_ARR_CACHE_TTL_MS", 30_000),
      () => buildCombinedLiveArrPayload(),
    ),
    queryPrecomputedMonthlyArrBySource({ startDate: trendStartDate, endDate: trendEndDate }),
    legacyArrByMonth(trendStartDate, trendEndDate),
    readServerCacheSyncStatus().catch(() => null),
    aiSpendByMonth(trendStartDate, trendEndDate, isoDate(now)),
    queryPrecomputedRetentionBySource({ startMonth: retentionStartMonth, endMonth: lastMonthKey }).catch(() => []),
    queryPrecomputedTofuMonthlyCurrent({ startDate: trendStartDate, endDate: trendEndDate }).catch(() => []),
  ]);

  // Completed months only; the current month is shown live instead.
  const movementByMonth = new Map(
    tofuRows.filter((r) => r.groupType === "overall").map((r) => [r.monthKey, r] as const),
  );
  const trend: HomeTrendPoint[] = monthly.map((m) => {
    const legacyArr = round2(legacyMonthly.get(m.monthKey) || 0);
    const mv = movementByMonth.get(m.monthKey);
    return {
      movement: mv
        ? {
            newArr: round2(mv.newArr),
            expansionArr: round2(mv.expansionArr),
            contractionArr: round2(Math.abs(mv.contractionArr)),
            churnArr: round2(Math.abs(mv.churnArr)),
          }
        : undefined,
      monthKey: m.monthKey,
      selfServeArr: round2(m.stripeArr),
      salesLedCloudArr: round2(m.hubspotArr),
      legacyArr,
      totalArr: round2(m.stripeArr + m.hubspotArr + legacyArr),
    };
  });
  const last = trend[trend.length - 1];
  const previous = trend[trend.length - 2];

  const lastMonthRow = monthly.find((m) => m.monthKey === lastMonthKey);
  const previousMonthRow = monthly.find((m) => m.monthKey === shiftMonthKey(lastMonthKey, -1));

  const selfServeArr = round2(live.stripeCurrentArr);
  const salesLedCloudArr = round2(live.hubspotCurrentArr);
  const cloudArr = round2(selfServeArr + salesLedCloudArr);

  return {
    generatedAtUtc: now.toISOString(),
    live: {
      asOfUtc: live.generatedAtUtc,
      selfServeArr,
      salesLedCloudArr,
      cloudArr,
      legacyArr: live.legacyArr,
      totalArr: round2(cloudArr + live.legacyArr),
      legacyByDeploymentType: live.legacyByDeploymentType,
      legacyDeals: live.legacyDeals,
    },
    aiSpend: {
      lastMonthKey: String(live.aiSpendLastMonthStartDate || "").slice(0, 7),
      lastMonthBilled: round2(live.aiSpendLastMonthAmount),
      annualized: round2(live.aiSpendLastMonthAmount * 12),
      monthly: aiMonthly,
    },
    retention: retentionRows.length
      ? {
          startMonth: retentionStartMonth,
          endMonth: lastMonthKey,
          combined: retentionFigures(retentionRows),
          salesLed: retentionFigures(retentionRows.filter((r) => r.source === "hubspot_account")),
          selfServe: retentionFigures(retentionRows.filter((r) => r.source !== "hubspot_account")),
        }
      : null,
    payingCustomers: lastMonthRow
      ? {
          monthKey: lastMonthKey,
          selfServe: lastMonthRow.stripePaying,
          salesLed: lastMonthRow.hubspotPaying,
          legacy: live.legacyDeals.length,
          total: lastMonthRow.payingCustomers,
          previousTotal: previousMonthRow ? previousMonthRow.payingCustomers : null,
        }
      : null,
    lastMonthChange: last && previous
      ? { monthKey: last.monthKey, previousMonthKey: previous.monthKey, change: round2(last.totalArr - previous.totalArr) }
      : null,
    trend,
    legacySunsetDate: LEGACY_SUNSET_DATE,
    lastNightlySync: lastSync
      ? {
          finishedAtUtc: lastSync.finishedAtUtc,
          failedTaskCount: lastSync.failedTaskCount,
          totalTaskCount: lastSync.totalTaskCount,
        }
      : null,
  };
}
