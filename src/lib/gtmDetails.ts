import { runBigQuerySqlRows, type BigQuerySqlParameter, type StripeBigQueryProfile } from "@/lib/stripeBigquery";
import { buildGtmLegacyArrCtes } from "@/lib/gtmLegacyArrSql";
import { normalizeGtmWeekEndDate } from "@/lib/gtmReport";

const PROFILE: StripeBigQueryProfile = "stripe_arr_correct";
const BIGQUERY_PROJECT = String(process.env.GTM_BIGQUERY_PROJECT || "botpress-stripe-data-pipeline").trim() || "botpress-stripe-data-pipeline";
const TRANSFORMED_DATASET = String(process.env.GTM_BIGQUERY_TRANSFORMED_DATASET || "transformed_data").trim() || "transformed_data";
const HUBSPOT_DATASET = String(process.env.GTM_BIGQUERY_HUBSPOT_DATASET || "hubspot").trim() || "hubspot";
const HUBSPOT_PORTAL_ID = String(process.env.HUBSPOT_PORTAL_ID || "20692578").trim() || "20692578";
const SALES_DEFAULT_PIPELINE_ID = "0cbbc8c6-dccf-4601-8d59-b6a15ed5129b";
const TRANSACTIONAL_PIPELINE_ID = "730649262";

export type GtmDetailPeriod = "week" | "priorWeek" | "mtd";
export type GtmBridgeSegment = "selfserve" | "sales_assist" | "salesled" | "total";
export type GtmBridgeField = "beginningArr" | "newArr" | "expansionArr" | "contractionArr" | "churnArr" | "transferArr" | "endingArr" | "netNewArr";
export type GtmDetailColumnFormat = "text" | "date" | "currency" | "count" | "percent";

export type GtmDetailColumn = {
  key: string;
  label: string;
  format?: GtmDetailColumnFormat;
  linkKey?: string;
};

export type GtmDetailRow = Record<string, string | number | null>;

export type GtmDetailResponse = {
  title: string;
  periodLabel: string;
  source: string;
  aggregation: "sum" | "count" | "average" | "ratio" | "snapshot";
  detailValue: number | null;
  columns: GtmDetailColumn[];
  rows: GtmDetailRow[];
  summary?: Array<{ label: string; value: string }>;
  note?: string;
};

export type GtmDetailRequest =
  | { kind: "metric"; weekEndDate?: string; metricId: string; period: GtmDetailPeriod }
  | { kind: "bridge"; weekEndDate?: string; segment: GtmBridgeSegment; field: GtmBridgeField; period?: "week" | "mtd" };

type DateRange = {
  startDate: string;
  endDate: string;
  asOfDate: string;
  monthStartDate: string;
  monthEndDate: string;
  label: string;
};

function safeIdentifier(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid ${label} BigQuery identifier.`);
  return value;
}

function tableRef(dataset: string, table: string) {
  return `\`${safeIdentifier(BIGQUERY_PROJECT, "project")}.${safeIdentifier(dataset, "dataset")}.${safeIdentifier(table, "table")}\``;
}

function parseIsoDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid weekEndDate. Expected YYYY-MM-DD.");
  }
  return parsed;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function endOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0));
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(parseIsoDate(value));
}

function resolveRange(requestedWeekEnd: string | undefined, period: GtmDetailPeriod): DateRange {
  const weekEndDate = normalizeGtmWeekEndDate(requestedWeekEnd);
  const weekEnd = parseIsoDate(weekEndDate);
  const monthStartDate = `${weekEndDate.slice(0, 7)}-01`;
  const monthEndDate = isoDate(endOfMonth(weekEnd));
  if (period === "priorWeek") {
    const endDate = isoDate(addDays(weekEnd, -7));
    const startDate = isoDate(addDays(weekEnd, -13));
    return { startDate, endDate, asOfDate: endDate, monthStartDate, monthEndDate, label: `${displayDate(startDate)}–${displayDate(endDate)}` };
  }
  if (period === "mtd") {
    return { startDate: monthStartDate, endDate: weekEndDate, asOfDate: weekEndDate, monthStartDate, monthEndDate, label: `${displayDate(monthStartDate)}–${displayDate(weekEndDate)}` };
  }
  const startDate = isoDate(addDays(weekEnd, -6));
  return { startDate, endDate: weekEndDate, asOfDate: weekEndDate, monthStartDate, monthEndDate, label: `${displayDate(startDate)}–${displayDate(weekEndDate)}` };
}

