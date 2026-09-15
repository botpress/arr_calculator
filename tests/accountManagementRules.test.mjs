import assert from "node:assert/strict";
import test from "node:test";
import {
  accountManagementQuarterWindow,
  calculateRetentionMetrics,
  dealOwnerAtCutoff,
  retentionMovement,
} from "../src/lib/accountManagementRules.ts";

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

test("resolves the deal owner that was active at the prior quarter-end", () => {
  const resolved = dealOwnerAtCutoff({
    cutoffIso: "2026-06-30T23:59:59.999Z",
    currentOwnerId: "new-owner",
    currentOwnerAssignedAt: "2026-09-12T10:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    history: [
      { value: "new-owner", timestamp: "2026-09-12T10:00:00.000Z" },
      { value: "prior-owner", timestamp: "2026-04-15T10:00:00.000Z" },
      { value: "first-owner", timestamp: "2026-01-01T00:00:00.000Z" },
    ],
  });

  assert.equal(resolved.ownerId, "prior-owner");
  assert.equal(resolved.source, "history");
});

test("does not put a deal created after the snapshot into the prior-quarter portfolio", () => {
  const resolved = dealOwnerAtCutoff({
    cutoffIso: "2026-06-30T23:59:59.999Z",
    currentOwnerId: "owner-1",
    currentOwnerAssignedAt: "2026-08-17T12:00:00.000Z",
    createdAt: "2026-08-17T12:00:00.000Z",
  });

  assert.equal(resolved.ownerId, "");
  assert.equal(resolved.source, "not_created");
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
