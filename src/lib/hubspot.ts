// lib/hubspot.ts
import {
  HubspotCompany,
  HubspotContact,
  HubspotDeal,
  HubspotLineItem,
  HubspotSearchResponse,
} from "./types";

const HUBSPOT_BASE = "https://api.hubapi.com";
const HUBSPOT_ASSOC_CONCURRENCY = 4;
const HUBSPOT_ASSOC_BATCH_CONCURRENCY = 2;
const HUBSPOT_BATCH_READ_CONCURRENCY = 2;
const HUBSPOT_CONTACT_SEARCH_CONCURRENCY = 4;
const HUBSPOT_MAX_RETRIES = 6;
const HUBSPOT_BASE_BACKOFF_MS = 400;
const HUBSPOT_CACHE_TTL_MS = Number(process.env.HUBSPOT_CACHE_TTL_MS || "120000");

type CacheEntry<T> = { value: T; expiresAt: number };

const DEALS_CACHE = new Map<string, CacheEntry<HubspotDeal[]>>();
const DEAL_STAGE_LABELS_CACHE = new Map<string, CacheEntry<Array<[string, string]>>>();
const DEAL_PIPELINE_LABELS_CACHE = new Map<string, CacheEntry<Array<[string, string]>>>();
const DEAL_STAGE_WORKSPACE_IDS_CACHE = new Map<string, CacheEntry<string[]>>();
const SALES_ASSIST_DEALS_CACHE = new Map<string, CacheEntry<SalesAssistDealMatch[]>>();
const DEAL_ASSOC_CACHE = new Map<string, CacheEntry<string[]>>();
const DEAL_COMPANY_ASSOC_CACHE = new Map<string, CacheEntry<string[]>>();
const DEAL_PROPERTY_HISTORY_CACHE = new Map<string, CacheEntry<HubspotDealWithPropertyHistory>>();
const COMPANY_CONTACT_ASSOC_CACHE = new Map<string, CacheEntry<string[]>>();
const CONTACT_COMPANY_ASSOC_CACHE = new Map<string, CacheEntry<string[]>>();
const CONTACT_EMAIL_SEARCH_CACHE = new Map<string, CacheEntry<string[]>>();
const COMPANY_CACHE = new Map<string, CacheEntry<HubspotCompany>>();
const CONTACT_CACHE = new Map<string, CacheEntry<HubspotContact>>();
const LINE_ITEM_CACHE = new Map<string, CacheEntry<HubspotLineItem>>();
const OWNERS_CACHE = new Map<string, CacheEntry<HubspotOwner[]>>();

export type HubspotOwner = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  archived?: boolean;
};

export type HubspotPropertyHistoryValue = {
  value?: string;
  timestamp?: string;
  sourceType?: string;
  sourceId?: string;
  updatedByUserId?: number;
};

export type HubspotDealWithPropertyHistory = HubspotDeal & {
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
  propertiesWithHistory?: Record<string, HubspotPropertyHistoryValue[]>;
};

export function clearHubspotMemoryCache() {
  DEALS_CACHE.clear();
  DEAL_STAGE_LABELS_CACHE.clear();
  DEAL_PIPELINE_LABELS_CACHE.clear();
  DEAL_STAGE_WORKSPACE_IDS_CACHE.clear();
  SALES_ASSIST_DEALS_CACHE.clear();
  DEAL_ASSOC_CACHE.clear();
  DEAL_COMPANY_ASSOC_CACHE.clear();
  DEAL_PROPERTY_HISTORY_CACHE.clear();
  COMPANY_CONTACT_ASSOC_CACHE.clear();
  CONTACT_COMPANY_ASSOC_CACHE.clear();
  CONTACT_EMAIL_SEARCH_CACHE.clear();
  COMPANY_CACHE.clear();
  CONTACT_CACHE.clear();
  LINE_ITEM_CACHE.clear();
  OWNERS_CACHE.clear();
}

export type SalesAssistDealMatchType = "transactional_closed_won" | "closed_lost_selfserve";

export type SalesAssistDealMatch = {
  dealId: string;
  stageId: string;
  matchType: SalesAssistDealMatchType;
  workspaceId: string;
  closedAtMs: number;
  dealName: string;
  primaryCompanyId: string;
  deploymentType: string;
};

function getToken() {
  const t = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!t) throw new Error("Missing HUBSPOT_PRIVATE_APP_TOKEN in .env.local");
  return t;
}

function nowMs() {
  return Date.now();
}

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= nowMs()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
  cache.set(key, { value, expiresAt: nowMs() + HUBSPOT_CACHE_TTL_MS });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(raw: string | null) {
  if (!raw) return null;
  const s = raw.trim();
  const asNum = Number(s);
  if (!Number.isNaN(asNum) && asNum >= 0) return asNum * 1000;
  const asDate = Date.parse(s);
  if (Number.isNaN(asDate)) return null;
  const delta = asDate - Date.now();
  return delta > 0 ? delta : 0;
}

function normalizeWorkspaceId(value: string) {
  return String(value || "").trim();
}

function normalizeWorkspaceIdToken(value: string) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStageLabelKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeLossReasonKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseHubspotTimestampMs(rawValue: unknown) {
  const value = String(rawValue || "").trim();
  if (!value) return NaN;
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      if (numeric > 1_000_000_000_000) return numeric;
      if (numeric > 1_000_000_000) return numeric * 1000;
      return numeric * 1000;
    }
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function firstNonEmptyProperty(properties: Record<string, unknown>, candidates: string[]) {
  for (const key of candidates) {
    const value = String(properties[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function isUnknownPropertyError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = String(error.message || "").toLowerCase();
  return (
    message.includes("property") &&
    (message.includes("does not exist") ||
      message.includes("no property found") ||
      message.includes("not a valid property"))
  );
}

async function hsFetch(url: string, init?: RequestInit) {
  for (let attempt = 0; attempt <= HUBSPOT_MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });

    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === HUBSPOT_MAX_RETRIES) {
      throw new Error(`HubSpot API error ${res.status}: ${text}`);
    }

    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    const backoffMs = HUBSPOT_BASE_BACKOFF_MS * Math.pow(2, attempt);
    const jitterMs = Math.floor(Math.random() * 250);
    const waitMs = Math.max(retryAfterMs ?? 0, backoffMs + jitterMs);
    await sleep(waitMs);
  }

  throw new Error("HubSpot API request failed unexpectedly");
}

type DealSearchPayload = {
  filterGroups: Array<{
    filters: Array<{ propertyName: string; operator: "EQ" | "GTE" | "LTE"; value: string }>;
  }>;
  properties: string[];
  limit: number;
  after?: string;
};

type DealPipelinesResponse = {
  results?: Array<{
    id?: string;
    label?: string;
    stages?: Array<{
      id?: string;
      label?: string;
    }>;
  }>;
};

type HubspotOwnersResponse = {
  results?: HubspotOwner[];
  paging?: { next?: { after?: string } };
};

