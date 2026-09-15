export type AccountManagerConfig = {
  ownerKey: string;
  ownerId: string;
  ownerName: string;
};

export type HubspotOwnerHistoryEntry = {
  value?: string;
  timestamp?: string;
};

export type RetentionAccountInput = {
  previousArr: number;
  currentArr: number;
};

export type RetentionMovement = "expanded" | "contracted" | "churned" | "retained" | "not_in_baseline";

export type RetentionMetrics = {
  accountCount: number;
  baselineAccountCount: number;
  previousArr: number;
  currentArr: number;
  netChange: number;
  expansionArr: number;
  contractionArr: number;
  churnArr: number;
  nrrPct: number | null;
};

function ownerIdFromEnv(name: string, fallback: string) {
  return String(process.env[name] || fallback).trim() || fallback;
}

export const ACCOUNT_MANAGER_CONFIGS: AccountManagerConfig[] = [
  {
    ownerKey: "chloe",
    ownerId: ownerIdFromEnv("HUBSPOT_ACCOUNT_MANAGER_CHLOE_OWNER_ID", "84747686"),
    ownerName: "Chloé Lagüe",
  },
  {
    ownerKey: "sam",
    ownerId: ownerIdFromEnv("HUBSPOT_ACCOUNT_MANAGER_SAM_OWNER_ID", "81143838"),
    ownerName: "Sam Rees",
  },
  {
    ownerKey: "kieran",
    ownerId: ownerIdFromEnv("HUBSPOT_ACCOUNT_MANAGER_KIERAN_OWNER_ID", "1314508841"),
    ownerName: "Kieran Hamilton",
  },
];

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function fiscalQuarterKeyForDate(date: Date) {
  const calendarMonth = date.getUTCMonth();
  const fiscalYear = calendarMonth >= 3 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
  const fiscalQuarter = Math.floor(((calendarMonth + 9) % 12) / 3) + 1;
  return `${fiscalYear}-Q${fiscalQuarter}`;
}

export function accountManagementQuarterWindow(quarter: string) {
  const match = /^(\d{4})-Q([1-4])$/.exec(String(quarter || "").trim().toUpperCase());
  if (!match) throw new Error("Invalid quarter; expected fiscal year-end YYYY-Q1 through YYYY-Q4");
  const fiscalYear = Number(match[1]);
  const quarterIndex = Number(match[2]) - 1;
  const fiscalStartYear = fiscalYear - 1;
  const currentStartMonth = 3 + quarterIndex * 3;

  const currentStart = new Date(Date.UTC(fiscalStartYear, currentStartMonth, 1));
  const currentEnd = new Date(Date.UTC(fiscalStartYear, currentStartMonth + 3, 0));
  const previousEnd = new Date(Date.UTC(fiscalStartYear, currentStartMonth, 0));

  return {
    quarter: `${fiscalYear}-Q${quarterIndex + 1}`,
    previousQuarterKey: fiscalQuarterKeyForDate(previousEnd),
    currentQuarterKey: `${fiscalYear}-Q${quarterIndex + 1}`,
    previousPeriodMonthKey: isoDate(previousEnd).slice(0, 7),
    currentPeriodMonthKey: isoDate(currentEnd).slice(0, 7),
    currentQuarterStart: isoDate(currentStart),
    previousQuarterEnd: isoDate(previousEnd),
    currentQuarterEnd: isoDate(currentEnd),
    ownerCutoffIso: `${isoDate(previousEnd)}T23:59:59.999Z`,
  };
}

function validTimestamp(value: unknown) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function dealOwnerAtCutoff(input: {
  history?: HubspotOwnerHistoryEntry[];
  cutoffIso: string;
  currentOwnerId?: string;
  currentOwnerAssignedAt?: string;
  createdAt?: string;
}) {
  const cutoffMs = validTimestamp(input.cutoffIso);
  if (cutoffMs == null) throw new Error("Invalid owner cutoff timestamp");

  const history = (input.history || [])
    .map((entry) => ({
      ownerId: String(entry.value || "").trim(),
      timestamp: String(entry.timestamp || "").trim(),
      timestampMs: validTimestamp(entry.timestamp),
    }))
    .filter((entry): entry is { ownerId: string; timestamp: string; timestampMs: number } => entry.timestampMs != null)
    .filter((entry) => entry.timestampMs <= cutoffMs)
    .sort((a, b) => b.timestampMs - a.timestampMs);

  if (history.length) {
    return {
      ownerId: history[0].ownerId,
      assignedAt: history[0].timestamp,
      source: "history" as const,
    };
  }

  const createdAtMs = validTimestamp(input.createdAt);
  if (createdAtMs != null && createdAtMs > cutoffMs) {
    return { ownerId: "", assignedAt: "", source: "not_created" as const };
  }

  const assignedAtMs = validTimestamp(input.currentOwnerAssignedAt);
  if (assignedAtMs != null && assignedAtMs <= cutoffMs) {
    return {
      ownerId: String(input.currentOwnerId || "").trim(),
      assignedAt: String(input.currentOwnerAssignedAt || "").trim(),
      source: "current_fallback" as const,
    };
  }

  return { ownerId: "", assignedAt: "", source: "unresolved" as const };
}

export function retentionMovement(previousArr: number, currentArr: number): RetentionMovement {
  const previous = Math.max(0, Number(previousArr || 0));
  const current = Math.max(0, Number(currentArr || 0));
  if (previous <= 0) return "not_in_baseline";
  if (current <= 0) return "churned";
  if (current > previous) return "expanded";
  if (current < previous) return "contracted";
  return "retained";
}

export function calculateRetentionMetrics(accounts: RetentionAccountInput[]): RetentionMetrics {
  let previousArr = 0;
  let currentArr = 0;
  let expansionArr = 0;
  let contractionArr = 0;
  let churnArr = 0;
  let baselineAccountCount = 0;

  for (const account of accounts || []) {
    const previous = Math.max(0, Number(account.previousArr || 0));
    const current = Math.max(0, Number(account.currentArr || 0));
    if (previous <= 0) continue;

    baselineAccountCount += 1;
    previousArr += previous;
    currentArr += current;
    const delta = current - previous;
    if (delta > 0) expansionArr += delta;
    if (delta < 0 && current > 0) contractionArr += Math.abs(delta);
    if (current <= 0) churnArr += previous;
  }

  const normalizedPrevious = round2(previousArr);
  const normalizedCurrent = round2(currentArr);
  return {
    accountCount: (accounts || []).length,
    baselineAccountCount,
    previousArr: normalizedPrevious,
    currentArr: normalizedCurrent,
    netChange: round2(normalizedCurrent - normalizedPrevious),
    expansionArr: round2(expansionArr),
    contractionArr: round2(contractionArr),
    churnArr: round2(churnArr),
    nrrPct: normalizedPrevious > 0 ? round2((normalizedCurrent / normalizedPrevious) * 100) : null,
  };
}
