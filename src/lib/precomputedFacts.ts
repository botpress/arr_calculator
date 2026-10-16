import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import {
  insertBigQueryRows,
  queryStripeAiSpendDailyAnnualizedFromUpcomingSnapshotsFromBigQuery,
  runBigQuerySqlStatement,
  type StripeBigQueryProfile,
} from "@/lib/stripeBigquery";
import { generateCombinedAllSubsReport, type CombinedAllSubsPlan } from "@/lib/combinedAllSubsReport";
import { generateTofuReport } from "@/lib/tofuReport";

const PROFILE: StripeBigQueryProfile = "stripe_arr_correct";
const PRECOMPUTED_PROJECT = String(process.env.PRECOMPUTED_TABLES_PROJECT || "botpress-stripe-data-pipeline").trim()
  || "botpress-stripe-data-pipeline";
const PRECOMPUTED_DATASET = String(process.env.PRECOMPUTED_TABLES_DATASET || "precomputed_tables").trim()
  || "precomputed_tables";
const MONTHLY_HISTORY_START = String(process.env.COMBINED_BILLING_OVERVIEW_MONTHLY_CACHE_START || "2023-01-01").trim()
  || "2023-01-01";
const AI_PRODUCT_TERMS = ["ai tokens", "web search and crawl"];

const TABLE_DIM_DATE = "dim_date";
const TABLE_FACT_CUSTOMER_ARR = "fact_customer_arr_periodic";
const TABLE_FACT_TOFU_MONTHLY = "fact_tofu_monthly";
const TABLE_FACT_AI_SPEND_DAILY = "fact_ai_spend_daily_agg";
const TABLE_FACT_SYNC_RUNS = "fact_sync_runs";
const VIEW_FACT_CUSTOMER_ARR_CURRENT = "vw_fact_customer_arr_periodic_current";
const VIEW_FACT_TOFU_MONTHLY_CURRENT = "vw_fact_tofu_monthly_current";
const VIEW_FACT_AI_SPEND_DAILY_CURRENT = "vw_fact_ai_spend_daily_agg_current";

type SyncMode = "full" | "dirty";
type FactGrain = "daily" | "monthly";

export type PrecomputedFactsSyncRequest = {
  mode?: SyncMode;
  startDate?: string;
  endDate?: string;
  includeDaily?: boolean;
  includeMonthly?: boolean;
  includeEnsureTables?: boolean;
  includeDimDate?: boolean;
  includeCustomerArrDaily?: boolean;
  includeAiSpendDaily?: boolean;
  includeCustomerArrMonthly?: boolean;
  includeTofuMonthly?: boolean;
  dirtyMonthKeys?: string[] | null;
};

export type PrecomputedFactsSyncStepResult = {
  step: string;
  ok: boolean;
  detail?: string;
  rowCount?: number;
  tookMs: number;
};

export type PrecomputedFactsSyncResult = {
  mode: SyncMode;
  startDate: string;
  endDate: string;
  syncRunId: string;
  includeDaily: boolean;
  includeMonthly: boolean;
  startedAtUtc: string;
  finishedAtUtc: string;
  steps: PrecomputedFactsSyncStepResult[];
};

function tableRef(table: string) {
  return `\`${PRECOMPUTED_PROJECT}.${PRECOMPUTED_DATASET}.${table}\``;
}

function validateIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function parseIsoDate(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const parsed = new Date(Date.UTC(y, mo, d, 0, 0, 0, 0));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== mo ||
    parsed.getUTCDate() !== d
  ) return null;
  return parsed;
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function maxIsoDate(a: string, b: string) {
  return a >= b ? a : b;
}

function minIsoDate(a: string, b: string) {
  return a <= b ? a : b;
}

function monthKeyToDate(key: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 0 || mo > 11) return null;
  return new Date(Date.UTC(y, mo, 1, 0, 0, 0, 0));
}

function dayKeyToDate(key: string) {
  return parseIsoDate(key);
}

function normalizePlan(value: string | undefined): CombinedAllSubsPlan {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "enterprise") return "enterprise";
  if (normalized === "managed") return "managed";
  if (normalized === "team") return "team";
  if (normalized === "plus") return "plus";
  if (normalized === "pay_as_you_go" || normalized === "pay as you go") return "pay_as_you_go";
  return "free";
}

function normalizeMode(raw: string | undefined): SyncMode {
  return String(raw || "").trim().toLowerCase() === "full" ? "full" : "dirty";
}

