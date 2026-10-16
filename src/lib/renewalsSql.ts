// SQL for the Renewals page. Kept free of imports so it can be inspected and run on its own.
//
// Contract rules mirror carrCtes in accountManagementBigquery.ts (active_start, explicit_end,
// inclusive active_end, annualized line ARR). Differences:
// - FX falls back to the latest available monthly rate for the currency when the close-month
//   rate is missing (int_fx_monthly_rates has gaps, e.g. EUR after 2026-01).
// - Native (pre-FX) annualized amounts are kept so non-USD contracts can show their own currency.
//
// Parameters: @as_of (YYYY-MM-DD), @horizon_days (INT64), @included_stage, @transactional_pipeline,
// @target_currency.

export type RenewalsSqlTables = {
  deals: string;
  dealLineItems: string;
  lineItems: string;
  fxRates: string;
  stagedCompanies: string;
  stagedOwners: string;
  rawCompanies: string;
  rawOwners: string;
};

const EXISTING_BUSINESS = `REGEXP_REPLACE(LOWER(COALESCE(d.dealtype, '')), r'[^a-z]', '') = 'existingbusiness'`;

export function buildRenewalsSql(t: RenewalsSqlTables) {
  return `
WITH desk_deals AS (
  SELECT DISTINCT dli.deal_id
  FROM ${t.dealLineItems} dli
  JOIN ${t.lineItems} li USING (line_item_id)
  WHERE STRPOS(LOWER(CONCAT(COALESCE(li.name, ''), ' ', COALESCE(li.description, ''), ' ', COALESCE(li.sku, ''))), 'desk - early access') > 0
     OR STRPOS(LOWER(CONCAT(COALESCE(li.name, ''), ' ', COALESCE(li.description, ''), ' ', COALESCE(li.sku, ''))), 'desk early access') > 0
),
fx AS (
  SELECT rate_month, from_currency, monthly_average_rate
  FROM ${t.fxRates}
  WHERE to_currency = @target_currency
  QUALIFY ROW_NUMBER() OVER (PARTITION BY rate_month, from_currency, to_currency ORDER BY captured_at DESC) = 1
),
fx_latest AS (
  SELECT from_currency, rate_month, monthly_average_rate
  FROM fx
  QUALIFY ROW_NUMBER() OVER (PARTITION BY from_currency ORDER BY rate_month DESC) = 1
),
inputs AS (
  SELECT
    d.deal_id,
    d.deal_name,
    d.owner_id,
    NULLIF(TRIM(d.primary_company_id), '') AS company_id,
    IF(d.pipeline_id = @transactional_pipeline, 'Cloud', NULLIF(TRIM(d.deployment_type), '')) AS deployment_type,
    CASE
      WHEN ${EXISTING_BUSINESS} AND DATE(d.close_date) IS NOT NULL
      THEN GREATEST(COALESCE(li.recurring_billing_start_date, li.billing_period_start_date), DATE(d.close_date))
      ELSE COALESCE(li.recurring_billing_start_date, li.billing_period_start_date)
    END AS active_start,
    COALESCE(li.recurring_billing_end_date, li.billing_period_end_date) AS explicit_end,
    li.term_in_months,
    li.recurring_billing_frequency,
    li.amount,
    COALESCE(NULLIF(UPPER(TRIM(d.currency)), ''), 'USD') AS currency,
    DATE_TRUNC(COALESCE(DATE(d.close_date), CURRENT_DATE()), MONTH) AS fx_month
  FROM ${t.deals} d
  JOIN ${t.dealLineItems} dli USING (deal_id)
  JOIN ${t.lineItems} li USING (line_item_id)
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
    ROUND(CAST(i.amount AS FLOAT64) * CASE
      WHEN i.explicit_end IS NULL AND COALESCE(i.term_in_months, 0) = 0 THEN 0
      WHEN STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'one') > 0 THEN 0
      WHEN LOWER(COALESCE(i.recurring_billing_frequency, '')) = 'per_six_months' OR REGEXP_CONTAINS(LOWER(COALESCE(i.recurring_billing_frequency, '')), r'six.*month') THEN 2
      WHEN LOWER(COALESCE(i.recurring_billing_frequency, '')) = 'per_quarter' OR STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'quarter') > 0 OR REGEXP_CONTAINS(LOWER(COALESCE(i.recurring_billing_frequency, '')), r'three.*month') THEN 4
      WHEN STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'semi') > 0 OR STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'half') > 0 THEN 2
      WHEN STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'month') > 0 THEN 12
      WHEN STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'year') > 0 OR STRPOS(LOWER(COALESCE(i.recurring_billing_frequency, '')), 'annual') > 0 THEN 1
      ELSE 0
    END, 2) AS native_arr,
    IF(i.currency = @target_currency, 1, COALESCE(fx_month.monthly_average_rate, fx_latest.monthly_average_rate)) AS fx_rate,
    i.currency <> @target_currency AND fx_month.monthly_average_rate IS NULL AND fx_latest.monthly_average_rate IS NOT NULL AS fx_fallback
  FROM inputs i
  LEFT JOIN fx fx_month ON fx_month.rate_month = i.fx_month AND fx_month.from_currency = i.currency
  LEFT JOIN fx_latest ON fx_latest.from_currency = i.currency
),
recurring AS (
  SELECT * FROM valued
  WHERE active_start IS NOT NULL AND active_end IS NOT NULL AND native_arr > 0
),
contract_lines AS (
  -- The contract renews when its last recurring line ends. Lines that ended earlier
  -- (ramp phases, short-term add-ons) have already lapsed, so only lines ending on that
  -- final day are summed.
  SELECT r.*, MAX(r.active_end) OVER (PARTITION BY r.deal_id) AS contract_active_end
  FROM recurring r
),
contracts AS (
  SELECT
    deal_id,
    ANY_VALUE(deal_name) AS deal_name,
    ANY_VALUE(owner_id) AS owner_id,
    ANY_VALUE(company_id) AS company_id,
    ANY_VALUE(deployment_type) AS deployment_type,
    ANY_VALUE(currency) AS currency,
    MIN(active_start) AS active_start,
    ANY_VALUE(contract_active_end) AS active_end,
    DATE_ADD(ANY_VALUE(contract_active_end), INTERVAL 1 DAY) AS renewal_date,
    ROUND(SUM(native_arr), 2) AS native_arr,
    ROUND(SUM(native_arr * fx_rate), 2) AS arr,
    LOGICAL_OR(fx_rate IS NULL) AS fx_missing,
    LOGICAL_OR(fx_fallback) AS fx_fallback,
    COUNT(*) AS line_count
  FROM contract_lines
  WHERE active_end = contract_active_end
  GROUP BY deal_id
),
due AS (
  SELECT *
  FROM contracts
  WHERE renewal_date BETWEEN DATE(@as_of) AND DATE_ADD(DATE(@as_of), INTERVAL @horizon_days DAY)
),
already_renewed AS (
  -- A later closed-won contract for the same company whose recurring term starts within
  -- 31 days of this contract's renewal date.
  SELECT
    due.deal_id,
    ARRAY_AGG(STRUCT(r.deal_id AS deal_id, r.deal_name AS deal_name, r.active_start AS active_start) ORDER BY r.active_start LIMIT 1)[OFFSET(0)] AS renewal
  FROM due
  JOIN recurring r
    ON r.company_id = due.company_id
   AND r.deal_id <> due.deal_id
   AND r.active_start BETWEEN DATE_SUB(due.renewal_date, INTERVAL 31 DAY) AND DATE_ADD(due.renewal_date, INTERVAL 31 DAY)
   AND r.active_end > due.active_end
  GROUP BY due.deal_id
),
open_existing AS (
  SELECT
    NULLIF(TRIM(d.primary_company_id), '') AS company_id,
    d.deal_id,
    d.deal_name,
    d.dealstage_id,
    DATE(d.close_date) AS close_date
  FROM ${t.deals} d
  WHERE COALESCE(d.is_archived, FALSE) = FALSE
    AND COALESCE(d.is_closed, FALSE) = FALSE
    AND ${EXISTING_BUSINESS}
    AND NULLIF(TRIM(d.primary_company_id), '') IS NOT NULL
),
open_renewal AS (
  SELECT
    company_id,
    ARRAY_AGG(STRUCT(deal_id, deal_name, dealstage_id, close_date) ORDER BY close_date IS NULL, close_date LIMIT 1)[OFFSET(0)] AS deal,
    COUNT(*) AS open_count
  FROM open_existing
  GROUP BY company_id
),
raw_companies AS (
  SELECT
    CAST(id AS STRING) AS company_id,
    properties_name AS company_name,
    NULLIF(TRIM(CAST(properties_csm_owner AS STRING)), '') AS csm_owner_id
  FROM ${t.rawCompanies}
  WHERE COALESCE(archived, FALSE) = FALSE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY _airbyte_extracted_at DESC, updatedAt DESC) = 1
),
raw_owners AS (
  SELECT
    CAST(id AS STRING) AS owner_id,
    COALESCE(NULLIF(TRIM(CONCAT(COALESCE(firstName, ''), ' ', COALESCE(lastName, ''))), ''), NULLIF(TRIM(email), '')) AS owner_name
  FROM ${t.rawOwners}
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY _airbyte_extracted_at DESC, updatedAt DESC) = 1
)
SELECT
  due.deal_id,
  due.deal_name,
  due.company_id,
  COALESCE(NULLIF(TRIM(sc.company_name), ''), NULLIF(TRIM(rc.company_name), ''), due.deal_name) AS company_name,
  CAST(due.renewal_date AS STRING) AS renewal_date,
  CAST(due.active_start AS STRING) AS active_start,
  due.arr,
  due.native_arr,
  due.currency,
  due.fx_missing,
  due.fx_fallback,
  COALESCE(due.deployment_type, '') AS deployment_type,
  COALESCE(rc.csm_owner_id, '') AS csm_owner_id,
  COALESCE(csm.owner_name, '') AS csm_owner_name,
  COALESCE(due.owner_id, '') AS deal_owner_id,
  COALESCE(NULLIF(TRIM(deal_owner.owner_name), ''), NULLIF(TRIM(deal_owner.email), ''), deal_owner_raw.owner_name, '') AS deal_owner_name,
  COALESCE(open_renewal.deal.deal_id, '') AS open_renewal_deal_id,
  COALESCE(open_renewal.deal.deal_name, '') AS open_renewal_deal_name,
  COALESCE(open_renewal.deal.dealstage_id, '') AS open_renewal_stage_id,
  COALESCE(CAST(open_renewal.deal.close_date AS STRING), '') AS open_renewal_close_date,
  COALESCE(open_renewal.open_count, 0) AS open_renewal_count,
  COALESCE(already_renewed.renewal.deal_id, '') AS renewed_by_deal_id,
  COALESCE(already_renewed.renewal.deal_name, '') AS renewed_by_deal_name
FROM due
LEFT JOIN ${t.stagedCompanies} sc ON sc.company_id = due.company_id AND COALESCE(sc.is_archived, FALSE) = FALSE
LEFT JOIN raw_companies rc ON rc.company_id = due.company_id
LEFT JOIN raw_owners csm ON csm.owner_id = rc.csm_owner_id
LEFT JOIN ${t.stagedOwners} deal_owner ON deal_owner.owner_id = due.owner_id
LEFT JOIN raw_owners deal_owner_raw ON deal_owner_raw.owner_id = due.owner_id
LEFT JOIN open_renewal ON open_renewal.company_id = due.company_id
LEFT JOIN already_renewed ON already_renewed.deal_id = due.deal_id
ORDER BY due.renewal_date, due.arr DESC
`;
}