function valueString(value: unknown) {
  return String(value ?? "").trim();
}

function valueNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueBoolean(value: unknown) {
  return value === true || valueString(value).toLowerCase() === "true";
}

function optionalString(value: unknown) {
  return valueString(value) || null;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sumRows(rows: GtmDetailRow[], key: string) {
  return round2(rows.reduce((total, row) => total + Number(row[key] || 0), 0));
}

function hubspotDealUrl(dealId: string) {
  return dealId ? `https://app.hubspot.com/contacts/${encodeURIComponent(HUBSPOT_PORTAL_ID)}/record/0-3/${encodeURIComponent(dealId)}` : null;
}

function hubspotContactUrl(contactId: string) {
  return contactId ? `https://app.hubspot.com/contacts/${encodeURIComponent(HUBSPOT_PORTAL_ID)}/record/0-1/${encodeURIComponent(contactId)}` : null;
}

function motionLabel(value: unknown) {
  const motion = valueString(value);
  if (motion === "self_serve") return "Self-serve";
  if (motion === "sales_assist") return "Sales Assist";
  if (motion === "sales_led") return "Sales-led";
  return motion || "Unknown";
}

function bridgeSegmentLabel(segment: GtmBridgeSegment) {
  if (segment === "selfserve") return "Self-serve";
  if (segment === "sales_assist") return "Sales Assist";
  if (segment === "salesled") return "Sales-led";
  return "Total";
}

function bridgeFieldLabel(field: GtmBridgeField) {
  return ({
    beginningArr: "Beginning ARR",
    newArr: "New ARR",
    expansionArr: "Expansion ARR",
    contractionArr: "Contraction ARR",
    churnArr: "Churn ARR",
    transferArr: "Transfer ARR",
    endingArr: "Ending ARR",
    netNewArr: "Net New ARR",
  } satisfies Record<GtmBridgeField, string>)[field];
}

function motionPredicate(segment: GtmBridgeSegment | "sales") {
  if (segment === "selfserve") return "m.motion = 'self_serve'";
  if (segment === "sales_assist") return "m.motion = 'sales_assist'";
  if (segment === "salesled") return "m.motion = 'sales_led'";
  if (segment === "sales") return "m.motion IN ('sales_assist', 'sales_led')";
  return "m.motion IN ('self_serve', 'sales_assist', 'sales_led')";
}

function commonParams(range: DateRange): BigQuerySqlParameter[] {
  return [
    { name: "start_date", type: "STRING", value: range.startDate },
    { name: "end_date", type: "STRING", value: range.endDate },
    { name: "as_of_date", type: "STRING", value: range.asOfDate },
    { name: "month_start", type: "STRING", value: range.monthStartDate },
    { name: "month_end", type: "STRING", value: range.monthEndDate },
    { name: "sales_pipeline", type: "STRING", value: SALES_DEFAULT_PIPELINE_ID },
    { name: "transaction_pipeline", type: "STRING", value: TRANSACTIONAL_PIPELINE_ID },
  ];
}

async function queryArrMovementDetails(input: {
  range: DateRange;
  segment: GtmBridgeSegment | "sales";
  field: GtmBridgeField | "churnAndContraction";
  title: string;
}): Promise<GtmDetailResponse> {
  const movementDetailsTable = tableRef(TRANSFORMED_DATASET, "rpt_logo_movement_details_by_period_and_motion");
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
  FROM ${movementDetailsTable}
  WHERE movement_scope = 'motion'
    AND grain = 'week'
    AND period_end BETWEEN DATE(@start_date) AND DATE(@end_date)
`,
  });
  const stockField = input.field === "beginningArr" || input.field === "endingArr";
  const stockBoundary = input.field === "beginningArr" ? "MIN" : "MAX";
  const stockValue = input.field === "beginningArr" ? "m.previous_segment_carr" : "m.current_segment_carr";
  const contributionExpression = stockField ? stockValue
    : input.field === "newArr" ? "m.new_contribution"
      : input.field === "expansionArr" ? "m.expansion_contribution"
        : input.field === "contractionArr" ? "m.contraction_contribution"
          : input.field === "churnArr" ? "m.churn_contribution"
            : input.field === "transferArr" ? "m.transfer_contribution"
              : input.field === "churnAndContraction" ? "m.churn_contribution + m.contraction_contribution"
                : "m.segment_delta";
  const detailBucketExpression = stockField ? "'snapshot'"
    : input.field === "newArr" ? "m.bucket"
      : input.field === "churnAndContraction" ? "IF(ABS(m.churn_contribution) > 0.000001, 'churn', 'contraction')"
        : input.field === "netNewArr" ? "m.bucket"
          : `'${input.field.replace("Arr", "").toLowerCase()}'`;
  const periodFilter = stockField
    ? "m.period_end = boundary.boundary_end"
    : "m.period_end BETWEEN DATE(@start_date) AND DATE(@end_date)";

  const rows = await runBigQuerySqlRows(
    `
WITH boundary AS (
  SELECT ${stockBoundary}(period_end) AS boundary_end
  FROM ${movementDetailsTable}
  WHERE movement_scope = 'motion'
    AND grain = 'week'
    AND period_end BETWEEN DATE(@start_date) AND DATE(@end_date)
),
${legacyCtes},
base_movements AS (
  SELECT
    m.period_start,
    m.period_end,
    m.customer_key,
    m.customer_label,
    m.company_name,
    m.hubspot_company_id,
    m.company_workspace_id,
    m.hubspot_company_url,
    m.motion,
    m.bucket,
    m.previous_customer_carr,
    m.current_customer_carr,
    m.previous_segment_carr,
    m.current_segment_carr,
    m.previous_motion_plans,
    m.current_motion_plans,
    FALSE AS is_legacy
  FROM ${movementDetailsTable} m
  WHERE m.movement_scope = 'motion'
    AND m.grain = 'week'
    AND m.period_end BETWEEN DATE(@start_date) AND DATE(@end_date)

  UNION ALL

  SELECT
    m.period_start,
    m.period_end,
    m.customer_key,
    m.customer_label,
    m.company_name,
    m.hubspot_company_id,
    m.company_workspace_id,
    IF(
      NULLIF(m.hubspot_company_id, '') IS NULL,
      NULL,
      CONCAT('https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-2/', m.hubspot_company_id)
    ) AS hubspot_company_url,
    m.motion,
    m.bucket,
    m.previous_customer_carr,
    m.current_customer_carr,
    m.previous_segment_carr,
    m.current_segment_carr,
    m.previous_motion_plans,
    m.current_motion_plans,
    m.is_legacy
  FROM legacy_movements m
), raw_movements AS (
  SELECT
    m.*,
    m.current_customer_carr - m.previous_customer_carr AS customer_delta,
    m.current_segment_carr - m.previous_segment_carr AS segment_delta
  FROM base_movements m
), classified AS (
  SELECT
    m.*,
    IF(m.bucket IN ('new', 'reactivation'), m.segment_delta, 0) AS new_contribution,
    IF(m.bucket NOT IN ('new', 'reactivation', 'churn') AND m.segment_delta > 0 AND m.customer_delta > 0, LEAST(m.segment_delta, m.customer_delta), 0) AS expansion_contribution,
    IF(m.bucket != 'churn' AND m.segment_delta < 0 AND m.customer_delta < 0, GREATEST(m.segment_delta, m.customer_delta), 0) AS contraction_contribution,
    IF(m.bucket = 'churn', m.segment_delta, 0) AS churn_contribution
  FROM raw_movements m
), allocated AS (
  SELECT
    m.*,
    m.segment_delta - m.new_contribution - m.expansion_contribution - m.contraction_contribution - m.churn_contribution AS transfer_contribution
  FROM classified m
), filtered AS (
  SELECT
    m.*,
    ${contributionExpression} AS contribution,
    ${detailBucketExpression} AS detail_bucket
  FROM allocated m
  ${stockField ? "CROSS JOIN boundary" : ""}
  WHERE ${periodFilter}
    AND ${motionPredicate(input.segment)}
    AND ABS(${contributionExpression}) > 0.000001
), deal_candidates AS (
  SELECT
    f.period_end,
    f.customer_key,
    f.motion,
    d.deal_id,
    d.deal_name,
    d.is_closed_won,
    d.dealtype,
    DATE(COALESCE(d.closed_won_date, d.close_date)) AS deal_date,
    COALESCE(d.contracted_carr, d.arr, d.amount_in_home_currency, d.amount) AS deal_arr,
    ROW_NUMBER() OVER (
      PARTITION BY f.period_end, f.customer_key, f.motion
      ORDER BY
        CASE WHEN COALESCE(d.is_closed_won, FALSE) AND DATE(COALESCE(d.closed_won_date, d.close_date)) BETWEEN f.period_start AND f.period_end THEN 0 ELSE 1 END,
        CASE WHEN ABS(COALESCE(d.contracted_carr, d.arr, d.amount_in_home_currency, d.amount, 0) - f.current_segment_carr) < 0.01 THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(d.is_closed_won, FALSE) THEN 0 ELSE 1 END,
        ABS(DATE_DIFF(COALESCE(DATE(d.closed_won_date), DATE(d.close_date), DATE(d.deal_created_at), f.period_end), f.period_end, DAY)),
        d.deal_id
    ) AS match_rank
  FROM filtered f
  LEFT JOIN ${tableRef(TRANSFORMED_DATASET, "stg_hubspot_deals")} d
    ON ${stockField ? "FALSE" : "COALESCE(d.is_archived, FALSE) = FALSE"}
   AND (NOT f.is_legacy OR LOWER(TRIM(COALESCE(d.deployment_type, ''))) <> 'cloud')
   AND (
     (NULLIF(f.hubspot_company_id, '') IS NOT NULL AND d.primary_company_id = f.hubspot_company_id)
     OR (NULLIF(d.deal_workspace_id, '') IS NOT NULL AND STRPOS(COALESCE(f.company_workspace_id, ''), d.deal_workspace_id) > 0)
   )
)
SELECT
  f.period_start,
  f.period_end,
  f.customer_key,
  f.customer_label,
  f.company_name,
  f.hubspot_company_id,
  f.company_workspace_id,
  f.hubspot_company_url,
  f.motion,
  f.bucket,
  f.detail_bucket,
  f.previous_segment_carr,
  f.current_segment_carr,
  f.previous_motion_plans,
  f.current_motion_plans,
  f.contribution,
  f.is_legacy,
  dc.deal_id,
  dc.deal_name,
  dc.deal_date,
  dc.deal_arr,
  dc.is_closed_won AS deal_is_closed_won,
  dc.dealtype
FROM filtered f
LEFT JOIN deal_candidates dc
  ON dc.period_end = f.period_end
 AND dc.customer_key = f.customer_key
 AND dc.motion = f.motion
 AND dc.match_rank = 1
ORDER BY ABS(f.contribution) DESC, f.customer_label, f.period_end
`, [
      ...commonParams(input.range),
      { name: "target_currency", type: "STRING", value: String(process.env.FX_TARGET_CURRENCY || "USD").trim().toUpperCase() || "USD" },
    ], { profile: PROFILE },
  );

  const details: GtmDetailRow[] = rows.map((row) => {
    const dealId = valueString(row.deal_id);
    const closedWon = valueBoolean(row.deal_is_closed_won);
    const movementEnd = valueString(row.period_end);
    const dealDate = valueString(row.deal_date);
    const currentArr = valueNumber(row.current_segment_carr);
    const dealArr = valueNumber(row.deal_arr);
    const isLegacy = valueBoolean(row.is_legacy);
    let matchBasis: string | null = null;
    if (dealId) {
      if (closedWon && dealDate && movementEnd && dealDate >= valueString(row.period_start) && dealDate <= movementEnd) matchBasis = "Closed won in movement week";
      else if (currentArr != null && dealArr != null && Math.abs(currentArr - dealArr) < 0.01) matchBasis = "Deal ARR matches resulting ARR";
      else matchBasis = closedWon
        ? isLegacy ? "Most relevant non-cloud closed-won company deal" : "Most relevant closed-won company deal"
        : "Related company deal";
    }
    return {
      customer: optionalString(row.customer_label) || optionalString(row.company_name) || valueString(row.customer_key),
      customerId: optionalString(row.customer_key),
      workspaceId: optionalString(row.company_workspace_id),
      companyId: optionalString(row.hubspot_company_id),
      companyUrl: optionalString(row.hubspot_company_url),
      weekEnding: optionalString(row.period_end),
      motion: motionLabel(row.motion),
      movement: valueString(row.detail_bucket || row.bucket).replaceAll("_", " "),
      planBefore: optionalString(row.previous_motion_plans),
      planAfter: optionalString(row.current_motion_plans),
      beforeArr: valueNumber(row.previous_segment_carr),
      afterArr: valueNumber(row.current_segment_carr),
      contribution: valueNumber(row.contribution),
      deal: optionalString(row.deal_name),
      dealId: dealId || null,
      dealUrl: hubspotDealUrl(dealId),
      dealDate: optionalString(row.deal_date),
      dealArr,
      matchBasis,
    };
  });

  const columns: GtmDetailColumn[] = [
    { key: "customer", label: "Customer", linkKey: "companyUrl" },
    { key: "weekEnding", label: "Week ending", format: "date" },
    { key: "motion", label: "Motion" },
  ];
  if (!stockField) columns.push({ key: "movement", label: "Movement" });
  columns.push(
    { key: "planBefore", label: "Plan before" },
    { key: "planAfter", label: "Plan after" },
    { key: "beforeArr", label: "ARR before", format: "currency" },
    { key: "afterArr", label: "ARR after", format: "currency" },
    { key: "contribution", label: stockField ? bridgeFieldLabel(input.field as GtmBridgeField) : "Contribution", format: "currency" },
  );
  if (!stockField) columns.push(
    { key: "deal", label: "Matched HubSpot deal", linkKey: "dealUrl" },
    { key: "matchBasis", label: "Deal match" },
  );

  return {
    title: input.title,
    periodLabel: input.range.label,
    source: "Customer-level combined + legacy CARR model · BigQuery",
    aggregation: stockField ? "snapshot" : "sum",
    detailValue: sumRows(details, "contribution"),
    columns,
    rows: details,
    note: stockField
      ? "Each row is a customer-level CARR record in the selected beginning or ending weekly snapshot, including non-cloud HubSpot ARR."
      : "Each row is a customer-level CARR record, including non-cloud HubSpot ARR. When a customer changes motion and ARR in the same week, the row contribution separates the true expansion or contraction from the transferred ARR, matching the aggregate bridge. The matched deal is ranked from HubSpot deals sharing the company or workspace; the Deal match column states the match basis.",
  };
}

const DEAL_METRICS = new Set(["pipeline_created", "open_pipeline", "opps_created", "opps_from_mql", "opps_from_pql", "sales_acv", "win_rate"]);

function newBusinessSql(alias = "d") {
  return `REGEXP_REPLACE(LOWER(COALESCE(${alias}.dealtype, '')), r'[^a-z]', '') = 'newbusiness'`;
}

async function queryDealMetricDetails(metricId: string, range: DateRange, title: string): Promise<GtmDetailResponse> {
  let condition = "FALSE";
  let aggregation: GtmDetailResponse["aggregation"] = "count";
  let contributionField = "1";
  let note = "Deals are read from the latest HubSpot replica in BigQuery.";
  if (metricId === "pipeline_created") {
    condition = `created_date BETWEEN DATE(@start_date) AND DATE(@end_date) AND is_included_pipeline AND is_new_business`;
    aggregation = "sum";
    contributionField = "deal_value";
  } else if (metricId === "open_pipeline") {
    condition = `created_date <= DATE(@as_of_date) AND (NOT COALESCE(is_closed, FALSE) OR verdict_date > DATE(@as_of_date)) AND expected_close_date BETWEEN DATE(@month_start) AND DATE(@month_end) AND is_included_pipeline AND is_new_business`;
    aggregation = "sum";
    contributionField = "deal_value";
    note = "This is a reconstructed point-in-time snapshot from the latest HubSpot replica. Later close-date edits can change a historical view.";
  } else if (metricId === "opps_created") {
    condition = `created_date BETWEEN DATE(@start_date) AND DATE(@end_date) AND is_included_pipeline AND is_new_business`;
  } else if (metricId === "opps_from_mql") {
    condition = `created_date BETWEEN DATE(@start_date) AND DATE(@end_date) AND pipeline_id = @sales_pipeline AND is_new_business`;
  } else if (metricId === "opps_from_pql") {
    condition = `created_date BETWEEN DATE(@start_date) AND DATE(@end_date) AND pipeline_id = @transaction_pipeline AND is_new_business`;
  } else if (metricId === "sales_acv") {
    condition = `verdict_date BETWEEN DATE_SUB(DATE(@as_of_date), INTERVAL 89 DAY) AND DATE(@as_of_date) AND pipeline_id = @sales_pipeline AND is_new_business AND COALESCE(is_closed_won, FALSE)`;
    aggregation = "average";
    contributionField = "deal_value";
    note = "ACV is the average deal value of closed-won, new-business Sales Default deals in the trailing 90 days.";
  } else if (metricId === "win_rate") {
    condition = `verdict_date BETWEEN DATE(@start_date) AND DATE(@end_date) AND is_included_pipeline AND (COALESCE(is_closed_won, FALSE) OR COALESCE(is_closed_lost, FALSE))`;
    aggregation = "ratio";
    contributionField = "IF(COALESCE(is_closed_won, FALSE), 1, 0)";
    note = "Win rate is closed won divided by all deals that reached a won or lost verdict in the period.";
  }

  const rows = await runBigQuerySqlRows(
    `
WITH scoped AS (
  SELECT
    d.*,
    d.pipeline_id IN (@sales_pipeline, @transaction_pipeline) AS is_included_pipeline,
    ${newBusinessSql("d")} AS is_new_business,
    DATE(d.deal_created_at) AS created_date,
    DATE(COALESCE(d.closed_won_date, d.close_date)) AS verdict_date,
    DATE(d.close_date) AS expected_close_date,
    COALESCE(d.amount_in_home_currency, d.amount, d.arr, d.contracted_carr, 0) AS deal_value
  FROM ${tableRef(TRANSFORMED_DATASET, "stg_hubspot_deals")} d
  WHERE COALESCE(d.is_archived, FALSE) = FALSE
)
SELECT
  deal_id, deal_name, primary_company_id, deal_workspace_id,
  pipeline_id, dealstage_id, dealtype, recurring_revenue_type,
  created_date, expected_close_date, verdict_date,
  is_closed_won, is_closed_lost, is_closed,
  deal_value, ${contributionField} AS contribution
FROM scoped
WHERE ${condition}
ORDER BY ABS(${contributionField}) DESC, COALESCE(verdict_date, expected_close_date, created_date) DESC, deal_name
`, commonParams(range), { profile: PROFILE },
  );

  const details: GtmDetailRow[] = rows.map((row) => {
    const dealId = valueString(row.deal_id);
    const pipelineId = valueString(row.pipeline_id);
    const status = valueBoolean(row.is_closed_won) ? "Closed won" : valueBoolean(row.is_closed_lost) ? "Closed lost" : valueBoolean(row.is_closed) ? "Closed" : "Open";
    return {
      deal: optionalString(row.deal_name) || dealId,
      dealUrl: hubspotDealUrl(dealId),
      dealId,
      companyId: optionalString(row.primary_company_id),
      workspaceId: optionalString(row.deal_workspace_id),
      pipeline: pipelineId === SALES_DEFAULT_PIPELINE_ID ? "Sales Default" : pipelineId === TRANSACTIONAL_PIPELINE_ID ? "Transactional" : pipelineId,
      dealType: optionalString(row.dealtype),
      createdDate: optionalString(row.created_date),
      closeDate: optionalString(row.expected_close_date),
      verdictDate: optionalString(row.verdict_date),
      status,
      dealValue: valueNumber(row.deal_value),
      contribution: valueNumber(row.contribution),
    };
  });

  let detailValue: number | null;
  const summary: Array<{ label: string; value: string }> = [];
  if (aggregation === "sum") detailValue = sumRows(details, "contribution");
  else if (aggregation === "average") detailValue = details.length ? round2(sumRows(details, "contribution") / details.length) : null;
  else if (aggregation === "ratio") {
    const won = details.filter((row) => row.status === "Closed won").length;
    detailValue = details.length ? won / details.length : null;
    summary.push({ label: "Closed won", value: String(won) }, { label: "Closed lost", value: String(details.length - won) });
  } else detailValue = details.length;

  return {
    title,
    periodLabel: metricId === "sales_acv" ? `Trailing 90 days through ${displayDate(range.asOfDate)}` : range.label,
    source: "HubSpot deals replica · BigQuery",
    aggregation,
    detailValue,
    columns: [
      { key: "deal", label: "Deal", linkKey: "dealUrl" },
      { key: "dealId", label: "Deal ID" },
      { key: "pipeline", label: "Pipeline" },
      { key: "dealType", label: "Deal type" },
      { key: "createdDate", label: "Created", format: "date" },
      { key: "closeDate", label: "Close date", format: "date" },
      { key: "status", label: "Status" },
      { key: "dealValue", label: "Deal value", format: "currency" },
    ],
    rows: details,
    summary: summary.length ? summary : undefined,
    note,
  };
}

async function queryContactMetricDetails(metricId: "mqls" | "sqls", range: DateRange, title: string): Promise<GtmDetailResponse> {
  const eventField = metricId === "mqls" ? "entered_mql_at" : "entered_sql_at";
  const rows = await runBigQuerySqlRows(
    `
WITH latest_contacts AS (
  SELECT
    id,
    properties_email AS email,
    properties_firstname AS first_name,
    properties_lastname AS last_name,
    properties_company AS company,
    properties_hs_v2_date_entered_marketingqualifiedlead AS entered_mql_at,
    properties_hs_v2_date_entered_salesqualifiedlead AS entered_sql_at
  FROM ${tableRef(HUBSPOT_DATASET, "contacts")}
  WHERE COALESCE(archived, FALSE) = FALSE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY _airbyte_extracted_at DESC, updatedAt DESC) = 1
)
SELECT id, email, first_name, last_name, company, DATE(${eventField}) AS event_date
FROM latest_contacts
WHERE DATE(${eventField}) BETWEEN DATE(@start_date) AND DATE(@end_date)
ORDER BY event_date DESC, email
`, commonParams(range), { profile: PROFILE },
  );
  const details: GtmDetailRow[] = rows.map((row) => {
    const contactId = valueString(row.id);
    const name = [valueString(row.first_name), valueString(row.last_name)].filter(Boolean).join(" ");
    return {
      contact: name || optionalString(row.email) || contactId,
      contactUrl: hubspotContactUrl(contactId),
      email: optionalString(row.email),
      company: optionalString(row.company),
      eventDate: optionalString(row.event_date),
      contactId,
    };
  });
  return {
    title,
    periodLabel: range.label,
    source: "HubSpot contacts replica · BigQuery",
    aggregation: "count",
    detailValue: details.length,
    columns: [
      { key: "contact", label: "Contact", linkKey: "contactUrl" },
      { key: "email", label: "Email" },
      { key: "company", label: "Company" },
      { key: "eventDate", label: metricId === "mqls" ? "Entered MQL" : "Entered SQL", format: "date" },
      { key: "contactId", label: "Contact ID" },
    ],
    rows: details,
  };
}

async function querySignupMetricDetails(metricId: "overall_signups" | "cs_signups" | "business_signups", range: DateRange, title: string): Promise<GtmDetailResponse> {
  const rows = await runBigQuerySqlRows(
    `
WITH overall AS (
  SELECT period_start, SUM(stage_count) AS overall_signups
  FROM ${tableRef(TRANSFORMED_DATASET, "rpt_marketing_overall_funnel_by_period")}
  WHERE stage_key = 'total_signups' AND period_start BETWEEN DATE(@start_date) AND DATE(@end_date)
  GROUP BY period_start
), cs AS (
  SELECT period_start, SUM(cs_stage_count) AS cs_signups
  FROM ${tableRef(TRANSFORMED_DATASET, "rpt_marketing_cs_vertical_by_period")}
  WHERE stage_key = 'total_signups' AND period_start BETWEEN DATE(@start_date) AND DATE(@end_date)
  GROUP BY period_start
)
SELECT
  COALESCE(overall.period_start, cs.period_start) AS event_date,
  COALESCE(overall.overall_signups, 0) AS overall_signups,
  COALESCE(cs.cs_signups, 0) AS cs_signups,
  GREATEST(COALESCE(overall.overall_signups, 0) - COALESCE(cs.cs_signups, 0), 0) AS business_signups
FROM overall FULL OUTER JOIN cs USING (period_start)
ORDER BY event_date DESC
`, commonParams(range), { profile: PROFILE },
  );
  const details: GtmDetailRow[] = rows.flatMap((row) => {
    const count = valueNumber(row[metricId]);
    if (!count) return [];
    return [{ date: optionalString(row.event_date), signups: count }];
  });
  return {
    title,
    periodLabel: range.label,
    source: metricId === "cs_signups" ? "Marketing CS vertical · BigQuery" : "Marketing funnel · BigQuery",
    aggregation: "sum",
    detailValue: sumRows(details, "signups"),
    columns: [{ key: "date", label: "Date", format: "date" }, { key: "signups", label: "Sign-ups", format: "count" }],
    rows: details,
    note: "The marketing funnel table is aggregated by date and does not retain customer or contact identifiers, so this drill-down shows the daily records that make up the total.",
  };
}

const ARR_METRIC_MAP: Record<string, { segment: GtmBridgeSegment | "sales"; field: GtmBridgeField | "churnAndContraction" }> = {
  net_new_arr: { segment: "total", field: "netNewArr" },
  selfserve_new: { segment: "selfserve", field: "newArr" },
  sales_new: { segment: "sales", field: "newArr" },
  selfserve_expansion: { segment: "selfserve", field: "expansionArr" },
  selfserve_churn: { segment: "selfserve", field: "churnAndContraction" },
  sales_expansion: { segment: "sales", field: "expansionArr" },
  sales_churn: { segment: "sales", field: "churnAndContraction" },
};

const SIGNUP_METRICS = new Set(["overall_signups", "cs_signups", "business_signups"]);
const CONTACT_METRICS = new Set(["mqls", "sqls"]);

export function validateGtmDetailRequest(raw: Partial<GtmDetailRequest>): GtmDetailRequest {
  const kind = valueString(raw.kind);
  const weekEndDate = valueString(raw.weekEndDate) || undefined;
  if (weekEndDate) parseIsoDate(weekEndDate);
  if (kind === "bridge") {
    const bridgeRequest = raw as Partial<Extract<GtmDetailRequest, { kind: "bridge" }>>;
    const segment = valueString(bridgeRequest.segment) as GtmBridgeSegment;
    const field = valueString(bridgeRequest.field) as GtmBridgeField;
    const period = (valueString(bridgeRequest.period) || "mtd") as "week" | "mtd";
    if (!["selfserve", "sales_assist", "salesled", "total"].includes(segment)) throw new Error("Invalid segment.");
    if (!["beginningArr", "newArr", "expansionArr", "contractionArr", "churnArr", "transferArr", "endingArr", "netNewArr"].includes(field)) throw new Error("Invalid bridge field.");
    if (!["week", "mtd"].includes(period)) throw new Error("Invalid bridge period.");
    return { kind, weekEndDate, segment, field, period };
  }
  if (kind === "metric") {
    const metricId = valueString((raw as Partial<Extract<GtmDetailRequest, { kind: "metric" }>>).metricId);
    const period = valueString((raw as Partial<Extract<GtmDetailRequest, { kind: "metric" }>>).period) as GtmDetailPeriod;
    if (!["week", "priorWeek", "mtd"].includes(period)) throw new Error("Invalid detail period.");
    if (!ARR_METRIC_MAP[metricId] && !DEAL_METRICS.has(metricId) && !SIGNUP_METRICS.has(metricId) && !CONTACT_METRICS.has(metricId)) {
      throw new Error("Invalid or unsupported detail metric.");
    }
    return { kind, weekEndDate, metricId, period };
  }
  throw new Error("Invalid detail kind.");
}

export async function queryGtmDetails(request: GtmDetailRequest): Promise<GtmDetailResponse> {
  if (request.kind === "bridge") {
    const range = resolveRange(request.weekEndDate, request.period || "mtd");
    return queryArrMovementDetails({
      range,
      segment: request.segment,
      field: request.field,
      title: `${bridgeSegmentLabel(request.segment)} · ${bridgeFieldLabel(request.field)}`,
    });
  }

  const range = resolveRange(request.weekEndDate, request.period);
  const arrMetric = ARR_METRIC_MAP[request.metricId];
  if (arrMetric) {
    return queryArrMovementDetails({ range, ...arrMetric, title: request.metricId.replaceAll("_", " ") });
  }
  if (DEAL_METRICS.has(request.metricId)) return queryDealMetricDetails(request.metricId, range, request.metricId.replaceAll("_", " "));
  if (CONTACT_METRICS.has(request.metricId)) return queryContactMetricDetails(request.metricId as "mqls" | "sqls", range, request.metricId.toUpperCase());
  if (SIGNUP_METRICS.has(request.metricId)) return querySignupMetricDetails(request.metricId as "overall_signups" | "cs_signups" | "business_signups", range, request.metricId.replaceAll("_", " "));
  throw new Error("Invalid or unsupported detail metric.");
}
