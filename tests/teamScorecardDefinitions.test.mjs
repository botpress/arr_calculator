import assert from "node:assert/strict";
import test from "node:test";
import {
  TEAM_SCORECARD_DEFINITIONS,
  TEAM_SCORECARD_KEYS,
  getTeamScorecardDefinition,
  isTeamScorecardKey,
} from "../src/lib/teamScorecardDefinitions.ts";
import { applyTeamScorecardManualValues } from "../src/lib/teamScorecardManualValues.ts";

test("preserves the V2 scorecards and adds Finance and People Ops", () => {
  assert.deepEqual(TEAM_SCORECARD_DEFINITIONS.map((team) => team.key), [...TEAM_SCORECARD_KEYS]);
  assert.deepEqual(TEAM_SCORECARD_DEFINITIONS.map((team) => team.metrics.length), [9, 7, 10, 4, 7, 4, 6, 8, 6]);
  assert.equal(TEAM_SCORECARD_DEFINITIONS.reduce((sum, team) => sum + team.metrics.length, 0), 61);
});

test("keeps the supplied Marketing and Finance targets", () => {
  const marketing = getTeamScorecardDefinition("marketing");
  const finance = getTeamScorecardDefinition("finance");
  assert.equal(marketing.metrics.filter((metric) => metric.target).length, 6);
  assert.equal(marketing.metrics[0].target, "0% → 25%+ by EOQ4");
  assert.equal(marketing.metrics[5].target, "6 by EOQ3");
  assert.deepEqual(finance.metrics.map((metric) => metric.target), [
    "≤5 bd",
    "≤10th",
    "Weekly",
    "±10%",
    "TBD",
    "TBD",
    "0 errors",
    "Weekly",
  ]);
  assert.equal(
    TEAM_SCORECARD_DEFINITIONS.filter((team) => team.key !== "marketing" && team.key !== "finance")
      .flatMap((team) => team.metrics)
      .every((metric) => metric.target === ""),
    true,
  );
});

test("keeps the supplied Finance and People Ops owners, cadence, and tracking flags", () => {
  const finance = getTeamScorecardDefinition("finance");
  const peopleOps = getTeamScorecardDefinition("people-ops");

  assert.equal(finance.metrics.length, 8);
  assert.equal(finance.metrics.every((metric) => metric.financeTracking === "yes"), true);
  assert.equal(finance.metrics[0].owner, "Controller");
  assert.equal(finance.metrics[6].frequency, "Quarterly");

  assert.equal(peopleOps.metrics.length, 6);
  assert.equal(peopleOps.metrics[0].owner, "Vlad");
  assert.equal(peopleOps.metrics[1].owner, "Vlad/Lauren/Mathilde");
  assert.equal(peopleOps.metrics[1].financeTracking, "yes");
  assert.equal(peopleOps.metrics[2].frequency, "semi-annual");
});

test("validates team route keys", () => {
  assert.equal(isTeamScorecardKey("sales"), true);
  assert.equal(isTeamScorecardKey("account-management"), true);
  assert.equal(isTeamScorecardKey("Account-Management"), true);
  assert.equal(isTeamScorecardKey("finance"), true);
  assert.equal(isTeamScorecardKey("people-ops"), true);
  assert.equal(isTeamScorecardKey("People-Ops"), true);
});

test("manual scorecard values fill blanks without overriding calculated metrics", () => {
  const report = {
    populatedMetricCount: 1,
    metrics: [
      { id: "blank", values: [], valueKind: "blank", source: "", calculation: "" },
      { id: "calculated", values: [{ label: "Actual", value: 10, format: "count" }], valueKind: "calculated", source: "BigQuery", calculation: "Query" },
    ],
  };
  const result = applyTeamScorecardManualValues(report, {
    blank: { value: 12.5, updatedAt: "2026-09-11T12:00:00.000Z", updatedBy: "admin@example.com" },
    calculated: { value: 99, updatedAt: "2026-09-11T12:00:00.000Z", updatedBy: "admin@example.com" },
  });

  assert.equal(result.populatedMetricCount, 2);
  assert.equal(result.metrics[0].valueKind, "manual");
  assert.equal(result.metrics[0].manualValue, 12.5);
  assert.equal(result.metrics[0].values[0].format, "number");
  assert.equal(result.metrics[1].values[0].value, 10);
  assert.equal(result.metrics[1].valueKind, "calculated");
});
