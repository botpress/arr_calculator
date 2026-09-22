import { runBigQuerySqlRows, type BigQuerySqlParameter } from "@/lib/stripeBigquery";

const PROFILE = "stripe_arr_correct" as const;
const BIGQUERY_PROJECT = String(process.env.GTM_BIGQUERY_PROJECT || "botpress-stripe-data-pipeline").trim() || "botpress-stripe-data-pipeline";
const TRANSFORMED_DATASET = String(process.env.GTM_BIGQUERY_TRANSFORMED_DATASET || "transformed_data").trim() || "transformed_data";
const HUBSPOT_DATASET = String(process.env.GTM_BIGQUERY_HUBSPOT_DATASET || "hubspot").trim() || "hubspot";
const TRANSACTIONAL_PIPELINE_ID = "730649262";

function safeIdentifier(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid ${label} BigQuery identifier.`);
  return value;
}

function tableRef(dataset: string, table: string) {
  return `\`${safeIdentifier(BIGQUERY_PROJECT, "project")}.${safeIdentifier(dataset, "dataset")}.${safeIdentifier(table, "table")}\``;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type AccountManagementWarehouseCandidate = {
  companyId: string;
  dealId: string;
  dealName: string;
  revenueSource: "hubspot_carr" | "stripe_arr";
  workspaceId: string;
  deploymentType: string;
};

export type AccountManagementWarehouseCarr = {
  companyId: string;
  companyName: string;
  previousArr: number;
  currentArr: number;
  previousCloudArr: number;
  currentCloudArr: number;
  previousLegacyArr: number;
  currentLegacyArr: number;
};

export type AccountManagementWarehouseCompany = {
  companyId: string;
  companyName: string;
  csmOwnerId: string;
  churnType: string;
  ownerName: string;
};

export type AccountManagementWarehouseData = {
  portfolioCandidates: AccountManagementWarehouseCandidate[];
  carrCandidates: AccountManagementWarehouseCandidate[];
  carrByCompany: AccountManagementWarehouseCarr[];
  companies: AccountManagementWarehouseCompany[];
  hubspotDealWorkspaceIds: string[];
};

export async function queryAccountManagementWarehouseData(input: {
  openingSnapshotDate: string;
  currentQuarterEnd: string;
  targetCurrency: string;
}): Promise<AccountManagementWarehouseData> {
  const deals = tableRef(TRANSFORMED_DATASET, "stg_hubspot_deals");
  const dealLineItems = tableRef(TRANSFORMED_DATASET, "stg_hubspot_deal_line_items");
  const lineItems = tableRef(TRANSFORMED_DATASET, "stg_hubspot_line_items");
  const fxRates = tableRef(TRANSFORMED_DATASET, "int_fx_monthly_rates");
  const stagedCompanies = tableRef(TRANSFORMED_DATASET, "stg_hubspot_companies");
  const rawCompanies = tableRef(HUBSPOT_DATASET, "companies");
  const rawOwners = tableRef(HUBSPOT_DATASET, "owners");
  const includedStage = text(process.env.INCLUDED_DEALSTAGE);
  if (!includedStage) throw new Error("Missing env var: INCLUDED_DEALSTAGE");

  const params: BigQuerySqlParameter[] = [
    { name: "opening_snapshot_date", type: "STRING", value: input.openingSnapshotDate },
    { name: "current_quarter_end", type: "STRING", value: input.currentQuarterEnd },
    { name: "target_currency", type: "STRING", value: input.targetCurrency },
    { name: "included_stage", type: "STRING", value: includedStage },
    { name: "transactional_pipeline", type: "STRING", value: TRANSACTIONAL_PIPELINE_ID },
  ];

  const portfolioPromise = runBigQuerySqlRows(
    `
WITH line_item_labels AS (
  SELECT
    dli.deal_id,
    LOWER(STRING_AGG(CONCAT(COALESCE(li.name, ''), ' ', COALESCE(li.description, ''), ' ', COALESCE(li.sku, '')), ' ')) AS labels
  FROM ${dealLineItems} dli
  JOIN ${lineItems} li USING (line_item_id)
  GROUP BY dli.deal_id
)
SELECT
  d.primary_company_id AS company_id,
  d.deal_id,
  d.deal_name,
  d.deal_workspace_id AS workspace_id,
  IF(d.pipeline_id = @transactional_pipeline, 'Cloud', d.deployment_type) AS deployment_type,
  'hubspot_carr' AS revenue_source
FROM ${deals} d
WHERE COALESCE(d.is_archived, FALSE) = FALSE
  AND REGEXP_REPLACE(LOWER(COALESCE(d.dealtype, '')), r'[^a-z]', '') = 'existingbusiness'

UNION ALL

SELECT
  d.primary_company_id AS company_id,
  d.deal_id,
  d.deal_name,
  d.deal_workspace_id AS workspace_id,
  'Cloud' AS deployment_type,
  'stripe_arr' AS revenue_source
FROM ${deals} d
JOIN line_item_labels labels USING (deal_id)
WHERE COALESCE(d.is_archived, FALSE) = FALSE
  AND d.pipeline_id = @transactional_pipeline
  AND COALESCE(d.is_closed_won, FALSE)
  AND DATE(COALESCE(d.closed_won_date, d.close_date)) <= DATE(@current_quarter_end)
  AND REGEXP_CONTAINS(labels.labels, r'(^|[^a-z0-9])team([^a-z0-9]|$)')
  AND NOT REGEXP_CONTAINS(labels.labels, r'(^|[^a-z0-9])plus([^a-z0-9]|$)')
`, params, { profile: PROFILE });

  const carrCtes = `
WITH desk_deals AS (
  SELECT DISTINCT dli.deal_id
  FROM ${dealLineItems} dli
  JOIN ${lineItems} li USING (line_item_id)
  WHERE STRPOS(LOWER(CONCAT(COALESCE(li.name, ''), ' ', COALESCE(li.description, ''), ' ', COALESCE(li.sku, ''))), 'desk - early access') > 0
     OR STRPOS(LOWER(CONCAT(COALESCE(li.name, ''), ' ', COALESCE(li.description, ''), ' ', COALESCE(li.sku, ''))), 'desk early access') > 0
),
latest_fx AS (
  SELECT rate_month, from_currency, to_currency, monthly_average_rate
  FROM ${fxRates}
  QUALIFY ROW_NUMBER() OVER (PARTITION BY rate_month, from_currency, to_currency ORDER BY captured_at DESC) = 1
),
inputs AS (
  SELECT
    d.deal_id,
    d.deal_name,
    NULLIF(TRIM(d.primary_company_id), '') AS company_id,
    NULLIF(TRIM(d.deal_workspace_id), '') AS workspace_id,
    IF(
      d.pipeline_id = @transactional_pipeline,
      'Cloud',
      NULLIF(TRIM(d.deployment_type), '')
    ) AS deployment_type,
    REGEXP_REPLACE(LOWER(COALESCE(d.dealtype, '')), r'[^a-z]', '') IN ('existingbusiness', 'upsell') AS is_existing_business,
    DATE(d.close_date) AS close_date,
    CASE
      WHEN REGEXP_REPLACE(LOWER(COALESCE(d.dealtype, '')), r'[^a-z]', '') = 'existingbusiness'
        AND DATE(d.close_date) IS NOT NULL
      THEN GREATEST(
        COALESCE(li.recurring_billing_start_date, li.billing_period_start_date),
        DATE(d.close_date)
      )
      ELSE COALESCE(li.recurring_billing_start_date, li.billing_period_start_date)
    END AS active_start,
    COALESCE(li.recurring_billing_end_date, li.billing_period_end_date) AS explicit_end,
    li.term_in_months,
    li.recurring_billing_frequency,
    li.amount,
    COALESCE(NULLIF(UPPER(TRIM(d.currency)), ''), 'USD') AS currency,
    DATE_TRUNC(COALESCE(DATE(d.close_date), CURRENT_DATE()), MONTH) AS fx_month
  FROM ${deals} d
  JOIN ${dealLineItems} dli USING (deal_id)
  JOIN ${lineItems} li USING (line_item_id)
  LEFT JOIN desk_deals desk USING (deal_id)
  WHERE COALESCE(d.is_archived, FALSE) = FALSE
    AND d.dealstage_id = @included_stage
    AND desk.deal_id IS NULL
),
valued AS (
  SELECT
    i.*,
    CASE
      WHEN i.explicit_end IS NOT NULL THEN DATE_SUB(i.explicit_end, INTERVAL 1 DAY)
      WHEN COALESCE(i.term_in_months, 0) <> 0 THEN DATE_SUB(DATE_ADD(i.active_start, INTERVAL CAST(i.term_in_months AS INT64) MONTH), INTERVAL 1 DAY)
      ELSE NULL
    END AS active_end,
    ROUND(
      ROUND(CAST(i.amount AS FLOAT64) * CASE
        WHEN i.explicit_end IS NULL AND COALESCE(i.term_in_months, 0) = 0 THEN 0
        WHEN STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'one') > 0 THEN 0
        WHEN LOWER(COALESCE(i.recurring_billing_frequency, '')) = 'per_six_months' OR REGEXP_CONTAINS(LOWER(COALESCE(i.recurring_billing_frequency, '')), r'six.*month') THEN 2
        WHEN LOWER(COALESCE(i.recurring_billing_frequency, '')) = 'per_quarter' OR STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'quarter') > 0 OR REGEXP_CONTAINS(LOWER(COALESCE(i.recurring_billing_frequency, '')), r'three.*month') THEN 4
        WHEN STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'semi') > 0 OR STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'half') > 0 THEN 2
        WHEN STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'month') > 0 THEN 12
        WHEN STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'year') > 0 OR STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'annual') > 0 THEN 1
        ELSE 0
      END, 2) * CAST(COALESCE(fx.monthly_average_rate, IF(i.currency = @target_currency, 1, 0)) AS FLOAT64),
      2
    ) AS line_arr
  FROM inputs i
  LEFT JOIN latest_fx fx
    ON fx.rate_month = i.fx_month
   AND fx.from_currency = i.currency
   AND fx.to_currency = @target_currency
),
lines AS (
  SELECT
    v.*,
    MIN(IF(v.active_start IS NOT NULL AND v.active_end IS NOT NULL AND v.line_arr > 0, v.active_start, NULL)) OVER (PARTITION BY v.deal_id) AS earliest_recurring_start
  FROM valued v
),
snapshots AS (
  SELECT DATE(@opening_snapshot_date) AS snapshot_date, 'previous' AS snapshot_key
  UNION ALL
  SELECT DATE(@current_quarter_end), 'current'
),
line_snapshots AS (
  SELECT
    l.*,
    s.snapshot_key,
    IF(
      l.active_start IS NOT NULL
      AND l.active_end IS NOT NULL
      AND l.line_arr > 0
      AND (
        s.snapshot_date BETWEEN l.active_start AND l.active_end
        OR (
          NOT l.is_existing_business
          AND l.close_date < l.earliest_recurring_start
          AND l.active_start = l.earliest_recurring_start
          AND s.snapshot_date BETWEEN l.close_date AND l.earliest_recurring_start
        )
      ),
      l.line_arr,
      0
    ) AS snapshot_arr
  FROM lines l
  CROSS JOIN snapshots s
)
`;

  const carrPromise = runBigQuerySqlRows(
    `${carrCtes}
SELECT
  ls.company_id,
  COALESCE(NULLIF(company.company_name, ''), ARRAY_AGG(NULLIF(ls.deal_name, '') IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)], '') AS company_name,
  ROUND(SUM(IF(ls.snapshot_key = 'previous', ls.snapshot_arr, 0)), 2) AS previous_arr,
  ROUND(SUM(IF(ls.snapshot_key = 'current', ls.snapshot_arr, 0)), 2) AS current_arr,
  ROUND(SUM(IF(ls.snapshot_key = 'previous' AND LOWER(TRIM(COALESCE(ls.deployment_type, ''))) = 'cloud', ls.snapshot_arr, 0)), 2) AS previous_cloud_arr,
  ROUND(SUM(IF(ls.snapshot_key = 'current' AND LOWER(TRIM(COALESCE(ls.deployment_type, ''))) = 'cloud', ls.snapshot_arr, 0)), 2) AS current_cloud_arr,
  ROUND(SUM(IF(ls.snapshot_key = 'previous' AND LOWER(TRIM(COALESCE(ls.deployment_type, ''))) <> 'cloud', ls.snapshot_arr, 0)), 2) AS previous_legacy_arr,
  ROUND(SUM(IF(ls.snapshot_key = 'current' AND LOWER(TRIM(COALESCE(ls.deployment_type, ''))) <> 'cloud', ls.snapshot_arr, 0)), 2) AS current_legacy_arr
FROM line_snapshots ls
LEFT JOIN ${stagedCompanies} company ON company.company_id = ls.company_id AND COALESCE(company.is_archived, FALSE) = FALSE
WHERE ls.company_id IS NOT NULL
GROUP BY ls.company_id, company.company_name
`, params, { profile: PROFILE });

  const carrCandidatesPromise = runBigQuerySqlRows(
    `${carrCtes}
SELECT DISTINCT
  company_id,
  deal_id,
  deal_name,
  workspace_id,
  deployment_type,
  'hubspot_carr' AS revenue_source
FROM lines
WHERE company_id IS NOT NULL
`, params, { profile: PROFILE });

  const companiesPromise = runBigQuerySqlRows(
    `
WITH line_item_labels AS (
  SELECT
    dli.deal_id,
    LOWER(STRING_AGG(CONCAT(COALESCE(li.name, ''), ' ', COALESCE(li.description, ''), ' ', COALESCE(li.sku, '')), ' ')) AS labels
  FROM ${dealLineItems} dli
  JOIN ${lineItems} li USING (line_item_id)
  GROUP BY dli.deal_id
),
relevant_company_ids AS (
  SELECT DISTINCT d.primary_company_id AS company_id
  FROM ${deals} d
  LEFT JOIN line_item_labels labels USING (deal_id)
  WHERE COALESCE(d.is_archived, FALSE) = FALSE
    AND NULLIF(TRIM(d.primary_company_id), '') IS NOT NULL
    AND (
      REGEXP_REPLACE(LOWER(COALESCE(d.dealtype, '')), r'[^a-z]', '') = 'existingbusiness'
      OR d.dealstage_id = @included_stage
      OR (
        d.pipeline_id = @transactional_pipeline
        AND COALESCE(d.is_closed_won, FALSE)
        AND DATE(COALESCE(d.closed_won_date, d.close_date)) <= DATE(@current_quarter_end)
        AND REGEXP_CONTAINS(labels.labels, r'(^|[^a-z0-9])team([^a-z0-9]|$)')
        AND NOT REGEXP_CONTAINS(labels.labels, r'(^|[^a-z0-9])plus([^a-z0-9]|$)')
      )
    )
),
companies AS (
  SELECT
    CAST(id AS STRING) AS company_id,
    properties_name AS company_name,
    properties_csm_owner AS csm_owner_id,
    properties_churn_type AS churn_type
  FROM ${rawCompanies}
  WHERE COALESCE(archived, FALSE) = FALSE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY _airbyte_extracted_at DESC, updatedAt DESC) = 1
),
owners AS (
  SELECT
    CAST(id AS STRING) AS owner_id,
    COALESCE(NULLIF(TRIM(CONCAT(COALESCE(firstName, ''), ' ', COALESCE(lastName, ''))), ''), NULLIF(TRIM(email), ''), CONCAT('Owner ', CAST(id AS STRING))) AS owner_name
  FROM ${rawOwners}
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY _airbyte_extracted_at DESC, updatedAt DESC) = 1
)
SELECT c.company_id, c.company_name, c.csm_owner_id, c.churn_type, o.owner_name
FROM relevant_company_ids relevant
JOIN companies c USING (company_id)
LEFT JOIN owners o ON o.owner_id = c.csm_owner_id
`, params, { profile: PROFILE });

  const dealWorkspaceIdsPromise = runBigQuerySqlRows(
    `
SELECT DISTINCT LOWER(TRIM(deal_workspace_id)) AS workspace_id
FROM ${deals}
WHERE COALESCE(is_archived, FALSE) = FALSE
  AND NULLIF(TRIM(deal_workspace_id), '') IS NOT NULL
ORDER BY workspace_id
`, [], { profile: PROFILE });

  const [portfolioRows, carrRows, carrCandidateRows, companyRows, dealWorkspaceIdRows] = await Promise.all([
    portfolioPromise,
    carrPromise,
    carrCandidatesPromise,
    companiesPromise,
    dealWorkspaceIdsPromise,
  ]);

  const mapCandidate = (row: Record<string, unknown>): AccountManagementWarehouseCandidate => ({
    companyId: text(row.company_id),
    dealId: text(row.deal_id),
    dealName: text(row.deal_name),
    revenueSource: text(row.revenue_source) === "stripe_arr" ? "stripe_arr" : "hubspot_carr",
    workspaceId: text(row.workspace_id).toLowerCase(),
    deploymentType: text(row.deployment_type),
  });

  return {
    portfolioCandidates: portfolioRows.map(mapCandidate),
    carrCandidates: carrCandidateRows.map(mapCandidate),
    carrByCompany: carrRows.map((row) => ({
      companyId: text(row.company_id),
      companyName: text(row.company_name),
      previousArr: number(row.previous_arr),
      currentArr: number(row.current_arr),
      previousCloudArr: number(row.previous_cloud_arr),
      currentCloudArr: number(row.current_cloud_arr),
      previousLegacyArr: number(row.previous_legacy_arr),
      currentLegacyArr: number(row.current_legacy_arr),
    })),
    companies: companyRows.map((row) => ({
      companyId: text(row.company_id),
      companyName: text(row.company_name),
      csmOwnerId: text(row.csm_owner_id),
      churnType: text(row.churn_type),
      ownerName: text(row.owner_name),
    })),
    hubspotDealWorkspaceIds: dealWorkspaceIdRows.map((row) => text(row.workspace_id).toLowerCase()).filter(Boolean),
  };
}
