export type MigrationPlanGeneration = "v2" | "v3" | "v4";
export type MigrationPlanVersion = Exclude<MigrationPlanGeneration, "v2">;

export type MigrationMetricInput = {
  migratedAt: string;
  migratedArr: number;
  resultingExpansion?: number;
};

export type LegacyPopulationSummary = {
  customers: number;
  arr: number;
};

export type MigrationGoalMetrics = {
  targetRatePct: number;
  openingLegacyCustomers: number;
  openingLegacyArr: number;
  openingAverageArr: number;
  currentLegacyCustomers: number;
  currentLegacyArr: number;
  fiscalYearCustomerTarget: number;
  fiscalYearArrTarget: number;
  monthlyCustomerTarget: number;
  monthlyArrTarget: number;
  fiscalYearCustomerProgressPct: number;
  fiscalYearArrProgressPct: number;
  currentMonthCustomerProgressPct: number;
  currentMonthArrProgressPct: number;
};

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }
  return date;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function migrationReportWindow(asOfDate: string, requestedStartDate?: string) {
  const asOf = parseIsoDate(asOfDate);
  if (!asOf) throw new Error("Invalid asOfDate; expected YYYY-MM-DD");
  const minimumStart = new Date(Date.UTC(2026, 3, 1));
  if (asOf.getTime() < minimumStart.getTime()) {
    throw new Error("Migration reporting starts on 2026-04-01");
  }

  const fiscalYearStartYear = asOf.getUTCMonth() >= 3 ? asOf.getUTCFullYear() : asOf.getUTCFullYear() - 1;
  const calculatedFiscalStart = new Date(Date.UTC(fiscalYearStartYear, 3, 1));
  const fiscalYearStart = calculatedFiscalStart < minimumStart ? minimumStart : calculatedFiscalStart;
  const fiscalYearEnd = new Date(Date.UTC(fiscalYearStart.getUTCFullYear() + 1, 2, 31));
  const requestedStart = String(requestedStartDate || "").trim()
    ? parseIsoDate(String(requestedStartDate || "").trim())
    : fiscalYearStart;
  if (!requestedStart) throw new Error("Invalid startDate; expected YYYY-MM-DD");
  if (requestedStart.getTime() < minimumStart.getTime()) {
    throw new Error("Migration reporting starts on 2026-04-01");
  }
  if (requestedStart.getTime() > asOf.getTime()) {
    throw new Error("Migration startDate must be on or before endDate");
  }
  const calendarMonthStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const currentMonthStart = requestedStart > calendarMonthStart ? requestedStart : calendarMonthStart;

  return {
    asOfDate: isoDate(asOf),
    rangeStart: isoDate(requestedStart),
    rangeEnd: isoDate(asOf),
    fiscalYearStart: isoDate(fiscalYearStart),
    fiscalYearEnd: isoDate(fiscalYearEnd),
    currentMonthStart: isoDate(currentMonthStart),
  };
}

