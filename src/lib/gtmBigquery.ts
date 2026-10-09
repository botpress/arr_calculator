import { runBigQuerySqlRows, type BigQuerySqlParameter, type StripeBigQueryProfile } from "@/lib/stripeBigquery";
import { buildGtmLegacyArrCtes } from "@/lib/gtmLegacyArrSql";

const PROFILE: StripeBigQueryProfile = "stripe_arr_correct";
const BIGQUERY_PROJECT = String(process.env.GTM_BIGQUERY_PROJECT || "botpress-stripe-data-pipeline").trim() || "botpress-stripe-data-pipeline";
const TRANSFORMED_DATASET = String(process.env.GTM_BIGQUERY_TRANSFORMED_DATASET || "transformed_data").trim() || "transformed_data";
const HUBSPOT_DATASET = String(process.env.GTM_BIGQUERY_HUBSPOT_DATASET || "hubspot").trim() || "hubspot";
const SALES_DEFAULT_PIPELINE_ID = "0cbbc8c6-dccf-4601-8d59-b6a15ed5129b";
const TRANSACTIONAL_PIPELINE_ID = "730649262";

export type GtmBigQueryCrmSnapshot = {
  pipelineCreated: number | null;
  pipelineCreatedAllTypes: number | null;
  openPipeline: number | null;
  openPipelineDealCount: number | null;
  oppsCreated: number | null;
  oppsFromMqlProxy: number | null;
  oppsFromPqlProxy: number | null;
  mqls: number | null;
  sqls: number | null;
  overallSignups: number | null;
  csSignups: number | null;
  businessSignups: number | null;
  salesLedAcv: number | null;
  winRate: number | null;
  heldShowRate: number | null;
  meetingHygieneCount: number | null;
  newLogosSalesLed: number | null;
  newLogosSalesAssist: number | null;
};

export type GtmBigQueryCrmMetrics = {
  currentWeek: GtmBigQueryCrmSnapshot;
  priorWeek: GtmBigQueryCrmSnapshot;
  monthToDate: GtmBigQueryCrmSnapshot;
  latestHubspotExtractedAt: string | null;
  warnings: string[];
};

export type GtmBigQueryArrRow = {
  weekStartDate: string;
  weekEndDate: string;
  segment: "selfserve" | "sales_assist" | "salesled";
  beginningArr: number;
  newArr: number;
  expansionArr: number;
  contractionArr: number;
  churnArr: number;
  transferArr: number;
  endingArr: number;
};

function safeIdentifier(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid ${label} BigQuery identifier.`);
  return value;
}

function tableRef(dataset: string, table: string) {
  return `\`${safeIdentifier(BIGQUERY_PROJECT, "project")}.${safeIdentifier(dataset, "dataset")}.${safeIdentifier(table, "table")}\``;
}

function toNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringOrNull(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function emptySnapshot(): GtmBigQueryCrmSnapshot {
  return {
    pipelineCreated: null,
    pipelineCreatedAllTypes: null,
    openPipeline: null,
    openPipelineDealCount: null,
    oppsCreated: null,
    oppsFromMqlProxy: null,
    oppsFromPqlProxy: null,
    mqls: null,
    sqls: null,
    overallSignups: null,
    csSignups: null,
    businessSignups: null,
    salesLedAcv: null,
    winRate: null,
    heldShowRate: null,
    meetingHygieneCount: null,
    newLogosSalesLed: null,
    newLogosSalesAssist: null,
  };
}

function sharedDateParams(input: {
  weekStartDate: string;
  weekEndDate: string;
  priorWeekStartDate: string;
  priorWeekEndDate: string;
  monthStartDate: string;
  monthEndDate: string;
}): BigQuerySqlParameter[] {
  return [
    { name: "week_start", type: "STRING", value: input.weekStartDate },
    { name: "week_end", type: "STRING", value: input.weekEndDate },
    { name: "prior_week_start", type: "STRING", value: input.priorWeekStartDate },
    { name: "prior_week_end", type: "STRING", value: input.priorWeekEndDate },
    { name: "month_start", type: "STRING", value: input.monthStartDate },
    { name: "month_end", type: "STRING", value: input.monthEndDate },
    { name: "sales_pipeline", type: "STRING", value: SALES_DEFAULT_PIPELINE_ID },
    { name: "transaction_pipeline", type: "STRING", value: TRANSACTIONAL_PIPELINE_ID },
  ];
}

function newBusinessSql(alias = "d") {
  return `REGEXP_REPLACE(LOWER(COALESCE(${alias}.dealtype, '')), r'[^a-z]', '') = 'newbusiness'`;
}

function assignDealSnapshot(snapshot: GtmBigQueryCrmSnapshot, row: Record<string, unknown>, prefix: string) {
  snapshot.pipelineCreated = toNumber(row[`${prefix}_pipeline_created`]);
  snapshot.pipelineCreatedAllTypes = toNumber(row[`${prefix}_pipeline_created_all_types`]);
  snapshot.openPipeline = toNumber(row[`${prefix}_open_pipeline`]);
  snapshot.openPipelineDealCount = toNumber(row[`${prefix}_open_pipeline_deal_count`]);
  snapshot.oppsCreated = toNumber(row[`${prefix}_opps_created`]);
  snapshot.oppsFromMqlProxy = toNumber(row[`${prefix}_opps_from_mql_proxy`]);
  snapshot.oppsFromPqlProxy = toNumber(row[`${prefix}_opps_from_pql_proxy`]);
  snapshot.salesLedAcv = toNumber(row[`${prefix}_sales_led_acv`]);
  snapshot.winRate = toNumber(row[`${prefix}_win_rate`]);
  snapshot.newLogosSalesLed = toNumber(row[`${prefix}_new_logos_sales_led`]);
  snapshot.newLogosSalesAssist = toNumber(row[`${prefix}_new_logos_sales_assist`]);
}

function assignContactSnapshot(snapshot: GtmBigQueryCrmSnapshot, row: Record<string, unknown>, prefix: string) {
  snapshot.mqls = toNumber(row[`${prefix}_mqls`]);
  snapshot.sqls = toNumber(row[`${prefix}_sqls`]);
}

function assignSignupSnapshot(snapshot: GtmBigQueryCrmSnapshot, row: Record<string, unknown>, prefix: string) {
  snapshot.overallSignups = toNumber(row[`${prefix}_overall_signups`]);
  snapshot.csSignups = toNumber(row[`${prefix}_cs_signups`]);
  snapshot.businessSignups = toNumber(row[`${prefix}_business_signups`]);
}

export async function queryGtmCrmMetrics(input: {
  weekStartDate: string;
  weekEndDate: string;
  priorWeekStartDate: string;
  priorWeekEndDate: string;
  monthStartDate: string;
  monthEndDate: string;
}): Promise<GtmBigQueryCrmMetrics> {
  const warnings: string[] = [];
  const result: GtmBigQueryCrmMetrics = {
    currentWeek: emptySnapshot(),
    priorWeek: emptySnapshot(),
    monthToDate: emptySnapshot(),
    latestHubspotExtractedAt: null,
    warnings,
  };
  const params = sharedDateParams(input);

  const dealsPromise = runBigQuerySqlRows(
    `
WITH deals AS (
  SELECT * FROM ${tableRef(TRANSFORMED_DATASET, "stg_hubspot_deals")}
  WHERE COALESCE(is_archived, FALSE) = FALSE
), scoped AS (
  SELECT
    d.*,
    d.pipeline_id IN (@sales_pipeline, @transaction_pipeline) AS is_included_pipeline,
    ${newBusinessSql("d")} AS is_new_business,
    DATE(d.deal_created_at) AS created_date,
    DATE(COALESCE(d.closed_won_date, d.close_date)) AS verdict_date,
    DATE(d.close_date) AS expected_close_date,
    COALESCE(d.amount_in_home_currency, d.amount, d.arr, d.contracted_carr, 0) AS deal_value
  FROM deals d
), flags AS (
  SELECT
    *,
    created_date BETWEEN DATE(@week_start) AND DATE(@week_end) AS created_current_week,
    created_date BETWEEN DATE(@prior_week_start) AND DATE(@prior_week_end) AS created_prior_week,
    created_date BETWEEN DATE(@month_start) AND DATE(@week_end) AS created_mtd,
    verdict_date BETWEEN DATE(@week_start) AND DATE(@week_end) AS verdict_current_week,
    verdict_date BETWEEN DATE(@prior_week_start) AND DATE(@prior_week_end) AS verdict_prior_week,
    verdict_date BETWEEN DATE(@month_start) AND DATE(@week_end) AS verdict_mtd,
    created_date <= DATE(@week_end) AND (NOT COALESCE(is_closed, FALSE) OR verdict_date > DATE(@week_end)) AS open_at_current_week_end,
    created_date <= DATE(@prior_week_end) AND (NOT COALESCE(is_closed, FALSE) OR verdict_date > DATE(@prior_week_end)) AS open_at_prior_week_end
  FROM scoped
)
SELECT
  SUM(IF(created_current_week AND is_included_pipeline AND is_new_business, deal_value, 0)) AS current_pipeline_created,
  SUM(IF(created_current_week AND is_included_pipeline, deal_value, 0)) AS current_pipeline_created_all_types,
  SUM(IF(open_at_current_week_end AND expected_close_date BETWEEN DATE(@month_start) AND DATE(@month_end) AND is_included_pipeline AND is_new_business, deal_value, 0)) AS current_open_pipeline,
  COUNTIF(open_at_current_week_end AND expected_close_date BETWEEN DATE(@month_start) AND DATE(@month_end) AND is_included_pipeline AND is_new_business) AS current_open_pipeline_deal_count,
  COUNTIF(created_current_week AND is_included_pipeline AND is_new_business) AS current_opps_created,
  COUNTIF(created_current_week AND pipeline_id = @sales_pipeline AND is_new_business) AS current_opps_from_mql_proxy,
  COUNTIF(created_current_week AND pipeline_id = @transaction_pipeline AND is_new_business) AS current_opps_from_pql_proxy,
  AVG(IF(verdict_date BETWEEN DATE_SUB(DATE(@week_end), INTERVAL 89 DAY) AND DATE(@week_end) AND pipeline_id = @sales_pipeline AND is_new_business AND COALESCE(is_closed_won, FALSE), deal_value, NULL)) AS current_sales_led_acv,
  SAFE_DIVIDE(COUNTIF(verdict_current_week AND is_included_pipeline AND COALESCE(is_closed_won, FALSE)), COUNTIF(verdict_current_week AND is_included_pipeline AND (COALESCE(is_closed_won, FALSE) OR COALESCE(is_closed_lost, FALSE)))) AS current_win_rate,
  COUNT(DISTINCT IF(verdict_current_week AND pipeline_id = @sales_pipeline AND is_new_business AND COALESCE(is_closed_won, FALSE), COALESCE(primary_company_id, deal_id), NULL)) AS current_new_logos_sales_led,
  COUNT(DISTINCT IF(verdict_current_week AND pipeline_id = @transaction_pipeline AND is_new_business AND COALESCE(is_closed_won, FALSE), COALESCE(primary_company_id, deal_id), NULL)) AS current_new_logos_sales_assist,

  SUM(IF(created_prior_week AND is_included_pipeline AND is_new_business, deal_value, 0)) AS prior_pipeline_created,
  SUM(IF(created_prior_week AND is_included_pipeline, deal_value, 0)) AS prior_pipeline_created_all_types,
  SUM(IF(open_at_prior_week_end AND expected_close_date BETWEEN DATE(@month_start) AND DATE(@month_end) AND is_included_pipeline AND is_new_business, deal_value, 0)) AS prior_open_pipeline,
  COUNTIF(open_at_prior_week_end AND expected_close_date BETWEEN DATE(@month_start) AND DATE(@month_end) AND is_included_pipeline AND is_new_business) AS prior_open_pipeline_deal_count,
  COUNTIF(created_prior_week AND is_included_pipeline AND is_new_business) AS prior_opps_created,
  COUNTIF(created_prior_week AND pipeline_id = @sales_pipeline AND is_new_business) AS prior_opps_from_mql_proxy,
  COUNTIF(created_prior_week AND pipeline_id = @transaction_pipeline AND is_new_business) AS prior_opps_from_pql_proxy,
  AVG(IF(verdict_date BETWEEN DATE_SUB(DATE(@prior_week_end), INTERVAL 89 DAY) AND DATE(@prior_week_end) AND pipeline_id = @sales_pipeline AND is_new_business AND COALESCE(is_closed_won, FALSE), deal_value, NULL)) AS prior_sales_led_acv,
  SAFE_DIVIDE(COUNTIF(verdict_prior_week AND is_included_pipeline AND COALESCE(is_closed_won, FALSE)), COUNTIF(verdict_prior_week AND is_included_pipeline AND (COALESCE(is_closed_won, FALSE) OR COALESCE(is_closed_lost, FALSE)))) AS prior_win_rate,
  COUNT(DISTINCT IF(verdict_prior_week AND pipeline_id = @sales_pipeline AND is_new_business AND COALESCE(is_closed_won, FALSE), COALESCE(primary_company_id, deal_id), NULL)) AS prior_new_logos_sales_led,
  COUNT(DISTINCT IF(verdict_prior_week AND pipeline_id = @transaction_pipeline AND is_new_business AND COALESCE(is_closed_won, FALSE), COALESCE(primary_company_id, deal_id), NULL)) AS prior_new_logos_sales_assist,

  SUM(IF(created_mtd AND is_included_pipeline AND is_new_business, deal_value, 0)) AS mtd_pipeline_created,
  SUM(IF(created_mtd AND is_included_pipeline, deal_value, 0)) AS mtd_pipeline_created_all_types,
  SUM(IF(open_at_current_week_end AND expected_close_date BETWEEN DATE(@month_start) AND DATE(@month_end) AND is_included_pipeline AND is_new_business, deal_value, 0)) AS mtd_open_pipeline,
  COUNTIF(open_at_current_week_end AND expected_close_date BETWEEN DATE(@month_start) AND DATE(@month_end) AND is_included_pipeline AND is_new_business) AS mtd_open_pipeline_deal_count,
  COUNTIF(created_mtd AND is_included_pipeline AND is_new_business) AS mtd_opps_created,
  COUNTIF(created_mtd AND pipeline_id = @sales_pipeline AND is_new_business) AS mtd_opps_from_mql_proxy,
  COUNTIF(created_mtd AND pipeline_id = @transaction_pipeline AND is_new_business) AS mtd_opps_from_pql_proxy,
  AVG(IF(verdict_date BETWEEN DATE_SUB(DATE(@week_end), INTERVAL 89 DAY) AND DATE(@week_end) AND pipeline_id = @sales_pipeline AND is_new_business AND COALESCE(is_closed_won, FALSE), deal_value, NULL)) AS mtd_sales_led_acv,
  SAFE_DIVIDE(COUNTIF(verdict_mtd AND is_included_pipeline AND COALESCE(is_closed_won, FALSE)), COUNTIF(verdict_mtd AND is_included_pipeline AND (COALESCE(is_closed_won, FALSE) OR COALESCE(is_closed_lost, FALSE)))) AS mtd_win_rate,
  COUNT(DISTINCT IF(verdict_mtd AND pipeline_id = @sales_pipeline AND is_new_business AND COALESCE(is_closed_won, FALSE), COALESCE(primary_company_id, deal_id), NULL)) AS mtd_new_logos_sales_led,
  COUNT(DISTINCT IF(verdict_mtd AND pipeline_id = @transaction_pipeline AND is_new_business AND COALESCE(is_closed_won, FALSE), COALESCE(primary_company_id, deal_id), NULL)) AS mtd_new_logos_sales_assist,
  MAX(source_extracted_at) AS latest_hubspot_extracted_at
FROM flags
`, params, { profile: PROFILE },
  ).then((rows) => {
    const row = rows[0] || {};
    assignDealSnapshot(result.currentWeek, row, "current");
    assignDealSnapshot(result.priorWeek, row, "prior");
    assignDealSnapshot(result.monthToDate, row, "mtd");
    result.latestHubspotExtractedAt = toStringOrNull(row.latest_hubspot_extracted_at);
  }).catch((error: unknown) => {
    warnings.push(`BigQuery deal metrics unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });

  const contactsPromise = runBigQuerySqlRows(
    `
WITH latest_contacts AS (
  SELECT id,
    properties_hs_v2_date_entered_marketingqualifiedlead AS entered_mql_at,
    properties_hs_v2_date_entered_salesqualifiedlead AS entered_sql_at,
    _airbyte_extracted_at AS source_extracted_at
  FROM ${tableRef(HUBSPOT_DATASET, "contacts")}
  WHERE COALESCE(archived, FALSE) = FALSE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY _airbyte_extracted_at DESC, updatedAt DESC) = 1
)
SELECT
  COUNTIF(DATE(entered_mql_at) BETWEEN DATE(@week_start) AND DATE(@week_end)) AS current_mqls,
  COUNTIF(DATE(entered_sql_at) BETWEEN DATE(@week_start) AND DATE(@week_end)) AS current_sqls,
  COUNTIF(DATE(entered_mql_at) BETWEEN DATE(@prior_week_start) AND DATE(@prior_week_end)) AS prior_mqls,
  COUNTIF(DATE(entered_sql_at) BETWEEN DATE(@prior_week_start) AND DATE(@prior_week_end)) AS prior_sqls,
  COUNTIF(DATE(entered_mql_at) BETWEEN DATE(@month_start) AND DATE(@week_end)) AS mtd_mqls,
  COUNTIF(DATE(entered_sql_at) BETWEEN DATE(@month_start) AND DATE(@week_end)) AS mtd_sqls,
  MAX(source_extracted_at) AS latest_hubspot_extracted_at
FROM latest_contacts
`, params, { profile: PROFILE },
  ).then((rows) => {
    const row = rows[0] || {};
    assignContactSnapshot(result.currentWeek, row, "current");
    assignContactSnapshot(result.priorWeek, row, "prior");
    assignContactSnapshot(result.monthToDate, row, "mtd");
    const contactFreshness = toStringOrNull(row.latest_hubspot_extracted_at);
    if (!result.latestHubspotExtractedAt || (contactFreshness && contactFreshness > result.latestHubspotExtractedAt)) result.latestHubspotExtractedAt = contactFreshness;
  }).catch((error: unknown) => {
    warnings.push(`BigQuery contact-funnel metrics unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });

  const signupPromise = runBigQuerySqlRows(
    `
WITH overall AS (
  SELECT
    SUM(IF(period_start BETWEEN DATE(@week_start) AND DATE(@week_end), stage_count, 0)) AS current_overall_signups,
    SUM(IF(period_start BETWEEN DATE(@prior_week_start) AND DATE(@prior_week_end), stage_count, 0)) AS prior_overall_signups,
    SUM(IF(period_start BETWEEN DATE(@month_start) AND DATE(@week_end), stage_count, 0)) AS mtd_overall_signups
  FROM ${tableRef(TRANSFORMED_DATASET, "rpt_marketing_overall_funnel_by_period")}
  WHERE stage_key = 'total_signups' AND period_start BETWEEN LEAST(DATE(@month_start), DATE(@prior_week_start)) AND DATE(@week_end)
), cs AS (
  SELECT
    SUM(IF(period_start BETWEEN DATE(@week_start) AND DATE(@week_end), cs_stage_count, 0)) AS current_cs_signups,
    SUM(IF(period_start BETWEEN DATE(@prior_week_start) AND DATE(@prior_week_end), cs_stage_count, 0)) AS prior_cs_signups,
    SUM(IF(period_start BETWEEN DATE(@month_start) AND DATE(@week_end), cs_stage_count, 0)) AS mtd_cs_signups
  FROM ${tableRef(TRANSFORMED_DATASET, "rpt_marketing_cs_vertical_by_period")}
  WHERE stage_key = 'total_signups' AND period_start BETWEEN LEAST(DATE(@month_start), DATE(@prior_week_start)) AND DATE(@week_end)
)
SELECT
  overall.current_overall_signups, cs.current_cs_signups,
  GREATEST(COALESCE(overall.current_overall_signups, 0) - COALESCE(cs.current_cs_signups, 0), 0) AS current_business_signups,
  overall.prior_overall_signups, cs.prior_cs_signups,
  GREATEST(COALESCE(overall.prior_overall_signups, 0) - COALESCE(cs.prior_cs_signups, 0), 0) AS prior_business_signups,
  overall.mtd_overall_signups, cs.mtd_cs_signups,
  GREATEST(COALESCE(overall.mtd_overall_signups, 0) - COALESCE(cs.mtd_cs_signups, 0), 0) AS mtd_business_signups
FROM overall CROSS JOIN cs
`, params, { profile: PROFILE },
  ).then((rows) => {
    const row = rows[0] || {};
    assignSignupSnapshot(result.currentWeek, row, "current");
    assignSignupSnapshot(result.priorWeek, row, "prior");
    assignSignupSnapshot(result.monthToDate, row, "mtd");
  }).catch((error: unknown) => {
    warnings.push(`BigQuery signup metrics unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });

  await Promise.all([dealsPromise, contactsPromise, signupPromise]);
  warnings.push("Held/show rate is unavailable because HubSpot meeting engagements are not replicated into BigQuery.");
  warnings.push("Historical open pipeline is reconstructed from deal created and close dates in the latest HubSpot replica; later close-date edits can change a prior-week snapshot.");
  return result;
}

export async function queryGtmArrRows(input: { startWeekEndDate: string; endWeekEndDate: string }): Promise<GtmBigQueryArrRow[]> {
  const waterfallTable = tableRef(TRANSFORMED_DATASET, "rpt_carr_waterfall_by_period_and_motion");
  const legacyCtes = buildGtmLegacyArrCtes({
    tables: {
      deals: tableRef(TRANSFORMED_DATASET, "stg_hubspot_deals"),
      dealLineItems: tableRef(TRANSFORMED_DATASET, "stg_hubspot_deal_line_items"),
      lineItems: tableRef(TRANSFORMED_DATASET, "stg_hubspot_line_items"),
      fxRates: tableRef(TRANSFORMED_DATASET, "int_fx_monthly_rates"),
      companies: tableRef(TRANSFORMED_DATASET, "stg_hubspot_companies"),
    },
    requestedPeriodsSql: `
  SELECT DISTINCT period_start, period_end
  FROM ${waterfallTable}
  WHERE grain = 'week'
    AND period_end BETWEEN DATE(@start_week_end) AND DATE(@end_week_end)
`,
  });
  const rows = await runBigQuerySqlRows(
    `
WITH existing_arr AS (
SELECT
  period_start, period_end, motion,
  beginning_carr AS beginning_arr,
  COALESCE(new_carr, 0) + COALESCE(reactivation_carr, 0) AS new_arr,
  expansion_carr AS expansion_arr,
  contraction_carr AS contraction_arr,
  churn_carr AS churn_arr,
  COALESCE(transfer_in_carr, 0) + COALESCE(transfer_out_carr, 0) AS transfer_arr,
  ending_carr AS ending_arr
FROM ${waterfallTable}
WHERE grain = 'week'
  AND period_end BETWEEN DATE(@start_week_end) AND DATE(@end_week_end)
  AND motion IN ('self_serve', 'sales_assist', 'sales_led')
),
${legacyCtes},
combined_arr AS (
  SELECT * FROM existing_arr
  UNION ALL
  SELECT * FROM legacy_arr_waterfall
)
SELECT
  period_start,
  period_end,
  motion,
  ROUND(SUM(beginning_arr), 2) AS beginning_arr,
  ROUND(SUM(new_arr), 2) AS new_arr,
  ROUND(SUM(expansion_arr), 2) AS expansion_arr,
  ROUND(SUM(contraction_arr), 2) AS contraction_arr,
  ROUND(SUM(churn_arr), 2) AS churn_arr,
  ROUND(SUM(transfer_arr), 2) AS transfer_arr,
  ROUND(SUM(ending_arr), 2) AS ending_arr
FROM combined_arr
GROUP BY period_start, period_end, motion
ORDER BY period_end, motion
`,
    [
      { name: "start_week_end", type: "STRING", value: input.startWeekEndDate },
      { name: "end_week_end", type: "STRING", value: input.endWeekEndDate },
      { name: "target_currency", type: "STRING", value: String(process.env.FX_TARGET_CURRENCY || "USD").trim().toUpperCase() || "USD" },
    ],
    { profile: PROFILE },
  );

  return rows.flatMap((row) => {
    const rawMotion = String(row.motion || "");
    const segment = rawMotion === "self_serve" ? "selfserve" : rawMotion === "sales_assist" ? "sales_assist" : rawMotion === "sales_led" ? "salesled" : null;
    if (!segment) return [];
    return [{
      weekStartDate: String(row.period_start || ""),
      weekEndDate: String(row.period_end || ""),
      segment,
      beginningArr: toNumber(row.beginning_arr) || 0,
      newArr: toNumber(row.new_arr) || 0,
      expansionArr: toNumber(row.expansion_arr) || 0,
      contractionArr: toNumber(row.contraction_arr) || 0,
      churnArr: toNumber(row.churn_arr) || 0,
      transferArr: toNumber(row.transfer_arr) || 0,
      endingArr: toNumber(row.ending_arr) || 0,
    } satisfies GtmBigQueryArrRow];
  });
}
