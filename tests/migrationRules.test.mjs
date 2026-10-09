import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateMigrationGoalMetrics,
  calculateMigrationMetrics,
  isHubspotMigrationUpsellType,
  migrationPlanDisplayName,
  migrationPlanGeneration,
  migrationPlanVersion,
  migrationReportWindow,
} from "../src/lib/migrationRules.ts";

test("uses an April fiscal-year start with an April 2026 reporting floor", () => {
  assert.deepEqual(migrationReportWindow("2026-08-27"), {
    asOfDate: "2026-08-27",
    rangeStart: "2026-04-01",
    rangeEnd: "2026-08-27",
    fiscalYearStart: "2026-04-01",
    fiscalYearEnd: "2027-03-31",
    currentMonthStart: "2026-08-01",
  });
  assert.deepEqual(migrationReportWindow("2027-02-03"), {
    asOfDate: "2027-02-03",
    rangeStart: "2026-04-01",
    rangeEnd: "2027-02-03",
    fiscalYearStart: "2026-04-01",
    fiscalYearEnd: "2027-03-31",
    currentMonthStart: "2027-02-01",
  });
  assert.deepEqual(migrationReportWindow("2027-04-01"), {
    asOfDate: "2027-04-01",
    rangeStart: "2027-04-01",
    rangeEnd: "2027-04-01",
    fiscalYearStart: "2027-04-01",
    fiscalYearEnd: "2028-03-31",
    currentMonthStart: "2027-04-01",
  });
});

test("supports a selected range beginning on or after April 2026", () => {
  assert.deepEqual(migrationReportWindow("2026-08-27", "2026-06-15"), {
    asOfDate: "2026-08-27",
    rangeStart: "2026-06-15",
    rangeEnd: "2026-08-27",
    fiscalYearStart: "2026-04-01",
    fiscalYearEnd: "2027-03-31",
    currentMonthStart: "2026-08-01",
  });
  assert.deepEqual(migrationReportWindow("2026-08-27", "2026-08-20").currentMonthStart, "2026-08-20");
  assert.throws(() => migrationReportWindow("2026-08-27", "2026-03-31"), /starts on 2026-04-01/);
  assert.throws(() => migrationReportWindow("2026-08-27", "2026-08-28"), /on or before endDate/);
});

test("recognizes v4 plan lines and treats unversioned legacy plans as v3", () => {
  assert.equal(migrationPlanVersion(["Plan - Plus monthly (v4)"]), "v4");
  assert.equal(migrationPlanVersion(["Plan - Team annual (v3)"]), "v3");
  assert.equal(migrationPlanVersion(["Plan - Managed annual"]), "v3");
  assert.equal(migrationPlanVersion(["Plan - Managed annual"], "v4"), "v4");
  assert.equal(migrationPlanVersion(["Plan - Managed annual (v3)"], "v4"), "v3");
  assert.equal(migrationPlanGeneration(["Plan - Team monthly (v2)"]), "v2");
  assert.equal(migrationPlanVersion(["Plan - Team monthly (v2)"]), null);
  assert.equal(migrationPlanVersion(["Add-on - Conversation Sessions monthly (v4)"]), null);
  assert.equal(migrationPlanVersion(["AI Tokens (v4)"]), null);
  assert.equal(migrationPlanDisplayName(["Plan - Team annual (v3)"], "v3"), "Team (V3)");
  assert.equal(migrationPlanDisplayName(["Plus monthly v4"], "v4"), "Plus (V4)");
});

test("derives the 70 percent fiscal-year logo and ARR targets", () => {
  assert.deepEqual(
    calculateMigrationGoalMetrics({
      opening: { customers: 100, arr: 1_200_000 },
      current: { customers: 58, arr: 696_000 },
      fiscalYearMigrated: { customers: 10, arr: 58_680 },
      currentMonthMigrated: { customers: 2, arr: 4_536 },
    }),
    {
      targetRatePct: 70,
      openingLegacyCustomers: 100,
      openingLegacyArr: 1_200_000,
      openingAverageArr: 12_000,
      currentLegacyCustomers: 58,
      currentLegacyArr: 696_000,
      fiscalYearCustomerTarget: 70,
      fiscalYearArrTarget: 840_000,
      monthlyCustomerTarget: 5.83,
      monthlyArrTarget: 70_000,
      fiscalYearCustomerProgressPct: 14.3,
      fiscalYearArrProgressPct: 7,
      currentMonthCustomerProgressPct: 34.3,
      currentMonthArrProgressPct: 6.5,
    },
  );
});

test("requires the HubSpot Upsell Type property to be Migration", () => {
  assert.equal(isHubspotMigrationUpsellType("Migration"), true);
  assert.equal(isHubspotMigrationUpsellType(" migration "), true);
  assert.equal(isHubspotMigrationUpsellType("Account growth"), false);
  assert.equal(isHubspotMigrationUpsellType("Corel - Migration"), false);
});

test("calculates ARR and logo totals for an inclusive date range", () => {
  const rows = [
    { migratedAt: "2026-04-01", migratedArr: 12000, resultingExpansion: 2000 },
    { migratedAt: "2026-08-14", migratedArr: 30000, resultingExpansion: -1000 },
    { migratedAt: "2026-09-01", migratedArr: 50000, resultingExpansion: 5000 },
  ];
  assert.deepEqual(calculateMigrationMetrics(rows, "2026-04-01", "2026-08-31"), {
    logosMigrated: 2,
    arrMigrated: 42000,
    resultingExpansion: 1000,
  });
});