function splitIntoChunks<T>(values: T[], size: number) {
  const out: T[][] = [];
  const chunkSize = Math.max(1, Math.floor(size));
  for (let i = 0; i < values.length; i += chunkSize) {
    out.push(values.slice(i, i + chunkSize));
  }
  return out;
}

function toBigQueryNumeric(value: unknown): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  // BigQuery NUMERIC supports up to 9 fractional digits.
  return n.toFixed(9).replace(/\.?0+$/, "");
}

function normalizeTimestampForBigQuery(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw
    .replace(" ", "T")
    .replace(/\+00$/, "Z")
    .replace(/\+0000$/, "Z");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

async function insertRowsChunked(table: string, rows: Array<Record<string, unknown>>, chunkSize = 5000) {
  if (!rows.length) return 0;
  const chunks = splitIntoChunks(rows, chunkSize);
  for (const chunk of chunks) {
    await insertBigQueryRows({
      projectId: PRECOMPUTED_PROJECT,
      dataset: PRECOMPUTED_DATASET,
      table,
      rows: chunk,
      options: { profile: PROFILE },
    });
  }
  return rows.length;
}

async function ensureTables() {
  await runBigQuerySqlStatement(
    `
CREATE TABLE IF NOT EXISTS ${tableRef(TABLE_DIM_DATE)} (
  date DATE NOT NULL,
  month_key STRING NOT NULL,
  quarter_key STRING NOT NULL,
  year INT64 NOT NULL,
  month INT64 NOT NULL,
  day_of_month INT64 NOT NULL,
  days_in_month INT64 NOT NULL,
  month_start DATE NOT NULL,
  month_end DATE NOT NULL,
  updated_at TIMESTAMP NOT NULL
)
PARTITION BY date
CLUSTER BY month_key, quarter_key
`,
    [],
    { profile: PROFILE },
  );

  await runBigQuerySqlStatement(
    `
CREATE TABLE IF NOT EXISTS ${tableRef(TABLE_FACT_CUSTOMER_ARR)} (
  period_date DATE NOT NULL,
  grain STRING NOT NULL,
  customer_key STRING NOT NULL,
  customer_label STRING,
  source STRING NOT NULL,
  segment STRING NOT NULL,
  plan STRING NOT NULL,
  sales_assist BOOL NOT NULL,
  desk_early_access BOOL NOT NULL,
  has_stripe_match BOOL NOT NULL,
  matched_stripe_key_count INT64 NOT NULL,
  arr_end NUMERIC NOT NULL,
  mrr_end NUMERIC NOT NULL,
  month_key STRING NOT NULL,
  sync_run_id STRING,
  updated_at TIMESTAMP NOT NULL
)
PARTITION BY period_date
CLUSTER BY grain, segment, plan, customer_key
`,
    [],
    { profile: PROFILE },
  );

  await runBigQuerySqlStatement(
    `
CREATE TABLE IF NOT EXISTS ${tableRef(TABLE_FACT_TOFU_MONTHLY)} (
  month_key STRING NOT NULL,
  period_date DATE NOT NULL,
  group_type STRING NOT NULL,
  group_value STRING NOT NULL,
  beginning_arr NUMERIC NOT NULL,
  new_arr NUMERIC NOT NULL,
  expansion_arr NUMERIC NOT NULL,
  contraction_arr NUMERIC NOT NULL,
  churn_arr NUMERIC NOT NULL,
  net_plan_change_arr NUMERIC NOT NULL,
  ending_arr NUMERIC NOT NULL,
  sync_run_id STRING,
  updated_at TIMESTAMP NOT NULL
)
PARTITION BY period_date
CLUSTER BY group_type, group_value, month_key
`,
    [],
    { profile: PROFILE },
  );

  await runBigQuerySqlStatement(
    `
CREATE TABLE IF NOT EXISTS ${tableRef(TABLE_FACT_AI_SPEND_DAILY)} (
  date DATE NOT NULL,
  snapshot_timestamp_utc TIMESTAMP,
  ai_spend_without_exclusions NUMERIC NOT NULL,
  ai_spend_with_exclusions NUMERIC NOT NULL,
  ai_spend_excluded NUMERIC NOT NULL,
  line_count INT64 NOT NULL,
  customer_count INT64 NOT NULL,
  sync_run_id STRING,
  updated_at TIMESTAMP NOT NULL
)
PARTITION BY date
CLUSTER BY date
`,
    [],
    { profile: PROFILE },
  );

  await runBigQuerySqlStatement(
    `
CREATE TABLE IF NOT EXISTS ${tableRef(TABLE_FACT_SYNC_RUNS)} (
  started_at_utc TIMESTAMP NOT NULL,
  finished_at_utc TIMESTAMP NOT NULL,
  mode STRING NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  include_daily BOOL NOT NULL,
  include_monthly BOOL NOT NULL,
  ok BOOL NOT NULL,
  details_json STRING NOT NULL
)
PARTITION BY DATE(started_at_utc)
CLUSTER BY mode, start_date, end_date
`,
    [],
    { profile: PROFILE },
  );

  // Keep schema forward-compatible without DML rewrites.
  await runBigQuerySqlStatement(
    `
ALTER TABLE ${tableRef(TABLE_FACT_CUSTOMER_ARR)}
ADD COLUMN IF NOT EXISTS sync_run_id STRING
`,
    [],
    { profile: PROFILE },
  );
  await runBigQuerySqlStatement(
    `
ALTER TABLE ${tableRef(TABLE_FACT_CUSTOMER_ARR)}
ADD COLUMN IF NOT EXISTS has_stripe_match BOOL
`,
    [],
    { profile: PROFILE },
  );
  await runBigQuerySqlStatement(
    `
ALTER TABLE ${tableRef(TABLE_FACT_CUSTOMER_ARR)}
ADD COLUMN IF NOT EXISTS matched_stripe_key_count INT64
`,
    [],
    { profile: PROFILE },
  );
  await runBigQuerySqlStatement(
    `
ALTER TABLE ${tableRef(TABLE_FACT_TOFU_MONTHLY)}
ADD COLUMN IF NOT EXISTS sync_run_id STRING
`,
    [],
    { profile: PROFILE },
  );
  await runBigQuerySqlStatement(
    `
ALTER TABLE ${tableRef(TABLE_FACT_AI_SPEND_DAILY)}
ADD COLUMN IF NOT EXISTS sync_run_id STRING
`,
    [],
    { profile: PROFILE },
  );

  await runBigQuerySqlStatement(
    `
CREATE OR REPLACE VIEW ${tableRef(VIEW_FACT_CUSTOMER_ARR_CURRENT)} AS
-- Each period shows the rows of ONE run, so customers a later run no longer writes
-- (e.g. renamed keys) drop out instead of being added on top.
-- Runs logged as finished OK win; runs with no log at all (older ones) come next;
-- runs logged only as started or failed (cut off, or blocked by a fallback) are never shown.
WITH run_status AS (
  SELECT
    JSON_VALUE(details_json, '$.syncRunId') AS sync_run_id,
    LOGICAL_OR(ok) AS any_ok
  FROM ${tableRef(TABLE_FACT_SYNC_RUNS)}
  GROUP BY 1
),
candidate_runs AS (
  SELECT
    t.period_date,
    t.grain,
    IFNULL(t.sync_run_id, '') AS run_key,
    MAX(t.updated_at) AS run_updated_at,
    CASE
      WHEN LOGICAL_OR(s.any_ok) THEN 2
      WHEN LOGICAL_OR(s.sync_run_id IS NOT NULL) THEN 0
      ELSE 1
    END AS trust
  FROM ${tableRef(TABLE_FACT_CUSTOMER_ARR)} t
  LEFT JOIN run_status s ON s.sync_run_id = t.sync_run_id
  GROUP BY 1, 2, 3
),
chosen_runs AS (
  SELECT period_date, grain, run_key
  FROM candidate_runs
  WHERE trust > 0
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY period_date, grain
    ORDER BY trust DESC, run_updated_at DESC
  ) = 1
)
SELECT * EXCEPT(rn)
FROM (
  SELECT
    t.*,
    ROW_NUMBER() OVER (
      PARTITION BY t.period_date, t.grain, t.customer_key
      ORDER BY t.updated_at DESC
    ) AS rn
  FROM ${tableRef(TABLE_FACT_CUSTOMER_ARR)} t
  JOIN chosen_runs c
    ON c.period_date = t.period_date
    AND c.grain = t.grain
    AND c.run_key = IFNULL(t.sync_run_id, '')
)
WHERE rn = 1
`,
    [],
    { profile: PROFILE },
  );

  await runBigQuerySqlStatement(
    `
CREATE OR REPLACE VIEW ${tableRef(VIEW_FACT_TOFU_MONTHLY_CURRENT)} AS
SELECT * EXCEPT(rn)
FROM (
  SELECT
    t.*,
    ROW_NUMBER() OVER (
      PARTITION BY t.period_date, t.group_type, t.group_value
      ORDER BY t.updated_at DESC, t.sync_run_id DESC
    ) AS rn
  FROM ${tableRef(TABLE_FACT_TOFU_MONTHLY)} t
)
WHERE rn = 1
`,
    [],
    { profile: PROFILE },
  );

  await runBigQuerySqlStatement(
    `
CREATE OR REPLACE VIEW ${tableRef(VIEW_FACT_AI_SPEND_DAILY_CURRENT)} AS
SELECT * EXCEPT(rn)
FROM (
  SELECT
    t.*,
    ROW_NUMBER() OVER (
      PARTITION BY t.date
      ORDER BY t.updated_at DESC, t.sync_run_id DESC
    ) AS rn
  FROM ${tableRef(TABLE_FACT_AI_SPEND_DAILY)} t
)
WHERE rn = 1
`,
    [],
    { profile: PROFILE },
  );
}

async function syncDateDimension(startDate: string, endDate: string) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end || end.getTime() < start.getTime()) return 0;
  await runBigQuerySqlStatement(
    `
INSERT INTO ${tableRef(TABLE_DIM_DATE)}
  (date, month_key, quarter_key, year, month, day_of_month, days_in_month, month_start, month_end, updated_at)
SELECT
  d AS date,
  FORMAT_DATE('%Y-%m', d) AS month_key,
  FORMAT('%d-Q%d', EXTRACT(YEAR FROM d), CAST(CEIL(EXTRACT(MONTH FROM d) / 3.0) AS INT64)) AS quarter_key,
  EXTRACT(YEAR FROM d) AS year,
  EXTRACT(MONTH FROM d) AS month,
  EXTRACT(DAY FROM d) AS day_of_month,
  EXTRACT(DAY FROM DATE_SUB(DATE_ADD(DATE_TRUNC(d, MONTH), INTERVAL 1 MONTH), INTERVAL 1 DAY)) AS days_in_month,
  DATE_TRUNC(d, MONTH) AS month_start,
  DATE_SUB(DATE_ADD(DATE_TRUNC(d, MONTH), INTERVAL 1 MONTH), INTERVAL 1 DAY) AS month_end,
  CURRENT_TIMESTAMP() AS updated_at
FROM UNNEST(GENERATE_DATE_ARRAY(DATE(@start_date), DATE(@end_date))) AS d
LEFT JOIN ${tableRef(TABLE_DIM_DATE)} existing
  ON existing.date = d
WHERE existing.date IS NULL
`,
    [
      { name: "start_date", type: "STRING", value: startDate },
      { name: "end_date", type: "STRING", value: endDate },
    ],
    { profile: PROFILE },
  );
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

