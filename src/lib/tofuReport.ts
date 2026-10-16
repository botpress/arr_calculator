import {
  generateCombinedAllSubsReport,
  type CombinedAllSubsResponse,
  type CombinedAllSubsRow,
  type CombinedAllSubsPlan,
  type CombinedAllSubsCombineMode,
} from "@/lib/combinedAllSubsReport";
import { getOrSetCache, readTtlMs, stableStringify } from "@/lib/serverResponseCache";
import {
  isPrecomputedFactsReadEnabled,
  queryPrecomputedCustomerArrCurrent,
  type PrecomputedFactCustomerArrRow,
} from "@/lib/precomputedFactsRead";

export type TofuGroupBy = "month" | "plan" | "segment";
export type TofuSegment = "salesled" | "selfserve" | "sales_assist";

export type TofuRequest = {
  startDate: string;
  endDate: string;
  combineMode?: CombinedAllSubsCombineMode;
  groupBy?: TofuGroupBy;
  // Compute from live source data, skipping saved monthly facts and the cached report. The facts
  // rebuild uses this: its own new month-end rows stay hidden until the run finishes, so reading
  // saved facts mid-run would pair a new month start with an old month end.
  freshSource?: boolean;
};

export type TofuMonthRow = {
  periodKey: string;
  periodLabel: string;
  beginningArr: number;
  newArr: number;
  expansionArr: number;
  contractionArr: number;
  churnArr: number;
  endingArr: number;
};

export type TofuResponse = {
  startDate: string;
  endDate: string;
  combineMode: CombinedAllSubsCombineMode;
  groupBy: TofuGroupBy;
  targetCurrency: string;
  rows: TofuMonthRow[];
  planRows?: TofuPlanRow[];
  segmentRows?: TofuSegmentRow[];
};

export type TofuPlanRow = {
  periodKey: string;
  periodLabel: string;
  plan: CombinedAllSubsPlan;
  beginningArr: number;
  newArr: number;
  expansionArr: number;
  contractionArr: number;
  churnArr: number;
  netPlanChangeArr: number;
  endingArr: number;
};

export type TofuSegmentRow = {
  periodKey: string;
  periodLabel: string;
  segment: TofuSegment;
  beginningArr: number;
  newArr: number;
  expansionArr: number;
  contractionArr: number;
  churnArr: number;
  endingArr: number;
};

export type TofuDetailMetric =
  | "beginningArr"
  | "newArr"
  | "expansionArr"
  | "contractionArr"
  | "churnArr"
  | "endingArr";

export type TofuDetailRequest = TofuRequest & {
  detailPeriodKey: string;
  detailMetric: TofuDetailMetric;
  detailSegment?: TofuSegment;
};

export type TofuDetailRow = {
  customerId: string;
  customerLabel: string;
  source: "hubspot_account" | "stripe_only_customer";
  previousArr: number;
  currentArr: number;
  deltaArr: number;
  previousMrr: number;
  currentMrr: number;
  deltaMrr: number;
  contributionArr: number;
  contributionMrr: number;
};

export type TofuDetailResponse = {
  startDate: string;
  endDate: string;
  combineMode: CombinedAllSubsCombineMode;
  targetCurrency: string;
  detailGroupBy: TofuGroupBy;
  detailSegment?: TofuSegment;
  detailSegmentLabel?: string;
  detailPeriodKey: string;
  detailPeriodLabel: string;
  detailPreviousPeriodKey: string;
  detailPreviousPeriodLabel: string;
  detailMetric: TofuDetailMetric;
  rows: TofuDetailRow[];
  summary: {
    rowCount: number;
    totalArr: number;
    totalMrr: number;
  };
};

const TOFU_EXPANDED_SOURCE_CACHE_TTL_MS = readTtlMs(
  "API_TOFU_EXPANDED_SOURCE_CACHE_TTL_MS",
  10 * 60_000,
);

