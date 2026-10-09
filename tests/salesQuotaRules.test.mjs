import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSalesQuotaProgress,
  calculateTeamSalesQuotaProgress,
  salesQuotaPeriod,
  TEAM_MONTHLY_QUOTA_AMOUNT,
} from "../src/lib/salesQuotaRules.ts";

test("prorates a monthly quota through the current day", () => {
  const progress = calculateSalesQuotaProgress(
    { ownerKey: "luca", ownerName: "Luca", quotaAmount: 65_000, cadence: "monthly" },
    "2026-08-20",
    32_500,
    2,
  );

  assert.equal(progress.periodStart, "2026-08-01");
  assert.equal(progress.periodEnd, "2026-08-31");
  assert.equal(progress.elapsedDays, 20);
  assert.equal(progress.totalDays, 31);
  assert.equal(progress.expectedAmount, 41_935.48);
  assert.equal(progress.expectedPct, 64.52);
  assert.equal(progress.attainmentPct, 50);
});

test("prorates Evan's quota across the full calendar quarter", () => {
  const progress = calculateSalesQuotaProgress(
    { ownerKey: "evan", ownerName: "Evan", quotaAmount: 399_000, cadence: "quarterly" },
    "2026-08-20",
    250_000,
    4,
  );

  assert.equal(progress.periodStart, "2026-07-01");
  assert.equal(progress.periodEnd, "2026-09-30");
  assert.equal(progress.elapsedDays, 51);
  assert.equal(progress.totalDays, 92);
  assert.equal(progress.expectedAmount, 221_184.78);
  assert.equal(progress.expectedPct, 55.43);
  assert.equal(progress.attainmentPct, 62.66);
});

test("calendar-quarter boundaries reset in October", () => {
  assert.deepEqual(salesQuotaPeriod("2026-10-01", "quarterly"), {
    periodStart: "2026-10-01",
    periodEnd: "2026-12-31",
    elapsedDays: 1,
    totalDays: 92,
  });
});

test("team attainment uses the monthly quota including one third of Evan's quarterly quota", () => {
  const team = calculateTeamSalesQuotaProgress("2026-08-20", 171_500, 6);

  assert.equal(TEAM_MONTHLY_QUOTA_AMOUNT, 343_000);
  assert.equal(team.quotaAmount, 343_000);
  assert.equal(team.soldAmount, 171_500);
  assert.equal(team.expectedAmount, 221_290.32);
  assert.equal(team.attainmentPct, 50);
  assert.equal(team.expectedPct, 64.52);
  assert.equal(team.dealCount, 6);
  assert.equal(team.periodStart, "2026-08-01");
  assert.equal(team.periodEnd, "2026-08-31");
});

test("rejects invalid as-of dates", () => {
  assert.throws(() => salesQuotaPeriod("2026-02-30", "monthly"), /Invalid as-of date/);
});
