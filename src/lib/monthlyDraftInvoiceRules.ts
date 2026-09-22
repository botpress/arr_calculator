import type { HubspotLineItemProps } from "./types";

export type DraftInvoiceLine = {
  lineItemId: string;
  description: string;
  amountMinor: number;
  currency: string;
  periodStart: number;
  periodEnd: number;
};

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);
const THREE_DECIMAL_CURRENCIES = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

function dateOnlyUtc(value: unknown) {
  const raw = String(value || "").trim();
  if (/^\d{10,13}$/.test(raw)) {
    const timestamp = Number(raw) * (raw.length === 10 ? 1000 : 1);
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime())
      ? null
      : new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) return null;
  return date;
}

function daysInUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addMonthsClampedUtc(date: Date, months: number) {
  const monthIndex = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthDifference(from: Date, to: Date) {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseBillingMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) throw new Error("Invalid billing month. Expected YYYY-MM.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error("Invalid billing month. Expected YYYY-MM.");
  return new Date(Date.UTC(year, month - 1, 1));
}

export function currentBillingMonth(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function billingCadenceMonths(value: unknown): number | null {
  const frequency = String(value || "").trim().toLowerCase();
  if (!frequency) return null;
  if (frequency.includes("one")) return 0;
  if (frequency === "per_six_months" || (frequency.includes("six") && frequency.includes("month")) || frequency.includes("semi") || frequency.includes("half")) return 6;
  if (frequency === "per_quarter" || frequency.includes("quarter") || (frequency.includes("three") && frequency.includes("month"))) return 3;
  if (frequency.includes("month")) return 1;
  if (frequency.includes("year") || frequency.includes("annual")) return 12;
  return null;
}

export function majorAmountToMinor(amount: number, currency: string) {
  const normalizedCurrency = currency.trim().toLowerCase();
  const exponent = ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)
    ? 0
    : THREE_DECIMAL_CURRENCIES.has(normalizedCurrency)
      ? 3
      : 2;
  return Math.round(amount * 10 ** exponent);
}

function isoDurationMonths(value: unknown) {
  const match = /^P(?:(\d+)Y)?(?:(\d+)M)?$/i.exec(String(value || "").trim());
  if (!match) return 0;
  return Number(match[1] || 0) * 12 + Number(match[2] || 0);
}

function contractEndExclusive(properties: HubspotLineItemProps, start: Date, cadenceMonths: number) {
  const explicitEnd =
    dateOnlyUtc(properties.hs_recurring_billing_end_date) ||
    dateOnlyUtc(properties.hs_billing_period_end_date);
  if (explicitEnd) return explicitEnd;

  const termMonths =
    Math.floor(numeric(properties.hs_term_in_months)) ||
    isoDurationMonths(properties.hs_recurring_billing_period) ||
    Math.floor(numeric(properties.hs_recurring_billing_number_of_payments)) * cadenceMonths;
  return termMonths > 0 ? addMonthsClampedUtc(start, termMonths) : null;
}

export function buildDraftInvoiceLine(args: {
  lineItemId: string;
  properties: HubspotLineItemProps;
  billingMonth: string;
  currency: string;
}): { line: DraftInvoiceLine | null; reason?: string } {
  const { properties } = args;
  const targetMonth = parseBillingMonth(args.billingMonth);
  const start =
    dateOnlyUtc(properties.hs_recurring_billing_start_date) ||
    dateOnlyUtc(properties.hs_billing_period_start_date);
  if (!start) return { line: null, reason: "missing_billing_start" };

  const cadenceMonths = billingCadenceMonths(properties.recurringbillingfrequency);
  if (cadenceMonths == null) return { line: null, reason: "unsupported_frequency" };

  const startMonth = startOfUtcMonth(start);
  const elapsedMonths = monthDifference(startMonth, targetMonth);
  if (elapsedMonths < 0) return { line: null, reason: "not_due" };
  if (cadenceMonths === 0 && elapsedMonths !== 0) return { line: null, reason: "not_due" };
  if (cadenceMonths > 0 && elapsedMonths % cadenceMonths !== 0) return { line: null, reason: "not_due" };

  const endExclusive = contractEndExclusive(properties, start, cadenceMonths);
  const billingTerms = String(properties.hs_recurring_billing_terms || "").trim().toUpperCase();
  const isOpenEnded = billingTerms === "AUTOMATICALLY_RENEW" || billingTerms === "FOREVER" || billingTerms === "UNTIL_CANCELLED";
  if (cadenceMonths > 0 && !endExclusive && !isOpenEnded) return { line: null, reason: "missing_contract_end" };

  const installmentStart = cadenceMonths === 0 ? start : addMonthsClampedUtc(start, elapsedMonths);
  if (endExclusive && installmentStart.getTime() >= endExclusive.getTime()) {
    return { line: null, reason: "contract_ended" };
  }

  const rawAmount = numeric(properties.amount) || numeric(properties.net_price);
  if (rawAmount <= 0) return { line: null, reason: "invalid_amount" };

  const currency = String(args.currency || "").trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) return { line: null, reason: "invalid_currency" };
  const amountMinor = majorAmountToMinor(rawAmount, currency);
  if (amountMinor <= 0) return { line: null, reason: "invalid_amount" };

  const scheduledEndExclusive = cadenceMonths === 0
    ? new Date(installmentStart.getTime() + 24 * 60 * 60 * 1000)
    : addMonthsClampedUtc(start, elapsedMonths + cadenceMonths);
  const effectiveEndExclusive = endExclusive && endExclusive < scheduledEndExclusive
    ? endExclusive
    : scheduledEndExclusive;
  const periodEnd = Math.max(
    Math.floor(installmentStart.getTime() / 1000),
    Math.floor((effectiveEndExclusive.getTime() - 1000) / 1000),
  );
  const description = String(
    properties.name || properties.hs_product_name || properties.description || properties.hs_sku || `HubSpot line item ${args.lineItemId}`,
  ).trim();

  return {
    line: {
      lineItemId: args.lineItemId,
      description: description.slice(0, 500),
      amountMinor,
      currency,
      periodStart: Math.floor(installmentStart.getTime() / 1000),
      periodEnd,
    },
  };
}
