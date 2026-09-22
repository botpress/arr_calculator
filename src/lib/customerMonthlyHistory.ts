const PROFILE = "stripe_arr_correct" as const;

function identifier(value: string, fallback: string, label: string) {
  const normalized = String(value || "").trim() || fallback;
  if (!/^[A-Za-z0-9_]+$/.test(normalized)) throw new Error(`Invalid ${label}: ${normalized}`);
  return normalized;
}

function projectIdentifier(value: string, fallback: string, label: string) {
  const normalized = String(value || "").trim() || fallback;
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new Error(`Invalid ${label}: ${normalized}`);
  return normalized;
}

function tableRef(project: string, dataset: string, table: string) {
  return `\`${projectIdentifier(project, project, "BigQuery project")}.${identifier(dataset, dataset, "BigQuery dataset")}.${identifier(table, table, "BigQuery table")}\``;
}

function configuredTableRef(value: string | undefined, fallback: [string, string, string], label: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return tableRef(...fallback);
  const parts = normalized.replace(/^`|`$/g, "").split(".");
  if (parts.length !== 3) throw new Error(`${label} must use project.dataset.table`);
  return tableRef(parts[0], parts[1], parts[2]);
}

function config() {
  const project = projectIdentifier(
    process.env.CUSTOMER_MONTHLY_HISTORY_PROJECT || process.env.PRECOMPUTED_TABLES_PROJECT || "botpress-stripe-data-pipeline",
    "botpress-stripe-data-pipeline",
    "customer history project",
  );
  const dataset = identifier(
    process.env.CUSTOMER_MONTHLY_HISTORY_DATASET || process.env.PRECOMPUTED_TABLES_DATASET || "precomputed_tables",
    "precomputed_tables",
    "customer history dataset",
  );
  const table = identifier(
    process.env.CUSTOMER_MONTHLY_HISTORY_TABLE || "customer_monthly_history",
    "customer_monthly_history",
    "customer history table",
  );
  const stripeProject = projectIdentifier(
    process.env.STRIPE_SOURCE_PROJECT || "botpress-stripe-data-pipeline",
    "botpress-stripe-data-pipeline",
    "Stripe source project",
  );
  const stripeDataset = identifier(process.env.STRIPE_SOURCE_DATASET || "stripe", "stripe", "Stripe source dataset");
  const precomputedProject = projectIdentifier(
    process.env.PRECOMPUTED_TABLES_PROJECT || "botpress-stripe-data-pipeline",
    "botpress-stripe-data-pipeline",
    "precomputed project",
  );
  const transformedProject = projectIdentifier(
    process.env.GTM_BIGQUERY_PROJECT || "botpress-stripe-data-pipeline",
    "botpress-stripe-data-pipeline",
    "transformed project",
  );
  const transformedDataset = identifier(
    process.env.GTM_BIGQUERY_TRANSFORMED_DATASET || "transformed_data",
    "transformed_data",
    "transformed dataset",
  );
  const precomputedDataset = identifier(
    process.env.PRECOMPUTED_TABLES_DATASET || "precomputed_tables",
    "precomputed_tables",
    "precomputed dataset",
  );
  return {
    project,
    dataset,
    table,
    outputRef: tableRef(project, dataset, table),
    customersRef: configuredTableRef(
      process.env.BIGQUERY_STRIPE_CUSTOMERS_TABLE,
      [stripeProject, stripeDataset, "customers"],
      "Stripe customers table",
    ),
    metadataRef: configuredTableRef(
      process.env.BIGQUERY_STRIPE_ARR_CORRECT_CUSTOMERS_METADATA_TABLE,
      [stripeProject, stripeDataset, "customers_metadata"],
      "Stripe customer metadata table",
    ),
    eventsRef: configuredTableRef(
      process.env.BIGQUERY_STRIPE_ARR_CORRECT_MRR_CHANGE_TABLE,
      [stripeProject, stripeDataset, "subscription_item_change_events_v2_beta"],
      "Stripe MRR event table",
    ),
    productsRef: configuredTableRef(
      process.env.BIGQUERY_STRIPE_ARR_CORRECT_PRODUCTS_TABLE,
      [stripeProject, stripeDataset, "products"],
      "Stripe products table",
    ),
    pricesRef: configuredTableRef(
      process.env.BIGQUERY_STRIPE_ARR_CORRECT_PRICES_TABLE,
      [stripeProject, stripeDataset, "prices"],
      "Stripe prices table",
    ),
    factsRef: tableRef(precomputedProject, precomputedDataset, "vw_fact_customer_arr_periodic_current"),
    hubspotDealsRef: tableRef(transformedProject, transformedDataset, "stg_hubspot_deals"),
  };
}