async function syncCustomerArrPeriodic(startDate: string, endDate: string, grain: FactGrain, syncRunId: string) {
  const report = await generateCombinedAllSubsReport({
    startDate,
    endDate,
    combineMode: "grouped",
    displayMode: "arr",
    planGrain: grain,
    includePlanData: true,
    groupedMatchStrategy: "full",
    includeSalesAssist: true,
    preferPrecomputedFacts: false,
  });

  // A report that fell back (no HubSpot↔Stripe matching or no sales-assist flags) has the right
  // totals but the wrong segment split. Fail the run so the saved data keeps the last good copy.
  const blockingWarnings = (report.warnings || []).filter((warning) =>
    /Grouped matching is temporarily unavailable|Sales-assist flag is temporarily unavailable/.test(warning),
  );
  if (blockingWarnings.length) {
    throw new Error(`Not saved: ${blockingWarnings.join(" | ")}`);
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const row of report.rows || []) {
    for (const period of report.periods || []) {
      const periodKey = String(period.key || "").trim();
      const periodDate = grain === "daily" ? dayKeyToDate(periodKey) : monthKeyToDate(periodKey);
      if (!periodDate) continue;
      const periodDateIso = toIsoDate(periodDate);
      const arrEnd = Number(row.valuesByPeriod?.[periodKey] || 0);
      const salesAssist = String(row.salesAssistByPeriod?.[periodKey] || row.salesAssist || "no").toLowerCase() === "yes";
      const deskEarlyAccess = String(row.deskEarlyAccessByPeriod?.[periodKey] || "no").toLowerCase() === "yes";
      const source = String(row.source || "stripe_only_customer");
      const segment = salesAssist
        ? "sales_assist"
        : (source === "hubspot_account" ? "salesled" : "selfserve");
      const plan = normalizePlan(String(row.plansByPeriod?.[periodKey] || "free"));
      const matchedStripeKeyCount = source === "hubspot_account"
        ? Math.max(0, Math.floor(Number(row.matchedStripeKeyCount || row.matchedStripeKeys?.length || 0)))
        : 0;
      const hasStripeMatch = source === "hubspot_account" && matchedStripeKeyCount > 0;
      rows.push({
        period_date: periodDateIso,
        grain,
        customer_key: String(row.id || ""),
        customer_label: String(row.customerLabel || ""),
        source,
        segment,
        plan,
        sales_assist: salesAssist,
        desk_early_access: deskEarlyAccess,
        has_stripe_match: hasStripeMatch,
        matched_stripe_key_count: matchedStripeKeyCount,
        arr_end: toBigQueryNumeric(arrEnd),
        mrr_end: toBigQueryNumeric(arrEnd / 12),
        month_key: periodDateIso.slice(0, 7),
        sync_run_id: syncRunId,
        updated_at: new Date().toISOString(),
      });
    }
  }

  return insertRowsChunked(TABLE_FACT_CUSTOMER_ARR, rows, 5000);
}

