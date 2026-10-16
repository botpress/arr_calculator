import { fetchDealStageIdToLabelMap, fetchHubspotOwnersById } from "@/lib/hubspot";
import { buildRenewalsSql } from "@/lib/renewalsSql";
import {
  MAX_RENEWAL_WINDOW_DAYS,
  deploymentCategory,
  renewalStatus,
  todayIsoUtc,
  type RenewalRow,
  type RenewalsResponse,
} from "@/lib/renewalsRules";
import { runBigQuerySqlRows, type BigQuerySqlParameter } from "@/lib/stripeBigquery";

const PROFILE = "stripe_arr_correct" as const;
const BIGQUERY_PROJECT = String(process.env.GTM_BIGQUERY_PROJECT || "botpress-stripe-data-pipeline").trim() || "botpress-stripe-data-pipeline";
const TRANSFORMED_DATASET = String(process.env.GTM_BIGQUERY_TRANSFORMED_DATASET || "transformed_data").trim() || "transformed_data";
const HUBSPOT_DATASET = String(process.env.GTM_BIGQUERY_HUBSPOT_DATASET || "hubspot").trim() || "hubspot";
const TRANSACTIONAL_PIPELINE_ID = "730649262";
const TARGET_CURRENCY = "USD";

function safeIdentifier(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid ${label} BigQuery identifier.`);
  return value;
}

function tableRef(dataset: string, table: string) {
  return `\`${safeIdentifier(BIGQUERY_PROJECT, "project")}.${safeIdentifier(dataset, "dataset")}.${safeIdentifier(table, "table")}\``;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value: unknown) {
  return value === true || String(value).toLowerCase() === "true";
}

function hubspotPortalId() {
  return text(process.env.HUBSPOT_PORTAL_ID) || "20692578";
}

function hubspotRecordUrl(objectType: "0-2" | "0-3", id: string) {
  if (!id) return "";
  return `https://app.hubspot.com/contacts/${encodeURIComponent(hubspotPortalId())}/record/${objectType}/${encodeURIComponent(id)}`;
}

function ownerDisplayName(owner: { firstName?: string; lastName?: string; email?: string } | undefined) {
  if (!owner) return "";
  return text(`${owner.firstName || ""} ${owner.lastName || ""}`) || text(owner.email);
}

