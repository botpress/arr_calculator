import assert from "node:assert/strict";
import test from "node:test";
import {
  EXCLUDED_OWNER_NOTE,
  evaluateBillingSwitch,
  isExcludedCommissionOwner,
  resolveExcludedOwners,
  resolveExistingBusinessOwnerConfig,
  shouldIncludeCommissionDeal,
} from "../src/lib/commissionRules.ts";
import {
  annualizedDealAmount,
  findPossibleDuplicateDeals,
  findStrictDuplicateDeals,
  findStrictDuplicateMatch,
  isPriceMismatch,
  monthlyStripePlanPrice,
  selectStripePlanPriceForDeal,
} from "../src/lib/commissionFlags.ts";

test("Existing Business eligibility uses HubSpot owner IDs, not first names", () => {
  const config = resolveExistingBusinessOwnerConfig({});
  assert.equal(config.mode, "ids");
  const ids = config.owners.map((owner) => owner.ownerId);
  assert.deepEqual(config.owners.map((owner) => owner.name), [
    "Tyler Toole",
    "Luca Molinaro",
    "Evan Stamegna",
    "Felipe Garcia",
    "Antonin Roussel",
  ]);
  // Felipe Garcia's Existing Business deal is commissioned.
  assert.equal(shouldIncludeCommissionDeal({ dealType: "existingbusiness", ownerId: "90624409", existingBusinessOwnerIds: ids }), true);
  // Sarah Chudleigh (Marketing) no longer matches through the first name "Sarah".
  assert.equal(
    shouldIncludeCommissionDeal({
      dealType: "existingbusiness",
      ownerId: "207967699",
      existingBusinessOwnerIds: ids,
      ownerIdentities: ["Sarah", "Sarah Chudleigh"],
      existingBusinessOwnerNames: ["Sarah"],
    }),
    false,
  );
  // CSMs earn no Existing Business commission; anyone earns New Business (e.g. Kieran Hamilton).
  assert.equal(shouldIncludeCommissionDeal({ dealType: "existingbusiness", ownerId: "csm-1", existingBusinessOwnerIds: ids }), false);
  assert.equal(shouldIncludeCommissionDeal({ dealType: "newbusiness", ownerId: "csm-1", existingBusinessOwnerIds: ids }), true);
  assert.equal(shouldIncludeCommissionDeal({ dealType: "Upsell", ownerId: "90624409", existingBusinessOwnerIds: ids }), false);
});

test("owner ID env override wins and the legacy name list still works as a fallback", () => {
  const fromIds = resolveExistingBusinessOwnerConfig({ ownerIds: "90624409, 123", ownerNames: "Tyler" });
  assert.equal(fromIds.mode, "ids");
  assert.deepEqual(fromIds.owners, [
    { ownerId: "90624409", name: "Felipe Garcia" },
    { ownerId: "123", name: "" },
  ]);
  const fromNames = resolveExistingBusinessOwnerConfig({ ownerNames: "Tyler;Luca" });
  assert.deepEqual(fromNames, { mode: "names", names: ["Tyler", "Luca"], source: "env_names" });
});

test("directors are excluded from per-deal commission by owner ID", () => {
  const excluded = resolveExcludedOwners({}).map((owner) => owner.ownerId);
  assert.deepEqual(excluded, ["88054084"]);
  assert.equal(isExcludedCommissionOwner("88054084", excluded), true);
  assert.equal(isExcludedCommissionOwner("90624409", excluded), false);
  assert.deepEqual(resolveExcludedOwners({ ownerIds: "1,2" }).map((owner) => owner.ownerId), ["1", "2"]);
  assert.equal(EXCLUDED_OWNER_NOTE, "Director: paid on team attainment, not per deal");
});

function candidate(overrides = {}) {
  return {
    dealId: "60254161422",
    workspaceId: "wkspace_deproc",
    stripeCustomerIds: ["cus_Ua9jicccRCwOny"],
    planKey: "plus",
    closeDate: "2026-09-09T00:00:00.000Z",
    commissionable: true,
    ...overrides,
  };
}

