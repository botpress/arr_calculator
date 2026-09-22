type LegacyArrTables = {
  deals: string;
  dealLineItems: string;
  lineItems: string;
  fxRates: string;
  companies: string;
};

export function buildGtmLegacyArrCtes(args: {
  tables: LegacyArrTables;
  requestedPeriodsSql: string;
}) {
  const { tables } = args;
  return `
legacy_requested_periods AS (
${args.requestedPeriodsSql}
),
legacy_periods AS (
  SELECT period_end
  FROM legacy_requested_periods
  UNION DISTINCT
  SELECT DATE_SUB(MIN(period_end), INTERVAL 7 DAY)
  FROM legacy_requested_periods
),
legacy_desk_early_access_deals AS (
  SELECT DISTINCT dli.deal_id
  FROM ${tables.dealLineItems} dli
  JOIN ${tables.lineItems} li USING (line_item_id)
  WHERE STRPOS(
    LOWER(CONCAT(COALESCE(li.name, ''), ' ', COALESCE(li.description, ''), ' ', COALESCE(li.sku, ''))),
    'desk - early access'
  ) > 0
     OR STRPOS(
       LOWER(CONCAT(COALESCE(li.name, ''), ' ', COALESCE(li.description, ''), ' ', COALESCE(li.sku, ''))),
       'desk early access'
     ) > 0
),
legacy_fx_rates AS (
  SELECT rate_month, from_currency, to_currency, monthly_average_rate
  FROM ${tables.fxRates}
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY rate_month, from_currency, to_currency
    ORDER BY captured_at DESC
  ) = 1
),
legacy_line_item_inputs AS (
  SELECT
    d.deal_id,
    d.deal_name,
    NULLIF(d.primary_company_id, '') AS company_id,
    COALESCE(NULLIF(d.primary_company_id, ''), CONCAT('deal:', d.deal_id)) AS customer_key,
    NULLIF(d.deal_workspace_id, '') AS deal_workspace_id,
    NULLIF(TRIM(d.deployment_type), '') AS deployment_type,
    REGEXP_REPLACE(LOWER(COALESCE(d.dealtype, '')), r'[^a-z]', '') IN ('existingbusiness', 'upsell') AS is_existing_business,
    DATE(d.close_date) AS close_date,
    COALESCE(li.recurring_billing_start_date, li.billing_period_start_date) AS active_start,
    COALESCE(li.recurring_billing_end_date, li.billing_period_end_date) AS explicit_end,
    li.term_in_months,
    li.recurring_billing_frequency,
    li.amount,
    COALESCE(NULLIF(UPPER(TRIM(d.currency)), ''), 'USD') AS currency,
    DATE_TRUNC(COALESCE(DATE(d.close_date), CURRENT_DATE()), MONTH) AS fx_month
  FROM ${tables.deals} d
  JOIN ${tables.dealLineItems} dli USING (deal_id)
  JOIN ${tables.lineItems} li USING (line_item_id)
  LEFT JOIN legacy_desk_early_access_deals eap USING (deal_id)
  WHERE COALESCE(d.is_archived, FALSE) = FALSE
    AND COALESCE(d.is_closed_won, FALSE)
    AND LOWER(TRIM(COALESCE(d.deployment_type, ''))) <> 'cloud'
    AND eap.deal_id IS NULL
),
legacy_valued_line_items AS (
  SELECT
    i.*,
    CASE
      WHEN i.explicit_end IS NOT NULL THEN DATE_SUB(i.explicit_end, INTERVAL 1 DAY)
      WHEN COALESCE(i.term_in_months, 0) <> 0
        THEN DATE_SUB(DATE_ADD(i.active_start, INTERVAL CAST(i.term_in_months AS INT64) MONTH), INTERVAL 1 DAY)
      ELSE NULL
    END AS active_end,
    ROUND(
      ROUND(CAST(i.amount AS FLOAT64) * CASE
        WHEN STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'one') > 0 THEN 0
        WHEN LOWER(COALESCE(i.recurring_billing_frequency, '')) = 'per_six_months'
          OR REGEXP_CONTAINS(LOWER(COALESCE(i.recurring_billing_frequency, '')), r'six.*month') THEN 2
        WHEN LOWER(COALESCE(i.recurring_billing_frequency, '')) = 'per_quarter'
          OR STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'quarter') > 0
          OR REGEXP_CONTAINS(LOWER(COALESCE(i.recurring_billing_frequency, '')), r'three.*month') THEN 4
        WHEN STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'semi') > 0
          OR STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'half') > 0 THEN 2
        WHEN STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'month') > 0 THEN 12
        WHEN STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'year') > 0
          OR STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'annual') > 0 THEN 1
        ELSE 0
      END, 2) * CAST(COALESCE(
        fx.monthly_average_rate,
        IF(i.currency = @target_currency, 1, 0)
      ) AS FLOAT64),
      2
    ) AS line_arr
  FROM legacy_line_item_inputs i
  LEFT JOIN legacy_fx_rates fx
    ON fx.rate_month = i.fx_month
   AND fx.from_currency = i.currency
   AND fx.to_currency = @target_currency
),
legacy_line_items AS (
  SELECT
    i.*,
    MIN(IF(i.active_start IS NOT NULL AND i.active_end IS NOT NULL AND i.line_arr > 0, i.active_start, NULL))
      OVER (PARTITION BY i.deal_id) AS earliest_recurring_start
  FROM legacy_valued_line_items i
),
legacy_customer_metadata AS (
  SELECT
    customer_key,
    ARRAY_AGG(company_id IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS company_id,
    ARRAY_AGG(NULLIF(deal_name, '') IGNORE NULLS ORDER BY close_date DESC LIMIT 1)[SAFE_OFFSET(0)] AS latest_deal_name,
    STRING_AGG(DISTINCT deal_workspace_id, ', ') AS deal_workspace_ids,
    STRING_AGG(DISTINCT deployment_type, ', ') AS deployment_types
  FROM legacy_line_items
  GROUP BY customer_key
),
legacy_customer_periods AS (
  SELECT
    DATE_SUB(p.period_end, INTERVAL 6 DAY) AS period_start,
    p.period_end,
    c.customer_key,
    c.company_id,
    COALESCE(NULLIF(company.company_name, ''), c.latest_deal_name, c.customer_key) AS customer_label,
    COALESCE(NULLIF(company.company_workspace_id, ''), c.deal_workspace_ids) AS company_workspace_id,
    c.deployment_types,
    ROUND(SUM(IF(
      li.active_start IS NOT NULL
      AND li.active_end IS NOT NULL
      AND li.line_arr > 0
      AND (
        p.period_end BETWEEN li.active_start AND li.active_end
        OR (
          NOT li.is_existing_business
          AND li.close_date < li.earliest_recurring_start
          AND li.active_start = li.earliest_recurring_start
          AND p.period_end BETWEEN li.close_date AND li.earliest_recurring_start
        )
      ),
      li.line_arr,
      0
    )), 2) AS ending_arr
  FROM legacy_periods p
  CROSS JOIN legacy_customer_metadata c
  LEFT JOIN legacy_line_items li USING (customer_key)
  LEFT JOIN ${tables.companies} company
    ON company.company_id = c.company_id
   AND COALESCE(company.is_archived, FALSE) = FALSE
  WHERE p.period_end IS NOT NULL
  GROUP BY
    p.period_end,
    c.customer_key,
    c.company_id,
    customer_label,
    company_workspace_id,
    c.deployment_types
),
legacy_customer_changes AS (
  SELECT
    *,
    COALESCE(LAG(ending_arr) OVER (PARTITION BY customer_key ORDER BY period_end), 0) AS beginning_arr
  FROM legacy_customer_periods
),
legacy_movements AS (
  SELECT
    c.period_start,
    c.period_end,
    c.customer_key,
    c.customer_label,
    c.customer_label AS company_name,
    c.company_id AS hubspot_company_id,
    c.company_workspace_id,
    'sales_led' AS motion,
    CASE
      WHEN c.beginning_arr = 0 AND c.ending_arr > 0 THEN 'new'
      WHEN c.beginning_arr > 0 AND c.ending_arr = 0 THEN 'churn'
      WHEN c.ending_arr > c.beginning_arr THEN 'expansion'
      WHEN c.ending_arr < c.beginning_arr THEN 'contraction'
      ELSE 'no_change'
    END AS bucket,
    c.beginning_arr AS previous_customer_carr,
    c.ending_arr AS current_customer_carr,
    c.beginning_arr AS previous_segment_carr,
    c.ending_arr AS current_segment_carr,
    IF(c.beginning_arr > 0, CONCAT('Legacy', IF(c.deployment_types IS NULL, '', CONCAT(' (', c.deployment_types, ')'))), NULL)
      AS previous_motion_plans,
    IF(c.ending_arr > 0, CONCAT('Legacy', IF(c.deployment_types IS NULL, '', CONCAT(' (', c.deployment_types, ')'))), NULL)
      AS current_motion_plans,
    TRUE AS is_legacy
  FROM legacy_customer_changes c
  JOIN legacy_requested_periods p USING (period_end)
),
legacy_arr_waterfall AS (
  SELECT
    period_start,
    period_end,
    'sales_led' AS motion,
    ROUND(SUM(previous_segment_carr), 2) AS beginning_arr,
    ROUND(SUM(IF(bucket = 'new', current_segment_carr - previous_segment_carr, 0)), 2) AS new_arr,
    ROUND(SUM(IF(bucket = 'expansion', current_segment_carr - previous_segment_carr, 0)), 2) AS expansion_arr,
    ROUND(SUM(IF(bucket = 'contraction', current_segment_carr - previous_segment_carr, 0)), 2) AS contraction_arr,
    ROUND(SUM(IF(bucket = 'churn', current_segment_carr - previous_segment_carr, 0)), 2) AS churn_arr,
    0 AS transfer_arr,
    ROUND(SUM(current_segment_carr), 2) AS ending_arr
  FROM legacy_movements
  GROUP BY period_start, period_end
)
`;
}
