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

      const hasReplacementStart = cluster.some((event) => {
        const type = String(event.eventType || "").trim().toUpperCase();
        return (type === "ACTIVE_START" || type === "ACTIVE_UPGRADE") && Number(event.mrrChange || 0) > 0;
      });
      const netMrrChange = cluster.reduce((sum, event) => sum + Number(event.mrrChange || 0), 0);
      // A net-positive Stripe plan transition is an upgrade signal, not a clawback by itself.
      // It is handled only when a qualifying replacement HubSpot deal exists.
      if (hasReplacementStart && netMrrChange >= 0) continue;

      const chosen =
        candidates.find((event) => String(event.eventType || "").trim().toUpperCase() === "ACTIVE_DOWNGRADE") ||
        candidates[0];
      risks.push({
        eventId: chosen.eventId,
        customerId: chosen.customerId,
        occurredAt: chosen.occurredAt,
        type: candidates.some(
          (event) => String(event.eventType || "").trim().toUpperCase() === "ACTIVE_DOWNGRADE",
        )
          ? "downgrade"
          : "churn",
      });
    }
  }

  return risks.sort(
    (a, b) => dateMs(a.occurredAt) - dateMs(b.occurredAt) || a.eventId.localeCompare(b.eventId),
  );
}

export function shouldIncludeCommissionDeal(input: {
  dealType: string;
  ownerIdentities: string[];
  existingBusinessOwnerNames: string[];
}) {
  const dealType = normalizedWords(input.dealType).replace(/\s+/g, "");
  if (dealType === "newbusiness") return true;
  if (dealType !== "existingbusiness") return false;

  const allowedOwners = new Set(input.existingBusinessOwnerNames.map(normalizedWords).filter(Boolean));
  return input.ownerIdentities.some((identity) => allowedOwners.has(normalizedWords(identity)));
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
    const eligibleRisk = (risksByDeal.get(deal.dealId) || [])
      .filter(
        (event) =>
          event.eventId.startsWith("deal-replacement:") || dateMs(event.occurredAt) < fullProtectionMs,
      )
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
