import assert from "node:assert/strict";
import test from "node:test";
import {
  FY27_MONTH_KEYS,
  GTM_TARGETS,
  countBusinessDays,
  getGtmTarget,
  paceMonthlyTarget,
} from "../src/lib/gtmTargets.ts";

test("every Targets-tab series covers Apr 2026 through Mar 2027", () => {
  assert.equal(FY27_MONTH_KEYS.length, 12);
  assert.equal(new Set(GTM_TARGETS.map((target) => target.id)).size, GTM_TARGETS.length);
  for (const target of GTM_TARGETS) assert.equal(target.monthly.length, 12, target.id);
});

test("August and September source-of-truth targets match the workbook", () => {
  assert.equal(getGtmTarget("2026-08", "net_new_arr"), 720143);
  assert.equal(getGtmTarget("2026-08", "new_arr_selfserve"), 520197);
  assert.equal(getGtmTarget("2026-08", "pipeline_total"), 1536091);
  assert.equal(getGtmTarget("2026-08", "expansion_assigned_total"), 63830);
  assert.equal(getGtmTarget("2026-09", "net_new_arr"), 872302);
  assert.equal(getGtmTarget("2026-09", "team_total"), 1351185);
});

test("company target waterfall reconciles every month", () => {
  for (const monthKey of FY27_MONTH_KEYS) {
    const beginning = getGtmTarget(monthKey, "beginning_arr") || 0;
    const newBusiness = getGtmTarget(monthKey, "new_business_arr") || 0;
    const expansion = getGtmTarget(monthKey, "expansion_arr") || 0;
    const churn = getGtmTarget(monthKey, "churn_arr") || 0;
    const contraction = getGtmTarget(monthKey, "contraction_arr") || 0;
    const migrations = getGtmTarget(monthKey, "migrations_transfers") || 0;
    const ending = getGtmTarget(monthKey, "ending_arr") || 0;
    assert.ok(Math.abs(beginning + newBusiness + expansion + churn + contraction + migrations - ending) <= 1, monthKey);
  }
});

test("business-day pacing matches the workbook NETWORKDAYS convention", () => {
  assert.equal(countBusinessDays("2026-09-01", "2026-09-02"), 2);
  assert.equal(countBusinessDays("2026-09-01", "2026-09-30"), 22);
  assert.equal(paceMonthlyTarget(220000, 2, 22), 20000);
});
