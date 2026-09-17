import { runBigQuerySqlRows, type BigQuerySqlParameter } from "@/lib/stripeBigquery";
import { SALES_QUOTA_CONFIGS, salesQuotaPeriod } from "@/lib/salesQuotaRules";

const BIGQUERY_PROJECT = String(process.env.GTM_BIGQUERY_PROJECT || "botpress-stripe-data-pipeline").trim() || "botpress-stripe-data-pipeline";
const TRANSFORMED_DATASET = String(process.env.GTM_BIGQUERY_TRANSFORMED_DATASET || "transformed_data").trim() || "transformed_data";
const HUBSPOT_DATASET = String(process.env.GTM_BIGQUERY_HUBSPOT_DATASET || "hubspot").trim() || "hubspot";
const SALES_DEFAULT_PIPELINE_ID = "0cbbc8c6-dccf-4601-8d59-b6a15ed5129b";
const TRANSACTIONAL_PIPELINE_ID = "730649262";
const PROFILE = "stripe_arr_correct" as const;

export type ScorecardCarrMetrics = {
  hasData: boolean;
  selfserveOpeningArr: number;
  selfserveExpansionArr: number;
  selfserveContractionArr: number;
  selfserveChurnArr: number;
  salesLedChurnArr: number;
  totalOpeningArr: number;
  totalExpansionArr: number;
  totalContractionArr: number;
  totalChurnArr: number;
  salesNewAndExpansionArr: number;
  salesLedExpansionArr: number;
  selfserveChurnLogos: number;
  salesLedChurnLogos: number;
};

export type ScorecardDealMetrics = {
  pipelineCreatedDeals: number;
  pipelineCreatedArr: number;
  salesLedClosedWon: number;
  salesLedClosedLost: number;
  renewalClosedWon: number;
  renewalClosedLost: number;
};

export type ScorecardContactMetrics = {
  mqlCount: number;
  sqlCount: number;
};

export type ScorecardQuotaMetric = {
  ownerName: string;
  cadence: "monthly" | "quarterly";
  soldAmount: number;
  quotaAmount: number;
  attainmentPct: number;
  dealCount: number;
  periodStart: string;
  periodEnd: string;
};

export type ScorecardAccountManagerMetric = {
  ownerName: string;
  accountCount: number;
  endingArr: number;
  openingCohortArr: number;
  endingCohortArr: number;
  nrrPct: number | null;
};

function safeIdentifier(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid ${label} BigQuery identifier.`);
  return value;
}

function tableRef(dataset: string, table: string) {
  return `\`${safeIdentifier(BIGQUERY_PROJECT, "project")}.${safeIdentifier(dataset, "dataset")}.${safeIdentifier(table, "table")}\``;
}