export async function generateRenewalsReport(): Promise<RenewalsResponse> {
  const includedStage = text(process.env.INCLUDED_DEALSTAGE);
  if (!includedStage) throw new Error("Missing env var: INCLUDED_DEALSTAGE");
  const asOf = todayIsoUtc();
  const warnings: string[] = [];

  const params: BigQuerySqlParameter[] = [
    { name: "as_of", type: "STRING", value: asOf },
    { name: "horizon_days", type: "INT64", value: String(MAX_RENEWAL_WINDOW_DAYS) },
    { name: "included_stage", type: "STRING", value: includedStage },
    { name: "transactional_pipeline", type: "STRING", value: TRANSACTIONAL_PIPELINE_ID },
    { name: "target_currency", type: "STRING", value: TARGET_CURRENCY },
  ];

  const sql = buildRenewalsSql({
    deals: tableRef(TRANSFORMED_DATASET, "stg_hubspot_deals"),
    dealLineItems: tableRef(TRANSFORMED_DATASET, "stg_hubspot_deal_line_items"),
    lineItems: tableRef(TRANSFORMED_DATASET, "stg_hubspot_line_items"),
    fxRates: tableRef(TRANSFORMED_DATASET, "int_fx_monthly_rates"),
    stagedCompanies: tableRef(TRANSFORMED_DATASET, "stg_hubspot_companies"),
    stagedOwners: tableRef(TRANSFORMED_DATASET, "stg_hubspot_owners"),
    rawCompanies: tableRef(HUBSPOT_DATASET, "companies"),
    rawOwners: tableRef(HUBSPOT_DATASET, "owners"),
  });

  const rawRows = (await runBigQuerySqlRows(sql, params, { profile: PROFILE })) as Record<string, unknown>[];

  const stageIds = new Set(rawRows.map((row) => text(row.open_renewal_stage_id)).filter(Boolean));
  let stageLabels = new Map<string, string>();
  if (stageIds.size) {
    try {
      stageLabels = await fetchDealStageIdToLabelMap();
    } catch (error) {
      warnings.push(`Could not load HubSpot stage names (${error instanceof Error ? error.message : "unknown error"}); showing stage IDs.`);
    }
  }

  // Owners that left HubSpot are missing from the warehouse owner tables; the HubSpot API
  // still returns them as archived owners.
  const unresolvedOwnerIds = new Set<string>();
  for (const row of rawRows) {
    if (text(row.csm_owner_id) && !text(row.csm_owner_name)) unresolvedOwnerIds.add(text(row.csm_owner_id));
    if (text(row.deal_owner_id) && !text(row.deal_owner_name)) unresolvedOwnerIds.add(text(row.deal_owner_id));
  }
  let ownersById = new Map<string, { firstName?: string; lastName?: string; email?: string; archived?: boolean }>();
  if (unresolvedOwnerIds.size) {
    try {
      ownersById = await fetchHubspotOwnersById(Array.from(unresolvedOwnerIds));
    } catch {
      // Fall back to "Owner <id>" below.
    }
  }
  const resolveOwner = (id: string, name: string) => {
    if (!id) return "";
    if (name) return name;
    const owner = ownersById.get(id);
    const resolved = ownerDisplayName(owner);
    if (resolved) return owner?.archived ? `${resolved} (deactivated)` : resolved;
    return `Owner ${id}`;
  };

  let fxFallbackCount = 0;
  let fxMissingCount = 0;
  const rows: RenewalRow[] = rawRows.map((row) => {
    const dealId = text(row.deal_id);
    const companyId = text(row.company_id);
    const openStageId = text(row.open_renewal_stage_id);
    const openStageLabel = stageLabels.get(openStageId) || openStageId;
    const status = renewalStatus({
      renewedByDealId: text(row.renewed_by_deal_id),
      renewedByDealName: text(row.renewed_by_deal_name),
      openRenewalDealId: text(row.open_renewal_deal_id),
      openRenewalDealName: text(row.open_renewal_deal_name),
      openRenewalStageLabel: openStageLabel,
    });
    const statusDealId = status.kind === "renewed" ? text(row.renewed_by_deal_id) : status.kind === "in_progress" ? text(row.open_renewal_deal_id) : "";
    const statusDealName = status.kind === "renewed" ? text(row.renewed_by_deal_name) : status.kind === "in_progress" ? text(row.open_renewal_deal_name) : "";
    const openCount = number(row.open_renewal_count);
    const closeDate = text(row.open_renewal_close_date);
    const statusDetail = status.kind === "in_progress"
      ? [closeDate ? `Expected close ${closeDate}` : "", openCount > 1 ? `${openCount} open Existing Business deals` : ""].filter(Boolean).join(" · ")
      : status.kind === "renewed"
        ? "Later closed-won contract starts around the renewal date"
        : "";
    const fxMissing = bool(row.fx_missing);
    const fxFallback = bool(row.fx_fallback);
    if (fxMissing) fxMissingCount += 1;
    if (fxFallback) fxFallbackCount += 1;
    const deploymentType = text(row.deployment_type);

    return {
      dealId,
      dealName: text(row.deal_name),
      dealUrl: hubspotRecordUrl("0-3", dealId),
      companyId,
      companyName: text(row.company_name) || text(row.deal_name),
      companyUrl: hubspotRecordUrl("0-2", companyId),
      renewalDate: text(row.renewal_date),
      arr: number(row.arr),
      nativeArr: number(row.native_arr),
      currency: text(row.currency) || TARGET_CURRENCY,
      fxMissing,
      fxFallback,
      deploymentType,
      deployment: deploymentCategory(deploymentType),
      csmOwnerId: text(row.csm_owner_id),
      csmOwnerName: resolveOwner(text(row.csm_owner_id), text(row.csm_owner_name)),
      dealOwnerId: text(row.deal_owner_id),
      dealOwnerName: resolveOwner(text(row.deal_owner_id), text(row.deal_owner_name)),
      status: status.kind,
      statusLabel: status.label,
      statusDealId,
      statusDealName,
      statusDealUrl: hubspotRecordUrl("0-3", statusDealId),
      statusDetail,
    };
  });

  if (fxFallbackCount) {
    warnings.push(`${fxFallbackCount} non-USD contract${fxFallbackCount === 1 ? "" : "s"} had no FX rate for the close month; converted with the latest available monthly rate.`);
  }
  if (fxMissingCount) {
    warnings.push(`${fxMissingCount} contract${fxMissingCount === 1 ? "" : "s"} could not be converted to USD (no FX rate at all) and show $0 ARR; see the native amount.`);
  }

  return {
    asOf,
    generatedAt: new Date().toISOString(),
    targetCurrency: TARGET_CURRENCY,
    maxWindowDays: MAX_RENEWAL_WINDOW_DAYS,
    rows,
    warnings,
  };
}