async function syncTofuMonthly(startDate: string, endDate: string, syncRunId: string) {
  const rows: Array<Record<string, unknown>> = [];
  const monthReport = await generateTofuReport({
    startDate,
    endDate,
    combineMode: "grouped",
    groupBy: "month",
    freshSource: true,
  });
  for (const row of monthReport.rows || []) {
    const d = monthKeyToDate(row.periodKey);
    if (!d) continue;
    rows.push({
      month_key: row.periodKey,
      period_date: toIsoDate(d),
      group_type: "overall",
      group_value: "overall",
      beginning_arr: toBigQueryNumeric(row.beginningArr),
      new_arr: toBigQueryNumeric(row.newArr),
      expansion_arr: toBigQueryNumeric(row.expansionArr),
      contraction_arr: toBigQueryNumeric(row.contractionArr),
      churn_arr: toBigQueryNumeric(row.churnArr),
      net_plan_change_arr: toBigQueryNumeric(0),
      ending_arr: toBigQueryNumeric(row.endingArr),
      sync_run_id: syncRunId,
      updated_at: new Date().toISOString(),
    });
  }

  const segmentReport = await generateTofuReport({
    startDate,
    endDate,
    combineMode: "grouped",
    groupBy: "segment",
    freshSource: true,
  });
  for (const row of segmentReport.segmentRows || []) {
    const d = monthKeyToDate(row.periodKey);
    if (!d) continue;
    rows.push({
      month_key: row.periodKey,
      period_date: toIsoDate(d),
      group_type: "segment",
      group_value: String(row.segment || "unknown"),
      beginning_arr: toBigQueryNumeric(row.beginningArr),
      new_arr: toBigQueryNumeric(row.newArr),
      expansion_arr: toBigQueryNumeric(row.expansionArr),
      contraction_arr: toBigQueryNumeric(row.contractionArr),
      churn_arr: toBigQueryNumeric(row.churnArr),
      net_plan_change_arr: toBigQueryNumeric(0),
      ending_arr: toBigQueryNumeric(row.endingArr),
      sync_run_id: syncRunId,
      updated_at: new Date().toISOString(),
    });
  }

  const planReport = await generateTofuReport({
    startDate,
    endDate,
    combineMode: "grouped",
    groupBy: "plan",
    freshSource: true,
  });
  for (const row of planReport.planRows || []) {
    const d = monthKeyToDate(row.periodKey);
    if (!d) continue;
    rows.push({
      month_key: row.periodKey,
      period_date: toIsoDate(d),
      group_type: "plan",
      group_value: String(row.plan || "free"),
      beginning_arr: toBigQueryNumeric(row.beginningArr),
      new_arr: toBigQueryNumeric(row.newArr),
      expansion_arr: toBigQueryNumeric(row.expansionArr),
      contraction_arr: toBigQueryNumeric(row.contractionArr),
      churn_arr: toBigQueryNumeric(row.churnArr),
      net_plan_change_arr: toBigQueryNumeric(row.netPlanChangeArr),
      ending_arr: toBigQueryNumeric(row.endingArr),
      sync_run_id: syncRunId,
      updated_at: new Date().toISOString(),
    });
  }

  return insertRowsChunked(TABLE_FACT_TOFU_MONTHLY, rows, 5000);
}