function normalizedWords(values: string[]) {
  return values
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isHubspotMigrationUpsellType(value: unknown) {
  return String(value || "").trim().toLowerCase() === "migration";
}

export function migrationPlanGeneration(
  values: string[],
  unversionedPlanVersion: MigrationPlanGeneration = "v3",
): MigrationPlanGeneration | null {
  const normalized = normalizedWords(values);
  if (!normalized || normalized === "refund" || normalized === "discount") return null;
  if (/\badd\s*ons?\b/.test(normalized)) return null;
  if (/\bai\s+tokens?\b/.test(normalized)) return null;
  if (/\bconversation\s+sessions?\b/.test(normalized)) return null;
  if (normalized.includes("web search and crawl")) return null;

  const recognizedPlan = /\b(enterprise|managed|team|plus|pay\s+as\s+you\s+go|payg|free)\b/.test(normalized);
  if (!recognizedPlan) return null;
  if (/(^|[^a-z0-9])v4([^a-z0-9]|$)/.test(normalized)) return "v4";
  if (/(^|[^a-z0-9])v3([^a-z0-9]|$)/.test(normalized)) return "v3";
  if (/(^|[^a-z0-9])v2([^a-z0-9]|$)/.test(normalized)) return "v2";
  if (/(^|[^a-z0-9])v1([^a-z0-9]|$)/.test(normalized)) return null;
  return unversionedPlanVersion;
}

export function migrationPlanDisplayName(values: string[], generation: MigrationPlanGeneration) {
  const normalized = normalizedWords(values);
  let planName = "Plan";
  if (/\benterprise\b/.test(normalized)) planName = "Enterprise";
  else if (/\bmanaged\b/.test(normalized)) planName = "Managed";
  else if (/\bteam\b/.test(normalized)) planName = "Team";
  else if (/\bplus\b/.test(normalized)) planName = "Plus";
  else if (/\b(pay\s+as\s+you\s+go|payg)\b/.test(normalized)) planName = "Pay As You Go";
  else if (/\bfree\b/.test(normalized)) planName = "Free";
  return `${planName} (${generation.toUpperCase()})`;
}

export function migrationPlanVersion(
  values: string[],
  unversionedPlanVersion: MigrationPlanVersion = "v3",
): MigrationPlanVersion | null {
  const generation = migrationPlanGeneration(values, unversionedPlanVersion);
  return generation === "v3" || generation === "v4" ? generation : null;
}

function roundTo(value: number, digits: number) {
  const multiplier = 10 ** digits;
  return Math.round((Number(value) || 0) * multiplier) / multiplier;
}

function progressPct(actual: number, target: number) {
  if (target <= 0) return 0;
  return roundTo((Math.max(0, actual) / target) * 100, 1);
}

export function calculateMigrationGoalMetrics(input: {
  opening: LegacyPopulationSummary;
  current: LegacyPopulationSummary;
  fiscalYearMigrated: { customers: number; arr: number };
  currentMonthMigrated: { customers: number; arr: number };
  targetRatePct?: number;
}): MigrationGoalMetrics {
  const targetRatePct = Math.max(0, Math.min(100, Number(input.targetRatePct ?? 70)));
  const openingLegacyCustomers = Math.max(0, Math.floor(Number(input.opening.customers || 0)));
  const openingLegacyArr = roundTo(Math.max(0, Number(input.opening.arr || 0)), 2);
  const currentLegacyCustomers = Math.max(0, Math.floor(Number(input.current.customers || 0)));
  const currentLegacyArr = roundTo(Math.max(0, Number(input.current.arr || 0)), 2);
  const openingAverageArr = openingLegacyCustomers > 0
    ? roundTo(openingLegacyArr / openingLegacyCustomers, 2)
    : 0;
  const fiscalYearCustomerTarget = Math.ceil(openingLegacyCustomers * (targetRatePct / 100));
  const fiscalYearArrTarget = roundTo(openingAverageArr * fiscalYearCustomerTarget, 2);
  const monthlyCustomerTarget = roundTo(fiscalYearCustomerTarget / 12, 2);
  const monthlyArrTarget = roundTo(fiscalYearArrTarget / 12, 2);
  const fiscalYearMigratedCustomers = Math.max(0, Number(input.fiscalYearMigrated.customers || 0));
  const fiscalYearMigratedArr = Math.max(0, Number(input.fiscalYearMigrated.arr || 0));
  const currentMonthMigratedCustomers = Math.max(0, Number(input.currentMonthMigrated.customers || 0));
  const currentMonthMigratedArr = Math.max(0, Number(input.currentMonthMigrated.arr || 0));

  return {
    targetRatePct,
    openingLegacyCustomers,
    openingLegacyArr,
    openingAverageArr,
    currentLegacyCustomers,
    currentLegacyArr,
    fiscalYearCustomerTarget,
    fiscalYearArrTarget,
    monthlyCustomerTarget,
    monthlyArrTarget,
    fiscalYearCustomerProgressPct: progressPct(fiscalYearMigratedCustomers, fiscalYearCustomerTarget),
    fiscalYearArrProgressPct: progressPct(fiscalYearMigratedArr, fiscalYearArrTarget),
    currentMonthCustomerProgressPct: progressPct(currentMonthMigratedCustomers, monthlyCustomerTarget),
    currentMonthArrProgressPct: progressPct(currentMonthMigratedArr, monthlyArrTarget),
  };
}

export function calculateMigrationMetrics(
  rows: MigrationMetricInput[],
  startDate: string,
  endDate: string,
) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end || end.getTime() < start.getTime()) {
    throw new Error("Invalid migration metric date range");
  }

  const included = (rows || []).filter((row) => {
    const migratedAt = parseIsoDate(String(row.migratedAt || "").slice(0, 10));
    return migratedAt && migratedAt.getTime() >= start.getTime() && migratedAt.getTime() <= end.getTime();
  });
  return {
    logosMigrated: included.length,
    arrMigrated: Math.round(included.reduce((sum, row) => sum + Math.max(0, Number(row.migratedArr || 0)), 0) * 100) / 100,
    resultingExpansion: Math.round(included.reduce((sum, row) => sum + Number(row.resultingExpansion || 0), 0) * 100) / 100,
  };
}
