import assert from "node:assert/strict";
import test from "node:test";
import {
  billingCadenceMonths,
  buildDraftInvoiceLine,
  currentBillingMonth,
  majorAmountToMinor,
  parseBillingMonth,
} from "../src/lib/monthlyDraftInvoiceRules.ts";

function properties(overrides = {}) {
  return {
    hs_recurring_billing_start_date: "2026-01-15",
    hs_term_in_months: "12",
    recurringbillingfrequency: "monthly",
    amount: "100.25",
    name: "Team plan",
    ...overrides,
  };
}

test("normalizes the supported HubSpot billing cadences", () => {
  assert.equal(billingCadenceMonths("monthly"), 1);
  assert.equal(billingCadenceMonths("per_quarter"), 3);
  assert.equal(billingCadenceMonths("per_six_months"), 6);
  assert.equal(billingCadenceMonths("annually"), 12);
  assert.equal(billingCadenceMonths("one_time"), 0);
  assert.equal(billingCadenceMonths("weekly"), null);
});

test("monthly line is due every month and uses the scheduled service period", () => {
  const result = buildDraftInvoiceLine({ lineItemId: "li_1", properties: properties(), billingMonth: "2026-03", currency: "USD" });
  assert.equal(result.line?.amountMinor, 10025);
  assert.equal(new Date((result.line?.periodStart || 0) * 1000).toISOString(), "2026-03-15T00:00:00.000Z");
  assert.equal(new Date((result.line?.periodEnd || 0) * 1000).toISOString(), "2026-04-14T23:59:59.000Z");
});

test("accepts HubSpot date properties returned as epoch milliseconds", () => {
  const result = buildDraftInvoiceLine({
    lineItemId: "li_epoch",
    properties: properties({ hs_recurring_billing_start_date: String(Date.UTC(2026, 0, 15)) }),
    billingMonth: "2026-02",
    currency: "USD",
  });
  assert.equal(new Date((result.line?.periodStart || 0) * 1000).toISOString(), "2026-02-15T00:00:00.000Z");
});

test("keeps end-of-month billing anchored across short months", () => {
  const endOfMonth = properties({ hs_recurring_billing_start_date: "2026-01-31" });
  const february = buildDraftInvoiceLine({ lineItemId: "li_eom", properties: endOfMonth, billingMonth: "2026-02", currency: "USD" });
  assert.equal(new Date((february.line?.periodStart || 0) * 1000).toISOString(), "2026-02-28T00:00:00.000Z");
  assert.equal(new Date((february.line?.periodEnd || 0) * 1000).toISOString(), "2026-03-30T23:59:59.000Z");
});

test("quarterly line is included only in anchor-aligned months", () => {
  const quarterly = properties({ recurringbillingfrequency: "quarterly" });
  assert.ok(buildDraftInvoiceLine({ lineItemId: "li_1", properties: quarterly, billingMonth: "2026-04", currency: "USD" }).line);
  assert.equal(buildDraftInvoiceLine({ lineItemId: "li_1", properties: quarterly, billingMonth: "2026-03", currency: "USD" }).reason, "not_due");
});

test("recurring lines without an end date or term are rejected", () => {
  const result = buildDraftInvoiceLine({
    lineItemId: "li_1",
    properties: properties({ hs_term_in_months: "", hs_recurring_billing_end_date: "" }),
    billingMonth: "2026-01",
    currency: "USD",
  });
  assert.equal(result.reason, "missing_contract_end");
});

test("line is not billed after its contract ends", () => {
  const result = buildDraftInvoiceLine({ lineItemId: "li_1", properties: properties(), billingMonth: "2027-01", currency: "USD" });
  assert.equal(result.reason, "contract_ended");
});

test("uses HubSpot's standard ISO recurring billing period as the contract term", () => {
  const result = buildDraftInvoiceLine({
    lineItemId: "li-standard-period",
    billingMonth: "2026-09",
    currency: "USD",
    properties: properties({
      hs_recurring_billing_start_date: "2026-01-15",
      hs_term_in_months: "",
      hs_recurring_billing_period: "P12M",
    }),
  });
  assert.ok(result.line);
});

test("includes a standard HubSpot quarterly line that starts in the selected month", () => {
  const result = buildDraftInvoiceLine({
    lineItemId: "li-standard-quarterly",
    billingMonth: "2026-09",
    currency: "USD",
    properties: properties({
      amount: "8145.00",
      recurringbillingfrequency: "quarterly",
      hs_recurring_billing_start_date: "2026-09-02",
      hs_term_in_months: "",
      hs_recurring_billing_period: "P3M",
      hs_recurring_billing_number_of_payments: "1",
      hs_recurring_billing_terms: "FIXED",
    }),
  });
  assert.equal(result.line?.amountMinor, 814500);
});

test("derives the contract term from HubSpot's number of payments", () => {
  const result = buildDraftInvoiceLine({
    lineItemId: "li-payment-count",
    billingMonth: "2026-09",
    currency: "USD",
    properties: properties({
      hs_recurring_billing_start_date: "2026-01-15",
      hs_term_in_months: "",
      hs_recurring_billing_number_of_payments: "12",
    }),
  });
  assert.ok(result.line);
});

test("supports recurring billing that continues until cancelled", () => {
  const result = buildDraftInvoiceLine({
    lineItemId: "li-open-ended",
    billingMonth: "2026-09",
    currency: "USD",
    properties: properties({
      hs_recurring_billing_start_date: "2026-01-15",
      hs_term_in_months: "",
      hs_recurring_billing_terms: "AUTOMATICALLY_RENEW",
    }),
  });
  assert.ok(result.line);
});

test("one-time line is included once in its start month", () => {
  const oneTime = properties({ recurringbillingfrequency: "one_time", hs_term_in_months: "" });
  assert.ok(buildDraftInvoiceLine({ lineItemId: "li_1", properties: oneTime, billingMonth: "2026-01", currency: "USD" }).line);
  assert.equal(buildDraftInvoiceLine({ lineItemId: "li_1", properties: oneTime, billingMonth: "2026-02", currency: "USD" }).reason, "not_due");
});

test("converts zero-decimal and three-decimal currencies", () => {
  assert.equal(majorAmountToMinor(100.25, "USD"), 10025);
  assert.equal(majorAmountToMinor(100, "JPY"), 100);
  assert.equal(majorAmountToMinor(1.234, "KWD"), 1234);
});

test("validates and formats billing months in UTC", () => {
  assert.equal(parseBillingMonth("2026-09").toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(currentBillingMonth(new Date("2026-09-30T23:59:00Z")), "2026-09");
  assert.throws(() => parseBillingMonth("2026-13"), /Invalid billing month/);
});