const TOFU_DETAIL_METRICS = new Set<TofuDetailMetric>([
  "beginningArr",
  "newArr",
  "expansionArr",
  "contractionArr",
  "churnArr",
  "endingArr",
]);

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeTofuGroupBy(value: string | undefined): TofuGroupBy {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "plan") return "plan";
  if (normalized === "segment") return "segment";
  return "month";
}

const PLAN_ORDER: CombinedAllSubsPlan[] = [
  "enterprise",
  "managed",
  "team",
  "plus",
  "pay_as_you_go",
  "free",
];

const SEGMENT_ORDER: TofuSegment[] = ["salesled", "selfserve", "sales_assist"];
const SEGMENT_LABELS: Record<TofuSegment, string> = {
  salesled: "Sales-led",
  selfserve: "Self-serve",
  sales_assist: "Sales assist",
};

function parseIsoDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function toIsoDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function monthBeforeRange(startDate: string) {
  const start = parseIsoDateOnly(startDate);
  if (!start) return null;
  const prevMonthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const prevMonthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0));
  return {
    startDate: toIsoDateOnly(prevMonthStart),
    endDate: toIsoDateOnly(prevMonthEnd),
  };
}

function monthKeyFromIsoDate(value: string) {
  return String(value || "").trim().slice(0, 7);
}

function monthKeyFromDate(value: Date) {
  return toIsoDateOnly(new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1))).slice(0, 7);
}

function monthStartIsoFromKey(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || "").trim());
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) return "";
  return toIsoDateOnly(new Date(Date.UTC(year, month, 1)));
}

function monthEndIsoFromKey(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || "").trim());
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) return "";
  return toIsoDateOnly(new Date(Date.UTC(year, month + 1, 0)));
}

