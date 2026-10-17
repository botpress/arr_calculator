export type CommissionRiskType = "churn" | "downgrade" | "upgrade";

export type CommissionPlanKey = "free" | "pay_as_you_go" | "plus" | "team" | "managed" | "enterprise";

export type CommissionDealRuleInput = {
  dealId: string;
  ownerId: string;
  workspaceId: string;
  closeDate: string;
  effectiveStartDate: string;
  planKey: CommissionPlanKey | "";
  termMonths: number;
  dealAmount: number;
  grossCommission: number;
};

export type CommissionPaymentRuleInput = {
  paymentId: string;
  workspaceId: string;
  paidDate: string;
  amount: number;
};

export type CommissionRiskRuleInput = {
  eventId: string;
  workspaceId: string;
  occurredAt: string;
  type: CommissionRiskType;
};

export type CommissionDealRuleResult = {
  dealId: string;
  allocatedPaidAmount: number;
  protectedAmount: number;
  monitoringStart: string;
  protectedUntil: string;
  fullyProtectedAt: string;
  proratedOpeningPaymentAmount: number;
  riskEventId: string;
  riskEventDate: string;
  riskType: CommissionRiskType | "";
  paidBeforeRisk: number;
  clawback: number;
  commissionableTermMonths: number;
  commissionableDealAmount: number;
  commissionableGrossCommission: number;
  replacementDealId: string;
};

export type CommissionPlanPaymentInput = {
  invoiceAmountPaid: number;
  amountRefunded: number;
  planLineAmount: number;
  totalPositiveLineAmount: number;
};

export type CommissionStripePlanEventInput = {
  eventId: string;
  customerId: string;
  subscriptionId: string;
  priceId: string;
  occurredAt: string;
  eventType: string;
  mrrChange: number;
};

export type CommissionStripeRiskResult = {
  eventId: string;
  customerId: string;
  occurredAt: string;
  type: Exclude<CommissionRiskType, "upgrade">;
};

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function dateMs(value: string) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function addMonthsIso(value: string, months: number) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const day = parsed.getUTCDate();
  const result = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + months, 1));
  const monthEndDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, monthEndDay));
  return result.toISOString();
}

function monitoringStartIso(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const monthOffset = parsed.getUTCDate() === 1 ? 0 : 1;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + monthOffset, 1)).toISOString();
}

function monthKey(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
}

function normalizedWorkspace(value: string) {
  return String(value || "").trim().toLowerCase();
}