test("DEPROC: two same-plan deals for one customer on the same day are one sale; the lowest deal ID keeps it", () => {
  const duplicates = findStrictDuplicateDeals([
    candidate({ dealId: "64836139307" }),
    candidate({ dealId: "60254161422" }),
  ]);
  assert.deepEqual(Array.from(duplicates.entries()), [["64836139307", "60254161422"]]);
});

test("strict duplicates: earliest close keeps it; shared Stripe customer counts; 14-day limit; plan changes excluded", () => {
  const earliest = findStrictDuplicateDeals([
    candidate({ dealId: "1", closeDate: "2026-09-20T00:00:00.000Z" }),
    candidate({ dealId: "2", closeDate: "2026-09-10T00:00:00.000Z", workspaceId: "other", stripeCustomerIds: ["cus_Ua9jicccRCwOny"] }),
  ]);
  assert.deepEqual(Array.from(earliest.entries()), [["1", "2"]]);
  assert.equal(
    findStrictDuplicateDeals([candidate({ dealId: "1" }), candidate({ dealId: "2", closeDate: "2026-09-24T00:00:00.000Z" })]).size,
    0,
  );
  assert.equal(findStrictDuplicateDeals([candidate({ dealId: "1" }), candidate({ dealId: "2", planKey: "team" })]).size, 0);
  assert.equal(findStrictDuplicateDeals([candidate({ dealId: "1" }), candidate({ dealId: "2", commissionable: false })]).size, 0);
  assert.equal(
    findStrictDuplicateDeals([candidate({ dealId: "1" }), candidate({ dealId: "2", workspaceId: "b", stripeCustomerIds: ["cus_x"] })]).size,
    0,
  );
  const match = findStrictDuplicateMatch(candidate({ dealId: "9" }), [candidate({ dealId: "1" })]);
  assert.equal(match?.dealId, "1");
});

test("possible duplicates: same customer within 90 days is a warning, except strict duplicates and plan changes", () => {
  const deals = [
    candidate({ dealId: "1", closeDate: "2026-07-01T00:00:00.000Z" }),
    candidate({ dealId: "2", closeDate: "2026-09-15T00:00:00.000Z" }),
    candidate({ dealId: "3", closeDate: "2026-09-16T00:00:00.000Z", planKey: "team" }),
    candidate({ dealId: "4", closeDate: "2026-12-31T00:00:00.000Z" }),
  ];
  const matches = findPossibleDuplicateDeals(deals);
  assert.deepEqual(matches.get("1"), ["2"]);
  assert.deepEqual(matches.get("2"), ["1"]);
  assert.equal(matches.has("3"), false);
  assert.equal(matches.has("4"), false);
  assert.equal(findPossibleDuplicateDeals(deals, { excludeDealIds: ["2"] }).size, 0);
});

test("price mismatch: v4 Plus entered at $2,268/yr while Stripe bills v5 Plus at $49/mo", () => {
  const plusV5 = {
    customerId: "cus_VJtQuyu8FFkkuq",
    priceId: "price_1U9TIdKDjVRgNn7vZlipraJ3",
    occurredAt: "2026-09-24T16:44:00.000Z",
    unitAmount: 49,
    quantity: 1,
    currency: "USD",
    interval: "month",
    intervalCount: 1,
  };
  const chosen = selectStripePlanPriceForDeal([plusV5], "2026-09-24T00:00:00.000Z");
  assert.equal(monthlyStripePlanPrice(chosen), 49);
  assert.equal(annualizedDealAmount(2268, 12), 2268);
  assert.equal(isPriceMismatch(2268, 49 * 12), true);
  // Annual Plus at $948/yr matches a $948/yr HubSpot amount (Yeesshh).
  assert.equal(monthlyStripePlanPrice({ unitAmount: 948, quantity: 1, interval: "year", intervalCount: 1 }), 79);
  assert.equal(isPriceMismatch(annualizedDealAmount(948, 12), 79 * 12), false);
  // Within 15% is fine; a 3-month POC is annualized before comparing.
  assert.equal(isPriceMismatch(1068, 89 * 12 * 1.1), false);
  assert.equal(annualizedDealAmount(4410, 3), 17640);
});

