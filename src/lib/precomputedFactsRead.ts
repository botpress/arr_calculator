import { runBigQuerySqlRows, type BigQuerySqlParameter, type StripeBigQueryProfile } from "@/lib/stripeBigquery";

const PROFILE: StripeBigQueryProfile = "stripe_arr_correct";
const PRECOMPUTED_PROJECT = String(process.env.PRECOMPUTED_TABLES_PROJECT || "botpress-stripe-data-pipeline").trim()
  || "botpress-stripe-data-pipeline";
const PRECOMPUTED_DATASET = String(process.env.PRECOMPUTED_TABLES_DATASET || "precomputed_tables").trim()
  || "precomputed_tables";
const VIEW_FACT_CUSTOMER_ARR_CURRENT = "vw_fact_customer_arr_periodic_current";
const VIEW_FACT_TOFU_MONTHLY_CURRENT = "vw_fact_tofu_monthly_current";

export type PrecomputedFactCustomerArrRow = {
  periodDate: string;
  grain: "daily" | "monthly";
  customerKey: string;
  customerLabel: string;
  source: "hubspot_account" | "stripe_only_customer";
  segment: string;
  plan: string;
  salesAssist: boolean;
  deskEarlyAccess: boolean;
  matchMetadataKnown: boolean;
  hasStripeMatch: boolean;
  matchedStripeKeyCount: number;
  arrEnd: number;
  mrrEnd: number;
};

export type PrecomputedFactTofuMonthlyRow = {
  monthKey: string;
  periodDate: string;
  groupType: "overall" | "segment" | "plan";
  groupValue: string;
  beginningArr: number;
  newArr: number;
  expansionArr: number;
  contractionArr: number;
  churnArr: number;
  netPlanChangeArr: number;
  endingArr: number;
};

export function isPrecomputedFactsReadEnabled() {
  return String(process.env.PRECOMPUTED_FACTS_READ_ENABLED || "true").trim().toLowerCase() !== "false";
}

function viewRef(viewName: string) {
  return `\`${PRECOMPUTED_PROJECT}.${PRECOMPUTED_DATASET}.${viewName}\``;
}

