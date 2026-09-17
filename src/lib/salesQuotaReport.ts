import { getMonthlyAverageFxRateForCloseMonth } from "@/lib/fx";
import {
  fetchDealsInStageClosedBetween,
  fetchHubspotOwnersById,
  type HubspotOwner,
} from "@/lib/hubspot";
import { parseDate, toNumber } from "@/lib/logic";
import { shouldIncludeCommissionDeal } from "@/lib/commissionRules";
import {
  calculateTeamSalesQuotaProgress,
  calculateSalesQuotaProgress,
  SALES_QUOTA_CONFIGS,
  salesQuotaPeriod,
  type SalesQuotaProgress,
  type TeamSalesQuotaProgress,
} from "@/lib/salesQuotaRules";
import type { HubspotDeal } from "@/lib/types";

export type SalesQuotaReportResponse = {
  asOfDate: string;
  targetCurrency: string;
  generatedAt: string;
  teamQuota: TeamSalesQuotaProgress;
  quotas: SalesQuotaProgress[];
  warnings: string[];
  methodology: string;
};

const DEFAULT_TRANSACTIONAL_PIPELINE_ID = "730649262";
const DEFAULT_TRANSACTIONAL_CLOSED_WON_STAGE_ID = "1064537523";
const DEFAULT_SALES_PIPELINE_ID = "0cbbc8c6-dccf-4601-8d59-b6a15ed5129b";
const DEFAULT_SALES_CLOSED_WON_STAGE_ID = "f12c408f-f92b-4a95-8b59-9f801b19b105";
const SALES_QUOTA_TIME_ZONE = "America/Toronto";

function envValue(name: string, fallback: string) {
  return String(process.env[name] || fallback).trim() || fallback;
}

function pipelineConfiguration() {
  return [
    {
      id: envValue("HUBSPOT_COMMISSION_TRANSACTIONAL_PIPELINE_ID", DEFAULT_TRANSACTIONAL_PIPELINE_ID),
      closedWonStageId: envValue(
        "HUBSPOT_COMMISSION_TRANSACTIONAL_CLOSED_WON_STAGE_ID",
        DEFAULT_TRANSACTIONAL_CLOSED_WON_STAGE_ID,
      ),
    },
    {
      id: envValue("HUBSPOT_COMMISSION_SALES_PIPELINE_ID", DEFAULT_SALES_PIPELINE_ID),
      closedWonStageId: envValue(
        "HUBSPOT_COMMISSION_SALES_CLOSED_WON_STAGE_ID",
        DEFAULT_SALES_CLOSED_WON_STAGE_ID,
      ),
    },
  ];
}

