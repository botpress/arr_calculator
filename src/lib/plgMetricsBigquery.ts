import { runBigQuerySqlRows, type BigQuerySqlParameter, type StripeBigQueryProfile } from "@/lib/stripeBigquery";

const PROFILE: StripeBigQueryProfile = "stripe_arr_correct";
const BIGQUERY_PROJECT = String(process.env.GTM_BIGQUERY_PROJECT || "botpress-stripe-data-pipeline").trim()
  || "botpress-stripe-data-pipeline";
const TRANSFORMED_DATASET = String(process.env.GTM_BIGQUERY_TRANSFORMED_DATASET || "transformed_data").trim()
  || "transformed_data";
const CUSTOMER_MOVEMENT_TABLE = "rpt_logo_movement_details_by_period_and_motion";

export type PlgNrrMetric = {
  audience: "plg" | "sales";
  cohort: "new" | "legacy";
  openingArr: number;
  currentArr: number;
  nrrPct: number | null;
  customerCount: number;
  retainedCustomerCount: number;
};

export type PlgAcvMetric = {
  motion: "plg" | "sales_assist" | "sales_led";
  acv: number | null;
  newArr: number;
  customerCount: number;
};

export type PlgMetricsReport = {
  asOfDate: string;
  newBusinessStartDate: string;
  legacySnapshotDate: string;
  targetCurrency: string;
  generatedAtUtc: string;
  nrr: PlgNrrMetric[];
  acv: PlgAcvMetric[];
  definitions: {
    newBusinessNrr: string;
    legacyNrr: string;
    acvYtd: string;
    motion: string;
  };
};

function safeIdentifier(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid ${label} BigQuery identifier.`);
  return value;
}

function tableRef() {
  return `\`${safeIdentifier(BIGQUERY_PROJECT, "project")}.${safeIdentifier(TRANSFORMED_DATASET, "dataset")}.${safeIdentifier(CUSTOMER_MOVEMENT_TABLE, "table")}\``;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number) {
  return Math.round((value || 0) * 100) / 100;
}