async function syncAiSpendDailyAgg(startDate: string, endDate: string, syncRunId: string) {
  const result = await queryStripeAiSpendDailyAnnualizedFromUpcomingSnapshotsFromBigQuery(
    {
      startDate,
      endDate,
      targetCurrency: "usd",
      productDescriptionIncludes: AI_PRODUCT_TERMS,
    },
    { profile: PROFILE },
  );

  const rows = (result.points || []).map((point) => ({
    date: point.snapshotDate,
    snapshot_timestamp_utc: normalizeTimestampForBigQuery(point.snapshotTimestampUtc),
    ai_spend_without_exclusions: toBigQueryNumeric(point.annualizedArrWithoutExclusions),
    ai_spend_with_exclusions: toBigQueryNumeric(point.annualizedArr),
    ai_spend_excluded: toBigQueryNumeric(point.annualizedArrExcluded),
    line_count: Number(point.lineCount || 0),
    customer_count: Number(point.customerCount || 0),
    sync_run_id: syncRunId,
    updated_at: new Date().toISOString(),
  }));
  return insertRowsChunked(TABLE_FACT_AI_SPEND_DAILY, rows, 5000);
}

// The saved-data view trusts these log rows, so a write that fails is retried, then raised.
async function writeSyncRun(result: PrecomputedFactsSyncResult, ok: boolean, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await insertSyncRunRow(result, ok);
      return;
    } catch (error: unknown) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
    }
  }
}