function normalizedWords(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function commissionPlanKey(values: string[]): CommissionPlanKey | "" {
  const normalized = normalizedWords(values.filter(Boolean).join(" "));
  if (!normalized) return "";
  if (/\benterprise\b/.test(normalized)) return "enterprise";
  if (/\bmanaged\b/.test(normalized)) return "managed";
  if (/\bteam\b/.test(normalized)) return "team";
  if (/\bplus\b/.test(normalized)) return "plus";
  if (/\bpay\s+as\s+you\s+go\b|\bpayg\b/.test(normalized)) return "pay_as_you_go";
  if (/\bfree\b/.test(normalized)) return "free";
  return "";
}

export function isCommissionPlanLineDescription(value: string) {
  const normalized = normalizedWords(value);
  if (!normalized || normalized === "refund" || normalized === "discount") return false;
  if (/\badd\s*ons?\b/.test(normalized)) return false;
  if (/\bai\s+tokens?\b/.test(normalized)) return false;
  if (normalized.includes("web search and crawl")) return false;
  return true;
}

export function isCommissionPlanActivityDescription(values: string[]) {
  const descriptions = values
    .map((value) => String(value || "").trim())
    .filter((value) => value && value !== "(blank)" && value !== "(unknown)");
  return descriptions.length > 0 && isCommissionPlanLineDescription(descriptions.join(" "));
}

export function calculateNetCommissionPlanPayment(input: CommissionPlanPaymentInput) {
  const invoiceAmountPaid = Math.max(0, Number(input.invoiceAmountPaid || 0));
  const amountRefunded = Math.max(0, Number(input.amountRefunded || 0));
  const planLineAmount = Math.max(0, Number(input.planLineAmount || 0));
  const totalPositiveLineAmount = Math.max(0, Number(input.totalPositiveLineAmount || 0));
  if (!invoiceAmountPaid || !planLineAmount || !totalPositiveLineAmount) return 0;

  const netInvoicePayment = Math.max(0, invoiceAmountPaid - amountRefunded);
  const planShare = Math.min(1, planLineAmount / totalPositiveLineAmount);
  return round2(netInvoicePayment * planShare);
}

const STRIPE_PLAN_TRANSITION_WINDOW_MS = 5 * 60 * 1000;

export function deriveCommissionRisksFromStripePlanEvents(
  events: CommissionStripePlanEventInput[],
): CommissionStripeRiskResult[] {
  const grouped = new Map<string, CommissionStripePlanEventInput[]>();
  for (const event of events) {
    const customerId = String(event.customerId || "").trim();
    const occurredAtMs = dateMs(event.occurredAt);
    if (!customerId || !Number.isFinite(occurredAtMs)) continue;
    const subscriptionId = String(event.subscriptionId || "").trim();
    const key = `${customerId}|${subscriptionId || "(no subscription)"}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(event);
  }

  const risks: CommissionStripeRiskResult[] = [];
  for (const groupedEvents of grouped.values()) {
    const sorted = groupedEvents
      .slice()
      .sort((a, b) => dateMs(a.occurredAt) - dateMs(b.occurredAt) || a.eventId.localeCompare(b.eventId));
    const clusters: CommissionStripePlanEventInput[][] = [];
    for (const event of sorted) {
      const cluster = clusters.at(-1);
      const previous = cluster?.at(-1);
      if (!cluster || !previous || dateMs(event.occurredAt) - dateMs(previous.occurredAt) > STRIPE_PLAN_TRANSITION_WINDOW_MS) {
        clusters.push([event]);
      } else {
        cluster.push(event);
      }
    }

    for (const cluster of clusters) {
      const candidates = cluster.filter((event) => {
        const type = String(event.eventType || "").trim().toUpperCase();
        return type === "ACTIVE_DOWNGRADE" || type === "ACTIVE_END";
      });
      if (!candidates.length) continue;

      const replacementStarts = cluster.filter((event) => {
        const type = String(event.eventType || "").trim().toUpperCase();
        return (type === "ACTIVE_START" || type === "ACTIVE_UPGRADE") && Number(event.mrrChange || 0) > 0;
      });
      const hasReplacementStart = replacementStarts.length > 0;
      const netMrrChange = cluster.reduce((sum, event) => sum + Number(event.mrrChange || 0), 0);
      // A net-positive Stripe plan transition is an upgrade signal, not a clawback by itself.
      // It is handled only when a qualifying replacement HubSpot deal exists.
      if (hasReplacementStart && netMrrChange >= 0) continue;

      const hasPlanPriceReplacement = candidates.some((candidate) => {
        const oldPriceId = String(candidate.priceId || "").trim();
        if (!oldPriceId) return false;
        return replacementStarts.some((replacement) => {
          const newPriceId = String(replacement.priceId || "").trim();
          return Boolean(newPriceId && newPriceId !== oldPriceId);
        });
      });

      // Stripe also emits ACTIVE_DOWNGRADE when a discount lowers the MRR of an
      // otherwise unchanged subscription item. Only a different recurring price
      // proves that the customer actually moved to another plan.
      const hasStandaloneEnd = candidates.some(
        (event) => String(event.eventType || "").trim().toUpperCase() === "ACTIVE_END",
      ) && !hasReplacementStart;
      if (!hasPlanPriceReplacement && !hasStandaloneEnd) continue;

      const chosen =
        candidates.find((event) => String(event.eventType || "").trim().toUpperCase() === "ACTIVE_DOWNGRADE") ||
        candidates[0];
      risks.push({
        eventId: chosen.eventId,
        customerId: chosen.customerId,
        occurredAt: chosen.occurredAt,
        type: hasPlanPriceReplacement ? "downgrade" : "churn",
      });
    }
  }

  return risks.sort(
    (a, b) => dateMs(a.occurredAt) - dateMs(b.occurredAt) || a.eventId.localeCompare(b.eventId),
  );
}

export type CommissionExistingBusinessOwner = {
  ownerId: string;
  name: string;
};

// The approved reps whose Existing Business deals are commissioned, by HubSpot owner id
// (resolved from transformed_data.stg_hubspot_owners). Matching by id avoids first-name
// collisions (the old name list matched any "Sarah", including Sarah Chudleigh in Marketing).
export const DEFAULT_EXISTING_BUSINESS_OWNERS: CommissionExistingBusinessOwner[] = [
  { ownerId: "83341410", name: "Tyler Toole" },
  { ownerId: "83341425", name: "Luca Molinaro" },
  { ownerId: "90624408", name: "Evan Stamegna" },
  { ownerId: "90624409", name: "Felipe Garcia" },
  { ownerId: "87328779", name: "Antonin Roussel" },
];

// Owners who earn no per-deal commission on any deal type. Sarah Rother is a director, paid on
// her team's attainment only (she stays in the quota / team attainment section).
export const DEFAULT_EXCLUDED_OWNERS: CommissionExistingBusinessOwner[] = [
  { ownerId: "88054084", name: "Sarah Rother" },
];

export const EXCLUDED_OWNER_NOTE = "Director: paid on team attainment, not per deal";

/** COMMISSION_EXCLUDED_OWNER_IDS (comma-separated HubSpot owner ids) overrides the default list. */
export function resolveExcludedOwners(env: { ownerIds?: string }): CommissionExistingBusinessOwner[] {
  const ids = splitConfigList(env.ownerIds || "");
  if (!ids.length) return DEFAULT_EXCLUDED_OWNERS.map((owner) => ({ ...owner }));
  const knownNames = new Map(DEFAULT_EXCLUDED_OWNERS.map((owner) => [owner.ownerId, owner.name]));
  return ids.map((ownerId) => ({ ownerId, name: knownNames.get(ownerId) || "" }));
}

export function isExcludedCommissionOwner(ownerId: string, excludedOwnerIds: string[]) {
  const id = String(ownerId || "").trim();
  return !!id && excludedOwnerIds.some((excluded) => String(excluded || "").trim() === id);
}

export type CommissionExistingBusinessOwnerConfig =
  | { mode: "ids"; owners: CommissionExistingBusinessOwner[]; source: "default" | "env_ids" }
  | { mode: "names"; names: string[]; source: "env_names" };

function splitConfigList(value: string) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[;,|\n\r]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

/**
 * COMMISSION_EXISTING_BUSINESS_OWNER_IDS (comma-separated HubSpot owner ids) wins; the legacy
 * COMMISSION_EXISTING_BUSINESS_OWNER_NAMES still works when set and no id list is given;
 * otherwise the built-in owner ids are used.
 */
export function resolveExistingBusinessOwnerConfig(env: {
  ownerIds?: string;
  ownerNames?: string;
}): CommissionExistingBusinessOwnerConfig {
  const ids = splitConfigList(env.ownerIds || "");
  if (ids.length) {
    const knownNames = new Map(DEFAULT_EXISTING_BUSINESS_OWNERS.map((owner) => [owner.ownerId, owner.name]));
    return {
      mode: "ids",
      owners: ids.map((ownerId) => ({ ownerId, name: knownNames.get(ownerId) || "" })),
      source: "env_ids",
    };
  }
  const names = splitConfigList(env.ownerNames || "");
  if (names.length) return { mode: "names", names, source: "env_names" };
  return { mode: "ids", owners: DEFAULT_EXISTING_BUSINESS_OWNERS.map((owner) => ({ ...owner })), source: "default" };
}

export function shouldIncludeCommissionDeal(input: {
  dealType: string;
  ownerId?: string;
  existingBusinessOwnerIds?: string[];
  ownerIdentities?: string[];
  existingBusinessOwnerNames?: string[];
}) {
  const dealType = normalizedWords(input.dealType).replace(/\s+/g, "");
  if (dealType === "newbusiness") return true;
  if (dealType !== "existingbusiness") return false;

  if (input.existingBusinessOwnerIds) {
    const ownerId = String(input.ownerId || "").trim();
    return !!ownerId && input.existingBusinessOwnerIds.some((allowed) => String(allowed || "").trim() === ownerId);
  }

  const allowedOwners = new Set((input.existingBusinessOwnerNames || []).map(normalizedWords).filter(Boolean));
  return (input.ownerIdentities || []).some((identity) => allowedOwners.has(normalizedWords(identity)));
}

function sortedWorkspaceDeals(deals: CommissionDealRuleInput[]) {
  const byWorkspace = new Map<string, CommissionDealRuleInput[]>();
  for (const deal of deals) {
    const workspaceId = normalizedWorkspace(deal.workspaceId);
    if (!workspaceId) continue;
    if (!byWorkspace.has(workspaceId)) byWorkspace.set(workspaceId, []);
    byWorkspace.get(workspaceId)!.push(deal);
  }
  for (const values of byWorkspace.values()) {
    values.sort((a, b) => {
      const effectiveDiff = dateMs(a.effectiveStartDate) - dateMs(b.effectiveStartDate);
      if (effectiveDiff) return effectiveDiff;
      const closeDiff = dateMs(a.closeDate) - dateMs(b.closeDate);
      if (closeDiff) return closeDiff;
      return a.dealId.localeCompare(b.dealId);
    });
  }
  return byWorkspace;
}

type DealCommissionWindow = {
  commissionableTermMonths: number;
  commissionableDealAmount: number;
  commissionableGrossCommission: number;
  replacementDeal: CommissionDealRuleInput | null;
  replacementType: "upgrade" | "downgrade" | "";
};

const PLAN_RANK: Record<CommissionPlanKey, number> = {
  free: 0,
  pay_as_you_go: 1,
  plus: 2,
  team: 3,
  managed: 4,
  enterprise: 5,
};

function dateMonthIndex(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return NaN;
  return parsed.getUTCFullYear() * 12 + parsed.getUTCMonth();
}

function isDealBackedPlanReplacement(current: CommissionDealRuleInput, replacement: CommissionDealRuleInput) {
  return !!current.planKey && !!replacement.planKey && current.planKey !== replacement.planKey;
}

function buildDealCommissionWindows(
  deals: CommissionDealRuleInput[],
  byWorkspace: Map<string, CommissionDealRuleInput[]>,
) {
  const windows = new Map<string, DealCommissionWindow>();
  for (const deal of deals) {
    windows.set(deal.dealId, {
      commissionableTermMonths: Math.max(1, Number(deal.termMonths || 12)),
      commissionableDealAmount: Math.max(0, Number(deal.dealAmount || 0)),
      commissionableGrossCommission: Math.max(0, Number(deal.grossCommission || 0)),
      replacementDeal: null,
      replacementType: "",
    });
  }

  for (const workspaceDeals of byWorkspace.values()) {
    let contractEndMonth = Number.NEGATIVE_INFINITY;
    let previous: CommissionDealRuleInput | null = null;
    for (const deal of workspaceDeals) {
      const rawStartMonth = dateMonthIndex(deal.effectiveStartDate);
      const replacementStartMonth = dateMonthIndex(monitoringStartIso(deal.effectiveStartDate));
      const termMonths = Math.max(1, Number(deal.termMonths || 12));
      const isReplacement =
        !!previous &&
        Number.isFinite(replacementStartMonth) &&
        replacementStartMonth < contractEndMonth &&
        isDealBackedPlanReplacement(previous, deal);

      if (!isReplacement) {
        contractEndMonth = Number.isFinite(rawStartMonth)
          ? rawStartMonth + termMonths
          : Number.NEGATIVE_INFINITY;
        previous = deal;
        continue;
      }

      const remainingTermMonths = Math.max(
        1,
        Math.min(termMonths, contractEndMonth - replacementStartMonth),
      );
      const scale = Math.min(1, remainingTermMonths / termMonths);
      const currentWindow = windows.get(deal.dealId)!;
      currentWindow.commissionableTermMonths = remainingTermMonths;
      currentWindow.commissionableDealAmount = round2(Math.max(0, Number(deal.dealAmount || 0)) * scale);
      currentWindow.commissionableGrossCommission = round2(
        Math.max(0, Number(deal.grossCommission || 0)) * scale,
      );

      const previousWindow = windows.get(previous!.dealId)!;
      previousWindow.replacementDeal = deal;
      previousWindow.replacementType = PLAN_RANK[deal.planKey as CommissionPlanKey] > PLAN_RANK[previous!.planKey as CommissionPlanKey]
        ? "upgrade"
        : "downgrade";
      previous = deal;
    }
  }

  return windows;
}

function choosePaymentDeal(deals: CommissionDealRuleInput[], paidAtMs: number) {
  let chosen: CommissionDealRuleInput | null = null;
  for (const deal of deals) {
    const closeAtMs = dateMs(deal.closeDate);
    if (!Number.isFinite(closeAtMs) || closeAtMs > paidAtMs) continue;
    if (!chosen || closeAtMs >= dateMs(chosen.closeDate)) chosen = deal;
  }
  return chosen;
}

function chooseRiskDeal(deals: CommissionDealRuleInput[], eventAtMs: number) {
  let chosen: CommissionDealRuleInput | null = null;
  for (const deal of deals) {
    const effectiveAtMs = dateMs(deal.effectiveStartDate);
    const closeAtMs = dateMs(deal.closeDate);
    if (!Number.isFinite(effectiveAtMs) || !Number.isFinite(closeAtMs)) continue;
    // A downgrade event at the exact instant a replacement starts belongs to the prior deal.
    if (effectiveAtMs >= eventAtMs || closeAtMs > eventAtMs) continue;
    if (!chosen || effectiveAtMs >= dateMs(chosen.effectiveStartDate)) chosen = deal;
  }
  return chosen;
}

export function calculateCommissionClawbacks(
  deals: CommissionDealRuleInput[],
  payments: CommissionPaymentRuleInput[],
  riskEvents: CommissionRiskRuleInput[],
): CommissionDealRuleResult[] {
  const byWorkspace = sortedWorkspaceDeals(deals);
  const dealWindows = buildDealCommissionWindows(deals, byWorkspace);
  const paymentsByDeal = new Map<string, CommissionPaymentRuleInput[]>();
  const risksByDeal = new Map<string, CommissionRiskRuleInput[]>();

  for (const payment of payments) {
    const workspaceDeals = byWorkspace.get(normalizedWorkspace(payment.workspaceId)) || [];
    const paidAtMs = dateMs(payment.paidDate);
    if (!Number.isFinite(paidAtMs) || Number(payment.amount || 0) <= 0) continue;
    const deal = choosePaymentDeal(workspaceDeals, paidAtMs);
    if (!deal) continue;
    if (!paymentsByDeal.has(deal.dealId)) paymentsByDeal.set(deal.dealId, []);
    paymentsByDeal.get(deal.dealId)!.push(payment);
  }

  const uniqueRiskEvents = new Map<string, CommissionRiskRuleInput>();
  for (const event of riskEvents) {
    const workspaceId = normalizedWorkspace(event.workspaceId);
    const eventAtMs = dateMs(event.occurredAt);
    if (!workspaceId || !Number.isFinite(eventAtMs)) continue;
    const fingerprint = `${workspaceId}|${eventAtMs}`;
    const current = uniqueRiskEvents.get(fingerprint);
    if (!current || event.type === "downgrade") uniqueRiskEvents.set(fingerprint, event);
  }

  for (const event of uniqueRiskEvents.values()) {
    const workspaceDeals = byWorkspace.get(normalizedWorkspace(event.workspaceId)) || [];
    const deal = chooseRiskDeal(workspaceDeals, dateMs(event.occurredAt));
    if (!deal) continue;
    if (!risksByDeal.has(deal.dealId)) risksByDeal.set(deal.dealId, []);
    risksByDeal.get(deal.dealId)!.push(event);
  }

  for (const deal of deals) {
    const window = dealWindows.get(deal.dealId);
    const replacement = window?.replacementDeal;
    if (!window || !replacement || !window.replacementType) continue;
    if (!risksByDeal.has(deal.dealId)) risksByDeal.set(deal.dealId, []);
    risksByDeal.get(deal.dealId)!.push({
      eventId: `deal-replacement:${deal.dealId}:${replacement.dealId}`,
      workspaceId: deal.workspaceId,
      occurredAt: replacement.closeDate,
      type: window.replacementType,
    });
  }

  return deals.map((deal) => {
    const window = dealWindows.get(deal.dealId)!;
    const termMonths = window.commissionableTermMonths;
    const dealAmount = window.commissionableDealAmount;
    const protectedAmount = round2(Math.min(dealAmount, dealAmount * (Math.min(3, termMonths) / termMonths)));
    const monitoringStart = monitoringStartIso(deal.effectiveStartDate);
    const monitoringStartMs = dateMs(monitoringStart);
    const protectedUntil = addMonthsIso(monitoringStart, 3);
    const dealPayments = (paymentsByDeal.get(deal.dealId) || [])
      .slice()
      .sort((a, b) => dateMs(a.paidDate) - dateMs(b.paidDate) || a.paymentId.localeCompare(b.paymentId));

    let cumulativePaid = 0;
    let protectionEligiblePaid = 0;
    let proratedOpeningPaymentAmount = 0;
    let fullyProtectedAt = "";
    for (const payment of dealPayments) {
      const paymentAmount = Math.max(0, Number(payment.amount || 0));
      cumulativePaid = round2(cumulativePaid + paymentAmount);
      if (dateMs(payment.paidDate) < monitoringStartMs) {
        proratedOpeningPaymentAmount = round2(proratedOpeningPaymentAmount + paymentAmount);
        continue;
      }
      protectionEligiblePaid = round2(protectionEligiblePaid + paymentAmount);
      if (!fullyProtectedAt && protectedAmount > 0 && protectionEligiblePaid + 0.005 >= protectedAmount) {
        fullyProtectedAt = payment.paidDate;
      }
    }

    const fullProtectionMs = fullyProtectedAt ? dateMs(fullyProtectedAt) : Number.POSITIVE_INFINITY;
    const protectionExpiryMs = dateMs(protectedUntil);
    const riskCutoffMs = Math.min(
      fullProtectionMs,
      Number.isFinite(protectionExpiryMs) ? protectionExpiryMs : Number.POSITIVE_INFINITY,
    );
    const eligibleRisk = (risksByDeal.get(deal.dealId) || [])
      .filter((event) => dateMs(event.occurredAt) < riskCutoffMs)
      .sort((a, b) => dateMs(a.occurredAt) - dateMs(b.occurredAt) || a.eventId.localeCompare(b.eventId))[0];

    let paidBeforeRisk = 0;
    if (eligibleRisk) {
      const riskAtMs = dateMs(eligibleRisk.occurredAt);
      paidBeforeRisk = dealPayments
        .filter((payment) => dateMs(payment.paidDate) <= riskAtMs)
        .reduce((sum, payment) => sum + Math.max(0, Number(payment.amount || 0)), 0);
    }
    paidBeforeRisk = round2(Math.min(dealAmount, paidBeforeRisk));

    const effectiveRate =
      dealAmount > 0 ? Math.max(0, Number(window.commissionableGrossCommission || 0)) / dealAmount : 0;
    const earnedCommission = round2(paidBeforeRisk * effectiveRate);
    const grossCommission = Math.max(0, Number(window.commissionableGrossCommission || 0));
    const clawback = eligibleRisk
      ? round2(Math.min(grossCommission, Math.max(0, grossCommission - earnedCommission)))
      : 0;

    return {
      dealId: deal.dealId,
      allocatedPaidAmount: round2(Math.min(dealAmount, cumulativePaid)),
      protectedAmount,
      monitoringStart,
      protectedUntil,
      fullyProtectedAt,
      proratedOpeningPaymentAmount,
      riskEventId: eligibleRisk?.eventId || "",
      riskEventDate: eligibleRisk?.occurredAt || "",
      riskType: eligibleRisk?.type || "",
      paidBeforeRisk,
      clawback,
      commissionableTermMonths: window.commissionableTermMonths,
      commissionableDealAmount: window.commissionableDealAmount,
      commissionableGrossCommission: window.commissionableGrossCommission,
      replacementDealId: window.replacementDeal?.dealId || "",
    };
  });
}

export function commissionMonthKey(value: string) {
  return monthKey(value);
}

export type CommissionMrrChange = {
  /** When the MRR change happened (ISO timestamp or YYYY-MM-DD). */
  occurredAt: string;
  /** Signed net MRR change in the report currency (major units). */
  mrrChange: number;
  /**
   * Number of Stripe item events with a non-zero MRR change behind this entry (a same-price
   * monthly-to-annual switch nets to 0 but still has events). Defaults to 1 when mrrChange != 0.
   */
  changeEvents?: number;
};

export type CommissionBillingSwitchResult = {
  mrrBefore: number;
  mrrAfter: number;
  /** Stripe shows a billing change (subscription/price start, end or plan change) from the close day to the end of the after window. */
  billingChanged: boolean;
  /** Existing paying customer, billing changed after close, and MRR did not go up: not paid. */
  noIncrease: boolean;
  /** Existing paying customer, MRR did not go up, but Stripe shows no billing change since close: warn, still paid. */
  billingNotUpdated: boolean;
};

// MRR "before" is measured this many days before the close day: new customers often start
// their Stripe subscription a few days (sometimes weeks) before the deal is marked closed-won,
// and that start must not count as prior MRR.
export const BILLING_SWITCH_BEFORE_DAYS = 30;
// MRR "after" includes changes up to the end of this many days after the close day.
export const BILLING_SWITCH_AFTER_DAYS = 7;

/**
 * An existing customer who moves to a new (e.g. annual) contract without paying more earns no
 * commission. Compares the customer's running Stripe MRR before close with MRR right after it.
 * The deal is zeroed only when Stripe actually shows a billing change after close; when it shows
 * none (the new plan may not be invoiced yet) the deal is kept and flagged instead.
 * Customers with no prior MRR are never affected.
 */
export function evaluateBillingSwitch(input: {
  changes: CommissionMrrChange[];
  closeDate: string;
  beforeDays?: number;
  afterDays?: number;
}): CommissionBillingSwitchResult {
  const dayMs = 24 * 60 * 60 * 1000;
  const closeDay = dateMs(`${String(input.closeDate || "").slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(closeDay)) {
    return { mrrBefore: 0, mrrAfter: 0, billingChanged: false, noIncrease: false, billingNotUpdated: false };
  }
  const beforeCutoff = closeDay - (input.beforeDays ?? BILLING_SWITCH_BEFORE_DAYS) * dayMs;
  const afterCutoff = closeDay + ((input.afterDays ?? BILLING_SWITCH_AFTER_DAYS) + 1) * dayMs;
  let before = 0;
  let after = 0;
  let billingChanged = false;
  for (const change of input.changes) {
    const at = dateMs(change.occurredAt);
    if (!Number.isFinite(at)) continue;
    const amount = Number(change.mrrChange || 0);
    const events = change.changeEvents ?? (amount ? 1 : 0);
    if (events > 0 && at >= closeDay && at < afterCutoff) billingChanged = true;
    if (!amount) continue;
    if (at < beforeCutoff) before += amount;
    if (at < afterCutoff) after += amount;
  }
  const mrrBefore = round2(Math.max(0, before));
  const mrrAfter = round2(Math.max(0, after));
  // MRR falling to $0 is a cancellation, handled by the clawback rule, not a billing switch.
  const existingWithoutIncrease = mrrBefore > 0.005 && mrrAfter > 0.005 && mrrAfter <= mrrBefore + 0.005;
  return {
    mrrBefore,
    mrrAfter,
    billingChanged,
    noIncrease: existingWithoutIncrease && billingChanged,
    billingNotUpdated: existingWithoutIncrease && !billingChanged,
  };
}
