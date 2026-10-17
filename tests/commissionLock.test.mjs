import assert from "node:assert/strict";
import test from "node:test";
import {
  activeLocksByMonth,
  adjustmentLabel,
  computeLockAdjustments,
  ledgerEntriesFromReport,
  lockedMonthFromReport,
} from "../src/lib/commissionLock.ts";

function entry(overrides = {}) {
  return {
    month: "2026-08",
    dealId: "deal-1",
    dealName: "Acme - Plus",
    ownerId: "owner-1",
    ownerName: "Felipe Garcia",
    kind: "commission",
    amount: 181.44,
    ...overrides,
  };
}

function report(month, deals, adjustments = []) {
  return {
    month,
    owners: [
      {
        ownerId: "owner-1",
        ownerName: "Felipe Garcia",
        deals: deals.map((deal) => ({
          dealId: "deal-1",
          dealName: "Acme - Plus",
          ownerId: "owner-1",
          ownerName: "Felipe Garcia",
          grossCommission: 0,
          clawback: 0,
          ...deal,
        })),
      },
    ],
    adjustments,
  };
}

test("a ledger is read from a report's commission and clawback rows", () => {
  const entries = ledgerEntriesFromReport(
    report("2026-08", [
      { dealId: "a", grossCommission: 100 },
      { dealId: "b", clawback: 40 },
      { dealId: "c", grossCommission: 0 },
    ]),
  );
  assert.deepEqual(
    entries.map((item) => [item.dealId, item.kind, item.amount, item.month]),
    [
      ["a", "commission", 100, "2026-08"],
      ["b", "clawback", -40, "2026-08"],
    ],
  );
});

test("nothing changes when today's data matches the locked snapshot", () => {
  const locked = lockedMonthFromReport(report("2026-08", [{ grossCommission: 181.44 }]));
  const adjustments = computeLockAdjustments({
    openMonth: "2026-09",
    currentLedger: [entry()],
    lockedMonths: [locked],
  });
  assert.deepEqual(adjustments, []);
});

test("a deal closed (or re-dated) into a locked month after lock is paid in the open month", () => {
  const locked = lockedMonthFromReport(report("2026-08", []));
  const [adjustment] = computeLockAdjustments({
    openMonth: "2026-09",
    currentLedger: [entry(), entry({ month: "2026-09", dealId: "deal-2" })],
    lockedMonths: [locked],
  });
  assert.equal(adjustment.forMonth, "2026-08");
  assert.equal(adjustment.amount, 181.44);
  assert.equal(adjustment.previousAmount, 0);
  assert.match(adjustmentLabel(adjustment), /^Adjustment for 2026-08: .*late-closed or re-dated/);
});

test("a clawback recorded after lock becomes a negative adjustment", () => {
  const locked = lockedMonthFromReport(report("2026-08", [{ grossCommission: 181.44 }]));
  const [adjustment] = computeLockAdjustments({
    openMonth: "2026-09",
    currentLedger: [entry(), entry({ kind: "clawback", amount: -120 })],
    lockedMonths: [locked],
  });
  assert.equal(adjustment.kind, "clawback");
  assert.equal(adjustment.amount, -120);
  assert.match(adjustment.reason, /recorded after the month was locked/);
});

test("a changed amount pays only the difference", () => {
  const locked = lockedMonthFromReport(report("2026-08", [{ grossCommission: 181.44 }]));
  const [adjustment] = computeLockAdjustments({
    openMonth: "2026-09",
    currentLedger: [entry({ amount: 200 })],
    lockedMonths: [locked],
  });
  assert.equal(adjustment.amount, 18.56);
  assert.match(adjustment.reason, /changed from 181.44 to 200.00/);
});

test("a paid deal that no longer qualifies is recovered", () => {
  const locked = lockedMonthFromReport(report("2026-08", [{ grossCommission: 181.44 }]));
  const [adjustment] = computeLockAdjustments({
    openMonth: "2026-09",
    currentLedger: [],
    lockedMonths: [locked],
  });
  assert.equal(adjustment.amount, -181.44);
  assert.equal(adjustment.currentAmount, 0);
  assert.match(adjustment.reason, /no longer qualifies/);
});

test("an owner change moves the commission between owners without changing the total", () => {
  const locked = lockedMonthFromReport(report("2026-08", [{ grossCommission: 181.44 }]));
  const adjustments = computeLockAdjustments({
    openMonth: "2026-09",
    currentLedger: [entry({ ownerId: "owner-2", ownerName: "Luca Molinaro" })],
    lockedMonths: [locked],
  });
  assert.equal(adjustments.length, 2);
  assert.equal(adjustments.reduce((sum, item) => sum + item.amount, 0), 0);
  assert.deepEqual(adjustments.map((item) => [item.ownerId, item.amount]).sort(), [
    ["owner-1", -181.44],
    ["owner-2", 181.44],
  ]);
});

test("an adjustment already paid in a later locked month is not paid twice", () => {
  const august = lockedMonthFromReport(report("2026-08", []));
  const septemberAdjustment = {
    forMonth: "2026-08",
    dealId: "deal-1",
    dealName: "Acme - Plus",
    ownerId: "owner-1",
    ownerName: "Felipe Garcia",
    kind: "commission",
    previousAmount: 0,
    currentAmount: 181.44,
    amount: 181.44,
    reason: "late close",
  };
  const september = lockedMonthFromReport(report("2026-09", [], [septemberAdjustment]));
  assert.deepEqual(
    computeLockAdjustments({ openMonth: "2026-10", currentLedger: [entry()], lockedMonths: [august, september] }),
    [],
  );
  // ...but if it is later reverted, October recovers it.
  const [recovery] = computeLockAdjustments({ openMonth: "2026-10", currentLedger: [], lockedMonths: [august, september] });
  assert.equal(recovery.amount, -181.44);
});

test("only locked months before the open month, and inside the comparable range, are adjusted", () => {
  const locked = lockedMonthFromReport(report("2026-08", [{ grossCommission: 181.44 }]));
  assert.deepEqual(computeLockAdjustments({ openMonth: "2026-08", currentLedger: [], lockedMonths: [locked] }), []);
  assert.deepEqual(computeLockAdjustments({ openMonth: "2026-07", currentLedger: [], lockedMonths: [locked] }), []);
  assert.deepEqual(
    computeLockAdjustments({ openMonth: "2026-09", currentLedger: [], lockedMonths: [locked], earliestComparableMonth: "2026-09" }),
    [],
  );
});

test("the latest lock or unlock record per month wins", () => {
  const active = activeLocksByMonth([
    { month: "2026-08", action: "lock", lockId: "a", lockedAt: "2026-09-02T10:00:00.000Z", lockedByName: "", lockedByEmail: "" },
    { month: "2026-08", action: "unlock", lockId: "b", lockedAt: "2026-09-03T10:00:00.000Z", lockedByName: "", lockedByEmail: "" },
    { month: "2026-09", action: "unlock", lockId: "c", lockedAt: "2026-10-01T10:00:00.000Z", lockedByName: "", lockedByEmail: "" },
    { month: "2026-09", action: "lock", lockId: "d", lockedAt: "2026-10-02T10:00:00.000Z", lockedByName: "", lockedByEmail: "" },
  ]);
  assert.deepEqual(Array.from(active.keys()), ["2026-09"]);
  assert.equal(active.get("2026-09").lockId, "d");
});