async function insertSyncRunRow(result: PrecomputedFactsSyncResult, ok: boolean) {
  await insertBigQueryRows({
    projectId: PRECOMPUTED_PROJECT,
    dataset: PRECOMPUTED_DATASET,
    table: TABLE_FACT_SYNC_RUNS,
    rows: [{
      started_at_utc: result.startedAtUtc,
      finished_at_utc: result.finishedAtUtc,
      mode: result.mode,
      start_date: result.startDate,
      end_date: result.endDate,
      include_daily: result.includeDaily,
      include_monthly: result.includeMonthly,
      ok,
      details_json: JSON.stringify(result),
    }],
    options: { profile: PROFILE },
  });
}

export function resolveSyncWindow(request: PrecomputedFactsSyncRequest) {
  const mode = normalizeMode(request.mode);
  const today = new Date();
  const todayIso = toIsoDate(today);
  const defaultStart = mode === "full"
    ? MONTHLY_HISTORY_START
    : maxIsoDate(MONTHLY_HISTORY_START, toIsoDate(new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - 62,
    ))));
  const startDate = validateIsoDate(String(request.startDate || "")) ? String(request.startDate) : defaultStart;
  const endDate = validateIsoDate(String(request.endDate || "")) ? String(request.endDate) : todayIso;
  let resolvedStartDate = startDate;
  let resolvedEndDate = endDate;

  const dirtyMonthKeys = Array.isArray(request.dirtyMonthKeys)
    ? Array.from(new Set(request.dirtyMonthKeys.map((value) => String(value || "").trim()).filter((value) => /^\d{4}-\d{2}$/.test(value)))).sort()
    : [];
  if (!validateIsoDate(String(request.startDate || "")) && !validateIsoDate(String(request.endDate || "")) && mode === "dirty" && dirtyMonthKeys.length) {
    const firstMonth = monthKeyToDate(dirtyMonthKeys[0]);
    const lastMonth = monthKeyToDate(dirtyMonthKeys[dirtyMonthKeys.length - 1]);
    if (firstMonth && lastMonth) {
      const monthEnd = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + 1, 0));
      resolvedStartDate = maxIsoDate(MONTHLY_HISTORY_START, toIsoDate(firstMonth));
      resolvedEndDate = minIsoDate(todayIso, toIsoDate(monthEnd));
    }
  }

  if (resolvedEndDate < resolvedStartDate) throw new Error("endDate must be >= startDate");
  return {
    mode,
    startDate: resolvedStartDate,
    endDate: resolvedEndDate,
    includeDaily: request.includeDaily !== false,
    includeMonthly: request.includeMonthly !== false,
    includeEnsureTables: request.includeEnsureTables !== false,
    includeDimDate: request.includeDimDate !== false,
    includeCustomerArrDaily: request.includeCustomerArrDaily !== false,
    includeAiSpendDaily: request.includeAiSpendDaily !== false,
    includeCustomerArrMonthly: request.includeCustomerArrMonthly !== false,
    includeTofuMonthly: request.includeTofuMonthly !== false,
  };
}

