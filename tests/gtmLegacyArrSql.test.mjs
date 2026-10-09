import assert from "node:assert/strict";
import test from "node:test";

import { buildGtmLegacyArrCtes } from "../src/lib/gtmLegacyArrSql.ts";

function sql() {
  return buildGtmLegacyArrCtes({
    tables: {
      deals: "deals_table",
      dealLineItems: "deal_line_items_table",
      lineItems: "line_items_table",
      fxRates: "fx_rates_table",
      companies: "companies_table",
    },
    requestedPeriodsSql: "SELECT period_start, period_end FROM periods_table",
  });
}

test("legacy GTM ARR includes every non-cloud closed-won deployment", () => {
  const query = sql();
  assert.match(query, /COALESCE\(d\.is_closed_won, FALSE\)/);
  assert.match(query, /LOWER\(TRIM\(COALESCE\(d\.deployment_type, ''\)\)\) <> 'cloud'/);
});

test("legacy GTM ARR follows the HubSpot CARR line-item rules", () => {
  const query = sql();
  assert.match(query, /legacy_desk_early_access_deals/);
  assert.match(query, /DATE_SUB\(i\.explicit_end, INTERVAL 1 DAY\)/);
  assert.match(query, /i\.amount AS FLOAT64/);
  assert.match(query, /recurring_billing_frequency/);
  assert.match(query, /fx\.monthly_average_rate/);
  assert.match(query, /li\.close_date < li\.earliest_recurring_start/);
});

test("legacy GTM ARR is attributed to sales-led and exposes a reconciling weekly bridge", () => {
  const query = sql();
  assert.match(query, /'sales_led' AS motion/);
  assert.match(query, /c\.beginning_arr AS previous_segment_carr/);
  assert.match(query, /c\.ending_arr AS current_segment_carr/);
  assert.match(query, /legacy_arr_waterfall AS/);
});
