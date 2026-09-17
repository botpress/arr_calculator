import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCommissionClawbacks,
  calculateNetCommissionPlanPayment,
  commissionPlanKey,
  commissionMonthKey,
  deriveCommissionRisksFromStripePlanEvents,
  isCommissionPlanActivityDescription,
  isCommissionPlanLineDescription,
  shouldIncludeCommissionDeal,
} from "../src/lib/commissionRules.ts";

function deal(overrides = {}) {
  return {
    dealId: "deal-old",
    ownerId: "owner-1",
    workspaceId: "workspace-1",
    closeDate: "2026-01-01T00:00:00.000Z",
    effectiveStartDate: "2026-01-01T00:00:00.000Z",
    planKey: "plus",
    termMonths: 12,
    dealAmount: 1200,
    grossCommission: 96,
    ...overrides,
  };
}

test("monthly churn claws back the unpaid commission once", () => {
  const [result] = calculateCommissionClawbacks(
    [deal()],
    [{ paymentId: "inv-1", workspaceId: "workspace-1", paidDate: "2026-01-02T00:00:00.000Z", amount: 100 }],
    [{ eventId: "churn-1", workspaceId: "workspace-1", occurredAt: "2026-02-15T00:00:00.000Z", type: "churn" }],
  );

  assert.equal(result.paidBeforeRisk, 100);
  assert.equal(result.clawback, 88);
  assert.equal(commissionMonthKey(result.riskEventDate), "2026-02");
});

test("risk after three full monthly payments does not claw back", () => {
  const [result] = calculateCommissionClawbacks(
    [deal()],
    [
      { paymentId: "inv-1", workspaceId: "workspace-1", paidDate: "2026-01-02T00:00:00.000Z", amount: 100 },
      { paymentId: "inv-2", workspaceId: "workspace-1", paidDate: "2026-02-02T00:00:00.000Z", amount: 100 },
      { paymentId: "inv-3", workspaceId: "workspace-1", paidDate: "2026-03-02T00:00:00.000Z", amount: 100 },
    ],
    [{ eventId: "churn-1", workspaceId: "workspace-1", occurredAt: "2026-03-20T00:00:00.000Z", type: "churn" }],
  );

  assert.equal(result.protectedAmount, 300);
  assert.equal(result.fullyProtectedAt, "2026-03-02T00:00:00.000Z");
  assert.equal(result.clawback, 0);
  assert.equal(result.riskEventId, "");
});

test("a prorated opening month does not advance the three-full-month protection clock", () => {
  const [result] = calculateCommissionClawbacks(
    [deal({
      closeDate: "2026-01-15T00:00:00.000Z",
      effectiveStartDate: "2026-01-15T00:00:00.000Z",
    })],
    [
      { paymentId: "opening-proration", workspaceId: "workspace-1", paidDate: "2026-01-15T00:00:00.000Z", amount: 50 },
      { paymentId: "feb-full", workspaceId: "workspace-1", paidDate: "2026-02-01T00:00:00.000Z", amount: 100 },
      { paymentId: "mar-full", workspaceId: "workspace-1", paidDate: "2026-03-01T00:00:00.000Z", amount: 100 },
      { paymentId: "apr-full", workspaceId: "workspace-1", paidDate: "2026-04-01T00:00:00.000Z", amount: 100 },
    ],
    [],
  );

  assert.equal(result.monitoringStart, "2026-02-01T00:00:00.000Z");
  assert.equal(result.protectedUntil, "2026-05-01T00:00:00.000Z");
  assert.equal(result.proratedOpeningPaymentAmount, 50);
  assert.equal(result.allocatedPaidAmount, 350);
  assert.equal(result.fullyProtectedAt, "2026-04-01T00:00:00.000Z");
});

test("opening proration still counts as paid cash if churn occurs before three full months", () => {
  const [result] = calculateCommissionClawbacks(
    [deal({
      closeDate: "2026-01-15T00:00:00.000Z",
      effectiveStartDate: "2026-01-15T00:00:00.000Z",
    })],
    [
      { paymentId: "opening-proration", workspaceId: "workspace-1", paidDate: "2026-01-15T00:00:00.000Z", amount: 50 },
      { paymentId: "feb-full", workspaceId: "workspace-1", paidDate: "2026-02-01T00:00:00.000Z", amount: 100 },
      { paymentId: "mar-full", workspaceId: "workspace-1", paidDate: "2026-03-01T00:00:00.000Z", amount: 100 },
    ],
    [{ eventId: "churn-1", workspaceId: "workspace-1", occurredAt: "2026-03-20T00:00:00.000Z", type: "churn" }],
  );

  assert.equal(result.fullyProtectedAt, "");
  assert.equal(result.paidBeforeRisk, 250);
  assert.equal(result.clawback, 76);
});

