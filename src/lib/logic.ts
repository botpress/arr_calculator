// lib/logic.ts
import { HubspotLineItemProps } from "./types";

export const FX_TARGET_CURRENCY = process.env.FX_TARGET_CURRENCY || "USD";

export const LI_PROPS = [
  // billing window
  "hs_recurring_billing_start_date",
  "hs_recurring_billing_end_date",
  "hs_billing_period_start_date",
  "hs_billing_period_end_date",
  "hs_term_in_months",
  "hs_recurring_billing_period",
  "hs_recurring_billing_number_of_payments",
  "hs_recurring_billing_terms",

  // pricing
  "amount",
  "net_price",
  "quantity",

  // recurrence
  "recurringbillingfrequency",

  // plan classification hints
  "name",
  "description",
  "hs_product_name",
  "hs_sku",
];

export type Window = { start: Date; end: Date; endIsOpenEnded: boolean };

export function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function toNumber(v: unknown) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export function firstOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function formatPeriodLabelMonthly(d: Date) {
  const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${m[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
}

export function formatPeriodKeyMonthly(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

/**
 * FIX: HubSpot returns date-only strings like "2026-04-01".
 * new Date("YYYY-MM-DD") parses as UTC → shifts locally.
 * Parse YYYY-MM-DD as LOCAL midnight.
 */
export function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).trim();

  // epoch ms or seconds
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    const epochMs = s.length === 10 ? n * 1000 : n;
    const dt = new Date(epochMs);
    if (isNaN(dt.getTime())) return null;

    // HubSpot date-type fields are often returned as epoch UTC midnight.
    // Preserve the calendar day in local time to avoid timezone day-shift.
    if (dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0 && dt.getUTCSeconds() === 0 && dt.getUTCMilliseconds() === 0) {
      return new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    }
    return dt;
  }

  // DATE-ONLY
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const dt = new Date(y, mo, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function computeWindowForLineItem(p: HubspotLineItemProps): Window | null {
  const start =
    parseDate(p.hs_recurring_billing_start_date) ||
    parseDate(p.hs_billing_period_start_date);

  if (!start) return null;

  let end =
    parseDate(p.hs_recurring_billing_end_date) ||
    parseDate(p.hs_billing_period_end_date);

  let endIsOpenEnded = false;

  if (end) {
    // HubSpot recurring/billing end dates behave like exclusive bounds in this report context.
    // Shift to an inclusive day-end boundary for period coverage logic.
    end = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  } else {
    const term = toNumber(p.hs_term_in_months);
    if (term) {
      end = new Date(start.getFullYear(), start.getMonth() + term, start.getDate() - 1);
    } else {
      end = new Date(2100, 0, 1);
      endIsOpenEnded = true;
    }
  }

  return { start, end, endIsOpenEnded };
}

export function isOneTimeLineItem(p: HubspotLineItemProps) {
  const w = computeWindowForLineItem(p);
  if (!w) return true; // safe default
  // NEW RULE: open-ended => one-time
  return !!w.endIsOpenEnded;
}

export function frequencyMultiplier(freqRaw: unknown) {
  const freq = String(freqRaw || "").trim().toLowerCase();

  if (freq.includes("one")) return 0;

  if (freq === "per_six_months" || (freq.includes("six") && freq.includes("month"))) return 2;
  if (freq === "per_quarter" || freq.includes("quarter") || (freq.includes("three") && freq.includes("month"))) return 4;
  if (freq.includes("semi") || freq.includes("half")) return 2;

  if (freq.includes("month")) return 12;
  if (freq.includes("year") || freq.includes("annual")) return 1;

  return 0;
}

export function computeCalculatedArrForLineItem(p: HubspotLineItemProps) {
  // NEW RULE: open-ended => one-time => ARR = 0
  if (isOneTimeLineItem(p)) return 0;

  let base = toNumber(p.amount);
  if (!base) base = toNumber(p.net_price);
  if (!base) return 0;

  const mult = frequencyMultiplier(p.recurringbillingfrequency);
  if (!mult) return 0;

  return round2(base * mult);
}

export function buildMonthlyPeriods(startMonth: Date, endMonth: Date) {
  const periods: { key: string; label: string; start: Date; end: Date }[] = [];
  for (let m = new Date(startMonth); m <= endMonth; m = addMonths(m, 1)) {
    const fm = firstOfMonth(m);
    periods.push({
      key: formatPeriodKeyMonthly(fm),
      label: formatPeriodLabelMonthly(fm),
      start: fm,
      end: endOfMonth(fm),
    });
  }
  return periods;
}

export type Grain = "daily" | "monthly" | "quarterly" | "annually";

/**
 * Aggregate monthly periods into quarterly/annual periods by summing month values.
 * (This preserves your month-end inclusion semantics perfectly.)
 */
export function aggregatePeriodsFromMonthly(
  monthlyPeriods: { key: string; label: string; start: Date; end: Date }[],
  grain: Grain,
) {
  if (grain === "monthly") return monthlyPeriods;

  if (grain === "annually") {
    const byYear = new Map<number, typeof monthlyPeriods>();
    for (const p of monthlyPeriods) {
      const y = p.start.getFullYear();
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(p);
    }
    return Array.from(byYear.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([y, months]) => ({
        key: String(y),
        label: String(y),
        start: months[0].start,
        end: months[months.length - 1].end,
        members: months.map((m) => m.key),
      }));
  }

  // quarterly
  const groups = new Map<string, typeof monthlyPeriods>();
  for (const p of monthlyPeriods) {
    const y = p.start.getFullYear();
    const q = Math.floor(p.start.getMonth() / 3) + 1;
    const k = `${y}-Q${q}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, months]) => ({
      key: k,
      label: k,
      start: months[0].start,
      end: months[months.length - 1].end,
      members: months.map((m) => m.key),
    }));
}
