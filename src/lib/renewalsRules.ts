// Pure helpers for the Renewals page (no imports so tests can load this file directly).

export const RENEWAL_WINDOW_OPTIONS = [30, 60, 90] as const;
export type RenewalWindowDays = (typeof RENEWAL_WINDOW_OPTIONS)[number];
export const MAX_RENEWAL_WINDOW_DAYS = 90;
export const LEGACY_SUNSET_DATE = "2026-12-31";

export type RenewalDeployment = "Cloud" | "Legacy";
export type RenewalStatusKind = "renewed" | "in_progress" | "none";

export type RenewalRow = {
  dealId: string;
  dealName: string;
  dealUrl: string;
  companyId: string;
  companyName: string;
  companyUrl: string;
  /** HubSpot end date: the first day the contract is no longer active. */
  renewalDate: string;
  arr: number;
  nativeArr: number;
  currency: string;
  fxMissing: boolean;
  fxFallback: boolean;
  deploymentType: string;
  deployment: RenewalDeployment;
  csmOwnerId: string;
  csmOwnerName: string;
  dealOwnerId: string;
  dealOwnerName: string;
  status: RenewalStatusKind;
  statusLabel: string;
  statusDealId: string;
  statusDealName: string;
  statusDealUrl: string;
  statusDetail: string;
};

export type RenewalsResponse = {
  asOf: string;
  generatedAt: string;
  targetCurrency: string;
  maxWindowDays: number;
  rows: RenewalRow[];
  warnings: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isoToUtcMs(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function todayIsoUtc(now: Date = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number) {
  const ms = isoToUtcMs(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetween(fromIso: string, toIso: string) {
  const from = isoToUtcMs(fromIso);
  const to = isoToUtcMs(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NaN;
  return Math.round((to - from) / DAY_MS);
}

/** Renewal date falls today through today + windowDays, inclusive on both ends. */
export function isInRenewalWindow(renewalDate: string, asOf: string, windowDays: number) {
  const days = daysBetween(asOf, renewalDate);
  return Number.isFinite(days) && days >= 0 && days <= windowDays;
}

export function normalizeWindowDays(value: unknown): RenewalWindowDays {
  const parsed = Number(value);
  return (RENEWAL_WINDOW_OPTIONS as readonly number[]).includes(parsed) ? (parsed as RenewalWindowDays) : 30;
}

/** Only an explicit "Cloud" deployment type counts as Cloud; anything else, including blank, is Legacy. */
export function deploymentCategory(deploymentType: string): RenewalDeployment {
  return String(deploymentType || "").trim().toLowerCase() === "cloud" ? "Cloud" : "Legacy";
}

export function renewalStatus(input: {
  renewedByDealId?: string;
  renewedByDealName?: string;
  openRenewalDealId?: string;
  openRenewalDealName?: string;
  openRenewalStageLabel?: string;
}): { kind: RenewalStatusKind; label: string } {
  if (String(input.renewedByDealId || "").trim()) {
    return { kind: "renewed", label: "Renewed" };
  }
  if (String(input.openRenewalDealId || "").trim()) {
    const stage = String(input.openRenewalStageLabel || "").trim() || "Open";
    return { kind: "in_progress", label: `Renewal in progress: ${stage}` };
  }
  return { kind: "none", label: "No renewal deal" };
}

export function filterRenewals(
  rows: RenewalRow[],
  filters: { asOf: string; windowDays: number; csmOwnerId?: string; deployment?: RenewalDeployment | "" },
) {
  const csm = String(filters.csmOwnerId ?? "");
  return rows
    .filter((row) => isInRenewalWindow(row.renewalDate, filters.asOf, filters.windowDays))
    .filter((row) => {
      if (!csm) return true;
      if (csm === "__none__") return !row.csmOwnerId;
      return row.csmOwnerId === csm;
    })
    .filter((row) => !filters.deployment || row.deployment === filters.deployment)
    .slice()
    .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate) || b.arr - a.arr || a.companyName.localeCompare(b.companyName));
}

export function summarizeRenewals(rows: RenewalRow[]) {
  let totalArr = 0;
  let noRenewalArr = 0;
  let noRenewalCount = 0;
  let legacyCount = 0;
  for (const row of rows) {
    totalArr += row.arr;
    if (row.status === "none") {
      noRenewalCount += 1;
      noRenewalArr += row.arr;
    }
    if (row.deployment === "Legacy") legacyCount += 1;
  }
  return {
    count: rows.length,
    totalArr: Math.round(totalArr * 100) / 100,
    noRenewalCount,
    noRenewalArr: Math.round(noRenewalArr * 100) / 100,
    legacyCount,
  };
}
