export type SalesQuotaCadence = "monthly" | "quarterly";

export type SalesQuotaConfig = {
  ownerKey: string;
  ownerName: string;
  quotaAmount: number;
  cadence: SalesQuotaCadence;
};

export type SalesQuotaProgress = SalesQuotaConfig & {
  periodStart: string;
  periodEnd: string;
  asOfDate: string;
  elapsedDays: number;
  totalDays: number;
  soldAmount: number;
  expectedAmount: number;
  attainmentPct: number;
  expectedPct: number;
  dealCount: number;
};

export type TeamSalesQuotaProgress = SalesQuotaProgress & {
  ownerKey: "team";
  ownerName: "Total team";
  cadence: "monthly";
};

export const SALES_QUOTA_CONFIGS: SalesQuotaConfig[] = [
  { ownerKey: "luca", ownerName: "Luca", quotaAmount: 65_000, cadence: "monthly" },
  { ownerKey: "tyler", ownerName: "Tyler", quotaAmount: 65_000, cadence: "monthly" },
  { ownerKey: "felipe", ownerName: "Felipe", quotaAmount: 80_000, cadence: "monthly" },
  { ownerKey: "evan", ownerName: "Evan", quotaAmount: 399_000, cadence: "quarterly" },
];

export const TEAM_MONTHLY_QUOTA_AMOUNT = SALES_QUOTA_CONFIGS.reduce(
  (sum, config) => sum + config.quotaAmount / (config.cadence === "quarterly" ? 3 : 1),
  0,
);

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) throw new Error("Invalid as-of date; expected YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("Invalid as-of date; expected YYYY-MM-DD");
  }
  return parsed;
}

export function salesQuotaPeriod(asOfDate: string, cadence: SalesQuotaCadence) {
  const asOf = parseIsoDate(asOfDate);
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth();
  const startMonth = cadence === "quarterly" ? Math.floor(month / 3) * 3 : month;
  const periodMonths = cadence === "quarterly" ? 3 : 1;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + periodMonths, 0));
  const elapsedDays = Math.floor((asOf.getTime() - start.getTime()) / DAY_MS) + 1;
  const totalDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  return {
    periodStart: isoDate(start),
    periodEnd: isoDate(end),
    elapsedDays,
    totalDays,
  };
}

export function calculateSalesQuotaProgress(
  config: SalesQuotaConfig,
  asOfDate: string,
  soldAmount: number,
  dealCount: number,
): SalesQuotaProgress {
  const period = salesQuotaPeriod(asOfDate, config.cadence);
  const quotaAmount = Math.max(0, Number(config.quotaAmount || 0));
  const normalizedSold = Math.max(0, Number(soldAmount || 0));
  const expectedPct = period.totalDays > 0 ? (period.elapsedDays / period.totalDays) * 100 : 0;
  return {
    ...config,
    ...period,
    asOfDate,
    quotaAmount: round2(quotaAmount),
    soldAmount: round2(normalizedSold),
    expectedAmount: round2(quotaAmount * (expectedPct / 100)),
    attainmentPct: quotaAmount > 0 ? round2((normalizedSold / quotaAmount) * 100) : 0,
    expectedPct: round2(expectedPct),
    dealCount: Math.max(0, Math.floor(Number(dealCount || 0))),
  };
}

export function calculateTeamSalesQuotaProgress(
  asOfDate: string,
  soldAmount: number,
  dealCount: number,
): TeamSalesQuotaProgress {
  return calculateSalesQuotaProgress(
    {
      ownerKey: "team",
      ownerName: "Total team",
      quotaAmount: TEAM_MONTHLY_QUOTA_AMOUNT,
      cadence: "monthly",
    },
    asOfDate,
    soldAmount,
    dealCount,
  ) as TeamSalesQuotaProgress;
}