function dateParams(startDate: string, endDate: string): BigQuerySqlParameter[] {
  return [
    { name: "start_date", type: "STRING", value: startDate },
    { name: "end_date", type: "STRING", value: endDate },
    { name: "sales_pipeline", type: "STRING", value: SALES_DEFAULT_PIPELINE_ID },
    { name: "transaction_pipeline", type: "STRING", value: TRANSACTIONAL_PIPELINE_ID },
  ];
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export async function queryScorecardCarrMetrics(startDate: string, endDate: string): Promise<ScorecardCarrMetrics> {
  const rows = await runBigQuerySqlRows(
    `
WITH waterfall AS (
  SELECT *
  FROM ${tableRef(TRANSFORMED_DATASET, "rpt_carr_waterfall_by_period_and_motion")}
  WHERE grain = 'day'
    AND period_end BETWEEN DATE(@start_date) AND DATE(@end_date)
    AND motion IN ('self_serve', 'sales_assist', 'sales_led')
), movements AS (
  SELECT
    COUNT(*) AS source_row_count,
    SUM(IF(period_end = DATE(@start_date) AND motion = 'self_serve', beginning_carr, 0)) AS selfserve_opening_arr,
    SUM(IF(motion = 'self_serve', expansion_carr, 0)) AS selfserve_expansion_arr,
    SUM(IF(motion = 'self_serve', contraction_carr, 0)) AS selfserve_contraction_arr,
    SUM(IF(motion = 'self_serve', churn_carr, 0)) AS selfserve_churn_arr,
    SUM(IF(motion = 'sales_led', churn_carr, 0)) AS sales_led_churn_arr,
    SUM(IF(period_end = DATE(@start_date), beginning_carr, 0)) AS total_opening_arr,
    SUM(expansion_carr) AS total_expansion_arr,
    SUM(contraction_carr) AS total_contraction_arr,
    SUM(churn_carr) AS total_churn_arr,
    SUM(IF(motion IN ('sales_assist', 'sales_led'), COALESCE(new_carr, 0) + COALESCE(reactivation_carr, 0) + COALESCE(expansion_carr, 0), 0)) AS sales_new_and_expansion_arr,
    SUM(IF(motion = 'sales_led', expansion_carr, 0)) AS sales_led_expansion_arr
  FROM waterfall
), logos AS (
  SELECT
    SUM(IF(motion = 'self_serve' AND bucket = 'churn', ABS(logo_count), 0)) AS selfserve_churn_logos,
    SUM(IF(motion = 'sales_led' AND bucket = 'churn', ABS(logo_count), 0)) AS sales_led_churn_logos
  FROM ${tableRef(TRANSFORMED_DATASET, "rpt_logo_movement_details_by_period_and_motion")}
  WHERE movement_scope = 'motion'
    AND grain = 'day'
    AND period_end BETWEEN DATE(@start_date) AND DATE(@end_date)
)
SELECT movements.*, logos.*
FROM movements CROSS JOIN logos
`, dateParams(startDate, endDate), { profile: PROFILE });
  const row = rows[0] || {};
  return {
    hasData: numberValue(row.source_row_count) > 0,
    selfserveOpeningArr: round2(numberValue(row.selfserve_opening_arr)),
    selfserveExpansionArr: round2(numberValue(row.selfserve_expansion_arr)),
    selfserveContractionArr: round2(numberValue(row.selfserve_contraction_arr)),
    selfserveChurnArr: round2(numberValue(row.selfserve_churn_arr)),
    salesLedChurnArr: round2(numberValue(row.sales_led_churn_arr)),
    totalOpeningArr: round2(numberValue(row.total_opening_arr)),
    totalExpansionArr: round2(numberValue(row.total_expansion_arr)),
    totalContractionArr: round2(numberValue(row.total_contraction_arr)),
    totalChurnArr: round2(numberValue(row.total_churn_arr)),
    salesNewAndExpansionArr: round2(numberValue(row.sales_new_and_expansion_arr)),
    salesLedExpansionArr: round2(numberValue(row.sales_led_expansion_arr)),
    selfserveChurnLogos: Math.round(numberValue(row.selfserve_churn_logos)),
    salesLedChurnLogos: Math.round(numberValue(row.sales_led_churn_logos)),
  };
}

export async function queryScorecardDealMetrics(startDate: string, endDate: string): Promise<ScorecardDealMetrics> {
  const rows = await runBigQuerySqlRows(
    `
WITH scoped AS (
  SELECT
    d.*,
    REGEXP_REPLACE(LOWER(COALESCE(d.dealtype, '')), r'[^a-z]', '') AS normalized_deal_type,
    DATE(d.deal_created_at) AS created_date,
    DATE(COALESCE(d.closed_won_date, d.close_date)) AS verdict_date,
    COALESCE(d.contracted_carr, d.arr, d.amount_in_home_currency, d.amount, 0) AS deal_arr
  FROM ${tableRef(TRANSFORMED_DATASET, "stg_hubspot_deals")} d
  WHERE COALESCE(d.is_archived, FALSE) = FALSE
)
SELECT
  COUNTIF(
    created_date BETWEEN DATE(@start_date) AND DATE(@end_date)
    AND pipeline_id IN (@sales_pipeline, @transaction_pipeline)
    AND normalized_deal_type = 'newbusiness'
  ) AS pipeline_created_deals,
  SUM(IF(
    created_date BETWEEN DATE(@start_date) AND DATE(@end_date)
    AND pipeline_id IN (@sales_pipeline, @transaction_pipeline)
    AND normalized_deal_type = 'newbusiness', deal_arr, 0
  )) AS pipeline_created_arr,
  COUNTIF(
    verdict_date BETWEEN DATE(@start_date) AND DATE(@end_date)
    AND pipeline_id = @sales_pipeline AND COALESCE(is_closed_won, FALSE)
  ) AS sales_led_closed_won,
  COUNTIF(
    verdict_date BETWEEN DATE(@start_date) AND DATE(@end_date)
    AND pipeline_id = @sales_pipeline AND COALESCE(is_closed_lost, FALSE)
  ) AS sales_led_closed_lost,
  COUNTIF(
    verdict_date BETWEEN DATE(@start_date) AND DATE(@end_date)
    AND pipeline_id IN (@sales_pipeline, @transaction_pipeline)
    AND normalized_deal_type = 'existingbusiness' AND COALESCE(is_closed_won, FALSE)
  ) AS renewal_closed_won,
  COUNTIF(
    verdict_date BETWEEN DATE(@start_date) AND DATE(@end_date)
    AND pipeline_id IN (@sales_pipeline, @transaction_pipeline)
    AND normalized_deal_type = 'existingbusiness' AND COALESCE(is_closed_lost, FALSE)
  ) AS renewal_closed_lost
FROM scoped
`, dateParams(startDate, endDate), { profile: PROFILE });
  const row = rows[0] || {};
  return {
    pipelineCreatedDeals: Math.round(numberValue(row.pipeline_created_deals)),
    pipelineCreatedArr: round2(numberValue(row.pipeline_created_arr)),
    salesLedClosedWon: Math.round(numberValue(row.sales_led_closed_won)),
    salesLedClosedLost: Math.round(numberValue(row.sales_led_closed_lost)),
    renewalClosedWon: Math.round(numberValue(row.renewal_closed_won)),
    renewalClosedLost: Math.round(numberValue(row.renewal_closed_lost)),
  };
}

export async function queryScorecardContactMetrics(startDate: string, endDate: string): Promise<ScorecardContactMetrics> {
  const rows = await runBigQuerySqlRows(
    `
WITH latest_contacts AS (
  SELECT
    id,
    properties_hs_v2_date_entered_marketingqualifiedlead AS entered_mql_at,
    properties_hs_v2_date_entered_salesqualifiedlead AS entered_sql_at
  FROM ${tableRef(HUBSPOT_DATASET, "contacts")}
  WHERE COALESCE(archived, FALSE) = FALSE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY _airbyte_extracted_at DESC, updatedAt DESC) = 1
)
SELECT
  COUNTIF(DATE(entered_mql_at) BETWEEN DATE(@start_date) AND DATE(@end_date)) AS mql_count,
  COUNTIF(DATE(entered_sql_at) BETWEEN DATE(@start_date) AND DATE(@end_date)) AS sql_count
FROM latest_contacts
`, dateParams(startDate, endDate), { profile: PROFILE });
  const row = rows[0] || {};
  return {
    mqlCount: Math.round(numberValue(row.mql_count)),
    sqlCount: Math.round(numberValue(row.sql_count)),
  };
}

export async function queryScorecardQuotaMetrics(endDate: string): Promise<ScorecardQuotaMetric[]> {
  const periods = SALES_QUOTA_CONFIGS.map((config) => salesQuotaPeriod(endDate, config.cadence));
  const earliestStart = periods.reduce((earliest, period) => period.periodStart < earliest ? period.periodStart : earliest, periods[0].periodStart);
  const rows = await runBigQuerySqlRows(
    `
SELECT
  REGEXP_EXTRACT(LOWER(COALESCE(o.owner_name, '')), r'^(luca|tyler|felipe|evan)(?:\\s|$)') AS owner_key,
  o.owner_name,
  DATE(COALESCE(d.closed_won_date, d.close_date)) AS closed_date,
  COALESCE(d.amount_in_home_currency, d.amount, d.arr, d.contracted_carr, 0) AS sold_amount
FROM ${tableRef(TRANSFORMED_DATASET, "stg_hubspot_deals")} d
JOIN ${tableRef(TRANSFORMED_DATASET, "stg_hubspot_owners")} o ON o.owner_id = d.owner_id
WHERE COALESCE(d.is_archived, FALSE) = FALSE
  AND COALESCE(d.is_closed_won, FALSE)
  AND d.pipeline_id IN (@sales_pipeline, @transaction_pipeline)
  AND REGEXP_REPLACE(LOWER(COALESCE(d.dealtype, '')), r'[^a-z]', '') IN ('newbusiness', 'existingbusiness')
  AND DATE(COALESCE(d.closed_won_date, d.close_date)) BETWEEN DATE(@start_date) AND DATE(@end_date)
  AND REGEXP_CONTAINS(LOWER(COALESCE(o.owner_name, '')), r'^(luca|tyler|felipe|evan)(?:\\s|$)')
`, dateParams(earliestStart, endDate), { profile: PROFILE });

  return SALES_QUOTA_CONFIGS.map((config) => {
    const period = salesQuotaPeriod(endDate, config.cadence);
    const matching = rows.filter((row) =>
      String(row.owner_key || "").toLowerCase() === config.ownerKey
      && String(row.closed_date || "") >= period.periodStart
      && String(row.closed_date || "") <= endDate,
    );
    const soldAmount = round2(matching.reduce((total, row) => total + numberValue(row.sold_amount), 0));
    return {
      ownerName: config.ownerName,
      cadence: config.cadence,
      soldAmount,
      quotaAmount: config.quotaAmount,
      attainmentPct: config.quotaAmount > 0 ? round2((soldAmount / config.quotaAmount) * 100) : 0,
      dealCount: matching.length,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    };
  });
}

export async function queryScorecardAccountManagerMetrics(startDate: string, endDate: string): Promise<ScorecardAccountManagerMetric[]> {
  const rows = await runBigQuerySqlRows(
    `
WITH portfolio_candidates AS (
  SELECT
    d.primary_company_id AS company_id,
    o.owner_name,
    LOWER(COALESCE(o.email, '')) AS owner_email,
    ROW_NUMBER() OVER (
      PARTITION BY d.primary_company_id
      ORDER BY COALESCE(d.owner_assigned_at, d.deal_created_at) DESC, d.deal_id DESC
    ) AS owner_rank
  FROM ${tableRef(TRANSFORMED_DATASET, "stg_hubspot_deals")} d
  JOIN ${tableRef(TRANSFORMED_DATASET, "stg_hubspot_owners")} o ON o.owner_id = d.owner_id
  WHERE COALESCE(d.is_archived, FALSE) = FALSE
    AND NULLIF(d.primary_company_id, '') IS NOT NULL
    AND REGEXP_REPLACE(LOWER(COALESCE(d.dealtype, '')), r'[^a-z]', '') = 'existingbusiness'
), portfolio AS (
  SELECT company_id, owner_name, owner_email
  FROM portfolio_candidates
  WHERE owner_rank = 1
    AND owner_email IN (
      'chloe.lague@botpress.com',
      'samuel.rees@botpress.com',
      'kieran.hamilton@botpress.com'
    )
), customer_snapshots AS (
  SELECT
    customer_key,
    hubspot_company_id,
    MAX(IF(period_end = DATE(@start_date), previous_customer_carr, NULL)) AS opening_arr,
    MAX(IF(period_end = DATE(@end_date), current_customer_carr, NULL)) AS ending_arr
  FROM ${tableRef(TRANSFORMED_DATASET, "rpt_logo_movement_details_by_period_and_motion")}
  WHERE movement_scope = 'motion'
    AND grain = 'day'
    AND period_end IN (DATE(@start_date), DATE(@end_date))
    AND NULLIF(hubspot_company_id, '') IS NOT NULL
  GROUP BY customer_key, hubspot_company_id
), company_snapshots AS (
  SELECT
    hubspot_company_id AS company_id,
    SUM(COALESCE(opening_arr, 0)) AS opening_arr,
    SUM(COALESCE(ending_arr, 0)) AS ending_arr
  FROM customer_snapshots
  GROUP BY hubspot_company_id
)
SELECT
  portfolio.owner_name,
  portfolio.owner_email,
  COUNTIF(COALESCE(company_snapshots.ending_arr, 0) > 0) AS account_count,
  SUM(IF(COALESCE(company_snapshots.ending_arr, 0) > 0, company_snapshots.ending_arr, 0)) AS ending_arr,
  SUM(IF(COALESCE(company_snapshots.opening_arr, 0) > 0, company_snapshots.opening_arr, 0)) AS opening_cohort_arr,
  SUM(IF(COALESCE(company_snapshots.opening_arr, 0) > 0, company_snapshots.ending_arr, 0)) AS ending_cohort_arr
FROM portfolio
LEFT JOIN company_snapshots USING (company_id)
GROUP BY portfolio.owner_name, portfolio.owner_email
ORDER BY portfolio.owner_name
`, dateParams(startDate, endDate), { profile: PROFILE });

  const labelsByEmail: Record<string, string> = {
    "chloe.lague@botpress.com": "Chloé Lagüe",
    "samuel.rees@botpress.com": "Sam Rees",
    "kieran.hamilton@botpress.com": "Kieran Hamilton",
  };
  const byEmail = new Map(rows.map((row) => [String(row.owner_email || "").toLowerCase(), row]));
  return Object.entries(labelsByEmail).map(([email, ownerName]) => {
    const row = byEmail.get(email) || {};
    const openingCohortArr = round2(numberValue(row.opening_cohort_arr));
    const endingCohortArr = round2(numberValue(row.ending_cohort_arr));
    return {
      ownerName,
      accountCount: Math.round(numberValue(row.account_count)),
      endingArr: round2(numberValue(row.ending_arr)),
      openingCohortArr,
      endingCohortArr,
      nrrPct: openingCohortArr > 0 ? round2((endingCohortArr / openingCohortArr) * 100) : null,
    };
  });
}