test("replacement deal receives new payments while the downgrade claws back only the prior deal", () => {
  const results = calculateCommissionClawbacks(
    [
      deal({ planKey: "team" }),
      deal({
        dealId: "deal-new",
        planKey: "plus",
        closeDate: "2026-02-10T00:00:00.000Z",
        effectiveStartDate: "2026-02-15T00:00:00.000Z",
        dealAmount: 600,
        grossCommission: 48,
      }),
    ],
    [
      { paymentId: "team-month", workspaceId: "workspace-1", paidDate: "2026-01-02T00:00:00.000Z", amount: 100 },
      { paymentId: "plus-month", workspaceId: "workspace-1", paidDate: "2026-02-15T00:00:00.000Z", amount: 50 },
    ],
    [
      { eventId: "end-same-time", workspaceId: "workspace-1", occurredAt: "2026-02-15T00:00:00.000Z", type: "churn" },
      { eventId: "downgrade-same-time", workspaceId: "workspace-1", occurredAt: "2026-02-15T00:00:00.000Z", type: "downgrade" },
    ],
  );
  const oldDeal = results.find((result) => result.dealId === "deal-old");
  const newDeal = results.find((result) => result.dealId === "deal-new");

  assert.equal(oldDeal?.riskType, "downgrade");
  assert.equal(oldDeal?.paidBeforeRisk, 100);
  assert.equal(oldDeal?.clawback, 88);
  assert.equal(newDeal?.allocatedPaidAmount, 50);
  assert.equal(newDeal?.clawback, 0);
});

test("Magicplan deal-backed Plus to Team upgrade pays Plus actuals and ten Team months", () => {
  const workspaceId = "wkspace_01KPEJBS3JFWFPKQWPECPXA48Z";
  const results = calculateCommissionClawbacks(
    [
      deal({
        dealId: "59369587569",
        workspaceId,
        closeDate: "2026-05-05T00:00:00.000Z",
        effectiveStartDate: "2026-05-05T00:00:00.000Z",
        planKey: "plus",
        dealAmount: 1068,
        grossCommission: 85.44,
      }),
      deal({
        dealId: "60033742225",
        workspaceId,
        closeDate: "2026-06-08T00:00:00.000Z",
        effectiveStartDate: "2026-06-08T00:00:00.000Z",
        planKey: "team",
        dealAmount: 5940,
        grossCommission: 475.2,
      }),
    ],
    [
      { paymentId: "plus-opening", workspaceId, paidDate: "2026-05-05T23:59:59.999Z", amount: 76.21 },
      { paymentId: "plus-june", workspaceId, paidDate: "2026-06-01T23:59:59.999Z", amount: 89 },
      { paymentId: "team-opening", workspaceId, paidDate: "2026-06-08T23:59:59.999Z", amount: 301.94 },
      { paymentId: "team-july", workspaceId, paidDate: "2026-07-01T23:59:59.999Z", amount: 495 },
      { paymentId: "team-august", workspaceId, paidDate: "2026-08-01T23:59:59.999Z", amount: 495 },
    ],
    [],
  );
  const plusDeal = results.find((result) => result.dealId === "59369587569");
  const teamDeal = results.find((result) => result.dealId === "60033742225");

  assert.equal(plusDeal?.riskType, "upgrade");
  assert.equal(plusDeal?.replacementDealId, "60033742225");
  assert.equal(plusDeal?.paidBeforeRisk, 165.21);
  assert.equal(plusDeal?.clawback, 72.22);
  assert.equal(teamDeal?.commissionableTermMonths, 10);
  assert.equal(teamDeal?.commissionableDealAmount, 4950);
  assert.equal(teamDeal?.commissionableGrossCommission, 396);
  assert.equal(teamDeal?.proratedOpeningPaymentAmount, 301.94);
  assert.equal(teamDeal?.allocatedPaidAmount, 1291.94);
});

test("Magicplan net-positive Stripe transition is not a clawback without its HubSpot upgrade deal", () => {
  const customerId = "cus_UM16U7mBhcTdEX";
  const subscriptionId = "sub_1TTgdqKDjVRgNn7vdhEEaa4D";
  const risks = deriveCommissionRisksFromStripePlanEvents([
    {
      eventId: "plus-down",
      customerId,
      subscriptionId,
      occurredAt: "2026-06-08T16:32:36.141Z",
      eventType: "ACTIVE_DOWNGRADE",
      mrrChange: -8900,
    },
    {
      eventId: "team-start",
      customerId,
      subscriptionId,
      occurredAt: "2026-06-08T16:32:36.141Z",
      eventType: "ACTIVE_START",
      mrrChange: 49500,
    },
    {
      eventId: "plus-end",
      customerId,
      subscriptionId,
      occurredAt: "2026-06-08T16:32:39.539Z",
      eventType: "ACTIVE_END",
      mrrChange: 0,
    },
  ]);

  assert.deepEqual(risks, []);
});