function monthKeysBetween(startDate: string, endDate: string) {
  const start = parseIsoDateOnly(startDate);
  const end = parseIsoDateOnly(endDate);
  if (!start || !end || end.getTime() < start.getTime()) return [];
  const out: string[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor.getTime() <= endMonth.getTime()) {
    out.push(monthKeyFromDate(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return out;
}

function previousPeriodKeyFor(
  periodKey: string,
  periods: Array<{ key: string }>,
  allPeriodKeys: string[],
) {
  const selectedIdx = periods.findIndex((period) => period.key === periodKey);
  const selectedPrevKey = selectedIdx > 0 ? periods[selectedIdx - 1].key : "";
  const allIdx = allPeriodKeys.indexOf(periodKey);
  return selectedPrevKey || (allIdx > 0 ? allPeriodKeys[allIdx - 1] : "");
}

async function loadExpandedTofuSource(request: TofuRequest): Promise<{
  expanded: CombinedAllSubsResponse;
  periods: Array<{ key: string; label: string }>;
  allPeriodKeys: string[];
}> {
  const groupBy = normalizeTofuGroupBy(request.groupBy);
  const prev = monthBeforeRange(request.startDate);
  const sourceStartDate = prev?.startDate || request.startDate;
  const expandedSourceRequest = {
    startDate: sourceStartDate,
    endDate: request.endDate,
    combineMode: request.combineMode,
    displayMode: "arr" as const,
    includePlanData: groupBy === "plan",
    planGrain: "monthly" as const,
    groupedMatchStrategy: (groupBy === "plan" ? "workspace_only" : "full") as "full" | "workspace_only",
    includeSalesAssist: groupBy === "segment",
  };
  const expandedCacheKey = `tofu:expanded-source:${stableStringify(expandedSourceRequest)}`;
  const expanded = request.freshSource
    ? await generateCombinedAllSubsReport({ ...expandedSourceRequest, preferPrecomputedFacts: false })
    : await getOrSetCache(
        expandedCacheKey,
        TOFU_EXPANDED_SOURCE_CACHE_TTL_MS,
        () => generateCombinedAllSubsReport(expandedSourceRequest),
      );

  const allPeriods = (expanded.periods || []).map((period) => ({
    key: String(period.key || ""),
    label: String(period.label || period.key || ""),
  }));
  const selectedStartMonthKey = String(request.startDate || "").slice(0, 7);
  const periods = allPeriods.filter((period) => period.key >= selectedStartMonthKey);
  const allPeriodKeys = allPeriods.map((period) => period.key);

  return { expanded, periods, allPeriodKeys };
}

function arrAtPeriod(row: CombinedAllSubsRow, periodKey: string) {
  return round2(Number(row.valuesByPeriod[periodKey] || 0));
}

function planAtPeriod(
  row: CombinedAllSubsRow,
  periodKey: string,
): CombinedAllSubsPlan {
  const fallback = (row.plansByPeriod?.[periodKey] || "").trim();
  return (fallback || "free") as CombinedAllSubsPlan;
}

function segmentAtPeriod(row: CombinedAllSubsRow, periodKey: string): TofuSegment {
  const assistValue = String(row.salesAssistByPeriod?.[periodKey] || row.salesAssist || "no")
    .trim()
    .toLowerCase();
  if (row.source === "hubspot_account") {
    if (assistValue === "yes") return "sales_assist";
    return "salesled";
  }
  return assistValue === "yes" ? "sales_assist" : "selfserve";
}

function contributionForMetric(metric: TofuDetailMetric, previousArr: number, currentArr: number) {
  const prevHas = Math.abs(previousArr) > 1e-9;
  const currHas = Math.abs(currentArr) > 1e-9;
  const delta = round2(currentArr - previousArr);

  if (metric === "beginningArr") return prevHas ? previousArr : null;
  if (metric === "endingArr") return currHas ? currentArr : null;
  if (metric === "newArr") return !prevHas && currHas ? currentArr : null;
  if (metric === "churnArr") return prevHas && !currHas ? -previousArr : null;
  if (metric === "expansionArr") return prevHas && currHas && delta > 0 ? delta : null;
  if (metric === "contractionArr") return prevHas && currHas && delta < 0 ? delta : null;
  return null;
}

function contributionForSegmentMetric(
  metric: TofuDetailMetric,
  segment: TofuSegment,
  previousArr: number,
  currentArr: number,
  previousSegment: TofuSegment,
  currentSegment: TofuSegment,
) {
  const prevHas = Math.abs(previousArr) > 1e-9;
  const currHas = Math.abs(currentArr) > 1e-9;
  const delta = round2(currentArr - previousArr);
  const inPrevSegment = prevHas && previousSegment === segment;
  const inCurrSegment = currHas && currentSegment === segment;

  if (metric === "beginningArr") return inPrevSegment ? previousArr : null;
  if (metric === "endingArr") return inCurrSegment ? currentArr : null;
  if (metric === "newArr") return !prevHas && inCurrSegment ? currentArr : null;
  if (metric === "churnArr") {
    if (inPrevSegment && !currHas) return -previousArr;
    if (inPrevSegment && currHas && previousSegment !== currentSegment) return -previousArr;
    return null;
  }
  if (metric === "expansionArr") {
    if (inPrevSegment && inCurrSegment && delta > 0) return delta;
    if (!inPrevSegment && inCurrSegment && prevHas && currHas && previousSegment !== currentSegment) return currentArr;
    return null;
  }
  if (metric === "contractionArr") {
    if (inPrevSegment && inCurrSegment && delta < 0) return delta;
    return null;
  }
  return null;
}

function segmentFromFactRow(row: Pick<PrecomputedFactCustomerArrRow, "source" | "salesAssist">): TofuSegment {
  if (row.source === "hubspot_account") {
    return row.salesAssist ? "sales_assist" : "salesled";
  }
  return row.salesAssist ? "sales_assist" : "selfserve";
}

async function generateTofuDetailReportFromPrecomputedFacts(
  request: TofuDetailRequest,
  groupBy: TofuGroupBy,
  detailSegment: TofuSegment | "",
): Promise<TofuDetailResponse | null> {
  if ((request.combineMode || "grouped") !== "grouped") return null;
  if (!isPrecomputedFactsReadEnabled()) return null;

  const detailPeriodKey = String(request.detailPeriodKey || "").trim();
  if (!/^\d{4}-\d{2}$/.test(detailPeriodKey)) return null;
  const months = monthKeysBetween(request.startDate, request.endDate);
  const detailMonthIdx = months.indexOf(detailPeriodKey);
  if (detailMonthIdx < 0) return null;

  const previousPeriodKey = detailMonthIdx > 0 ? months[detailMonthIdx - 1] : "";
  const currentPeriodDate = monthStartIsoFromKey(detailPeriodKey);
  const previousPeriodDate = previousPeriodKey ? monthStartIsoFromKey(previousPeriodKey) : "";
  if (!currentPeriodDate) return null;

  const queryStartDate = previousPeriodDate || currentPeriodDate;
  const queryEndDate = monthEndIsoFromKey(detailPeriodKey);
  if (!queryStartDate || !queryEndDate) return null;

  const factRows = await queryPrecomputedCustomerArrCurrent({
    startDate: queryStartDate,
    endDate: queryEndDate,
    grain: "monthly",
  }).catch(() => []);
  if (!factRows.length) return null;

  type CustomerPeriodSnapshot = {
    customerKey: string;
    customerLabel: string;
    source: "hubspot_account" | "stripe_only_customer";
    salesAssist: boolean;
    arrEnd: number;
    mrrEnd: number;
  };
  const byCustomer = new Map<string, { previous?: CustomerPeriodSnapshot; current?: CustomerPeriodSnapshot }>();
  for (const row of factRows) {
    const periodKey = monthKeyFromIsoDate(row.periodDate);
    if (periodKey !== detailPeriodKey && periodKey !== previousPeriodKey) continue;
    const snapshot: CustomerPeriodSnapshot = {
      customerKey: row.customerKey,
      customerLabel: row.customerLabel || row.customerKey,
      source: row.source,
      salesAssist: row.salesAssist,
      arrEnd: round2(row.arrEnd),
      mrrEnd: round2(row.mrrEnd),
    };
    const entry = byCustomer.get(row.customerKey) || {};
    if (periodKey === detailPeriodKey) entry.current = snapshot;
    if (periodKey === previousPeriodKey) entry.previous = snapshot;
    byCustomer.set(row.customerKey, entry);
  }

  const detailRows: TofuDetailRow[] = [];
  for (const [customerKey, snapshotPair] of byCustomer.entries()) {
    const previousArr = round2(snapshotPair.previous?.arrEnd || 0);
    const currentArr = round2(snapshotPair.current?.arrEnd || 0);
    const previousMrr = round2(snapshotPair.previous?.mrrEnd || previousArr / 12);
    const currentMrr = round2(snapshotPair.current?.mrrEnd || currentArr / 12);
    const deltaArr = round2(currentArr - previousArr);
    const deltaMrr = round2(currentMrr - previousMrr);
    const source = snapshotPair.current?.source || snapshotPair.previous?.source || "stripe_only_customer";
    const customerLabel = snapshotPair.current?.customerLabel || snapshotPair.previous?.customerLabel || customerKey;
    const previousSegment = snapshotPair.previous
      ? segmentFromFactRow(snapshotPair.previous)
      : "selfserve";
    const currentSegment = snapshotPair.current
      ? segmentFromFactRow(snapshotPair.current)
      : "selfserve";

    const contributionArr =
      groupBy === "segment" && detailSegment
        ? contributionForSegmentMetric(
            request.detailMetric,
            detailSegment,
            previousArr,
            currentArr,
            previousSegment,
            currentSegment,
          )
        : contributionForMetric(request.detailMetric, previousArr, currentArr);
    if (contributionArr == null) continue;

    detailRows.push({
      customerId: customerKey,
      customerLabel,
      source,
      previousArr,
      currentArr,
      deltaArr,
      previousMrr,
      currentMrr,
      deltaMrr,
      contributionArr: round2(contributionArr),
      contributionMrr: round2(contributionArr / 12),
    });
  }

  detailRows.sort((a, b) => {
    const diff = Math.abs(b.contributionMrr) - Math.abs(a.contributionMrr);
    if (Math.abs(diff) > 1e-9) return diff;
    return a.customerLabel.localeCompare(b.customerLabel);
  });

  return {
    startDate: request.startDate,
    endDate: request.endDate,
    combineMode: "grouped",
    targetCurrency: "USD",
    detailGroupBy: groupBy,
    detailSegment: groupBy === "segment" && detailSegment ? detailSegment : undefined,
    detailSegmentLabel: groupBy === "segment" && detailSegment ? SEGMENT_LABELS[detailSegment] : undefined,
    detailPeriodKey,
    detailPeriodLabel: detailPeriodKey,
    detailPreviousPeriodKey: previousPeriodKey,
    detailPreviousPeriodLabel: previousPeriodKey,
    detailMetric: request.detailMetric,
    rows: detailRows,
    summary: {
      rowCount: detailRows.length,
      totalArr: round2(detailRows.reduce((sum, row) => sum + row.contributionArr, 0)),
      totalMrr: round2(detailRows.reduce((sum, row) => sum + row.contributionMrr, 0)),
    },
  };
}

export async function generateTofuReport(request: TofuRequest): Promise<TofuResponse> {
  const start = parseIsoDateOnly(request.startDate);
  const end = parseIsoDateOnly(request.endDate);
  if (!start || !end) {
    throw new Error("Invalid startDate/endDate");
  }
  if (end.getTime() < start.getTime()) {
    throw new Error("endDate must be >= startDate");
  }

  const { expanded, periods, allPeriodKeys } = await loadExpandedTofuSource(request);
  const groupBy = normalizeTofuGroupBy(request.groupBy);

  if (groupBy === "segment") {
    const segmentRows: TofuSegmentRow[] = [];

    for (const [idx, period] of periods.entries()) {
      const selectedPrevKey = idx > 0 ? periods[idx - 1].key : "";
      const prevKey = selectedPrevKey || previousPeriodKeyFor(period.key, periods, allPeriodKeys);

      const segmentBuckets = new Map<
        TofuSegment,
        {
          beginningArr: number;
          newArr: number;
          expansionArr: number;
          contractionArr: number;
          churnArr: number;
          endingArr: number;
        }
      >();

      const ensureBucket = (segment: TofuSegment) => {
        if (!segmentBuckets.has(segment)) {
          segmentBuckets.set(segment, {
            beginningArr: 0,
            newArr: 0,
            expansionArr: 0,
            contractionArr: 0,
            churnArr: 0,
            endingArr: 0,
          });
        }
        return segmentBuckets.get(segment)!;
      };

      for (const row of expanded.rows || []) {
        const curr = round2(Number(row.valuesByPeriod[period.key] || 0));
        const prev = round2(prevKey ? Number(row.valuesByPeriod[prevKey] || 0) : 0);
        const prevHas = Math.abs(prev) > 1e-9;
        const currHas = Math.abs(curr) > 1e-9;
        const prevSegment = prevHas ? segmentAtPeriod(row, prevKey) : "selfserve";
        const currSegment = currHas ? segmentAtPeriod(row, period.key) : "selfserve";

        if (prevHas) {
          const bucket = ensureBucket(prevSegment);
          bucket.beginningArr = round2(bucket.beginningArr + prev);
        }
        if (currHas) {
          const bucket = ensureBucket(currSegment);
          bucket.endingArr = round2(bucket.endingArr + curr);
        }

        if (!prevHas && currHas) {
          const bucket = ensureBucket(currSegment);
          bucket.newArr = round2(bucket.newArr + curr);
          continue;
        }

        if (prevHas && !currHas) {
          const bucket = ensureBucket(prevSegment);
          bucket.churnArr = round2(bucket.churnArr - prev);
          continue;
        }

        if (prevHas && currHas) {
          if (prevSegment === currSegment) {
            const diff = round2(curr - prev);
            const bucket = ensureBucket(currSegment);
            if (diff > 0) bucket.expansionArr = round2(bucket.expansionArr + diff);
            else if (diff < 0) bucket.contractionArr = round2(bucket.contractionArr + diff);
          } else {
            const oldBucket = ensureBucket(prevSegment);
            oldBucket.churnArr = round2(oldBucket.churnArr - prev);
            const newBucket = ensureBucket(currSegment);
            newBucket.expansionArr = round2(newBucket.expansionArr + curr);
          }
        }
      }

      for (const segment of SEGMENT_ORDER) {
        const bucket = segmentBuckets.get(segment);
        if (!bucket) continue;
        const hasAnyValue =
          Math.abs(bucket.beginningArr) > 1e-9 ||
          Math.abs(bucket.newArr) > 1e-9 ||
          Math.abs(bucket.expansionArr) > 1e-9 ||
          Math.abs(bucket.contractionArr) > 1e-9 ||
          Math.abs(bucket.churnArr) > 1e-9 ||
          Math.abs(bucket.endingArr) > 1e-9;
        if (!hasAnyValue) continue;

        segmentRows.push({
          periodKey: period.key,
          periodLabel: period.label,
          segment,
          beginningArr: bucket.beginningArr,
          newArr: bucket.newArr,
          expansionArr: bucket.expansionArr,
          contractionArr: bucket.contractionArr,
          churnArr: bucket.churnArr,
          endingArr: bucket.endingArr,
        });
      }
    }

    return {
      startDate: request.startDate,
      endDate: request.endDate,
      combineMode: expanded.combineMode,
      groupBy,
      targetCurrency: expanded.targetCurrency,
      rows: [],
      segmentRows,
    };
  }

  if (groupBy === "plan") {
    const planRows: TofuPlanRow[] = [];

    for (const [idx, period] of periods.entries()) {
      const selectedPrevKey = idx > 0 ? periods[idx - 1].key : "";
      const prevKey = selectedPrevKey || previousPeriodKeyFor(period.key, periods, allPeriodKeys);

      const planBuckets = new Map<
        CombinedAllSubsPlan,
        {
          beginningArr: number;
          newArr: number;
          expansionArr: number;
          contractionArr: number;
          churnArr: number;
          netPlanChangeArr: number;
          endingArr: number;
        }
      >();

      const ensureBucket = (plan: CombinedAllSubsPlan) => {
        if (!planBuckets.has(plan)) {
          planBuckets.set(plan, {
            beginningArr: 0,
            newArr: 0,
            expansionArr: 0,
            contractionArr: 0,
            churnArr: 0,
            netPlanChangeArr: 0,
            endingArr: 0,
          });
        }
        return planBuckets.get(plan)!;
      };

      for (const row of expanded.rows || []) {
        const curr = round2(Number(row.valuesByPeriod[period.key] || 0));
        const prev = round2(prevKey ? Number(row.valuesByPeriod[prevKey] || 0) : 0);
        const prevHas = Math.abs(prev) > 1e-9;
        const currHas = Math.abs(curr) > 1e-9;

        const prevPlan = prevHas ? planAtPeriod(row, prevKey) : "free";
        const currPlan = currHas ? planAtPeriod(row, period.key) : "free";

        if (prevHas) {
          const bucket = ensureBucket(prevPlan);
          bucket.beginningArr = round2(bucket.beginningArr + prev);
        }
        if (currHas) {
          const bucket = ensureBucket(currPlan);
          bucket.endingArr = round2(bucket.endingArr + curr);
        }

        if (!prevHas && currHas) {
          const bucket = ensureBucket(currPlan);
          bucket.newArr = round2(bucket.newArr + curr);
          continue;
        }

        if (prevHas && !currHas) {
          const bucket = ensureBucket(prevPlan);
          bucket.churnArr = round2(bucket.churnArr - prev);
          continue;
        }

        if (prevHas && currHas) {
          if (prevPlan === currPlan) {
            const diff = round2(curr - prev);
            const bucket = ensureBucket(currPlan);
            if (diff > 0) bucket.expansionArr = round2(bucket.expansionArr + diff);
            else if (diff < 0) bucket.contractionArr = round2(bucket.contractionArr + diff);
          } else {
            const oldPlanBucket = ensureBucket(prevPlan);
            oldPlanBucket.netPlanChangeArr = round2(oldPlanBucket.netPlanChangeArr - prev);
            const newPlanBucket = ensureBucket(currPlan);
            newPlanBucket.expansionArr = round2(newPlanBucket.expansionArr + curr);
          }
        }
      }

      for (const plan of PLAN_ORDER) {
        const bucket = planBuckets.get(plan);
        if (!bucket) continue;
        const hasAnyValue =
          Math.abs(bucket.beginningArr) > 1e-9 ||
          Math.abs(bucket.newArr) > 1e-9 ||
          Math.abs(bucket.expansionArr) > 1e-9 ||
          Math.abs(bucket.contractionArr) > 1e-9 ||
          Math.abs(bucket.churnArr) > 1e-9 ||
          Math.abs(bucket.netPlanChangeArr) > 1e-9 ||
          Math.abs(bucket.endingArr) > 1e-9;
        if (!hasAnyValue) continue;

        planRows.push({
          periodKey: period.key,
          periodLabel: period.label,
          plan,
          beginningArr: bucket.beginningArr,
          newArr: bucket.newArr,
          expansionArr: bucket.expansionArr,
          contractionArr: bucket.contractionArr,
          churnArr: bucket.churnArr,
          netPlanChangeArr: bucket.netPlanChangeArr,
          endingArr: bucket.endingArr,
        });
      }
    }

    return {
      startDate: request.startDate,
      endDate: request.endDate,
      combineMode: expanded.combineMode,
      groupBy,
      targetCurrency: expanded.targetCurrency,
      rows: [],
      planRows,
    };
  }

  const rows: TofuMonthRow[] = periods.map((period, idx) => {
    const selectedPrevKey = idx > 0 ? periods[idx - 1].key : "";
    const prevKey = selectedPrevKey || previousPeriodKeyFor(period.key, periods, allPeriodKeys);

    let beginningArr = 0;
    let newArr = 0;
    let expansionArr = 0;
    let contractionArr = 0;
    let churnArr = 0;
    let endingArr = 0;

    for (const row of expanded.rows || []) {
      const curr = round2(Number(row.valuesByPeriod[period.key] || 0));
      const prev = round2(
        prevKey
          ? Number(row.valuesByPeriod[prevKey] || 0)
          : 0,
      );

      beginningArr = round2(beginningArr + prev);
      endingArr = round2(endingArr + curr);

      const prevHas = Math.abs(prev) > 1e-9;
      const currHas = Math.abs(curr) > 1e-9;

      if (!prevHas && currHas) {
        newArr = round2(newArr + curr);
        continue;
      }

      if (prevHas && !currHas) {
        churnArr = round2(churnArr - prev);
        continue;
      }

      if (prevHas && currHas) {
        const diff = round2(curr - prev);
        if (diff > 0) expansionArr = round2(expansionArr + diff);
        else if (diff < 0) contractionArr = round2(contractionArr + diff);
      }
    }

    return {
      periodKey: period.key,
      periodLabel: period.label,
      beginningArr,
      newArr,
      expansionArr,
      contractionArr,
      churnArr,
      endingArr,
    };
  });

  return {
    startDate: request.startDate,
    endDate: request.endDate,
    combineMode: expanded.combineMode,
    groupBy,
    targetCurrency: expanded.targetCurrency,
    rows,
  };
}

export async function generateTofuDetailReport(request: TofuDetailRequest): Promise<TofuDetailResponse> {
  const start = parseIsoDateOnly(request.startDate);
  const end = parseIsoDateOnly(request.endDate);
  if (!start || !end) {
    throw new Error("Invalid startDate/endDate");
  }
  if (end.getTime() < start.getTime()) {
    throw new Error("endDate must be >= startDate");
  }
  if (!TOFU_DETAIL_METRICS.has(request.detailMetric)) {
    throw new Error("Invalid detail metric");
  }
  const groupBy = normalizeTofuGroupBy(request.groupBy);
  const detailSegmentRaw = String(request.detailSegment || "").trim().toLowerCase();
  const detailSegment = (SEGMENT_ORDER.find((segment) => segment === detailSegmentRaw) || "") as TofuSegment | "";
  if (groupBy === "segment" && !detailSegment) {
    throw new Error("Invalid detail segment");
  }

  const precomputedDetail = await generateTofuDetailReportFromPrecomputedFacts(
    request,
    groupBy,
    detailSegment,
  ).catch(() => null);
  if (precomputedDetail) return precomputedDetail;

  const { expanded, periods, allPeriodKeys } = await loadExpandedTofuSource(request);
  const detailPeriodKey = String(request.detailPeriodKey || "").trim();
  const period = periods.find((item) => item.key === detailPeriodKey);
  if (!period) {
    throw new Error("Invalid detail period");
  }

  const previousPeriodKey = previousPeriodKeyFor(period.key, periods, allPeriodKeys);
  const previousPeriodLabel = periods.find((item) => item.key === previousPeriodKey)?.label || previousPeriodKey;

  const detailRows: TofuDetailRow[] = [];
  for (const row of expanded.rows || []) {
    const previousArr = previousPeriodKey ? arrAtPeriod(row, previousPeriodKey) : 0;
    const currentArr = arrAtPeriod(row, period.key);
    const contributionArr =
      groupBy === "segment" && detailSegment
        ? contributionForSegmentMetric(
            request.detailMetric,
            detailSegment,
            previousArr,
            currentArr,
            previousPeriodKey ? segmentAtPeriod(row, previousPeriodKey) : "selfserve",
            segmentAtPeriod(row, period.key),
          )
        : contributionForMetric(request.detailMetric, previousArr, currentArr);
    if (contributionArr == null) continue;

    const deltaArr = round2(currentArr - previousArr);
    const previousMrr = round2(previousArr / 12);
    const currentMrr = round2(currentArr / 12);
    const deltaMrr = round2(deltaArr / 12);
    const contributionMrr = round2(contributionArr / 12);

    detailRows.push({
      customerId: row.id,
      customerLabel: row.customerLabel,
      source: row.source,
      previousArr,
      currentArr,
      deltaArr,
      previousMrr,
      currentMrr,
      deltaMrr,
      contributionArr: round2(contributionArr),
      contributionMrr,
    });
  }

  detailRows.sort((a, b) => {
    const diff = Math.abs(b.contributionMrr) - Math.abs(a.contributionMrr);
    if (Math.abs(diff) > 1e-9) return diff;
    return a.customerLabel.localeCompare(b.customerLabel);
  });

  return {
    startDate: request.startDate,
    endDate: request.endDate,
    combineMode: expanded.combineMode,
    targetCurrency: expanded.targetCurrency,
    detailGroupBy: groupBy,
    detailSegment: groupBy === "segment" && detailSegment ? detailSegment : undefined,
    detailSegmentLabel: groupBy === "segment" && detailSegment ? SEGMENT_LABELS[detailSegment] : undefined,
    detailPeriodKey: period.key,
    detailPeriodLabel: period.label,
    detailPreviousPeriodKey: previousPeriodKey,
    detailPreviousPeriodLabel: previousPeriodLabel,
    detailMetric: request.detailMetric,
    rows: detailRows,
    summary: {
      rowCount: detailRows.length,
      totalArr: round2(detailRows.reduce((sum, row) => sum + row.contributionArr, 0)),
      totalMrr: round2(detailRows.reduce((sum, row) => sum + row.contributionMrr, 0)),
    },
  };
}