type DealLineItemAssociationResponse = {
  results?: Array<{ id?: string | number }>;
};

type DealLineItemBatchAssociationResponse = {
  results?: Array<{
    from?: { id?: string | number };
    to?: Array<{ toObjectId?: string | number; id?: string | number }>;
  }>;
};

type DealCompanyAssociationResponse = {
  results?: Array<{
    id?: string | number;
    toObjectId?: string | number;
    associationTypes?: Array<{
      category?: string;
      typeId?: number;
      label?: string | null;
    }>;
  }>;
};

type DealCompanyBatchAssociationResponse = {
  results?: Array<{
    from?: { id?: string | number };
    to?: Array<{
      toObjectId?: string | number;
      id?: string | number;
      associationTypes?: Array<{
        category?: string;
        typeId?: number;
        label?: string | null;
      }>;
    }>;
  }>;
};

type CompanyContactAssociationResponse = {
  results?: Array<{ id?: string | number }>;
};

type CompanyContactBatchAssociationResponse = {
  results?: Array<{
    from?: { id?: string | number };
    to?: Array<{ toObjectId?: string | number; id?: string | number }>;
  }>;
};

type ContactCompanyAssociationResponse = {
  results?: Array<{ id?: string | number }>;
};

type ContactCompanyBatchAssociationResponse = {
  results?: Array<{
    from?: { id?: string | number };
    to?: Array<{ toObjectId?: string | number; id?: string | number }>;
  }>;
};

type ContactSearchPayload = {
  filterGroups: Array<{
    filters: Array<
      | { propertyName: string; operator: "EQ"; value: string }
      | { propertyName: string; operator: "IN"; values: string[] }
    >;
  }>;
  properties: string[];
  limit: number;
  after?: string;
};

export type HubspotDealPropertyUpdate = {
  dealId: string;
  properties: Record<string, string | number | boolean>;
};

function parseIsoDateOnly(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const safeLimit = Math.max(1, Math.min(limit, items.length));
  const out: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const idx = next;
      next++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: safeLimit }, () => worker()));
  return out;
}