export async function queryPlgMetrics(input?: { asOfDate?: string }): Promise<PlgMetricsReport> {
  const requestedAsOfDate = String(input?.asOfDate || "").trim();
  if (requestedAsOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedAsOfDate)) {
    throw new Error("Invalid asOfDate. Expected YYYY-MM-DD.");
  }

  const newBusinessStartDate = "2026-04-01";
  const legacySnapshotDate = "2026-03-31";
  const params: BigQuerySqlParameter[] = [
    { name: "requested_as_of_date", type: "STRING", value: requestedAsOfDate },
    { name: "new_business_start_date", type: "STRING", value: newBusinessStartDate },
    { name: "legacy_snapshot_date", type: "STRING", value: legacySnapshotDate },
  ];

  const rows = await runBigQuerySqlRows(
    `
WITH daily_motion AS (
  SELECT
    period_end AS period_date,
    customer_key,
    motion AS segment,
    CAST(current_customer_carr AS FLOAT64) AS customer_arr,
    CAST(current_segment_carr AS FLOAT64) AS motion_arr,
    CAST(previous_customer_carr AS FLOAT64) AS previous_customer_arr,
    bucket
  FROM ${tableRef()}
  WHERE movement_scope = 'motion'
    AND grain = 'day'
    AND motion IN ('self_serve', 'sales_assist', 'sales_led')
), bounds AS (
  SELECT
    IF(
      NULLIF(@requested_as_of_date, '') IS NULL,
      MAX(period_date),
      LEAST(DATE(@requested_as_of_date), MAX(period_date))
    ) AS as_of_date
  FROM daily_motion
), first_paid AS (
  SELECT
    customer_key,
    period_date AS first_paid_date,
    segment AS acquisition_segment,
    customer_arr AS acquisition_arr
  FROM daily_motion
  WHERE bucket = 'new'
    AND previous_customer_arr <= 0
    AND customer_arr > 0
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY customer_key
    ORDER BY period_date, motion_arr DESC, segment
  ) = 1
), latest_by_customer AS (
  SELECT customer_key, MAX(customer_arr) AS current_arr
  FROM daily_motion
  CROSS JOIN bounds
  WHERE period_date = bounds.as_of_date
  GROUP BY customer_key
), legacy AS (
  SELECT
    customer_key,
    segment AS cohort_segment,
    customer_arr AS opening_arr
  FROM daily_motion
  WHERE period_date = DATE(@legacy_snapshot_date)
    AND customer_arr > 0
    AND motion_arr > 0
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY customer_key
    ORDER BY motion_arr DESC, segment
  ) = 1
), nrr_cohorts AS (
  SELECT
    'new' AS cohort,
    customer_key,
    acquisition_segment AS cohort_segment,
    acquisition_arr AS opening_arr
  FROM first_paid
  CROSS JOIN bounds
  WHERE first_paid_date BETWEEN DATE(@new_business_start_date) AND bounds.as_of_date

  UNION ALL

  SELECT 'legacy', customer_key, cohort_segment, opening_arr
  FROM legacy
), audiences AS (
  SELECT 'plg' AS audience, ['self_serve'] AS segments
  UNION ALL
  SELECT 'sales', ['sales_assist', 'sales_led']
), nrr_metrics AS (
  SELECT
    audiences.audience,
    nrr_cohorts.cohort,
    SUM(nrr_cohorts.opening_arr) AS opening_arr,
    SUM(COALESCE(latest_by_customer.current_arr, 0)) AS current_arr,
    SAFE_MULTIPLY(
      SAFE_DIVIDE(SUM(COALESCE(latest_by_customer.current_arr, 0)), SUM(nrr_cohorts.opening_arr)),
      100
    ) AS nrr_pct,
    COUNT(*) AS customer_count,
    COUNTIF(COALESCE(latest_by_customer.current_arr, 0) > 0) AS retained_customer_count
  FROM audiences
  JOIN nrr_cohorts ON nrr_cohorts.cohort_segment IN UNNEST(audiences.segments)
  LEFT JOIN latest_by_customer USING (customer_key)
  GROUP BY audiences.audience, nrr_cohorts.cohort
), acv_motions AS (
  SELECT 'plg' AS motion, ['self_serve'] AS segments
  UNION ALL SELECT 'sales_assist', ['sales_assist']
  UNION ALL SELECT 'sales_led', ['sales_led']
), acv_metrics AS (
  SELECT
    acv_motions.motion,
    AVG(first_paid.acquisition_arr) AS acv,
    SUM(first_paid.acquisition_arr) AS new_arr,
    COUNT(*) AS customer_count
  FROM acv_motions
  LEFT JOIN first_paid
    ON first_paid.acquisition_segment IN UNNEST(acv_motions.segments)
  CROSS JOIN bounds
  WHERE first_paid.first_paid_date BETWEEN DATE(@new_business_start_date) AND bounds.as_of_date
  GROUP BY acv_motions.motion
)
SELECT
  'nrr' AS metric_type,
  bounds.as_of_date,
  nrr_metrics.audience,
  nrr_metrics.cohort,
  CAST(NULL AS STRING) AS motion,
  nrr_metrics.opening_arr,
  nrr_metrics.current_arr,
  nrr_metrics.nrr_pct,
  nrr_metrics.customer_count,
  nrr_metrics.retained_customer_count,
  CAST(NULL AS FLOAT64) AS acv,
  CAST(NULL AS FLOAT64) AS new_arr
FROM bounds CROSS JOIN nrr_metrics

UNION ALL

SELECT
  'acv',
  bounds.as_of_date,
  CAST(NULL AS STRING),
  CAST(NULL AS STRING),
  acv_metrics.motion,
  CAST(NULL AS FLOAT64),
  CAST(NULL AS FLOAT64),
  CAST(NULL AS FLOAT64),
  acv_metrics.customer_count,
  CAST(NULL AS INT64),
  acv_metrics.acv,
  acv_metrics.new_arr
FROM bounds CROSS JOIN acv_metrics
ORDER BY metric_type, audience, cohort, motion
`,
    params,
    { profile: PROFILE },
  );

  const asOfDate = String(rows[0]?.as_of_date || "");
  if (!asOfDate) throw new Error("No daily customer ARR snapshots are available in BigQuery.");

  const nrr = rows
    .filter((row) => String(row.metric_type) === "nrr")
    .map((row) => ({
      audience: String(row.audience) as PlgNrrMetric["audience"],
      cohort: String(row.cohort) as PlgNrrMetric["cohort"],
      openingArr: round2(numberValue(row.opening_arr)),
      currentArr: round2(numberValue(row.current_arr)),
      nrrPct: nullableNumber(row.nrr_pct),
      customerCount: Math.round(numberValue(row.customer_count)),
      retainedCustomerCount: Math.round(numberValue(row.retained_customer_count)),
    }));

  const acv = rows
    .filter((row) => String(row.metric_type) === "acv")
    .map((row) => ({
      motion: String(row.motion) as PlgAcvMetric["motion"],
      acv: nullableNumber(row.acv),
      newArr: round2(numberValue(row.new_arr)),
      customerCount: Math.round(numberValue(row.customer_count)),
    }));

  return {
    asOfDate,
    newBusinessStartDate,
    legacySnapshotDate,
    targetCurrency: String(
      process.env.STRIPE_THROUGH_MRR_TARGET_CURRENCY
      || process.env.STRIPE_ARR_CORRECT_TARGET_CURRENCY
      || "USD",
    ).trim().toUpperCase(),
    generatedAtUtc: new Date().toISOString(),
    nrr,
    acv,
    definitions: {
      newBusinessNrr: "Current ARR divided by ARR on the first paid day, for customers whose first paid day is April 1, 2026 or later.",
      legacyNrr: "Current ARR divided by March 31, 2026 ARR for the fixed cohort that was active and paying on March 31, 2026.",
      acvYtd: "Average ARR on the first paid day for customers first paid since April 1, 2026 (fiscal YTD).",
      motion: "PLG is self-serve. Sales combines Sales Assist and Sales Led for NRR; ACV is shown separately for those motions.",
    },
  };
}