function toNum(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function toBool(value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

export async function queryPrecomputedCustomerArrCurrent(params: {
  startDate: string;
  endDate: string;
  grain: "daily" | "monthly";
}) {
  const queryParams: BigQuerySqlParameter[] = [
    { name: "grain", type: "STRING", value: params.grain },
    { name: "start_date", type: "STRING", value: params.startDate },
    { name: "end_date", type: "STRING", value: params.endDate },
  ];

  const sqlWithMatchColumns = `
SELECT
  period_date,
  grain,
  customer_key,
  customer_label,
  source,
  segment,
  plan,
  sales_assist,
  desk_early_access,
  (has_stripe_match IS NOT NULL OR matched_stripe_key_count IS NOT NULL) AS match_metadata_known,
  has_stripe_match,
  matched_stripe_key_count,
  arr_end,
  mrr_end
FROM ${viewRef(VIEW_FACT_CUSTOMER_ARR_CURRENT)}
WHERE grain = @grain
  AND period_date BETWEEN DATE(@start_date) AND DATE(@end_date)
ORDER BY customer_key, period_date
`;
  const sqlLegacyColumns = `
SELECT
  period_date,
  grain,
  customer_key,
  customer_label,
  source,
  segment,
  plan,
  sales_assist,
  desk_early_access,
  FALSE AS match_metadata_known,
  arr_end,
  mrr_end
FROM ${viewRef(VIEW_FACT_CUSTOMER_ARR_CURRENT)}
WHERE grain = @grain
  AND period_date BETWEEN DATE(@start_date) AND DATE(@end_date)
ORDER BY customer_key, period_date
`;

  let rows: Awaited<ReturnType<typeof runBigQuerySqlRows>> = [];
  try {
    rows = await runBigQuerySqlRows(sqlWithMatchColumns, queryParams, { profile: PROFILE });
  } catch {
    rows = await runBigQuerySqlRows(sqlLegacyColumns, queryParams, { profile: PROFILE });
  }

  return rows.map((row) => ({
    periodDate: String(row.period_date || ""),
    grain: String(row.grain || "monthly").trim().toLowerCase() === "daily" ? "daily" : "monthly",
    customerKey: String(row.customer_key || ""),
    customerLabel: String(row.customer_label || ""),
    source: String(row.source || "") === "hubspot_account" ? "hubspot_account" : "stripe_only_customer",
    segment: String(row.segment || ""),
    plan: String(row.plan || ""),
    salesAssist: toBool(row.sales_assist),
    deskEarlyAccess: toBool(row.desk_early_access),
    matchMetadataKnown: toBool(row.match_metadata_known),
    hasStripeMatch: toBool(row.has_stripe_match),
    matchedStripeKeyCount: Math.max(0, Math.floor(toNum(row.matched_stripe_key_count))),
    arrEnd: toNum(row.arr_end),
    mrrEnd: toNum(row.mrr_end),
  })) satisfies PrecomputedFactCustomerArrRow[];
}

export async function queryPrecomputedTofuMonthlyCurrent(params: {
  startDate: string;
  endDate: string;
}) {
  const rows = await runBigQuerySqlRows(
    `
SELECT
  month_key,
  period_date,
  group_type,
  group_value,
  beginning_arr,
  new_arr,
  expansion_arr,
  contraction_arr,
  churn_arr,
  net_plan_change_arr,
  ending_arr
FROM ${viewRef(VIEW_FACT_TOFU_MONTHLY_CURRENT)}
WHERE period_date BETWEEN DATE_TRUNC(DATE(@start_date), MONTH) AND DATE_TRUNC(DATE(@end_date), MONTH)
ORDER BY period_date, group_type, group_value
`,
    [
      { name: "start_date", type: "STRING", value: params.startDate },
      { name: "end_date", type: "STRING", value: params.endDate },
    ],
    { profile: PROFILE },
  );

  return rows.map((row) => ({
    monthKey: String(row.month_key || ""),
    periodDate: String(row.period_date || ""),
    groupType: String(row.group_type || "overall").trim().toLowerCase() as "overall" | "segment" | "plan",
    groupValue: String(row.group_value || ""),
    beginningArr: toNum(row.beginning_arr),
    newArr: toNum(row.new_arr),
    expansionArr: toNum(row.expansion_arr),
    contractionArr: toNum(row.contraction_arr),
    churnArr: toNum(row.churn_arr),
    netPlanChangeArr: toNum(row.net_plan_change_arr),
    endingArr: toNum(row.ending_arr),
  })) satisfies PrecomputedFactTofuMonthlyRow[];
}

// Month-end ARR per month, split by where the customer is billed (HubSpot account vs Stripe only).
export async function queryPrecomputedMonthlyArrBySource(params: { startDate: string; endDate: string }) {
  const rows = await runBigQuerySqlRows(
    `
SELECT
  FORMAT_DATE('%Y-%m', period_date) AS month_key,
  SUM(IF(source = 'hubspot_account', arr_end, 0)) AS hubspot_arr,
  SUM(IF(source = 'hubspot_account', 0, arr_end)) AS stripe_arr,
  COUNTIF(arr_end > 0) AS paying_customers,
  COUNTIF(arr_end > 0 AND source = 'hubspot_account') AS hubspot_paying,
  COUNTIF(arr_end > 0 AND source != 'hubspot_account') AS stripe_paying
FROM ${viewRef(VIEW_FACT_CUSTOMER_ARR_CURRENT)}
WHERE grain = 'monthly'
  AND period_date BETWEEN DATE(@start_date) AND DATE(@end_date)
GROUP BY month_key
ORDER BY month_key
`,
    [
      { name: "start_date", type: "STRING", value: params.startDate },
      { name: "end_date", type: "STRING", value: params.endDate },
    ],
    { profile: PROFILE },
  );
  return rows.map((row) => ({
    monthKey: String(row.month_key || ""),
    hubspotArr: toNum(row.hubspot_arr),
    stripeArr: toNum(row.stripe_arr),
    payingCustomers: Math.floor(toNum(row.paying_customers)),
    hubspotPaying: Math.floor(toNum(row.hubspot_paying)),
    stripePaying: Math.floor(toNum(row.stripe_paying)),
  }));
}

// Net and gross revenue retention between two month-ends: customers paying at the start month,
// and what those same customers pay at the end month. NRR = end / start; GRR caps each customer
// at their starting ARR, so it counts only churn and contraction.
export async function queryPrecomputedRetentionBySource(params: { startMonth: string; endMonth: string }) {
  const rows = await runBigQuerySqlRows(
    `
WITH f AS (
  SELECT FORMAT_DATE('%Y-%m', period_date) AS month_key, customer_key, source, arr_end
  FROM ${viewRef(VIEW_FACT_CUSTOMER_ARR_CURRENT)}
  WHERE grain = 'monthly'
)
SELECT
  b.source,
  COUNT(*) AS customers,
  SUM(b.arr_end) AS start_arr,
  SUM(IFNULL(e.arr_end, 0)) AS end_arr,
  SUM(LEAST(IFNULL(e.arr_end, 0), b.arr_end)) AS retained_arr
FROM f b
LEFT JOIN f e ON e.customer_key = b.customer_key AND e.month_key = @end_month
WHERE b.month_key = @start_month AND b.arr_end > 0
GROUP BY b.source
`,
    [
      { name: "start_month", type: "STRING", value: params.startMonth },
      { name: "end_month", type: "STRING", value: params.endMonth },
    ],
    { profile: PROFILE },
  );
  return rows.map((row) => ({
    source: String(row.source || "") === "hubspot_account" ? "hubspot_account" : "stripe_only_customer",
    customers: Math.floor(toNum(row.customers)),
    startArr: toNum(row.start_arr),
    endArr: toNum(row.end_arr),
    retainedArr: toNum(row.retained_arr),
  }));
}
