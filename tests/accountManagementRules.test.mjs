import assert from "node:assert/strict";
import test from "node:test";
import {
  accountManagementQuarterWindow,
  calculateRetentionMetrics,
  companyCsmOwnerId,
  retentionMovement,
} from "../src/lib/accountManagementRules.ts";

test("assigns ownership from the company CSM owner field, not the deal owner field", () => {
  assert.equal(companyCsmOwnerId({ csm_owner: " 1314508841 ", hubspot_owner_id: "84747686" }), "1314508841");
  assert.equal(companyCsmOwnerId({ hubspot_owner_id: "84747686" }), "");
});

test("builds the prior and selected quarter-end comparison window", () => {
  assert.deepEqual(accountManagementQuarterWindow("2027-Q2"), {
    quarter: "2027-Q2",
    previousQuarterKey: "2027-Q1",
    currentQuarterKey: "2027-Q2",
    previousPeriodMonthKey: "2026-06",
    currentPeriodMonthKey: "2026-09",
    currentQuarterStart: "2026-07-01",
    previousQuarterEnd: "2026-06-30",
    currentQuarterEnd: "2026-09-30",
    ownerCutoffIso: "2026-06-30T23:59:59.999Z",
  });

  assert.equal(accountManagementQuarterWindow("2027-Q1").currentQuarterStart, "2026-04-01");
  assert.equal(accountManagementQuarterWindow("2027-Q1").previousQuarterEnd, "2026-03-31");
  assert.equal(accountManagementQuarterWindow("2027-Q4").currentQuarterEnd, "2027-03-31");
  assert.throws(() => accountManagementQuarterWindow("2026-Q5"), /Invalid quarter/);
});

test("calculates NRR from only accounts with prior-quarter ARR", () => {
  const metrics = calculateRetentionMetrics([
    { previousArr: 100, currentArr: 120 },
    { previousArr: 200, currentArr: 150 },
    { previousArr: 50, currentArr: 0 },
    { previousArr: 0, currentArr: 80 },
  ]);

  assert.deepEqual(metrics, {
    accountCount: 4,
    baselineAccountCount: 3,
    previousArr: 350,
    currentArr: 270,
    netChange: -80,
    expansionArr: 20,
    contractionArr: 50,
    churnArr: 50,
    nrrPct: 77.14,
  });
});

test("classifies account-level retention movements", () => {
  assert.equal(retentionMovement(100, 120), "expanded");
  assert.equal(retentionMovement(100, 75), "contracted");
  assert.equal(retentionMovement(100, 0), "churned");
  assert.equal(retentionMovement(100, 100), "retained");
  assert.equal(retentionMovement(0, 100), "not_in_baseline");
});