export async function syncPrecomputedFacts(request: PrecomputedFactsSyncRequest): Promise<PrecomputedFactsSyncResult> {
  const window = resolveSyncWindow(request);
  const startedAtUtc = new Date().toISOString();
  const syncRunId = `${window.mode}:${startedAtUtc}:${Math.random().toString(36).slice(2, 10)}`;
  const steps: PrecomputedFactsSyncStepResult[] = [];

  const runStep = async (step: string, fn: () => Promise<number | string | void>) => {
    const t0 = Date.now();
    try {
      const value = await fn();
      const detail = typeof value === "string" ? value : undefined;
      const rowCount = typeof value === "number" ? value : undefined;
      steps.push({
        step,
        ok: true,
        detail,
        rowCount,
        tookMs: Date.now() - t0,
      });
    } catch (error: unknown) {
      steps.push({
        step,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        tookMs: Date.now() - t0,
      });
      throw error;
    }
  };

  try {
    if (window.includeEnsureTables) {
      await runStep("ensure_tables", async () => {
        await ensureTables();
        return "ok";
      });
    }
    // Logged as not-OK up front: if the run is cut off, the saved-data view never shows its rows.
    // No facts are written unless this marker is saved.
    await runStep("log_started", () => writeSyncRun({
      mode: window.mode,
      startDate: window.startDate,
      endDate: window.endDate,
      syncRunId,
      includeDaily: window.includeDaily,
      includeMonthly: window.includeMonthly,
      startedAtUtc,
      finishedAtUtc: startedAtUtc,
      steps: [{ step: "started", ok: false, detail: "run in progress", tookMs: 0 }],
    }, false));
    if (window.includeDimDate) {
      await runStep("sync_dim_date", () => syncDateDimension(window.startDate, window.endDate));
    }
    if (window.includeDaily) {
      if (window.includeCustomerArrDaily) {
        await runStep("sync_customer_arr_daily", () => syncCustomerArrPeriodic(window.startDate, window.endDate, "daily", syncRunId));
      }
      if (window.includeAiSpendDaily) {
        await runStep("sync_ai_spend_daily_agg", () => syncAiSpendDailyAgg(window.startDate, window.endDate, syncRunId));
      }
    }
    if (window.includeMonthly) {
      if (window.includeCustomerArrMonthly) {
        await runStep("sync_customer_arr_monthly", () => syncCustomerArrPeriodic(window.startDate, window.endDate, "monthly", syncRunId));
      }
      if (window.includeTofuMonthly) {
        await runStep("sync_tofu_monthly", () => syncTofuMonthly(window.startDate, window.endDate, syncRunId));
      }
    }
  } finally {
    const finishedAtUtc = new Date().toISOString();
    const result: PrecomputedFactsSyncResult = {
      mode: window.mode,
      startDate: window.startDate,
      endDate: window.endDate,
      syncRunId,
      includeDaily: window.includeDaily,
      includeMonthly: window.includeMonthly,
      startedAtUtc,
      finishedAtUtc,
      steps,
    };
    const ok = steps.every((step) => step.ok);
    const logError = await writeSyncRun(result, ok).then(() => null, (error: unknown) => error);
    // A finished run whose success can't be logged stays hidden, so report it as failed.
    if (ok && logError) {
      steps.push({
        step: "log_finished",
        ok: false,
        detail: logError instanceof Error ? logError.message : String(logError),
        tookMs: 0,
      });
      throw logError;
    }
  }

  return {
    mode: window.mode,
    startDate: window.startDate,
    endDate: window.endDate,
    syncRunId,
    includeDaily: window.includeDaily,
    includeMonthly: window.includeMonthly,
    startedAtUtc,
    finishedAtUtc: new Date().toISOString(),
    steps,
  };
}

export async function assertAdmin(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
  });
  const isAdmin = String(token?.role || "viewer").trim().toLowerCase() === "admin";
  if (!isAdmin) throw new Error("Forbidden");
}