test("Stripe plan price for a deal: plan in effect at close, else the first one within 90 days after", () => {
  const price = (occurredAt, unitAmount) => ({
    customerId: "c",
    priceId: `p${unitAmount}`,
    occurredAt,
    unitAmount,
    quantity: 1,
    currency: "USD",
    interval: "month",
    intervalCount: 1,
  });
  const prices = [price("2026-01-01T00:00:00.000Z", 89), price("2026-09-09T23:00:00.000Z", 189), price("2026-10-01T00:00:00.000Z", 495)];
  assert.equal(selectStripePlanPriceForDeal(prices, "2026-09-09T00:00:00.000Z").unitAmount, 189);
  assert.equal(selectStripePlanPriceForDeal([prices[2]], "2026-09-09T00:00:00.000Z").unitAmount, 495);
  assert.equal(selectStripePlanPriceForDeal([prices[2]], "2026-06-01T00:00:00.000Z"), null);
});

test("billing switch: an existing customer whose MRR does not increase earns nothing", () => {
  // Monthly Plus $89 switched to annual Plus $948/yr ($79/mo) on close.
  const result = evaluateBillingSwitch({
    closeDate: "2026-09-21T00:00:00.000Z",
    changes: [
      { occurredAt: "2026-03-01T00:00:00.000Z", mrrChange: 89 },
      { occurredAt: "2026-09-21T00:00:00.000Z", mrrChange: 79 },
      { occurredAt: "2026-09-21T00:00:00.000Z", mrrChange: -89 },
    ],
  });
  assert.deepEqual(result, { mrrBefore: 89, mrrAfter: 79, noIncrease: true });
});

test("billing switch: Yeesshh ($60/mo add-ons before, $159/mo after) still earns", () => {
  const result = evaluateBillingSwitch({
    closeDate: "2026-10-14T00:00:00.000Z",
    changes: [
      { occurredAt: "2026-03-09T00:00:00.000Z", mrrChange: 20 },
      { occurredAt: "2026-05-19T00:00:00.000Z", mrrChange: 20 },
      { occurredAt: "2026-07-01T00:00:00.000Z", mrrChange: 25 },
      { occurredAt: "2026-08-01T00:00:00.000Z", mrrChange: -25 },
      { occurredAt: "2026-08-27T00:00:00.000Z", mrrChange: 20 },
      { occurredAt: "2026-10-14T00:00:00.000Z", mrrChange: 99 },
    ],
  });
  assert.deepEqual(result, { mrrBefore: 60, mrrAfter: 159, noIncrease: false });
});

test("billing switch: new customers, and subscriptions started shortly before close, are unaffected", () => {
  // No prior MRR at all.
  assert.equal(
    evaluateBillingSwitch({
      closeDate: "2026-09-24T00:00:00.000Z",
      changes: [{ occurredAt: "2026-09-24T00:00:00.000Z", mrrChange: 49 }],
    }).noIncrease,
    false,
  );
  // Subscribed 10 days before the deal was marked closed-won: still a new sale.
  assert.equal(
    evaluateBillingSwitch({
      closeDate: "2026-09-21T00:00:00.000Z",
      changes: [{ occurredAt: "2026-09-11T00:00:00.000Z", mrrChange: 189 }],
    }).noIncrease,
    false,
  );
  // Changes more than 7 days after close are ignored.
  assert.deepEqual(
    evaluateBillingSwitch({
      closeDate: "2026-09-01T00:00:00.000Z",
      changes: [
        { occurredAt: "2026-01-01T00:00:00.000Z", mrrChange: 20 },
        { occurredAt: "2026-09-09T00:00:00.000Z", mrrChange: 89 },
      ],
    }),
    { mrrBefore: 20, mrrAfter: 20, noIncrease: true },
  );
});