function normalizedWords(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizedDealType(value: unknown) {
  return normalizedWords(value).replace(/\s+/g, "");
}

function ownerIdentities(owner: HubspotOwner | undefined) {
  const firstName = String(owner?.firstName || "").trim();
  const lastName = String(owner?.lastName || "").trim();
  const email = String(owner?.email || "").trim();
  const emailLocalPart = email.split("@")[0] || "";
  return [firstName, [firstName, lastName].filter(Boolean).join(" "), email, emailLocalPart].filter(Boolean);
}

function quotaOwnerKey(owner: HubspotOwner | undefined) {
  const identities = new Set(ownerIdentities(owner).map(normalizedWords));
  return SALES_QUOTA_CONFIGS.find((config) => identities.has(normalizedWords(config.ownerName)))?.ownerKey || "";
}

function isoDate(value: unknown) {
  const parsed = parseDate(value);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

function todayInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export async function generateSalesQuotaReport(options?: {
  asOfDate?: string;
  targetCurrency?: string;
}): Promise<SalesQuotaReportResponse> {
  const asOfDate = String(options?.asOfDate || todayInTimeZone(SALES_QUOTA_TIME_ZONE)).trim();
  // This validates the date even if HubSpot has no matching deals.
  const periods = SALES_QUOTA_CONFIGS.map((config) => salesQuotaPeriod(asOfDate, config.cadence));
  const earliestPeriodStart = periods.reduce(
    (earliest, period) => (period.periodStart < earliest ? period.periodStart : earliest),
    periods[0].periodStart,
  );
  const targetCurrency = String(options?.targetCurrency || "USD")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(targetCurrency)) throw new Error("Invalid targetCurrency");

  const pipelines = pipelineConfiguration();
  const properties = [
    "dealtype",
    "pipeline",
    "closedate",
    "amount",
    "deal_currency_code",
    "hubspot_owner_id",
  ];
  const fetchedByPipeline = await Promise.all(
    pipelines.map(async (pipeline) => ({
      pipeline,
      deals: await fetchDealsInStageClosedBetween(
        properties,
        pipeline.closedWonStageId,
        earliestPeriodStart,
        asOfDate,
      ),
    })),
  );

  const deals: HubspotDeal[] = [];
  const seenDealIds = new Set<string>();
  for (const fetched of fetchedByPipeline) {
    for (const deal of fetched.deals) {
      const propertiesForDeal = deal.properties || {};
      if (String(propertiesForDeal.pipeline || "") !== fetched.pipeline.id) continue;
      const dealType = normalizedDealType(propertiesForDeal.dealtype);
      if (dealType !== "newbusiness" && dealType !== "existingbusiness") continue;
      const dealId = String(deal.id || "").trim();
      if (!dealId || seenDealIds.has(dealId)) continue;
      seenDealIds.add(dealId);
      deals.push(deal);
    }
  }

  const ownerIds = Array.from(
    new Set(
      deals
        .map((deal) => String(deal.properties?.hubspot_owner_id || "").trim())
        .filter(Boolean),
    ),
  );
  const ownersById = await fetchHubspotOwnersById(ownerIds);
  const includedOwnerNames = SALES_QUOTA_CONFIGS.map((config) => config.ownerName);
  const totals = new Map<string, { soldAmount: number; dealCount: number }>(
    SALES_QUOTA_CONFIGS.map((config) => [config.ownerKey, { soldAmount: 0, dealCount: 0 }]),
  );
  const teamMonthTotal = { soldAmount: 0, dealCount: 0 };
  const teamMonthPeriod = salesQuotaPeriod(asOfDate, "monthly");
  const warnings = new Set<string>();
  const fxCache = new Map<string, Promise<number>>();

  async function fxRate(currency: string, closeDate: string) {
    if (currency === targetCurrency) return 1;
    const cacheKey = `${currency}|${targetCurrency}|${closeDate.slice(0, 7)}`;
    if (!fxCache.has(cacheKey)) {
      fxCache.set(
        cacheKey,
        getMonthlyAverageFxRateForCloseMonth(
          currency,
          targetCurrency,
          new Date(`${closeDate}T12:00:00.000Z`),
        ).then((fx) => Number(fx.rate || 0)),
      );
    }
    return fxCache.get(cacheKey)!;
  }

  for (const deal of deals) {
    const propertiesForDeal = deal.properties || {};
    const ownerId = String(propertiesForDeal.hubspot_owner_id || "").trim();
    const owner = ownersById.get(ownerId);
    const ownerKey = quotaOwnerKey(owner);
    if (!ownerKey) continue;
    if (
      !shouldIncludeCommissionDeal({
        dealType: String(propertiesForDeal.dealtype || ""),
        ownerIdentities: ownerIdentities(owner),
        existingBusinessOwnerNames: includedOwnerNames,
      })
    ) {
      continue;
    }

    const config = SALES_QUOTA_CONFIGS.find((entry) => entry.ownerKey === ownerKey)!;
    const closeDate = isoDate(propertiesForDeal.closedate);
    const period = salesQuotaPeriod(asOfDate, config.cadence);
    if (!closeDate || closeDate < period.periodStart || closeDate > asOfDate) continue;

    const currency = String(propertiesForDeal.deal_currency_code || targetCurrency).trim().toUpperCase();
    const rate = await fxRate(currency, closeDate);
    if (rate <= 0) {
      warnings.add(`Some ${currency} deals could not be converted to ${targetCurrency}.`);
      continue;
    }
    const amount = Math.max(0, toNumber(propertiesForDeal.amount)) * rate;
    const total = totals.get(ownerKey)!;
    total.soldAmount += amount;
    total.dealCount += 1;
    if (closeDate >= teamMonthPeriod.periodStart) {
      teamMonthTotal.soldAmount += amount;
      teamMonthTotal.dealCount += 1;
    }
  }

  const quotas = SALES_QUOTA_CONFIGS.map((config) => {
    const total = totals.get(config.ownerKey)!;
    return calculateSalesQuotaProgress(config, asOfDate, total.soldAmount, total.dealCount);
  });

  return {
    asOfDate,
    targetCurrency,
    generatedAt: new Date().toISOString(),
    teamQuota: calculateTeamSalesQuotaProgress(
      asOfDate,
      teamMonthTotal.soldAmount,
      teamMonthTotal.dealCount,
    ),
    quotas,
    warnings: Array.from(warnings),
    methodology:
      "Closed-won New Business and approved-rep Existing Business HubSpot deal amounts from the Sales and Transactional pipelines, converted to the target currency by close month. The team bar is monthly and uses one third of quarterly quotas; individual quarterly bars remain quarter-to-date.",
  };
}
