// Pure helpers for the per-deal warning flags on the Commissions report.
// None of these change commission rates or amounts, except the strict duplicate
// rule, which keeps one sale from being paid twice.

export type CommissionFlagType =
  | "duplicate"
  | "possible_duplicate"
  | "price_mismatch"
  | "cancellation_untrackable"
  | "owner_unknown"
  | "no_increase";

export type CommissionFlag = {
  type: CommissionFlagType;
  message: string;
};

export type CommissionDuplicateCandidate = {
  dealId: string;
  dealName?: string;
  workspaceId: string;
  stripeCustomerIds: string[];
  planKey: string;
  closeDate: string;
  commissionable: boolean;
};

export const STRICT_DUPLICATE_WINDOW_DAYS = 14;
export const POSSIBLE_DUPLICATE_WINDOW_DAYS = 90;
export const PRICE_MISMATCH_TOLERANCE = 0.15;

const DAY_MS = 24 * 60 * 60 * 1000;

function dateMs(value: string) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function closeDayMs(value: string) {
  const day = String(value || "").slice(0, 10);
  return dateMs(`${day}T00:00:00.000Z`);
}

function normalized(value: string) {
  return String(value || "").trim().toLowerCase();
}

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** True when two deals point at the same customer: same workspace or a shared Stripe customer. */
export function sameCommissionCustomer(a: CommissionDuplicateCandidate, b: CommissionDuplicateCandidate) {
  const workspaceA = normalized(a.workspaceId);
  if (workspaceA && workspaceA === normalized(b.workspaceId)) return true;
  const customersA = new Set((a.stripeCustomerIds || []).map(normalized).filter(Boolean));
  return (b.stripeCustomerIds || []).some((customerId) => customersA.has(normalized(customerId)));
}

function closeDaysApart(a: CommissionDuplicateCandidate, b: CommissionDuplicateCandidate) {
  const diff = Math.abs(closeDayMs(a.closeDate) - closeDayMs(b.closeDate));
  return Number.isFinite(diff) ? diff / DAY_MS : Number.POSITIVE_INFINITY;
}

function byCloseThenId(a: CommissionDuplicateCandidate, b: CommissionDuplicateCandidate) {
  const diff = closeDayMs(a.closeDate) - closeDayMs(b.closeDate);
  if (diff) return diff;
  return compareDealIds(a.dealId, b.dealId);
}

/** Numeric HubSpot ids compare as numbers so "999" sorts before "1000". */
export function compareDealIds(a: string, b: string) {
  const left = String(a || "");
  const right = String(b || "");
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    if (left.length !== right.length) return left.length - right.length;
  }
  return left.localeCompare(right);
}

/**
 * Strict rule: two or more commissionable deals for the same customer (workspace or Stripe
 * customer), on the same known plan, closing within 14 days of each other are one sale.
 * The earliest-closed deal keeps the commission (tie-break: lowest deal id); every other deal
 * maps to the kept deal id. Different plans are plan changes, handled by the replacement rules.
 */
export function findStrictDuplicateDeals(
  deals: CommissionDuplicateCandidate[],
  windowDays = STRICT_DUPLICATE_WINDOW_DAYS,
) {
  const duplicateOf = new Map<string, string>();
  const kept: CommissionDuplicateCandidate[] = [];
  const sorted = deals.filter((deal) => deal.commissionable && deal.planKey).slice().sort(byCloseThenId);
  for (const deal of sorted) {
    const original = kept.find(
      (candidate) =>
        candidate.planKey === deal.planKey &&
        sameCommissionCustomer(candidate, deal) &&
        closeDaysApart(candidate, deal) <= windowDays,
    );
    if (original) duplicateOf.set(deal.dealId, original.dealId);
    else kept.push(deal);
  }
  return duplicateOf;
}

/** The paid deal (if any) that `deal` would be a strict duplicate of. */
export function findStrictDuplicateMatch(
  deal: CommissionDuplicateCandidate,
  paidDeals: CommissionDuplicateCandidate[],
  windowDays = STRICT_DUPLICATE_WINDOW_DAYS,
) {
  if (!deal.planKey) return null;
  return (
    paidDeals
      .filter(
        (candidate) =>
          candidate.dealId !== deal.dealId &&
          candidate.planKey === deal.planKey &&
          sameCommissionCustomer(candidate, deal) &&
          closeDaysApart(candidate, deal) <= windowDays,
      )
      .sort(byCloseThenId)[0] || null
  );
}