test("a net-negative Stripe plan replacement remains a downgrade risk", () => {
  const risks = deriveCommissionRisksFromStripePlanEvents([
    {
      eventId: "team-down",
      customerId: "customer-1",
      subscriptionId: "subscription-1",
      occurredAt: "2026-02-15T12:00:00.000Z",
      eventType: "ACTIVE_DOWNGRADE",
      mrrChange: -49500,
    },
    {
      eventId: "plus-start",
      customerId: "customer-1",
      subscriptionId: "subscription-1",
      occurredAt: "2026-02-15T12:00:00.000Z",
      eventType: "ACTIVE_START",
      mrrChange: 8900,
    },
  ]);

  assert.equal(risks.length, 1);
  assert.equal(risks[0].type, "downgrade");
});

test("a late churn remains monitored until the first-three-month payment threshold is met", () => {
  const [result] = calculateCommissionClawbacks(
    [deal()],
    [{ paymentId: "inv-1", workspaceId: "workspace-1", paidDate: "2026-01-02T00:00:00.000Z", amount: 100 }],
    [{ eventId: "late-churn", workspaceId: "workspace-1", occurredAt: "2026-05-01T00:00:00.000Z", type: "churn" }],
  );

  assert.equal(result.riskEventId, "late-churn");
  assert.equal(result.clawback, 88);
});

test("commission payments exclude add-ons and AI tokens and use the refund-adjusted plan share", () => {
  assert.equal(isCommissionPlanLineDescription("Team Plan"), true);
  assert.equal(isCommissionPlanLineDescription("AI Tokens"), false);
  assert.equal(isCommissionPlanLineDescription("Extra seats Add-On"), false);
  assert.equal(isCommissionPlanLineDescription("Refund"), false);

  assert.equal(
    calculateNetCommissionPlanPayment({
      invoiceAmountPaid: 150,
      amountRefunded: 30,
      planLineAmount: 100,
      totalPositiveLineAmount: 150,
    }),
    80,
  );
  assert.equal(
    calculateNetCommissionPlanPayment({
      invoiceAmountPaid: 100,
      amountRefunded: 150,
      planLineAmount: 100,
      totalPositiveLineAmount: 100,
    }),
    0,
  );
});

test("commission risk events only include identified primary plan products", () => {
  assert.equal(
    isCommissionPlanActivityDescription(["Plan - Plus monthly (v4)", "Plan - Plus"]),
    true,
  );
  assert.equal(
    isCommissionPlanActivityDescription([
      "Add-on - Conversation Sessions monthly (v4)",
      "Add-on - Conversation Sessions",
    ]),
    false,
  );
  assert.equal(isCommissionPlanActivityDescription(["AI Tokens", ""]), false);
  assert.equal(isCommissionPlanActivityDescription(["", "(blank)"]), false);
});

test("commission plan keys identify Magicplan replacement tiers", () => {
  assert.equal(commissionPlanKey(["Magicplan - Plus Plan"]), "plus");
  assert.equal(commissionPlanKey(["Magicplan - Team Plan"]), "team");
  assert.equal(commissionPlanKey(["Add-on - Collaborators"]), "");
});

test("Existing Business is limited to the approved New Business reps", () => {
  const approvedOwners = ["Tyler", "Luca", "Evan", "Felipe", "Antonin", "Sarah"];

  assert.equal(
    shouldIncludeCommissionDeal({
      dealType: "newbusiness",
      ownerIdentities: ["Someone Else"],
      existingBusinessOwnerNames: approvedOwners,
    }),
    true,
  );
  assert.equal(
    shouldIncludeCommissionDeal({
      dealType: "existing_business",
      ownerIdentities: ["Sarah", "Sarah Example"],
      existingBusinessOwnerNames: approvedOwners,
    }),
    true,
  );
  assert.equal(
    shouldIncludeCommissionDeal({
      dealType: "existingbusiness",
      ownerIdentities: ["Someone Else"],
      existingBusinessOwnerNames: approvedOwners,
    }),
    false,
  );
});

test("a clawback never exceeds the commission originally paid", () => {
  const [result] = calculateCommissionClawbacks(
    [deal({ dealAmount: 1200, grossCommission: 96 })],
    [],
    [{ eventId: "churn-1", workspaceId: "workspace-1", occurredAt: "2026-02-01T00:00:00.000Z", type: "churn" }],
  );

  assert.equal(result.clawback, 96);
});
