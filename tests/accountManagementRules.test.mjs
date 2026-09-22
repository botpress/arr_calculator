import assert from "node:assert/strict";
import test from "node:test";
import {
  accountManagementQuarterWindow,
  calculateRetentionMetrics,
  calculateRetentionMetricsWithExclusions,
  companyCsmOwnerId,
  fillZeroArrFromStripe,
  isAccountManagementBaselineEligible,
  isExcludedNewAccountActivity,
  isManagedAccountPlan,
  isTransactionalTeamPlan,
  isExcludedNewAccountChurn,
  isExcludedLegacyAccount,
  retentionExclusionReason,
  retentionMovement,
} from "../src/lib/accountManagementRules.ts";

test("admits only baseline managed plans when Stripe measures the account", () => {
  assert.equal(isManagedAccountPlan("Team"), true);
  assert.equal(isManagedAccountPlan("managed"), true);
  assert.equal(isManagedAccountPlan("enterprise"), true);
  assert.equal(isManagedAccountPlan("plus"), false);
  assert.equal(
    isAccountManagementBaselineEligible({
      previousArr: 1068,
      previousCloudArr: 1068,
      stripeMeasuredAtBaseline: true,
      stripeBaselinePlans: ["plus"],
    }),
    false,
  );
  assert.equal(
    isAccountManagementBaselineEligible({
      previousArr: 5940,
      previousCloudArr: 5940,
      stripeMeasuredAtBaseline: true,
      stripeBaselinePlans: ["team"],
    }),
    true,
  );
  assert.equal(
    isAccountManagementBaselineEligible({
      previousArr: 25000,
      previousCloudArr: 25000,
      stripeMeasuredAtBaseline: false,
      stripeBaselinePlans: [],
    }),
    true,
  );
  assert.equal(
    isAccountManagementBaselineEligible({
      previousArr: 25000,
      previousCloudArr: 0,
      stripeMeasuredAtBaseline: false,
      stripeBaselinePlans: [],
    }),
    false,
  );
});

test("assigns ownership from the company CSM owner field, not the deal owner field", () => {
  assert.equal(companyCsmOwnerId({ csm_owner: " 1314508841 ", hubspot_owner_id: "84747686" }), "1314508841");
  assert.equal(companyCsmOwnerId({ hubspot_owner_id: "84747686" }), "");
});

test("includes Transactional Team plans and excludes anything mentioning Plus", () => {
  assert.equal(isTransactionalTeamPlan(["Team Annual"]), true);
  assert.equal(isTransactionalTeamPlan(["Botpress Team", "Implementation"]), true);
  assert.equal(isTransactionalTeamPlan(["Plus Annual"]), false);
  assert.equal(isTransactionalTeamPlan(["Team migration", "Plus plan"]), false);
  assert.equal(isTransactionalTeamPlan(["Enterprise"]), false);
});

test("fills only zero HubSpot ARR columns from Stripe base-subscription ARR", () => {
  assert.deepEqual(
    fillZeroArrFromStripe(
      { previousArr: 0, currentArr: 120 },
      { previousArr: 90, currentArr: 130 },
    ),
    { previousArr: 90, currentArr: 120, usedStripePrevious: true, usedStripeCurrent: false },
  );
  assert.deepEqual(
    fillZeroArrFromStripe(
      { previousArr: 100, currentArr: 0 },
      { previousArr: 110, currentArr: 80 },
    ),
    { previousArr: 100, currentArr: 80, usedStripePrevious: false, usedStripeCurrent: true },
  );
  assert.deepEqual(
    fillZeroArrFromStripe(
      { previousArr: 0, currentArr: 0 },
      { previousArr: 0, currentArr: 0 },
    ),
    { previousArr: 0, currentArr: 0, usedStripePrevious: false, usedStripeCurrent: false },
  );
});

test("builds the prior and selected quarter-end comparison window", () => {
  assert.deepEqual(accountManagementQuarterWindow("2027-Q2"), {
    quarter: "2027-Q2",
    previousQuarterKey: "2027-Q1",
    currentQuarterKey: "2027-Q2",
    previousPeriodMonthKey: "2026-06",
    currentPeriodMonthKey: "2026-09",
    currentQuarterStart: "2026-07-01",
    openingSnapshotDate: "2026-07-01",
    currentQuarterActivityStart: "2026-07-02",
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

test("excludes every ARR reduction in the first 90 days from NRR while keeping it in account count", () => {
  assert.equal(
    isExcludedNewAccountActivity({ previousArr: 100, currentArr: 0, earlyLifecycleActivity: true }),
    true,
  );
  assert.equal(
    isExcludedNewAccountActivity({ previousArr: 100, currentArr: 50, earlyLifecycleActivity: true }),
    true,
  );
  assert.equal(
    isExcludedNewAccountActivity({ previousArr: 100, currentArr: 50, churnType: "New account (<90 days)" }),
    true,
  );
  assert.equal(
    isExcludedNewAccountActivity({ previousArr: 100, currentArr: 120, earlyLifecycleActivity: true }),
    false,
  );
  assert.deepEqual(
    calculateRetentionMetricsWithExclusions([
      { previousArr: 100, currentArr: 0, previousCloudArr: 100, currentCloudArr: 0, churnType: "New account (<90 days)" },
      { previousArr: 200, currentArr: 180, previousCloudArr: 200, currentCloudArr: 180, churnType: "Standard Churn" },
    ]),
    {
      accountCount: 2,
      baselineAccountCount: 1,
      previousArr: 200,
      currentArr: 180,
      netChange: -20,
      expansionArr: 0,
      contractionArr: 20,
      churnArr: 0,
      nrrPct: 90,
    },
  );
});

test("excludes legacy-only accounts but includes legacy-to-Cloud migrations", () => {
  const legacyExpansion = {
    previousArr: 100,
    currentArr: 140,
    previousCloudArr: 0,
    currentCloudArr: 0,
  };
  const legacyChurn = {
    previousArr: 100,
    currentArr: 0,
    previousCloudArr: 0,
    currentCloudArr: 0,
  };
  const migration = {
    previousArr: 100,
    currentArr: 160,
    previousCloudArr: 0,
    currentCloudArr: 160,
  };
  assert.equal(isExcludedLegacyAccount(legacyExpansion), true);
  assert.equal(isExcludedLegacyAccount(legacyChurn), true);
  assert.equal(retentionExclusionReason(legacyExpansion), "legacy_only");
  assert.equal(isExcludedLegacyAccount(migration), false);
  assert.equal(retentionExclusionReason(migration), null);
  assert.deepEqual(calculateRetentionMetricsWithExclusions([legacyExpansion, migration]), {
    accountCount: 2,
    baselineAccountCount: 1,
    previousArr: 100,
    currentArr: 160,
    netChange: 60,
    expansionArr: 60,
    contractionArr: 0,
    churnArr: 0,
    nrrPct: 160,
  });
});

test("classifies account-level retention movements", () => {
  assert.equal(retentionMovement(100, 120), "expanded");
  assert.equal(retentionMovement(100, 75), "contracted");
  assert.equal(retentionMovement(100, 0), "churned");
  assert.equal(retentionMovement(100, 100), "retained");
  assert.equal(retentionMovement(0, 100), "not_in_baseline");
});
