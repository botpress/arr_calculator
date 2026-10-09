import assert from "node:assert/strict";
import test from "node:test";
import { customerMonthlyHistorySql } from "../src/lib/customerMonthlyHistory.ts";

test("builds a partitioned customer-month history from website, Stripe, and HubSpot sources", () => {
  const sql = customerMonthlyHistorySql();

  assert.match(sql, /PARTITION BY month_start/);
  assert.match(sql, /vw_fact_customer_arr_periodic_current/);
  assert.match(sql, /subscription_item_change_events_v2_beta/);
  assert.match(sql, /stg_hubspot_deals/);
  assert.match(sql, /is_closed_won/);
  assert.match(sql, /AS deployment_types/);
  assert.match(sql, /GENERATE_DATE_ARRAY/);
  assert.match(sql, /@history_start/);
  assert.match(sql, /@target_currency/);
  assert.match(sql, /'sales_assist'/);
  assert.match(sql, /'salesled'/);
  assert.match(sql, /'selfserve'/);
  assert.match(sql, /AS pricing_plan/);
  assert.match(sql, /AS arr/);
});

test("rejects unsafe output identifiers", () => {
  const previous = process.env.CUSTOMER_MONTHLY_HISTORY_TABLE;
  process.env.CUSTOMER_MONTHLY_HISTORY_TABLE = "history`; DROP TABLE customers";
  try {
    assert.throws(() => customerMonthlyHistorySql(), /Invalid customer history table/);
  } finally {
    if (previous === undefined) delete process.env.CUSTOMER_MONTHLY_HISTORY_TABLE;
    else process.env.CUSTOMER_MONTHLY_HISTORY_TABLE = previous;
  }
});

test("accepts an explicit fully-qualified Stripe event source", () => {
  const previous = process.env.BIGQUERY_STRIPE_ARR_CORRECT_MRR_CHANGE_TABLE;
  process.env.BIGQUERY_STRIPE_ARR_CORRECT_MRR_CHANGE_TABLE = "billing_prod.stripe_curated.mrr_events";
  try {
    assert.match(customerMonthlyHistorySql(), /`billing_prod\.stripe_curated\.mrr_events`/);
  } finally {
    if (previous === undefined) delete process.env.BIGQUERY_STRIPE_ARR_CORRECT_MRR_CHANGE_TABLE;
    else process.env.BIGQUERY_STRIPE_ARR_CORRECT_MRR_CHANGE_TABLE = previous;
  }
});
