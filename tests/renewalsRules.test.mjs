import assert from "node:assert/strict";
import test from "node:test";
import {
  addDaysIso,
  daysBetween,
  deploymentCategory,
  filterRenewals,
  isInRenewalWindow,
  normalizeWindowDays,
  renewalStatus,
  summarizeRenewals,
  todayIsoUtc,
} from "../src/lib/renewalsRules.ts";

function row(overrides) {
  return {
    dealId: "d1",
    dealName: "Deal",
    dealUrl: "",
    companyId: "c1",
    companyName: "Company",
    companyUrl: "",
    renewalDate: "2026-10-20",
    arr: 1000,
    nativeArr: 1000,
    currency: "USD",
    fxMissing: false,
    fxFallback: false,
    deploymentType: "Cloud",
    deployment: "Cloud",
    csmOwnerId: "o1",
    csmOwnerName: "Owner One",
    dealOwnerId: "o2",
    dealOwnerName: "Owner Two",
    status: "none",
    statusLabel: "No renewal deal",
    statusDealId: "",
    statusDealName: "",
    statusDealUrl: "",
    statusDetail: "",
    ...overrides,
  };
}

test("date helpers work in whole UTC days", () => {
  assert.equal(todayIsoUtc(new Date("2026-10-16T23:59:00.000Z")), "2026-10-16");
  assert.equal(addDaysIso("2026-10-16", 30), "2026-11-15");
  assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
  assert.equal(daysBetween("2026-10-16", "2026-11-15"), 30);
  assert.equal(daysBetween("2026-10-16", "2026-10-15"), -1);
  assert.ok(Number.isNaN(daysBetween("bad", "2026-10-15")));
});

test("renewal window includes today and today + N, excludes past and later dates", () => {
  assert.equal(isInRenewalWindow("2026-10-16", "2026-10-16", 30), true);
  assert.equal(isInRenewalWindow("2026-11-15", "2026-10-16", 30), true);
  assert.equal(isInRenewalWindow("2026-11-16", "2026-10-16", 30), false);
  assert.equal(isInRenewalWindow("2026-10-15", "2026-10-16", 30), false);
  assert.equal(isInRenewalWindow("2026-11-16", "2026-10-16", 60), true);
  assert.equal(isInRenewalWindow("", "2026-10-16", 30), false);
});

test("window selector only accepts 30, 60 or 90 days", () => {
  assert.equal(normalizeWindowDays("60"), 60);
  assert.equal(normalizeWindowDays(90), 90);
  assert.equal(normalizeWindowDays("45"), 30);
  assert.equal(normalizeWindowDays(undefined), 30);
});

test("only an explicit Cloud deployment type is Cloud", () => {
  assert.equal(deploymentCategory("Cloud"), "Cloud");
  assert.equal(deploymentCategory(" cloud "), "Cloud");
  assert.equal(deploymentCategory("Migration"), "Legacy");
  assert.equal(deploymentCategory("Dedicated"), "Legacy");
  assert.equal(deploymentCategory(""), "Legacy");
});

test("renewal status prefers renewed, then an open Existing Business deal, else none", () => {
  assert.deepEqual(renewalStatus({ renewedByDealId: "9", openRenewalDealId: "8", openRenewalStageLabel: "Negotiation" }), {
    kind: "renewed",
    label: "Renewed",
  });
  assert.deepEqual(renewalStatus({ openRenewalDealId: "8", openRenewalStageLabel: "Negotiation" }), {
    kind: "in_progress",
    label: "Renewal in progress: Negotiation",
  });
  assert.deepEqual(renewalStatus({ openRenewalDealId: "8" }), { kind: "in_progress", label: "Renewal in progress: Open" });
  assert.deepEqual(renewalStatus({}), { kind: "none", label: "No renewal deal" });
});

test("filters by window, CSM and deployment, sorted by renewal date", () => {
  const rows = [
    row({ dealId: "late", renewalDate: "2026-12-01" }),
    row({ dealId: "b", renewalDate: "2026-10-25", arr: 10 }),
    row({ dealId: "a", renewalDate: "2026-10-18", deployment: "Legacy", deploymentType: "Migration" }),
    row({ dealId: "nocsm", renewalDate: "2026-10-30", csmOwnerId: "", csmOwnerName: "" }),
    row({ dealId: "past", renewalDate: "2026-10-01" }),
  ];
  const asOf = "2026-10-16";
  assert.deepEqual(filterRenewals(rows, { asOf, windowDays: 30 }).map((r) => r.dealId), ["a", "b", "nocsm"]);
  assert.deepEqual(filterRenewals(rows, { asOf, windowDays: 60 }).map((r) => r.dealId), ["a", "b", "nocsm", "late"]);
  assert.deepEqual(filterRenewals(rows, { asOf, windowDays: 30, deployment: "Legacy" }).map((r) => r.dealId), ["a"]);
  assert.deepEqual(filterRenewals(rows, { asOf, windowDays: 30, csmOwnerId: "__none__" }).map((r) => r.dealId), ["nocsm"]);
  assert.deepEqual(filterRenewals(rows, { asOf, windowDays: 30, csmOwnerId: "o1" }).map((r) => r.dealId), ["a", "b"]);
});

test("summary counts contracts, ARR and ARR without a renewal deal", () => {
  const summary = summarizeRenewals([
    row({ arr: 1000.5, status: "none" }),
    row({ arr: 2000, status: "in_progress", deployment: "Legacy" }),
    row({ arr: 300, status: "renewed" }),
  ]);
  assert.deepEqual(summary, { count: 3, totalArr: 3300.5, noRenewalCount: 1, noRenewalArr: 1000.5, legacyCount: 1 });
});