export async function fetchDealsInStage(properties: string[], dealstage: string) {
  const cacheKey = `${dealstage}|${[...properties].sort().join(",")}`;
  const cached = readCache(DEALS_CACHE, cacheKey);
  if (cached) return cached;

  const url = `${HUBSPOT_BASE}/crm/v3/objects/deals/search`;
  let after: string | null = null;
  const results: HubspotDeal[] = [];

  while (true) {
    const payload: DealSearchPayload = {
      filterGroups: [{ filters: [{ propertyName: "dealstage", operator: "EQ", value: dealstage }] }],
      properties,
      limit: 100,
    };
    if (after) payload.after = after;

    const json: HubspotSearchResponse<HubspotDeal> = await hsFetch(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    results.push(...(json.results || []));
    after = json.paging?.next?.after ?? null;
    if (!after) break;
  }

  writeCache(DEALS_CACHE, cacheKey, results);
  return results;
}

export async function fetchDealsByDealType(properties: string[], dealType: string) {
  const normalizedDealType = String(dealType || "").trim();
  if (!normalizedDealType) return [];

  const cacheKey = `dealtype:${normalizedDealType}|${[...properties].sort().join(",")}`;
  const cached = readCache(DEALS_CACHE, cacheKey);
  if (cached) return cached;

  const url = `${HUBSPOT_BASE}/crm/v3/objects/deals/search`;
  let after: string | null = null;
  const results: HubspotDeal[] = [];

  while (true) {
    const payload: DealSearchPayload = {
      filterGroups: [{ filters: [{ propertyName: "dealtype", operator: "EQ", value: normalizedDealType }] }],
      properties,
      limit: 100,
    };
    if (after) payload.after = after;

    const json: HubspotSearchResponse<HubspotDeal> = await hsFetch(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    results.push(...(json.results || []));
    after = json.paging?.next?.after ?? null;
    if (!after) break;
  }

  writeCache(DEALS_CACHE, cacheKey, results);
  return results;
}

export async function fetchDealsInStageClosedBetween(
  properties: string[],
  dealstage: string,
  closeDateStartIso: string,
  closeDateEndIso: string,
) {
  const start = parseIsoDateOnly(closeDateStartIso);
  const end = parseIsoDateOnly(closeDateEndIso);
  if (!start || !end || end.getTime() < start.getTime()) {
    return [];
  }

  const startMs = start.getTime();
  const endMs = end.getTime() + (24 * 60 * 60 * 1000 - 1);
  const cacheKey = `${dealstage}|closedate:${startMs}:${endMs}|${[...properties].sort().join(",")}`;
  const cached = readCache(DEALS_CACHE, cacheKey);
  if (cached) return cached;

  const url = `${HUBSPOT_BASE}/crm/v3/objects/deals/search`;
  let after: string | null = null;
  const results: HubspotDeal[] = [];

  while (true) {
    const payload: DealSearchPayload = {
      filterGroups: [
        {
          filters: [
            { propertyName: "dealstage", operator: "EQ", value: dealstage },
            { propertyName: "closedate", operator: "GTE", value: String(startMs) },
            { propertyName: "closedate", operator: "LTE", value: String(endMs) },
          ],
        },
      ],
      properties,
      limit: 100,
    };
    if (after) payload.after = after;

    const json: HubspotSearchResponse<HubspotDeal> = await hsFetch(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    results.push(...(json.results || []));
    after = json.paging?.next?.after ?? null;
    if (!after) break;
  }

  writeCache(DEALS_CACHE, cacheKey, results);
  return results;
}

export async function fetchDealsCreatedBetween(
  properties: string[],
  createdDateStartIso: string,
  createdDateEndIso: string,
) {
  const start = parseIsoDateOnly(createdDateStartIso);
  const end = parseIsoDateOnly(createdDateEndIso);
  if (!start || !end || end.getTime() < start.getTime()) {
    return [];
  }

  const startMs = start.getTime();
  const endMs = end.getTime() + (24 * 60 * 60 * 1000 - 1);
  const cacheKey = `createdate:${startMs}:${endMs}|${[...properties].sort().join(",")}`;
  const cached = readCache(DEALS_CACHE, cacheKey);
  if (cached) return cached;

  const url = `${HUBSPOT_BASE}/crm/v3/objects/deals/search`;
  let after: string | null = null;
  const results: HubspotDeal[] = [];

  while (true) {
    const payload: DealSearchPayload = {
      filterGroups: [
        {
          filters: [
            { propertyName: "createdate", operator: "GTE", value: String(startMs) },
            { propertyName: "createdate", operator: "LTE", value: String(endMs) },
          ],
        },
      ],
      properties,
      limit: 100,
    };
    if (after) payload.after = after;

    const json: HubspotSearchResponse<HubspotDeal> = await hsFetch(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    results.push(...(json.results || []));
    after = json.paging?.next?.after ?? null;
    if (!after) break;
  }

  writeCache(DEALS_CACHE, cacheKey, results);
  return results;
}

export async function fetchDealStageIdToLabelMap() {
  const cacheKey = "all";
  const cached = readCache(DEAL_STAGE_LABELS_CACHE, cacheKey);
  if (cached) return new Map<string, string>(cached);

  const url = `${HUBSPOT_BASE}/crm/v3/pipelines/deals`;
  const json = (await hsFetch(url)) as DealPipelinesResponse;
  const out = new Map<string, string>();

  for (const pipeline of json.results || []) {
    for (const stage of pipeline.stages || []) {
      const id = String(stage.id || "").trim();
      const label = String(stage.label || "").trim();
      if (!id || !label) continue;
      if (!out.has(id)) out.set(id, label);
    }
  }

  writeCache(DEAL_STAGE_LABELS_CACHE, cacheKey, Array.from(out.entries()));
  return out;
}

export async function fetchDealPipelineIdToLabelMap() {
  const cacheKey = "all";
  const cached = readCache(DEAL_PIPELINE_LABELS_CACHE, cacheKey);
  if (cached) return new Map<string, string>(cached);

  const url = `${HUBSPOT_BASE}/crm/v3/pipelines/deals`;
  const json = (await hsFetch(url)) as DealPipelinesResponse;
  const out = new Map<string, string>();

  for (const pipeline of json.results || []) {
    const id = String(pipeline.id || "").trim();
    const label = String(pipeline.label || "").trim();
    if (!id || !label) continue;
    if (!out.has(id)) out.set(id, label);
  }

  writeCache(DEAL_PIPELINE_LABELS_CACHE, cacheKey, Array.from(out.entries()));
  return out;
}

export async function fetchHubspotOwnersById(ownerIds: string[]) {
  const requested = Array.from(new Set((ownerIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!requested.length) return new Map<string, HubspotOwner>();

  const cacheKey = "active-and-archived";
  let owners = readCache(OWNERS_CACHE, cacheKey);
  if (!owners) {
    owners = [];
    for (const archived of [false, true]) {
      let after = "";
      while (true) {
        const params = new URLSearchParams({ limit: "500", archived: String(archived) });
        if (after) params.set("after", after);
        const json = (await hsFetch(`${HUBSPOT_BASE}/crm/v3/owners?${params.toString()}`)) as HubspotOwnersResponse;
        owners.push(...(json.results || []));
        after = String(json.paging?.next?.after || "");
        if (!after) break;
      }
    }
    writeCache(OWNERS_CACHE, cacheKey, owners);
  }

  const requestedSet = new Set(requested);
  return new Map(
    owners
      .filter((owner) => requestedSet.has(String(owner.id || "")))
      .map((owner) => [String(owner.id), owner]),
  );
}

export async function batchReadDealPropertyHistory(dealIds: string[], propertyNames: string[]) {
  const ids = Array.from(new Set((dealIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  const properties = Array.from(
    new Set((propertyNames || []).map((property) => String(property || "").trim()).filter(Boolean)),
  );
  const out = new Map<string, HubspotDealWithPropertyHistory>();
  if (!ids.length || !properties.length) return out;

  const propertyKey = properties.slice().sort().join(",");
  const missingIds: string[] = [];
  for (const id of ids) {
    const cached = readCache(DEAL_PROPERTY_HISTORY_CACHE, `${id}|${propertyKey}`);
    if (cached) out.set(id, cached);
    else missingIds.push(id);
  }

  if (!missingIds.length) return out;

  const url = `${HUBSPOT_BASE}/crm/v3/objects/deals/batch/read`;
  const chunks: string[][] = [];
  // HubSpot caps batch reads that request property histories at 50 records.
  const propertyHistoryBatchSize = 50;
  for (let i = 0; i < missingIds.length; i += propertyHistoryBatchSize) {
    chunks.push(missingIds.slice(i, i + propertyHistoryBatchSize));
  }

  const chunkResults = await mapWithConcurrency(chunks, HUBSPOT_BATCH_READ_CONCURRENCY, async (chunk) => {
    const json = await hsFetch(url, {
      method: "POST",
      body: JSON.stringify({
        properties,
        propertiesWithHistory: properties,
        inputs: chunk.map((id) => ({ id })),
      }),
    });
    return (json.results || []) as HubspotDealWithPropertyHistory[];
  });

  for (const deals of chunkResults) {
    for (const deal of deals) {
      const id = String(deal.id || "").trim();
      if (!id) continue;
      out.set(id, deal);
      writeCache(DEAL_PROPERTY_HISTORY_CACHE, `${id}|${propertyKey}`, deal);
    }
  }

  return out;
}

function parseCsvSet(raw: string) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[,\n\r|;]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function buildWorkspacePropCandidates() {
  const workspaceProp = String(process.env.DEAL_WORKSPACE_ID_PROP || "workspace_id").trim() || "workspace_id";
  return Array.from(
    new Set(
      [
        workspaceProp,
        workspaceProp.endsWith("__c") ? workspaceProp.slice(0, -3) : `${workspaceProp}__c`,
        "workspace_id",
        "workspace_id__c",
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function buildClosedLostReasonPropCandidates() {
  const configured = String(process.env.HUBSPOT_CLOSED_LOST_REASON_PROP || "").trim();
  return Array.from(
    new Set(
      [
        configured,
        configured ? (configured.endsWith("__c") ? configured.slice(0, -3) : `${configured}__c`) : "",
        "loss_reason__c",
        "loss_reason",
        "closed_lost_reason",
        "closed_lost_reason__c",
        "closedlostreason",
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function buildSalesAssistClosedLostReasonKeys() {
  const configuredRaw =
    String(process.env.HUBSPOT_SALES_ASSIST_CLOSED_LOST_REASONS || "").trim() ||
    "Going self-serve Team,Going self-serve Plus";
  const keys = parseCsvSet(configuredRaw)
    .map((value) => normalizeLossReasonKey(value))
    .filter(Boolean);
  return new Set(keys);
}

async function resolveStageIdsByLabelOrEnv(
  idsEnvName: string,
  fallbackLabelEnvName: string,
  fallbackLabelDefault: string,
) {
  const configured = parseCsvSet(String(process.env[idsEnvName] || ""));
  if (configured.length) return configured;

  const normalizedLabel = normalizeStageLabelKey(
    String(process.env[fallbackLabelEnvName] || fallbackLabelDefault),
  );
  if (!normalizedLabel) return [];

  const stageIdToLabel = await fetchDealStageIdToLabelMap();
  return Array.from(stageIdToLabel.entries())
    .filter(([, label]) => normalizeStageLabelKey(label || "") === normalizedLabel)
    .map(([stageId]) => stageId);
}

async function resolveClosedLostStageIds() {
  const configured = parseCsvSet(String(process.env.HUBSPOT_TRANSACTIONAL_CLOSED_LOST_STAGE_ID || ""));
  if (configured.length) return configured;

  const explicitLabel = normalizeStageLabelKey(
    String(process.env.HUBSPOT_TRANSACTIONAL_CLOSED_LOST_STAGE_LABEL || "Closed Lost (Transactional Pipeline)"),
  );
  const stageIdToLabel = await fetchDealStageIdToLabelMap();
  const exact = Array.from(stageIdToLabel.entries())
    .filter(([, label]) => normalizeStageLabelKey(label || "") === explicitLabel)
    .map(([stageId]) => stageId);
  if (exact.length) return exact;

  const transactionalClosedLost = Array.from(stageIdToLabel.entries())
    .filter(([, label]) => {
      const normalized = normalizeStageLabelKey(label || "");
      return normalized.includes("closedlost") && normalized.includes("transactionalpipeline");
    })
    .map(([stageId]) => stageId);
  if (transactionalClosedLost.length) return transactionalClosedLost;

  return Array.from(stageIdToLabel.entries())
    .filter(([, label]) => normalizeStageLabelKey(label || "").includes("closedlost"))
    .map(([stageId]) => stageId);
}

async function fetchDealsForStageWithWorkspaceCandidates(
  stageId: string,
  workspacePropCandidates: string[],
  extraProps: string[],
  dateRange?: { startDate: string; endDate: string },
) {
  const dealsById = new Map<string, HubspotDeal>();
  let fetchedAny = false;
  for (const workspaceField of workspacePropCandidates) {
    const props = Array.from(new Set([workspaceField, ...extraProps].filter(Boolean)));
    try {
      const deals = dateRange
        ? await fetchDealsInStageClosedBetween(props, stageId, dateRange.startDate, dateRange.endDate)
        : await fetchDealsInStage(props, stageId);
      fetchedAny = true;
      for (const deal of deals || []) {
        const dealId = String(deal.id || "").trim();
        if (!dealId) continue;
        const previous = dealsById.get(dealId);
        if (!previous) {
          dealsById.set(dealId, deal);
          continue;
        }
        dealsById.set(dealId, {
          ...previous,
          properties: {
            ...(previous.properties || {}),
            ...(deal.properties || {}),
          },
        });
      }
    } catch (error) {
      if (isUnknownPropertyError(error)) continue;
      throw error;
    }
  }
  if (!fetchedAny) return [];
  return Array.from(dealsById.values());
}

async function fetchDealsForStageWithWorkspaceAndReasonCandidates(
  stageId: string,
  workspacePropCandidates: string[],
  closedLostReasonPropCandidates: string[],
  dateRange?: { startDate: string; endDate: string },
) {
  const dealsById = new Map<string, HubspotDeal>();
  let fetchedAny = false;
  for (const reasonField of closedLostReasonPropCandidates) {
    const deals = await fetchDealsForStageWithWorkspaceCandidates(
      stageId,
      workspacePropCandidates,
      ["closedate", "dealname", "hs_primary_associated_company", reasonField],
      dateRange,
    );
    fetchedAny = true;
    for (const deal of deals || []) {
      const dealId = String(deal.id || "").trim();
      if (!dealId) continue;
      const previous = dealsById.get(dealId);
      if (!previous) {
        dealsById.set(dealId, deal);
        continue;
      }
      dealsById.set(dealId, {
        ...previous,
        properties: {
          ...(previous.properties || {}),
          ...(deal.properties || {}),
        },
      });
    }
  }
  if (!fetchedAny) return [];
  return Array.from(dealsById.values());
}

async function fetchSalesAssistDealMatchesInternal(dateRange?: { startDate: string; endDate: string }) {
  const transactionalStageIds = await resolveStageIdsByLabelOrEnv(
    "HUBSPOT_TRANSACTIONAL_STAGE_ID",
    "HUBSPOT_TRANSACTIONAL_STAGE_LABEL",
    "Closed Won (Transactional Pipeline)",
  );
  const closedLostStageIds = await resolveClosedLostStageIds();
  const workspacePropCandidates = buildWorkspacePropCandidates();
  const closedLostReasonPropCandidates = buildClosedLostReasonPropCandidates();
  const allowedClosedLostReasons = buildSalesAssistClosedLostReasonKeys();

  const out = new Map<string, SalesAssistDealMatch>();

  for (const stageId of transactionalStageIds) {
    const deals = await fetchDealsForStageWithWorkspaceCandidates(
      stageId,
      workspacePropCandidates,
      ["closedate", "dealname", "hs_primary_associated_company", "deployment_type__c"],
      dateRange,
    );
    for (const deal of deals || []) {
      const properties = (deal.properties || {}) as Record<string, unknown>;
      const workspaceId = normalizeWorkspaceId(firstNonEmptyProperty(properties, workspacePropCandidates));
      const closedAtMs = parseHubspotTimestampMs(properties.closedate);
      if (!Number.isFinite(closedAtMs)) continue;
      const dealId = String(deal.id || "").trim();
      if (!dealId) continue;
      const key = `won:${dealId}`;
      if (out.has(key)) continue;
      out.set(key, {
        dealId,
        stageId,
        matchType: "transactional_closed_won",
        workspaceId,
        closedAtMs,
        dealName: String(properties.dealname || "").trim(),
        primaryCompanyId: String(properties.hs_primary_associated_company || "").trim(),
        deploymentType: String(properties.deployment_type__c || "").trim(),
      });
    }
  }

  for (const stageId of closedLostStageIds) {
    const deals = await fetchDealsForStageWithWorkspaceAndReasonCandidates(
      stageId,
      workspacePropCandidates,
      closedLostReasonPropCandidates,
      dateRange,
    );
    for (const deal of deals || []) {
      const properties = (deal.properties || {}) as Record<string, unknown>;
      const workspaceId = normalizeWorkspaceId(firstNonEmptyProperty(properties, workspacePropCandidates));
      const closedAtMs = parseHubspotTimestampMs(properties.closedate);
      const closedLostReason = firstNonEmptyProperty(properties, closedLostReasonPropCandidates);
      const closedLostReasonKey = normalizeLossReasonKey(closedLostReason);
      if (!Number.isFinite(closedAtMs)) continue;
      if (!closedLostReasonKey || !allowedClosedLostReasons.has(closedLostReasonKey)) continue;
      const dealId = String(deal.id || "").trim();
      if (!dealId) continue;
      const key = `lost:${dealId}`;
      if (out.has(key)) continue;
      out.set(key, {
        dealId,
        stageId,
        matchType: "closed_lost_selfserve",
        workspaceId,
        closedAtMs,
        dealName: String(properties.dealname || "").trim(),
        primaryCompanyId: String(properties.hs_primary_associated_company || "").trim(),
        deploymentType: String(properties.deployment_type__c || "").trim(),
      });
    }
  }

  return Array.from(out.values()).sort((a, b) => {
    if (a.closedAtMs !== b.closedAtMs) return a.closedAtMs - b.closedAtMs;
    return a.dealId.localeCompare(b.dealId);
  });
}

export async function fetchSalesAssistDealMatches(dateRange?: { startDate: string; endDate: string }) {
  const rangeKey = dateRange ? `${dateRange.startDate}:${dateRange.endDate}` : "all";
  const cacheKey = [
    `range:${rangeKey}`,
    `transactional_stage_id:${String(process.env.HUBSPOT_TRANSACTIONAL_STAGE_ID || "")}`,
    `transactional_stage_label:${String(process.env.HUBSPOT_TRANSACTIONAL_STAGE_LABEL || "")}`,
    `transactional_closed_lost_stage_id:${String(process.env.HUBSPOT_TRANSACTIONAL_CLOSED_LOST_STAGE_ID || "")}`,
    `transactional_closed_lost_stage_label:${String(process.env.HUBSPOT_TRANSACTIONAL_CLOSED_LOST_STAGE_LABEL || "")}`,
    `closed_lost_reason_prop:${String(process.env.HUBSPOT_CLOSED_LOST_REASON_PROP || "")}`,
    `closed_lost_reason_values:${String(process.env.HUBSPOT_SALES_ASSIST_CLOSED_LOST_REASONS || "")}`,
    `deal_workspace_prop:${String(process.env.DEAL_WORKSPACE_ID_PROP || "")}`,
  ].join("|");
  const cached = readCache(SALES_ASSIST_DEALS_CACHE, cacheKey);
  if (cached) return cached;
  const matches = await fetchSalesAssistDealMatchesInternal(dateRange);
  writeCache(SALES_ASSIST_DEALS_CACHE, cacheKey, matches);
  return matches;
}

export async function fetchSalesAssistWorkspaceIds() {
  const matches = await fetchSalesAssistDealMatches();
  return new Set(
    matches
      .map((match) => normalizeWorkspaceIdToken(match.workspaceId))
      .filter(Boolean),
  );
}

export async function fetchWorkspaceIdsForDealStageLabel(
  stageLabel = String(process.env.HUBSPOT_TRANSACTIONAL_STAGE_LABEL || "Closed Won (Transactional Pipeline)"),
) {
  const configuredStageIds = Array.from(
    new Set(
      String(process.env.HUBSPOT_TRANSACTIONAL_STAGE_ID || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  const normalizedLabel = normalizeStageLabelKey(stageLabel);
  if (!configuredStageIds.length && !normalizedLabel) return new Set<string>();

  const cacheKey = configuredStageIds.length
    ? `stage_ids:${configuredStageIds.slice().sort((a, b) => a.localeCompare(b)).join(",")}`
    : `stage_label:${normalizedLabel}`;
  const cached = readCache(DEAL_STAGE_WORKSPACE_IDS_CACHE, cacheKey);
  if (cached) return new Set<string>(cached);

  let matchingStageIds = configuredStageIds;
  if (!matchingStageIds.length) {
    const stageIdToLabel = await fetchDealStageIdToLabelMap();
    matchingStageIds = Array.from(stageIdToLabel.entries())
      .filter(([, label]) => normalizeStageLabelKey(label || "") === normalizedLabel)
      .map(([stageId]) => stageId);
  }

  if (!matchingStageIds.length) {
    writeCache(DEAL_STAGE_WORKSPACE_IDS_CACHE, cacheKey, []);
    return new Set<string>();
  }

  const workspaceProp = String(process.env.DEAL_WORKSPACE_ID_PROP || "workspace_id").trim() || "workspace_id";
  const workspacePropCandidates = Array.from(
    new Set(
      [
        workspaceProp,
        workspaceProp.endsWith("__c") ? workspaceProp.slice(0, -3) : `${workspaceProp}__c`,
        "workspace_id",
        "workspace_id__c",
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  const workspaceIds = new Set<string>();

  for (const stageId of matchingStageIds) {
    let deals: HubspotDeal[] = [];
    let fetched = false;
    for (const workspaceField of workspacePropCandidates) {
      try {
        deals = await fetchDealsInStage([workspaceField], stageId);
        fetched = true;
        break;
      } catch (error) {
        if (isUnknownPropertyError(error)) continue;
        throw error;
      }
    }
    if (!fetched) {
      // No compatible workspace field exists in this HubSpot portal.
      continue;
    }

    for (const deal of deals || []) {
      const properties = (deal.properties || {}) as Record<string, unknown>;
      const workspaceId = normalizeWorkspaceId(firstNonEmptyProperty(properties, workspacePropCandidates));
      if (workspaceId) workspaceIds.add(workspaceId);
    }
  }

  writeCache(DEAL_STAGE_WORKSPACE_IDS_CACHE, cacheKey, Array.from(workspaceIds));
  return workspaceIds;
}

export async function fetchLineItemIdsForDeal(dealId: string) {
  const cached = readCache(DEAL_ASSOC_CACHE, dealId);
  if (cached) return cached;

  const url = `${HUBSPOT_BASE}/crm/v3/objects/deals/${dealId}/associations/line_items`;
  const json = (await hsFetch(url)) as DealLineItemAssociationResponse;
  const ids = (json.results || [])
    .map((r) => String(r.id || ""))
    .filter((id) => !!id);
  writeCache(DEAL_ASSOC_CACHE, dealId, ids);
  return ids;
}

export async function fetchLineItemIdsForDeals(dealIds: string[]) {
  const dedupedDealIds = Array.from(new Set(dealIds.filter((id) => !!id)));
  const out = new Map<string, string[]>();

  const pending: string[] = [];
  for (const dealId of dedupedDealIds) {
    const cached = readCache(DEAL_ASSOC_CACHE, dealId);
    if (cached) out.set(dealId, cached);
    else pending.push(dealId);
  }

  if (pending.length) {
    let resolvedByBatch = false;
    try {
      const batchUrl = `${HUBSPOT_BASE}/crm/v4/associations/deals/line_items/batch/read`;
      const chunkSize = 100;
      const chunks: string[][] = [];
      for (let i = 0; i < pending.length; i += chunkSize) chunks.push(pending.slice(i, i + chunkSize));

      const chunkResults = await mapWithConcurrency(
        chunks,
        HUBSPOT_ASSOC_BATCH_CONCURRENCY,
        async (chunk): Promise<DealLineItemBatchAssociationResponse> => {
          const json = (await hsFetch(batchUrl, {
            method: "POST",
            body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
          })) as DealLineItemBatchAssociationResponse;
          return json;
        },
      );

      const seenInBatch = new Set<string>();
      for (const chunkResult of chunkResults) {
        for (const assoc of chunkResult.results || []) {
          const dealId = String(assoc.from?.id || "");
          if (!dealId) continue;
          seenInBatch.add(dealId);
          const ids = (assoc.to || [])
            .map((t) => String(t.toObjectId || t.id || ""))
            .filter((id) => !!id);
          out.set(dealId, ids);
          writeCache(DEAL_ASSOC_CACHE, dealId, ids);
        }
      }

      for (const dealId of pending) {
        if (!seenInBatch.has(dealId)) {
          out.set(dealId, []);
          writeCache(DEAL_ASSOC_CACHE, dealId, []);
        }
      }
      resolvedByBatch = true;
    } catch {
      resolvedByBatch = false;
    }

    if (!resolvedByBatch) {
      const pairs = await mapWithConcurrency(pending, HUBSPOT_ASSOC_CONCURRENCY, async (dealId) => {
        const ids = await fetchLineItemIdsForDeal(dealId);
        return { dealId, ids };
      });
      for (const p of pairs) out.set(p.dealId, p.ids);
    }
  }

  return dealIds.map((dealId) => ({ dealId, ids: out.get(dealId) || [] }));
}

function associationIsPrimary(
  association: { associationTypes?: Array<{ typeId?: number; label?: string | null }> },
) {
  return (association.associationTypes || []).some((type) => {
    const label = String(type.label || "").trim().toLowerCase();
    return label === "primary" || Number(type.typeId || 0) === 5;
  });
}

function orderedAssociatedCompanyIds(
  associations: Array<{
    id?: string | number;
    toObjectId?: string | number;
    associationTypes?: Array<{ typeId?: number; label?: string | null }>;
  }>,
) {
  return associations
    .map((association) => ({
      id: String(association.toObjectId || association.id || "").trim(),
      primary: associationIsPrimary(association),
    }))
    .filter((association) => Boolean(association.id))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.id.localeCompare(b.id))
    .map((association) => association.id);
}

export async function fetchCompanyIdsForDeal(dealId: string) {
  const normalizedDealId = String(dealId || "").trim();
  if (!normalizedDealId) return [];
  const cached = readCache(DEAL_COMPANY_ASSOC_CACHE, normalizedDealId);
  if (cached) return cached;

  const url = `${HUBSPOT_BASE}/crm/v4/objects/deals/${normalizedDealId}/associations/companies`;
  const json = (await hsFetch(url)) as DealCompanyAssociationResponse;
  const ids = orderedAssociatedCompanyIds(json.results || []);
  writeCache(DEAL_COMPANY_ASSOC_CACHE, normalizedDealId, ids);
  return ids;
}

export async function fetchCompanyIdsForDeals(dealIds: string[]) {
  const dedupedDealIds = Array.from(
    new Set((dealIds || []).map((id) => String(id || "").trim()).filter(Boolean)),
  );
  const out = new Map<string, string[]>();
  const pending: string[] = [];

  for (const dealId of dedupedDealIds) {
    const cached = readCache(DEAL_COMPANY_ASSOC_CACHE, dealId);
    if (cached) out.set(dealId, cached);
    else pending.push(dealId);
  }

  if (pending.length) {
    let resolvedByBatch = false;
    try {
      const batchUrl = `${HUBSPOT_BASE}/crm/v4/associations/deals/companies/batch/read`;
      const chunks: string[][] = [];
      for (let i = 0; i < pending.length; i += 100) chunks.push(pending.slice(i, i + 100));

      const chunkResults = await mapWithConcurrency(
        chunks,
        HUBSPOT_ASSOC_BATCH_CONCURRENCY,
        async (chunk): Promise<DealCompanyBatchAssociationResponse> =>
          (await hsFetch(batchUrl, {
            method: "POST",
            body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
          })) as DealCompanyBatchAssociationResponse,
      );

      const seenInBatch = new Set<string>();
      for (const chunkResult of chunkResults) {
        for (const association of chunkResult.results || []) {
          const dealId = String(association.from?.id || "").trim();
          if (!dealId) continue;
          seenInBatch.add(dealId);
          const ids = orderedAssociatedCompanyIds(association.to || []);
          out.set(dealId, ids);
          writeCache(DEAL_COMPANY_ASSOC_CACHE, dealId, ids);
        }
      }

      for (const dealId of pending) {
        if (seenInBatch.has(dealId)) continue;
        out.set(dealId, []);
        writeCache(DEAL_COMPANY_ASSOC_CACHE, dealId, []);
      }
      resolvedByBatch = true;
    } catch {
      resolvedByBatch = false;
    }

    if (!resolvedByBatch) {
      const pairs = await mapWithConcurrency(pending, HUBSPOT_ASSOC_CONCURRENCY, async (dealId) => ({
        dealId,
        ids: await fetchCompanyIdsForDeal(dealId),
      }));
      for (const pair of pairs) out.set(pair.dealId, pair.ids);
    }
  }

  return dedupedDealIds.map((dealId) => ({ dealId, ids: out.get(dealId) || [] }));
}

export async function fetchContactIdsForCompany(companyId: string) {
  const cached = readCache(COMPANY_CONTACT_ASSOC_CACHE, companyId);
  if (cached) return cached;

  const url = `${HUBSPOT_BASE}/crm/v3/objects/companies/${companyId}/associations/contacts`;
  const json = (await hsFetch(url)) as CompanyContactAssociationResponse;
  const ids = (json.results || [])
    .map((r) => String(r.id || ""))
    .filter((id) => !!id);
  writeCache(COMPANY_CONTACT_ASSOC_CACHE, companyId, ids);
  return ids;
}

export async function fetchContactIdsForCompanies(companyIds: string[]) {
  const dedupedCompanyIds = Array.from(new Set(companyIds.filter((id) => !!id)));
  const out = new Map<string, string[]>();

  const pending: string[] = [];
  for (const companyId of dedupedCompanyIds) {
    const cached = readCache(COMPANY_CONTACT_ASSOC_CACHE, companyId);
    if (cached) out.set(companyId, cached);
    else pending.push(companyId);
  }

  if (pending.length) {
    let resolvedByBatch = false;
    try {
      const batchUrl = `${HUBSPOT_BASE}/crm/v4/associations/companies/contacts/batch/read`;
      const chunkSize = 100;
      const chunks: string[][] = [];
      for (let i = 0; i < pending.length; i += chunkSize) chunks.push(pending.slice(i, i + chunkSize));

      const chunkResults = await mapWithConcurrency(
        chunks,
        HUBSPOT_ASSOC_BATCH_CONCURRENCY,
        async (chunk): Promise<CompanyContactBatchAssociationResponse> => {
          const json = (await hsFetch(batchUrl, {
            method: "POST",
            body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
          })) as CompanyContactBatchAssociationResponse;
          return json;
        },
      );

      const seenInBatch = new Set<string>();
      for (const chunkResult of chunkResults) {
        for (const assoc of chunkResult.results || []) {
          const companyId = String(assoc.from?.id || "");
          if (!companyId) continue;
          seenInBatch.add(companyId);
          const ids = (assoc.to || [])
            .map((t) => String(t.toObjectId || t.id || ""))
            .filter((id) => !!id);
          out.set(companyId, ids);
          writeCache(COMPANY_CONTACT_ASSOC_CACHE, companyId, ids);
        }
      }

      for (const companyId of pending) {
        if (!seenInBatch.has(companyId)) {
          out.set(companyId, []);
          writeCache(COMPANY_CONTACT_ASSOC_CACHE, companyId, []);
        }
      }
      resolvedByBatch = true;
    } catch {
      resolvedByBatch = false;
    }

    if (!resolvedByBatch) {
      const pairs = await mapWithConcurrency(pending, HUBSPOT_ASSOC_CONCURRENCY, async (companyId) => {
        const ids = await fetchContactIdsForCompany(companyId);
        return { companyId, ids };
      });
      for (const pair of pairs) out.set(pair.companyId, pair.ids);
    }
  }

  return companyIds.map((companyId) => ({ companyId, ids: out.get(companyId) || [] }));
}

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

function uniqueEmails(values: string[]) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => normalizeEmail(value))
        .filter((value) => value.includes("@")),
    ),
  );
}

async function searchContactIdsByEmailEq(email: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return [];

  const cached = readCache(CONTACT_EMAIL_SEARCH_CACHE, normalizedEmail);
  if (cached) return cached;

  const url = `${HUBSPOT_BASE}/crm/v3/objects/contacts/search`;
  const ids: string[] = [];
  let after: string | null = null;

  while (true) {
    const payload: ContactSearchPayload = {
      filterGroups: [
        {
          filters: [{ propertyName: "email", operator: "EQ", value: normalizedEmail }],
        },
      ],
      properties: ["email"],
      limit: 100,
    };
    if (after) payload.after = after;

    const json: HubspotSearchResponse<HubspotContact> = await hsFetch(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    for (const contact of json.results || []) {
      const id = String(contact.id || "").trim();
      if (id) ids.push(id);
    }
    after = json.paging?.next?.after ?? null;
    if (!after) break;
  }

  const deduped = Array.from(new Set(ids));
  writeCache(CONTACT_EMAIL_SEARCH_CACHE, normalizedEmail, deduped);
  return deduped;
}

async function searchContactIdsByEmails(emails: string[]) {
  const normalizedEmails = uniqueEmails(emails);
  const emailToContactIds = new Map<string, string[]>();
  if (!normalizedEmails.length) return emailToContactIds;

  const pending: string[] = [];
  for (const email of normalizedEmails) {
    const cached = readCache(CONTACT_EMAIL_SEARCH_CACHE, email);
    if (cached) {
      emailToContactIds.set(email, cached);
    } else {
      pending.push(email);
    }
  }

  if (pending.length) {
    let usedInOperator = false;
    try {
      const url = `${HUBSPOT_BASE}/crm/v3/objects/contacts/search`;
      const chunkSize = 50;
      const chunks: string[][] = [];
      for (let i = 0; i < pending.length; i += chunkSize) chunks.push(pending.slice(i, i + chunkSize));

      const chunkResults = await mapWithConcurrency(
        chunks,
        HUBSPOT_CONTACT_SEARCH_CONCURRENCY,
        async (chunk) => {
          let after: string | null = null;
          const found = new Map<string, Set<string>>();
          for (const email of chunk) found.set(email, new Set<string>());

          while (true) {
            const payload: ContactSearchPayload = {
              filterGroups: [
                {
                  filters: [{ propertyName: "email", operator: "IN", values: chunk }],
                },
              ],
              properties: ["email"],
              limit: 100,
            };
            if (after) payload.after = after;

            const json: HubspotSearchResponse<HubspotContact> = await hsFetch(url, {
              method: "POST",
              body: JSON.stringify(payload),
            });

            for (const contact of json.results || []) {
              const id = String(contact.id || "").trim();
              const email = normalizeEmail(String(contact.properties?.email || ""));
              if (!id || !email) continue;
              if (!found.has(email)) continue;
              found.get(email)!.add(id);
            }

            after = json.paging?.next?.after ?? null;
            if (!after) break;
          }

          return found;
        },
      );

      for (const chunkResult of chunkResults) {
        for (const [email, idsSet] of chunkResult.entries()) {
          const ids = Array.from(idsSet);
          emailToContactIds.set(email, ids);
          writeCache(CONTACT_EMAIL_SEARCH_CACHE, email, ids);
        }
      }
      usedInOperator = true;
    } catch {
      usedInOperator = false;
    }

    if (!usedInOperator) {
      const pairs = await mapWithConcurrency(pending, HUBSPOT_CONTACT_SEARCH_CONCURRENCY, async (email) => {
        const ids = await searchContactIdsByEmailEq(email);
        return { email, ids };
      });
      for (const pair of pairs) {
        emailToContactIds.set(pair.email, pair.ids);
      }
    }
  }

  for (const email of normalizedEmails) {
    if (!emailToContactIds.has(email)) {
      emailToContactIds.set(email, []);
      writeCache(CONTACT_EMAIL_SEARCH_CACHE, email, []);
    }
  }

  return emailToContactIds;
}

async function fetchCompanyIdsForContact(contactId: string) {
  const cached = readCache(CONTACT_COMPANY_ASSOC_CACHE, contactId);
  if (cached) return cached;

  const url = `${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}/associations/companies`;
  const json = (await hsFetch(url)) as ContactCompanyAssociationResponse;
  const ids = (json.results || [])
    .map((r) => String(r.id || ""))
    .filter((id) => !!id);
  writeCache(CONTACT_COMPANY_ASSOC_CACHE, contactId, ids);
  return ids;
}

async function fetchCompanyIdsForContacts(contactIds: string[]) {
  const dedupedContactIds = Array.from(new Set(contactIds.filter((id) => !!id)));
  const out = new Map<string, string[]>();

  const pending: string[] = [];
  for (const contactId of dedupedContactIds) {
    const cached = readCache(CONTACT_COMPANY_ASSOC_CACHE, contactId);
    if (cached) out.set(contactId, cached);
    else pending.push(contactId);
  }

  if (pending.length) {
    let resolvedByBatch = false;
    try {
      const batchUrl = `${HUBSPOT_BASE}/crm/v4/associations/contacts/companies/batch/read`;
      const chunkSize = 100;
      const chunks: string[][] = [];
      for (let i = 0; i < pending.length; i += chunkSize) chunks.push(pending.slice(i, i + chunkSize));

      const chunkResults = await mapWithConcurrency(
        chunks,
        HUBSPOT_ASSOC_BATCH_CONCURRENCY,
        async (chunk): Promise<ContactCompanyBatchAssociationResponse> => {
          const json = (await hsFetch(batchUrl, {
            method: "POST",
            body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
          })) as ContactCompanyBatchAssociationResponse;
          return json;
        },
      );

      const seenInBatch = new Set<string>();
      for (const chunkResult of chunkResults) {
        for (const assoc of chunkResult.results || []) {
          const contactId = String(assoc.from?.id || "");
          if (!contactId) continue;
          seenInBatch.add(contactId);
          const ids = (assoc.to || [])
            .map((t) => String(t.toObjectId || t.id || ""))
            .filter((id) => !!id);
          out.set(contactId, ids);
          writeCache(CONTACT_COMPANY_ASSOC_CACHE, contactId, ids);
        }
      }

      for (const contactId of pending) {
        if (!seenInBatch.has(contactId)) {
          out.set(contactId, []);
          writeCache(CONTACT_COMPANY_ASSOC_CACHE, contactId, []);
        }
      }
      resolvedByBatch = true;
    } catch {
      resolvedByBatch = false;
    }

    if (!resolvedByBatch) {
      const pairs = await mapWithConcurrency(pending, HUBSPOT_ASSOC_CONCURRENCY, async (contactId) => {
        const ids = await fetchCompanyIdsForContact(contactId);
        return { contactId, ids };
      });
      for (const pair of pairs) out.set(pair.contactId, pair.ids);
    }
  }

  return contactIds.map((contactId) => ({ contactId, ids: out.get(contactId) || [] }));
}

export async function fetchCompanyIdsForContactEmails(emails: string[]) {
  const normalizedEmails = uniqueEmails(emails);
  const result = new Map<string, Set<string>>();
  if (!normalizedEmails.length) return result;

  const emailToContactIds = await searchContactIdsByEmails(normalizedEmails);
  const allContactIds = Array.from(
    new Set(
      normalizedEmails.flatMap((email) => emailToContactIds.get(email) || []),
    ),
  );
  if (!allContactIds.length) return result;

  const companyIdsByContact = new Map<string, string[]>();
  for (const pair of await fetchCompanyIdsForContacts(allContactIds)) {
    companyIdsByContact.set(pair.contactId, pair.ids || []);
  }

  for (const email of normalizedEmails) {
    const contactIds = emailToContactIds.get(email) || [];
    for (const contactId of contactIds) {
      const companyIds = companyIdsByContact.get(contactId) || [];
      for (const companyId of companyIds) {
        const normalizedCompanyId = String(companyId || "").trim();
        if (!normalizedCompanyId) continue;
        if (!result.has(normalizedCompanyId)) result.set(normalizedCompanyId, new Set<string>());
        result.get(normalizedCompanyId)!.add(email);
      }
    }
  }

  return result;
}

export async function batchReadLineItems(ids: string[], properties: string[]) {
  const url = `${HUBSPOT_BASE}/crm/v3/objects/line_items/batch/read`;
  const map = new Map<string, HubspotLineItem>();

  const dedupedIds = Array.from(new Set(ids.filter((id) => !!id)));
  const missingIds: string[] = [];

  for (const id of dedupedIds) {
    const cached = readCache(LINE_ITEM_CACHE, id);
    if (cached) map.set(id, cached);
    else missingIds.push(id);
  }

  if (!missingIds.length) return map;

  const chunkSize = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < missingIds.length; i += chunkSize) chunks.push(missingIds.slice(i, i + chunkSize));

  const chunkResults = await mapWithConcurrency(chunks, HUBSPOT_BATCH_READ_CONCURRENCY, async (chunk) => {
    const json = await hsFetch(url, {
      method: "POST",
      body: JSON.stringify({
        properties,
        inputs: chunk.map((id) => ({ id })),
      }),
    });
    return (json.results || []) as HubspotLineItem[];
  });

  for (const lis of chunkResults) {
    lis.forEach((li) => {
      const id = String(li.id);
      map.set(id, li);
      writeCache(LINE_ITEM_CACHE, id, li);
    });
  }

  return map;
}

export async function batchReadCompanies(ids: string[], properties: string[]) {
  const url = `${HUBSPOT_BASE}/crm/v3/objects/companies/batch/read`;
  const map = new Map<string, HubspotCompany>();

  const dedupedIds = Array.from(new Set(ids.filter((id) => !!id)));
  const propsCacheKey = [...properties].sort().join(",");
  const missingIds: string[] = [];

  for (const id of dedupedIds) {
    const cached = readCache(COMPANY_CACHE, `${id}|${propsCacheKey}`);
    if (cached) map.set(id, cached);
    else missingIds.push(id);
  }

  if (!missingIds.length) return map;

  const chunkSize = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < missingIds.length; i += chunkSize) chunks.push(missingIds.slice(i, i + chunkSize));

  const chunkResults = await mapWithConcurrency(chunks, HUBSPOT_BATCH_READ_CONCURRENCY, async (chunk) => {
    const json = await hsFetch(url, {
      method: "POST",
      body: JSON.stringify({
        properties,
        inputs: chunk.map((id) => ({ id })),
      }),
    });
    return (json.results || []) as HubspotCompany[];
  });

  for (const companies of chunkResults) {
    companies.forEach((company) => {
      const id = String(company.id);
      map.set(id, company);
      writeCache(COMPANY_CACHE, `${id}|${propsCacheKey}`, company);
    });
  }

  return map;
}

export async function batchReadContacts(ids: string[], properties: string[]) {
  const url = `${HUBSPOT_BASE}/crm/v3/objects/contacts/batch/read`;
  const map = new Map<string, HubspotContact>();

  const dedupedIds = Array.from(new Set(ids.filter((id) => !!id)));
  const missingIds: string[] = [];

  for (const id of dedupedIds) {
    const cached = readCache(CONTACT_CACHE, id);
    if (cached) map.set(id, cached);
    else missingIds.push(id);
  }

  if (!missingIds.length) return map;

  const chunkSize = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < missingIds.length; i += chunkSize) chunks.push(missingIds.slice(i, i + chunkSize));

  const chunkResults = await mapWithConcurrency(chunks, HUBSPOT_BATCH_READ_CONCURRENCY, async (chunk) => {
    const json = await hsFetch(url, {
      method: "POST",
      body: JSON.stringify({
        properties,
        inputs: chunk.map((id) => ({ id })),
      }),
    });
    return (json.results || []) as HubspotContact[];
  });

  for (const contacts of chunkResults) {
    contacts.forEach((contact) => {
      const id = String(contact.id);
      map.set(id, contact);
      writeCache(CONTACT_CACHE, id, contact);
    });
  }

  return map;
}

export async function batchUpdateDealProperties(updates: HubspotDealPropertyUpdate[]) {
  const deduped = new Map<string, Record<string, string | number | boolean>>();
  for (const u of updates) {
    if (!u.dealId || !u.properties) continue;
    deduped.set(u.dealId, u.properties);
  }

  const inputs = Array.from(deduped.entries()).map(([id, properties]) => ({
    id,
    properties,
  }));
  if (!inputs.length) return;

  const url = `${HUBSPOT_BASE}/crm/v3/objects/deals/batch/update`;
  const chunkSize = 100;
  for (let i = 0; i < inputs.length; i += chunkSize) {
    const chunk = inputs.slice(i, i + chunkSize);
    await hsFetch(url, {
      method: "POST",
      body: JSON.stringify({ inputs: chunk }),
    });
  }
}