export type CustomerMonthlyHistoryStartedResult = {
  table: string;
  historyStart: string;
  projectId: string;
  jobId: string;
  location: string;
  startedAtUtc: string;
};

export function customerMonthlyHistorySql() {
  const refs = config();
  return `
CREATE OR REPLACE TABLE ${refs.outputRef}
PARTITION BY month_start
CLUSTER BY motion, plan_family, workspace_id
AS
WITH
stripe_customer_raw AS (
  SELECT TO_JSON_STRING(c) AS raw_json
  FROM ${refs.customersRef} c
),
stripe_customers_parsed AS (
  SELECT
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.id')), ''), '') AS customer_id,
    LOWER(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.email')), ''), '')) AS email,
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.name')), ''), '') AS customer_name,
    CASE
      WHEN REGEXP_CONTAINS(COALESCE(JSON_VALUE(raw_json, '$.created'), ''), r'^\\d{13,}$')
        THEN TIMESTAMP_MILLIS(SAFE_CAST(JSON_VALUE(raw_json, '$.created') AS INT64))
      WHEN REGEXP_CONTAINS(COALESCE(JSON_VALUE(raw_json, '$.created'), ''), r'^\\d{10}$')
        THEN TIMESTAMP_SECONDS(SAFE_CAST(JSON_VALUE(raw_json, '$.created') AS INT64))
      ELSE SAFE_CAST(JSON_VALUE(raw_json, '$.created') AS TIMESTAMP)
    END AS customer_created_at,
    COALESCE(
      SAFE_CAST(JSON_VALUE(raw_json, '$.batch_timestamp') AS TIMESTAMP),
      SAFE_CAST(JSON_VALUE(raw_json, '$._airbyte_extracted_at') AS TIMESTAMP),
      TIMESTAMP('1970-01-01')
    ) AS extracted_at
  FROM stripe_customer_raw
  WHERE COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.id')), ''), '') <> ''
),
stripe_customers_latest AS (
  SELECT * EXCEPT(extracted_at)
  FROM stripe_customers_parsed
  QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY extracted_at DESC) = 1
),
stripe_metadata_raw AS (
  SELECT TO_JSON_STRING(m) AS raw_json
  FROM ${refs.metadataRef} m
),
stripe_workspace AS (
  SELECT customer_id, workspace_id
  FROM (
    SELECT
      COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.customer_id')), ''), '') AS customer_id,
      LOWER(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.value')), ''), '')) AS workspace_id,
      COALESCE(
        SAFE_CAST(JSON_VALUE(raw_json, '$.batch_timestamp') AS TIMESTAMP),
        SAFE_CAST(JSON_VALUE(raw_json, '$._airbyte_extracted_at') AS TIMESTAMP),
        TIMESTAMP('1970-01-01')
      ) AS extracted_at
    FROM stripe_metadata_raw
    WHERE LOWER(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.key')), ''), '')) = 'workspace_id'
  )
  WHERE customer_id <> '' AND workspace_id <> ''
  QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY extracted_at DESC, workspace_id) = 1
),
stripe_directory AS (
  SELECT
    c.customer_id,
    c.email,
    c.customer_name,
    c.customer_created_at,
    COALESCE(w.workspace_id, '') AS workspace_id
  FROM stripe_customers_latest c
  LEFT JOIN stripe_workspace w USING (customer_id)
),
hubspot_deal_raw AS (
  SELECT TO_JSON_STRING(d) AS raw_json
  FROM ${refs.hubspotDealsRef} d
  WHERE COALESCE(is_archived, FALSE) = FALSE
),
hubspot_accounts AS (
  SELECT
    company_id,
    ARRAY_AGG(DISTINCT NULLIF(workspace_id, '') IGNORE NULLS ORDER BY NULLIF(workspace_id, '')) AS workspace_ids,
    ARRAY_AGG(DISTINCT NULLIF(deployment_type, '') IGNORE NULLS ORDER BY NULLIF(deployment_type, '')) AS deployment_types,
    ARRAY_AGG(NULLIF(deployment_type, '') IGNORE NULLS ORDER BY deal_created_at DESC LIMIT 1)[SAFE_OFFSET(0)] AS deployment_type,
    ARRAY_AGG(NULLIF(account_name, '') IGNORE NULLS ORDER BY deal_created_at DESC LIMIT 1)[SAFE_OFFSET(0)] AS account_name,
    MIN(deal_created_at) AS first_deal_date
  FROM (
    SELECT
      COALESCE(
        NULLIF(TRIM(JSON_VALUE(raw_json, '$.primary_company_id')), ''),
        NULLIF(TRIM(JSON_VALUE(raw_json, '$.hs_primary_associated_company')), ''),
        NULLIF(TRIM(JSON_VALUE(raw_json, '$.account_id')), ''),
        ''
      ) AS company_id,
      LOWER(COALESCE(
        NULLIF(TRIM(JSON_VALUE(raw_json, '$.workspace_id')), ''),
        NULLIF(TRIM(JSON_VALUE(raw_json, '$.workspace_id__c')), ''),
        ''
      )) AS workspace_id,
      COALESCE(
        NULLIF(TRIM(JSON_VALUE(raw_json, '$.deployment_type')), ''),
        NULLIF(TRIM(JSON_VALUE(raw_json, '$.deployment_type__c')), ''),
        NULLIF(TRIM(JSON_VALUE(raw_json, '$.properties_deployment_type__c')), ''),
        '(blank)'
      ) AS deployment_type,
      COALESCE(
        NULLIF(TRIM(JSON_VALUE(raw_json, '$.account_name')), ''),
        NULLIF(TRIM(JSON_VALUE(raw_json, '$.company_name')), ''),
        NULLIF(TRIM(JSON_VALUE(raw_json, '$.deal_name')), ''),
        ''
      ) AS account_name,
      COALESCE(
        SAFE_CAST(JSON_VALUE(raw_json, '$.deal_created_at') AS TIMESTAMP),
        SAFE_CAST(JSON_VALUE(raw_json, '$.createdate') AS TIMESTAMP)
      ) AS deal_created_at,
      COALESCE(SAFE_CAST(JSON_VALUE(raw_json, '$.is_closed_won') AS BOOL), FALSE) AS is_closed_won
    FROM hubspot_deal_raw
  )
  WHERE company_id <> '' AND is_closed_won
  GROUP BY company_id
),
monthly_facts AS (
  SELECT
    CAST(period_date AS DATE) AS month_start,
    CAST(customer_key AS STRING) AS customer_key,
    CAST(customer_label AS STRING) AS customer_label,
    CAST(source AS STRING) AS source,
    CAST(segment AS STRING) AS motion,
    CAST(plan AS STRING) AS plan,
    CAST(arr_end AS NUMERIC) AS arr,
    CAST(mrr_end AS NUMERIC) AS mrr,
    COALESCE(CAST(sales_assist AS BOOL), FALSE) AS sales_assist,
    COALESCE(CAST(desk_early_access AS BOOL), FALSE) AS desk_early_access
  FROM ${refs.factsRef}
  WHERE grain = 'monthly'
),
fact_customers AS (
  SELECT
    customer_key,
    ANY_VALUE(customer_label) AS customer_label,
    ANY_VALUE(source) AS source,
    MIN(month_start) AS first_fact_month,
    CASE WHEN ANY_VALUE(source) = 'hubspot_account'
      THEN REGEXP_EXTRACT(customer_key, r'(\\d+)$')
      ELSE ''
    END AS hubspot_company_id,
    CASE WHEN ANY_VALUE(source) = 'stripe_only_customer'
      THEN LOWER(REGEXP_REPLACE(customer_key, r'^stripe:', ''))
      ELSE ''
    END AS stripe_identity
  FROM monthly_facts
  GROUP BY customer_key
),
stripe_fact_match AS (
  SELECT
    d.customer_id,
    MIN(f.customer_key) AS customer_key
  FROM stripe_directory d
  JOIN fact_customers f
    ON f.source = 'stripe_only_customer'
    AND f.stripe_identity IN (LOWER(d.customer_id), d.email)
  GROUP BY d.customer_id
),
hubspot_fact_match AS (
  SELECT
    d.customer_id,
    MIN(COALESCE(f.customer_key, CONCAT('hubspot:', h.company_id))) AS customer_key
  FROM stripe_directory d
  JOIN hubspot_accounts h
    ON d.workspace_id <> '' AND d.workspace_id IN UNNEST(h.workspace_ids)
  LEFT JOIN fact_customers f
    ON f.source = 'hubspot_account' AND f.hubspot_company_id = h.company_id
  GROUP BY d.customer_id
),
stripe_assignment AS (
  SELECT
    d.*,
    COALESCE(h.customer_key, s.customer_key, CONCAT('stripe:', d.customer_id)) AS customer_key
  FROM stripe_directory d
  LEFT JOIN hubspot_fact_match h USING (customer_id)
  LEFT JOIN stripe_fact_match s USING (customer_id)
),
stripe_dimensions AS (
  SELECT
    customer_key,
    ARRAY_AGG(DISTINCT customer_id ORDER BY customer_id) AS stripe_customer_ids,
    ARRAY_AGG(DISTINCT NULLIF(workspace_id, '') IGNORE NULLS ORDER BY NULLIF(workspace_id, '')) AS workspace_ids,
    ARRAY_AGG(customer_id ORDER BY IF(customer_created_at IS NULL, 1, 0), customer_created_at, customer_id LIMIT 1)[OFFSET(0)] AS primary_customer_id,
    ARRAY_AGG(NULLIF(email, '') IGNORE NULLS ORDER BY IF(customer_created_at IS NULL, 1, 0), customer_created_at, email LIMIT 1)[SAFE_OFFSET(0)] AS email,
    ARRAY_AGG(NULLIF(customer_name, '') IGNORE NULLS ORDER BY IF(customer_created_at IS NULL, 1, 0), customer_created_at, customer_name LIMIT 1)[SAFE_OFFSET(0)] AS customer_name,
    MIN(DATE(customer_created_at)) AS signup_date
  FROM stripe_assignment
  GROUP BY customer_key
),
logical_customers AS (
  SELECT
    f.customer_key,
    f.source,
    COALESCE(NULLIF(f.customer_label, ''), NULLIF(sd.customer_name, ''), NULLIF(sd.email, ''), f.customer_key) AS customer_name,
    COALESCE(sd.primary_customer_id, '') AS customer_id,
    COALESCE(sd.stripe_customer_ids, ARRAY<STRING>[]) AS stripe_customer_ids,
    COALESCE(sd.workspace_ids[SAFE_OFFSET(0)], h.workspace_ids[SAFE_OFFSET(0)], '') AS workspace_id,
    ARRAY(
      SELECT DISTINCT workspace_id
      FROM UNNEST(ARRAY_CONCAT(COALESCE(sd.workspace_ids, ARRAY<STRING>[]), COALESCE(h.workspace_ids, ARRAY<STRING>[]))) AS workspace_id
      WHERE workspace_id <> ''
      ORDER BY workspace_id
    ) AS workspace_ids,
    COALESCE(h.deployment_type, '(blank)') AS deployment_type,
    COALESCE(h.deployment_types, ARRAY<STRING>['(blank)']) AS deployment_types,
    COALESCE(sd.signup_date, DATE(h.first_deal_date), f.first_fact_month) AS signup_date,
    COALESCE(sd.email, '') AS email,
    f.hubspot_company_id,
    f.first_fact_month
  FROM fact_customers f
  LEFT JOIN stripe_dimensions sd USING (customer_key)
  LEFT JOIN hubspot_accounts h ON h.company_id = f.hubspot_company_id

  UNION ALL

  SELECT
    sd.customer_key,
    'stripe_only_customer' AS source,
    COALESCE(NULLIF(sd.customer_name, ''), NULLIF(sd.email, ''), sd.primary_customer_id) AS customer_name,
    sd.primary_customer_id AS customer_id,
    sd.stripe_customer_ids,
    COALESCE(sd.workspace_ids[SAFE_OFFSET(0)], '') AS workspace_id,
    sd.workspace_ids,
    '(blank)' AS deployment_type,
    ARRAY<STRING>['(blank)'] AS deployment_types,
    sd.signup_date,
    COALESCE(sd.email, '') AS email,
    '' AS hubspot_company_id,
    sd.signup_date AS first_fact_month
  FROM stripe_dimensions sd
  LEFT JOIN fact_customers f USING (customer_key)
  WHERE f.customer_key IS NULL AND NOT STARTS_WITH(sd.customer_key, 'hubspot:')

  UNION ALL

  SELECT
    CONCAT('hubspot:', h.company_id) AS customer_key,
    'hubspot_account' AS source,
    COALESCE(NULLIF(h.account_name, ''), CONCAT('HubSpot company ', h.company_id)) AS customer_name,
    COALESCE(sd.primary_customer_id, '') AS customer_id,
    COALESCE(sd.stripe_customer_ids, ARRAY<STRING>[]) AS stripe_customer_ids,
    COALESCE(sd.workspace_ids[SAFE_OFFSET(0)], h.workspace_ids[SAFE_OFFSET(0)], '') AS workspace_id,
    ARRAY(
      SELECT DISTINCT workspace_id
      FROM UNNEST(ARRAY_CONCAT(COALESCE(sd.workspace_ids, ARRAY<STRING>[]), COALESCE(h.workspace_ids, ARRAY<STRING>[]))) AS workspace_id
      WHERE workspace_id <> ''
      ORDER BY workspace_id
    ) AS workspace_ids,
    COALESCE(h.deployment_type, '(blank)') AS deployment_type,
    COALESCE(h.deployment_types, ARRAY<STRING>['(blank)']) AS deployment_types,
    COALESCE(sd.signup_date, DATE(h.first_deal_date)) AS signup_date,
    COALESCE(sd.email, '') AS email,
    h.company_id AS hubspot_company_id,
    DATE(h.first_deal_date) AS first_fact_month
  FROM hubspot_accounts h
  LEFT JOIN fact_customers f
    ON f.source = 'hubspot_account' AND f.hubspot_company_id = h.company_id
  LEFT JOIN stripe_dimensions sd ON sd.customer_key = CONCAT('hubspot:', h.company_id)
  WHERE f.customer_key IS NULL
),
customer_month_spine AS (
  SELECT c.*, month_start
  FROM logical_customers c
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(
    GREATEST(
      DATE(@history_start),
      DATE_TRUNC(COALESCE(LEAST(c.signup_date, c.first_fact_month), c.signup_date, c.first_fact_month, CURRENT_DATE()), MONTH)
    ),
    DATE_TRUNC(CURRENT_DATE(), MONTH),
    INTERVAL 1 MONTH
  )) AS month_start
),
product_raw AS (
  SELECT TO_JSON_STRING(p) AS raw_json FROM ${refs.productsRef} p
),
products AS (
  SELECT
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.id')), ''), '') AS product_id,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.name')), ''), '')) AS product_name,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.description')), ''), '')) AS product_description
  FROM product_raw
  GROUP BY product_id
),
price_raw AS (
  SELECT TO_JSON_STRING(p) AS raw_json FROM ${refs.pricesRef} p
),
prices AS (
  SELECT
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.id')), ''), '') AS price_id,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.nickname')), ''), '')) AS price_nickname,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.lookup_key')), ''), '')) AS lookup_key,
    MAX(COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.metadata.plan_version')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.metadata.version')), ''),
      ''
    )) AS metadata_version,
    MAX(LOWER(COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.recurring.interval')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.recurring_interval')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.interval')), ''),
      ''
    ))) AS recurring_interval,
    MAX(COALESCE(
      SAFE_CAST(JSON_VALUE(raw_json, '$.recurring.interval_count') AS INT64),
      SAFE_CAST(JSON_VALUE(raw_json, '$.recurring_interval_count') AS INT64),
      SAFE_CAST(JSON_VALUE(raw_json, '$.interval_count') AS INT64),
      1
    )) AS interval_count
  FROM price_raw
  GROUP BY price_id
),
event_raw AS (
  SELECT TO_JSON_STRING(e) AS raw_json FROM ${refs.eventsRef} e
),
events_parsed AS (
  SELECT
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.customer_id')), ''), '') AS customer_id,
    CASE
      WHEN REGEXP_CONTAINS(COALESCE(JSON_VALUE(raw_json, '$.event_timestamp'), ''), r'^\\d{13,}$')
        THEN TIMESTAMP_MILLIS(SAFE_CAST(JSON_VALUE(raw_json, '$.event_timestamp') AS INT64))
      WHEN REGEXP_CONTAINS(COALESCE(JSON_VALUE(raw_json, '$.event_timestamp'), ''), r'^\\d{10}$')
        THEN TIMESTAMP_SECONDS(SAFE_CAST(JSON_VALUE(raw_json, '$.event_timestamp') AS INT64))
      ELSE SAFE_CAST(JSON_VALUE(raw_json, '$.event_timestamp') AS TIMESTAMP)
    END AS event_timestamp,
    LOWER(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.currency')), ''), '')) AS currency,
    CAST(COALESCE(SAFE_CAST(JSON_VALUE(raw_json, '$.mrr_change') AS FLOAT64), 0) AS FLOAT64) / 100.0 AS mrr_change,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price')), ''),
      ''
    ) AS price_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product')), ''),
      ''
    ) AS product_id,
    LOWER(CONCAT(
      ' ', COALESCE(JSON_VALUE(raw_json, '$.price_nickname'), ''),
      ' ', COALESCE(JSON_VALUE(raw_json, '$.price_description'), ''),
      ' ', COALESCE(JSON_VALUE(raw_json, '$.price_name'), ''),
      ' ', COALESCE(JSON_VALUE(raw_json, '$.product_name'), ''), ' '
    )) AS event_hints
  FROM event_raw
),
events_enriched AS (
  SELECT
    a.customer_key,
    e.event_timestamp,
    e.mrr_change,
    LOWER(CONCAT(
      e.event_hints,
      ' ', COALESCE(pr.price_nickname, ''),
      ' ', COALESCE(pr.lookup_key, ''),
      ' ', COALESCE(pr.metadata_version, ''),
      ' ', COALESCE(p.product_name, ''),
      ' ', COALESCE(p.product_description, ''), ' '
    )) AS plan_hints,
    e.product_id,
    COALESCE(pr.recurring_interval, '') AS recurring_interval,
    COALESCE(pr.interval_count, 1) AS interval_count
  FROM events_parsed e
  JOIN stripe_assignment a USING (customer_id)
  LEFT JOIN prices pr USING (price_id)
  LEFT JOIN products p USING (product_id)
  WHERE e.event_timestamp IS NOT NULL AND e.currency = @target_currency
),
classified_events AS (
  SELECT
    *,
    CASE
      WHEN LOWER(product_id) = 'prod_m9gpcuhm0q9uzg' THEN 'free'
      WHEN LOWER(product_id) = 'prod_pbflquwvpscoaw' THEN 'pay_as_you_go'
      WHEN REGEXP_CONTAINS(plan_hints, r'enterprise') THEN 'enterprise'
      WHEN REGEXP_CONTAINS(plan_hints, r'managed') THEN 'managed'
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z])team([^a-z]|$)') THEN 'team'
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z])plus([^a-z]|$)') THEN 'plus'
      WHEN REGEXP_CONTAINS(plan_hints, r'pay\\s*as\\s*you\\s*go|payg|metered|usage|token') THEN 'pay_as_you_go'
      ELSE 'other'
    END AS plan_family,
    CASE
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z0-9])v4([^a-z0-9]|$)') THEN 'v4'
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z0-9])v3([^a-z0-9]|$)') THEN 'v3'
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z0-9])v2([^a-z0-9]|$)') THEN 'v2'
      ELSE 'unknown'
    END AS plan_version,
    CASE
      WHEN recurring_interval = 'year' AND interval_count = 1 THEN 'annual'
      WHEN recurring_interval = 'month' AND interval_count = 12 THEN 'annual'
      WHEN recurring_interval = 'month' AND interval_count = 6 THEN 'semiannual'
      WHEN recurring_interval = 'month' AND interval_count = 3 THEN 'quarterly'
      WHEN recurring_interval = 'month' AND interval_count = 1 THEN 'monthly'
      WHEN recurring_interval <> '' THEN CONCAT(recurring_interval, '_', CAST(interval_count AS STRING))
      WHEN REGEXP_CONTAINS(plan_hints, r'annual|yearly') THEN 'annual'
      WHEN REGEXP_CONTAINS(plan_hints, r'monthly') THEN 'monthly'
      ELSE 'unknown'
    END AS billing_interval,
    NOT REGEXP_CONTAINS(plan_hints, r'add\\s*ons?|ai\\s+tokens?|conversation\\s+sessions?|web\\s+search\\s+and\\s+crawl') AS is_primary_plan
  FROM events_enriched
),
event_monthly_delta AS (
  SELECT
    customer_key,
    plan_family,
    plan_version,
    billing_interval,
    is_primary_plan,
    DATE_TRUNC(DATE(event_timestamp), MONTH) AS event_month,
    SUM(mrr_change) AS mrr_delta
  FROM classified_events
  GROUP BY customer_key, plan_family, plan_version, billing_interval, is_primary_plan, event_month
),
plan_signatures AS (
  SELECT
    customer_key,
    plan_family,
    plan_version,
    billing_interval,
    is_primary_plan,
    MIN(event_month) AS first_event_month
  FROM event_monthly_delta
  GROUP BY customer_key, plan_family, plan_version, billing_interval, is_primary_plan
),
plan_month_spine AS (
  SELECT
    s.customer_key,
    s.plan_family,
    s.plan_version,
    s.billing_interval,
    s.is_primary_plan,
    cm.month_start
  FROM plan_signatures s
  JOIN customer_month_spine cm USING (customer_key)
  WHERE cm.month_start >= s.first_event_month
),
plan_balances AS (
  SELECT
    p.customer_key,
    p.month_start,
    p.plan_family,
    p.plan_version,
    p.billing_interval,
    p.is_primary_plan,
    SUM(COALESCE(d.mrr_delta, 0)) OVER (
      PARTITION BY p.customer_key, p.plan_family, p.plan_version, p.billing_interval, p.is_primary_plan
      ORDER BY p.month_start ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS mrr
  FROM plan_month_spine p
  LEFT JOIN event_monthly_delta d
    ON d.customer_key = p.customer_key
    AND d.plan_family = p.plan_family
    AND d.plan_version = p.plan_version
    AND d.billing_interval = p.billing_interval
    AND d.is_primary_plan = p.is_primary_plan
    AND d.event_month = p.month_start
),
stripe_arr_by_month AS (
  SELECT customer_key, month_start, ROUND(SUM(mrr) * 12, 2) AS arr
  FROM plan_balances
  GROUP BY customer_key, month_start
),
active_primary_plans AS (
  SELECT
    customer_key,
    month_start,
    plan_family,
    plan_version,
    billing_interval,
    mrr,
    CONCAT(
      IF(plan_version = 'unknown', '', CONCAT(plan_version, ' ')),
      REPLACE(plan_family, '_', ' '),
      IF(billing_interval = 'unknown', '', CONCAT(' ', billing_interval))
    ) AS pricing_plan,
    CASE plan_family
      WHEN 'enterprise' THEN 6 WHEN 'managed' THEN 5 WHEN 'team' THEN 4
      WHEN 'plus' THEN 3 WHEN 'pay_as_you_go' THEN 2 WHEN 'free' THEN 1 ELSE 0
    END AS plan_rank,
    CASE plan_version WHEN 'v4' THEN 4 WHEN 'v3' THEN 3 WHEN 'v2' THEN 2 ELSE 0 END AS version_rank
  FROM plan_balances
  WHERE mrr > 0.000000001 AND is_primary_plan AND plan_family <> 'other'
),
primary_plan AS (
  SELECT * EXCEPT(mrr, plan_rank, version_rank)
  FROM active_primary_plans
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY customer_key, month_start
    ORDER BY plan_rank DESC, version_rank DESC, mrr DESC, pricing_plan
  ) = 1
),
active_plan_list AS (
  SELECT customer_key, month_start, STRING_AGG(DISTINCT pricing_plan, ' | ' ORDER BY pricing_plan) AS active_pricing_plans
  FROM active_primary_plans
  GROUP BY customer_key, month_start
),
final_rows AS (
  SELECT
    CONCAT(c.customer_key, ':', FORMAT_DATE('%Y-%m', c.month_start)) AS customer_month_key,
    c.month_start,
    FORMAT_DATE('%Y-%m', c.month_start) AS month_key,
    c.customer_key,
    c.customer_id,
    c.stripe_customer_ids,
    c.workspace_id,
    c.workspace_ids,
    c.deployment_type,
    c.deployment_types,
    c.hubspot_company_id,
    c.customer_name,
    c.email,
    c.signup_date,
    c.source,
    CASE
      WHEN f.motion = 'sales_assist' THEN 'sales_assist'
      WHEN f.motion = 'salesled' THEN 'salesled'
      WHEN f.motion = 'selfserve' THEN 'selfserve'
      WHEN c.source = 'hubspot_account' THEN 'salesled'
      ELSE 'selfserve'
    END AS motion,
    COALESCE(p.pricing_plan, NULLIF(f.plan, ''), IF(COALESCE(f.arr, sa.arr, 0) > 0, 'pay as you go', 'free')) AS pricing_plan,
    COALESCE(p.plan_family, NULLIF(f.plan, ''), IF(COALESCE(f.arr, sa.arr, 0) > 0, 'pay_as_you_go', 'free')) AS plan_family,
    COALESCE(p.plan_version, 'unknown') AS plan_version,
    COALESCE(p.billing_interval, 'unknown') AS billing_interval,
    COALESCE(ap.active_pricing_plans, COALESCE(p.pricing_plan, NULLIF(f.plan, ''), 'free')) AS active_pricing_plans,
    CAST(ROUND(COALESCE(f.arr, sa.arr, 0), 2) AS NUMERIC) AS arr,
    CAST(ROUND(COALESCE(f.mrr, SAFE_DIVIDE(sa.arr, 12), 0), 2) AS NUMERIC) AS mrr,
    COALESCE(f.sales_assist, FALSE) AS sales_assist,
    COALESCE(f.desk_early_access, FALSE) AS desk_early_access,
    COALESCE(f.arr, sa.arr, 0) > 0.000000001 AS is_active,
    CURRENT_TIMESTAMP() AS updated_at
  FROM customer_month_spine c
  LEFT JOIN monthly_facts f
    ON f.customer_key = c.customer_key AND f.month_start = c.month_start
  LEFT JOIN stripe_arr_by_month sa
    ON sa.customer_key = c.customer_key AND sa.month_start = c.month_start
  LEFT JOIN primary_plan p
    ON p.customer_key = c.customer_key AND p.month_start = c.month_start
  LEFT JOIN active_plan_list ap
    ON ap.customer_key = c.customer_key AND ap.month_start = c.month_start
)
SELECT * FROM final_rows
`;
}

export async function startCustomerMonthlyHistoryRefresh(): Promise<CustomerMonthlyHistoryStartedResult> {
  const { startBigQuerySqlStatement } = await import("@/lib/stripeBigquery");
  const refs = config();
  const historyStart = String(process.env.CUSTOMER_MONTHLY_HISTORY_START || "2015-01-01").trim();
  const targetCurrency = String(process.env.FX_TARGET_CURRENCY || "USD").trim().toLowerCase() || "usd";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(historyStart)) {
    throw new Error("CUSTOMER_MONTHLY_HISTORY_START must be YYYY-MM-DD");
  }
  const job = await startBigQuerySqlStatement(
    customerMonthlyHistorySql(),
    [
      { name: "history_start", type: "STRING", value: historyStart },
      { name: "target_currency", type: "STRING", value: targetCurrency },
    ],
    { profile: PROFILE },
  );
  return {
    table: `${refs.project}.${refs.dataset}.${refs.table}`,
    historyStart,
    ...job,
    startedAtUtc: new Date().toISOString(),
  };
}