/**
 * Warning-only rule: commissionable deals for the same customer closing within 90 days of each
 * other. Strict duplicates (already zeroed) and pairs on two different known plans (plan
 * changes, handled by the replacement rules) are left out. Returns dealId -> other deal ids.
 */
export function findPossibleDuplicateDeals(
  deals: CommissionDuplicateCandidate[],
  options: { windowDays?: number; excludeDealIds?: Iterable<string> } = {},
) {
  const windowDays = options.windowDays ?? POSSIBLE_DUPLICATE_WINDOW_DAYS;
  const excluded = new Set(options.excludeDealIds || []);
  const eligible = deals.filter((deal) => deal.commissionable && !excluded.has(deal.dealId)).sort(byCloseThenId);
  const matches = new Map<string, string[]>();
  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      const a = eligible[i];
      const b = eligible[j];
      if (closeDaysApart(a, b) > windowDays) continue;
      if (!sameCommissionCustomer(a, b)) continue;
      if (a.planKey && b.planKey && a.planKey !== b.planKey) continue;
      if (!matches.has(a.dealId)) matches.set(a.dealId, []);
      if (!matches.has(b.dealId)) matches.set(b.dealId, []);
      matches.get(a.dealId)!.push(b.dealId);
      matches.get(b.dealId)!.push(a.dealId);
    }
  }
  return matches;
}

export type StripePlanPriceObservation = {
  customerId: string;
  priceId: string;
  occurredAt: string;
  /** Unit amount in major currency units (e.g. dollars). */
  unitAmount: number;
  quantity: number;
  currency: string;
  interval: string;
  intervalCount: number;
};

/** Monthly list price of a recurring Stripe price, or 0 when it cannot be expressed monthly. */
export function monthlyStripePlanPrice(observation: Pick<StripePlanPriceObservation, "unitAmount" | "quantity" | "interval" | "intervalCount">) {
  const unitAmount = Number(observation.unitAmount || 0);
  if (!(unitAmount > 0)) return 0;
  const quantity = Number(observation.quantity || 0) > 0 ? Number(observation.quantity) : 1;
  const count = Number(observation.intervalCount || 0) > 0 ? Number(observation.intervalCount) : 1;
  const interval = normalized(observation.interval);
  let months = 0;
  if (interval === "month") months = count;
  else if (interval === "year") months = 12 * count;
  else if (interval === "week") months = (count * 7 * 12) / 365;
  else if (interval === "day") months = (count * 12) / 365;
  if (!months) return 0;
  return round2((unitAmount * quantity) / months);
}

/**
 * The Stripe plan price for a deal: the plan started most recently at or before the close day
 * (end of day), otherwise the first plan started within 90 days after close.
 */
export function selectStripePlanPriceForDeal(
  observations: StripePlanPriceObservation[],
  closeDate: string,
  afterCloseDays = 90,
) {
  const closeEndMs = closeDayMs(closeDate) + DAY_MS - 1;
  if (!Number.isFinite(closeEndMs)) return null;
  const valid = observations
    .filter((observation) => monthlyStripePlanPrice(observation) > 0 && Number.isFinite(dateMs(observation.occurredAt)))
    .sort((a, b) => dateMs(a.occurredAt) - dateMs(b.occurredAt) || a.priceId.localeCompare(b.priceId));
  const before = valid.filter((observation) => dateMs(observation.occurredAt) <= closeEndMs);
  if (before.length) return before[before.length - 1];
  return valid.find((observation) => dateMs(observation.occurredAt) <= closeEndMs + afterCloseDays * DAY_MS) || null;
}

/** HubSpot contract amount expressed per year. */
export function annualizedDealAmount(dealAmount: number, termMonths: number) {
  const months = Number(termMonths || 0) > 0 ? Number(termMonths) : 12;
  return round2((Math.max(0, Number(dealAmount || 0)) * 12) / months);
}

/** True when the HubSpot annual amount differs from the Stripe annual price by more than the tolerance. */
export function isPriceMismatch(hubspotAnnual: number, stripeAnnual: number, tolerance = PRICE_MISMATCH_TOLERANCE) {
  const hubspot = Number(hubspotAnnual || 0);
  const stripe = Number(stripeAnnual || 0);
  if (!(hubspot > 0) || !(stripe > 0)) return false;
  return Math.abs(hubspot - stripe) / stripe > tolerance;
}
