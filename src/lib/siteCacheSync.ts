import { clearHubspotMemoryCache } from "@/lib/hubspot";
import { detectDirtyMonthSyncPlan, resolveDirtyMonthKeys } from "@/lib/dirtyDateSync";
import { syncPrecomputedFacts } from "@/lib/precomputedFacts";
import { factSyncInMainSyncEnabled, legacyPrecomputeWarmupEnabled } from "@/lib/factTableFlags";
import {
  clearPersistentServerResponseCache,
  clearServerResponseCache,
  readServerCacheSyncRunState,
  type ServerCacheSyncRunState,
  writeServerCacheSyncRunState,
  writeServerCacheSyncStatus,
} from "@/lib/serverResponseCache";
import { clearStripeReportMemoryCache } from "@/lib/stripeReport";
import { POST as combinedAllSubsPost } from "@/app/api/combined-all-subs-report/route";
import { POST as combinedBillingOverviewPost } from "@/app/api/combined-billing-overview-report/route";
import { POST as combinedLiveArrPost } from "@/app/api/combined-live-arr/route";
import { POST as homeSummaryPost } from "@/app/api/home-summary/route";
import { POST as modelUpdateAnalyticsPost } from "@/app/api/model-update-analytics/route";
import { POST as hubspotViewModelPost } from "@/app/api/hubspot-view-model/route";
import { POST as stripeAiSpendPost } from "@/app/api/stripe-ai-spend-report/route";
import { POST as stripeBillingOverviewPost } from "@/app/api/stripe-billing-overview-report/route";
import { POST as stripeThroughMrrPost } from "@/app/api/stripe-through-mrr-report/route";
import { POST as tofuPost } from "@/app/api/tofu-report/route";
import { POST as ndrGdrPost } from "@/app/api/ndr-gdr-report/route";

export type SyncMode = "fast" | "full";

type SyncOptions = {
  warmup?: boolean;
  syncMode?: SyncMode;
};

type WarmupTaskOptions = {
  dirtyMonthKeys?: string[] | null;
};

export type CacheSyncTaskResult = {
  key: string;
  ok: boolean;
  status?: number;
  tookMs: number;
  error?: string;
  transient?: boolean;
  attempts?: number;
  retryAfterMs?: number;
  source?: "bigquery" | "hubspot" | "stripe_api" | "mixed";
};

export type CacheSyncResult = {
  startedAtUtc: string;
  finishedAtUtc: string;
  tookMs: number;
  warmup: boolean;
  cleared: {
    inMemory: ReturnType<typeof clearServerResponseCache>;
    persistent: Awaited<ReturnType<typeof clearPersistentServerResponseCache>>;
  };
  tasks: CacheSyncTaskResult[];
};

type RoutePostHandler = (req: never) => Promise<Response>;

type WarmupTaskDefinition = {
  key: string;
  handler: RoutePostHandler;
  body: Record<string, unknown>;
  source?: "bigquery" | "hubspot" | "stripe_api" | "mixed";
};

export type CacheSyncClearResult = {
  inMemory: ReturnType<typeof clearServerResponseCache>;
  persistent: Awaited<ReturnType<typeof clearPersistentServerResponseCache>>;
};

export type CacheSyncBatchResult = {
  totalTasks: number;
  startIndex: number;
  nextIndex: number;
  done: boolean;
  results: CacheSyncTaskResult[];
};

function normalizeSyncMode(value: unknown): SyncMode {
  return String(value || "").trim().toLowerCase() === "full" ? "full" : "fast";
}

function toIsoDateOnlyUtc(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseIsoDateOnlyUtc(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function parseMonthKeyUtc(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}

function addMonthsUtc(date: Date, deltaMonths: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + deltaMonths, 1));
}

function endOfMonthUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function daysAgoIsoUtc(days: number) {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - Math.max(0, days)));
  return toIsoDateOnlyUtc(utc);
}

function maxIsoDate(a: string, b: string) {
  return a >= b ? a : b;
}

function readConcurrencyLimit(envName: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[envName] || "");
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function readIntEnv(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name] || "");
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds)) return Math.max(0, Math.floor(asSeconds * 1000));
  const asDate = Date.parse(raw);
  if (!Number.isFinite(asDate)) return null;
  return Math.max(0, asDate - Date.now());
}

function classifyTransientFailure(result: Pick<CacheSyncTaskResult, "status" | "error" | "ok">): boolean {
  if (result.ok) return false;
  const status = Number(result.status || 0);
  if (status === 408 || status === 409 || status === 425 || status === 429) return true;
  if (status >= 500) return true;
  const message = String(result.error || "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("could not resolve host") ||
    message.includes("fetch failed") ||
    message.includes("server returned html error page") ||
    message.includes("internal error")
  );
}

function parseRetryAfterMsFromError(error: string | undefined): number | null {
  const text = String(error || "");
  if (!text) return null;
  const direct = /retry-?after[^0-9]*(\d+)/i.exec(text);
  if (direct && Number.isFinite(Number(direct[1]))) {
    return Math.max(0, Math.floor(Number(direct[1]) * 1000));
  }
  return null;
}

function readTaskTimeoutMsForMode(syncMode: SyncMode) {
  const mode = normalizeSyncMode(syncMode);
  const fullTimeoutMs = readIntEnv("CACHE_SYNC_TASK_TIMEOUT_MS_FULL", 600_000, 15_000, 3_600_000);
  const fastTimeoutMs = readIntEnv("CACHE_SYNC_TASK_TIMEOUT_MS_FAST", 180_000, 15_000, 3_600_000);
  const fallbackTimeoutMs = readIntEnv("CACHE_SYNC_TASK_TIMEOUT_MS", mode === "full" ? fullTimeoutMs : fastTimeoutMs, 15_000, 3_600_000);
  return mode === "full"
    ? Math.max(fallbackTimeoutMs, fullTimeoutMs)
    : Math.max(15_000, Math.min(fastTimeoutMs, fallbackTimeoutMs));
}

function defaultRanges(syncMode: SyncMode) {
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const monthlyHistoryStart = String(process.env.COMBINED_BILLING_OVERVIEW_MONTHLY_CACHE_START || "2023-01-01").trim();
  const monthlyHistoryStartIso = /^\d{4}-\d{2}-\d{2}$/.test(monthlyHistoryStart)
    ? monthlyHistoryStart
    : "2023-01-01";
  const fastDaysRaw = Number(process.env.CACHE_SYNC_FAST_LOOKBACK_DAYS || 90);
  const fastLookbackDays = Number.isFinite(fastDaysRaw) ? Math.max(30, Math.floor(fastDaysRaw)) : 90;
  const fastStart = maxIsoDate(monthlyHistoryStartIso, daysAgoIsoUtc(fastLookbackDays));
  const effectiveStart = syncMode === "full" ? monthlyHistoryStartIso : fastStart;
  return {
    today: toIsoDateOnlyUtc(now),
    currentMonthStart: toIsoDateOnlyUtc(currentMonthStart),
    monthlyHistoryStart: monthlyHistoryStartIso,
    effectiveStart,
  };
}

async function precomputedFactsSyncPost(req: never) {
  try {
    const request = req as unknown as Request;
    const raw = await request.text();
    const body = (raw ? JSON.parse(raw) : {}) as {
      mode?: "full" | "dirty";
      startDate?: string;
      endDate?: string;
      includeDaily?: boolean;
      includeMonthly?: boolean;
      dirtyMonthKeys?: string[] | null;
    };
    const result = await syncPrecomputedFacts({
      mode: body.mode || "dirty",
      startDate: body.startDate,
      endDate: body.endDate,
      includeDaily: body.includeDaily,
      includeMonthly: body.includeMonthly,
      dirtyMonthKeys: body.dirtyMonthKeys,
    });
    const ok = (result.steps || []).every((step) => step.ok);
    return new Response(
      JSON.stringify({
        ok,
        ...result,
      }),
      {
        status: ok ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function invokeRoutePost(label: string, handler: RoutePostHandler, body: Record<string, unknown>) {
  const t0 = Date.now();
  try {
    const req = new Request("http://localhost/internal-precompute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await handler(req as never);
    if (res.ok) {
      return {
        key: label,
        ok: true,
        status: res.status,
        tookMs: Date.now() - t0,
      } as CacheSyncTaskResult;
    }

    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    const text = await res.text();
    return {
      key: label,
      ok: false,
      status: res.status,
      tookMs: Date.now() - t0,
      error: text.slice(0, 300),
      transient: classifyTransientFailure({ ok: false, status: res.status, error: text }),
      ...(retryAfterMs !== null ? { retryAfterMs } : {}),
    } as CacheSyncTaskResult;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      key: label,
      ok: false,
      tookMs: Date.now() - t0,
      error: message,
      transient: classifyTransientFailure({ ok: false, error: message }),
    } as CacheSyncTaskResult;
  }
}

async function invokeRoutePostWithRetry(
  task: WarmupTaskDefinition,
  options?: {
    syncMode?: SyncMode;
    timeoutMs?: number;
    maxAttempts?: number;
    serialRecovery?: boolean;
  },
) {
  const syncMode = normalizeSyncMode(options?.syncMode);
  const timeoutMs = Number.isFinite(options?.timeoutMs)
    ? Math.max(15_000, Math.floor(Number(options?.timeoutMs)))
    : readTaskTimeoutMsForMode(syncMode);
  const defaultMaxAttempts = syncMode === "full"
    ? readIntEnv("CACHE_SYNC_MAX_ATTEMPTS_FULL", 5, 1, 10)
    : readIntEnv("CACHE_SYNC_MAX_ATTEMPTS_FAST", 3, 1, 10);
  const maxAttempts = Number.isFinite(options?.maxAttempts)
    ? Math.max(1, Math.min(10, Math.floor(Number(options?.maxAttempts))))
    : defaultMaxAttempts;
  const baseBackoffMs = readIntEnv("CACHE_SYNC_RETRY_BASE_MS", 500, 100, 60_000);
  const maxBackoffMs = readIntEnv("CACHE_SYNC_RETRY_MAX_MS", 20_000, 1000, 180_000);

  const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Task timed out after ${Math.floor(timeoutMs / 1000)}s`)), timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });

  let attempt = 1;
  let result: CacheSyncTaskResult = await withTimeout(invokeRoutePost(task.key, task.handler, task.body)).catch((error: unknown) => ({
    key: task.key,
    ok: false,
    tookMs: 0,
    error: error instanceof Error ? error.message : String(error),
    transient: true,
  }));
  result.source = task.source || "mixed";
  result.transient = classifyTransientFailure(result);
  while (!result.ok && attempt < maxAttempts) {
    if (!classifyTransientFailure(result)) break;
    attempt += 1;
    const jitterMs = Math.floor(Math.random() * 500);
    const exponentialBackoffMs = Math.min(maxBackoffMs, baseBackoffMs * 2 ** (attempt - 2));
    const retryAfterMs = parseRetryAfterMsFromError(result.error);
    const waitMs = Math.max(exponentialBackoffMs + jitterMs, retryAfterMs || 0);
    await sleep(waitMs);
    result = await withTimeout(invokeRoutePost(task.key, task.handler, task.body)).catch((error: unknown) => ({
      key: task.key,
      ok: false,
      tookMs: 0,
      error: error instanceof Error ? error.message : String(error),
      transient: true,
    }));
    result.source = task.source || "mixed";
    result.transient = classifyTransientFailure(result);
  }
  if (!result.ok && attempt > 1) {
    return {
      ...result,
      error: `${result.error || "task failed"} (after ${attempt} attempts${options?.serialRecovery ? ", serial recovery" : ""})`,
      attempts: attempt,
    };
  }
  return {
    ...result,
    attempts: attempt,
  };
}

type WarmupRangeChunk = {
  startDate: string;
  endDate: string;
  label: string;
};

function buildMonthlyWarmupChunks(startDate: string, endDate: string, monthsPerChunk: number): WarmupRangeChunk[] {
  const start = parseIsoDateOnlyUtc(startDate);
  const end = parseIsoDateOnlyUtc(endDate);
  if (!start || !end || end.getTime() < start.getTime()) return [];
  const chunkMonths = Number.isFinite(monthsPerChunk) ? Math.max(1, Math.floor(monthsPerChunk)) : 6;
  const chunks: WarmupRangeChunk[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor.getTime() <= end.getTime()) {
    const chunkStart = cursor;
    const chunkEndCandidate = endOfMonthUtc(addMonthsUtc(chunkStart, chunkMonths - 1));
    const chunkEnd = chunkEndCandidate.getTime() > end.getTime() ? end : chunkEndCandidate;
    const chunkStartIso = toIsoDateOnlyUtc(chunkStart);
    const chunkEndIso = toIsoDateOnlyUtc(chunkEnd);
    chunks.push({
      startDate: chunkStartIso,
      endDate: chunkEndIso,
      label: `${chunkStartIso}..${chunkEndIso}`,
    });
    cursor = addMonthsUtc(chunkStart, chunkMonths);
  }
  return chunks;
}

function buildMonthlyWarmupChunksFromDirtyMonths(monthKeys: string[], monthsPerChunk: number): WarmupRangeChunk[] {
  const parsed = monthKeys
    .map((value) => parseMonthKeyUtc(value))
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime());
  if (!parsed.length) return [];
  const uniqueMonths: Date[] = [];
  for (const monthStart of parsed) {
    const last = uniqueMonths[uniqueMonths.length - 1];
    if (last && last.getTime() === monthStart.getTime()) continue;
    uniqueMonths.push(monthStart);
  }
  const chunkMonths = Number.isFinite(monthsPerChunk) ? Math.max(1, Math.floor(monthsPerChunk)) : 4;
  const today = new Date();
  const todayDateOnly = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const chunks: WarmupRangeChunk[] = [];
  let index = 0;
  while (index < uniqueMonths.length) {
    const chunkStart = uniqueMonths[index];
    let endIndex = index;
    while (endIndex + 1 < uniqueMonths.length) {
      const nextExpected = addMonthsUtc(uniqueMonths[endIndex], 1).getTime();
      const nextActual = uniqueMonths[endIndex + 1].getTime();
      if (nextExpected !== nextActual) break;
      if (endIndex - index + 1 >= chunkMonths) break;
      endIndex += 1;
    }
    const chunkEndByMonth = endOfMonthUtc(uniqueMonths[endIndex]);
    const chunkEnd = chunkEndByMonth.getTime() > todayDateOnly.getTime() ? todayDateOnly : chunkEndByMonth;
    const startDate = toIsoDateOnlyUtc(chunkStart);
    const endDate = toIsoDateOnlyUtc(chunkEnd);
    chunks.push({
      startDate,
      endDate,
      label: `${startDate}..${endDate}`,
    });
    index = endIndex + 1;
  }
  return chunks;
}

export function buildWarmupTaskDefinitions(syncMode: SyncMode = "fast", options: WarmupTaskOptions = {}): WarmupTaskDefinition[] {
  const normalizedMode = normalizeSyncMode(syncMode);
  const { today, currentMonthStart, effectiveStart } = defaultRanges(normalizedMode);
  const previousDate = daysAgoIsoUtc(7);
  const defaultChunkMonths = normalizedMode === "full" ? 4 : 6;
  const chunkMonthsRaw = Number(process.env.CACHE_SYNC_MONTHLY_CHUNK_SIZE || defaultChunkMonths);
  const chunkMonths = Number.isFinite(chunkMonthsRaw) ? Math.max(1, Math.floor(chunkMonthsRaw)) : defaultChunkMonths;
  const dirtyMonthKeys = Array.isArray(options.dirtyMonthKeys)
    ? Array.from(new Set(options.dirtyMonthKeys.map((value) => String(value || "").trim()).filter((value) => /^\d{4}-\d{2}$/.test(value))))
      .sort()
    : null;
  if (dirtyMonthKeys && dirtyMonthKeys.length === 0) return [];
  const chunks = dirtyMonthKeys
    ? buildMonthlyWarmupChunksFromDirtyMonths(dirtyMonthKeys, chunkMonths)
    : buildMonthlyWarmupChunks(effectiveStart, today, chunkMonths);
  if (!chunks.length) return [];
  const taskStart = chunks[0].startDate;
  const taskEnd = chunks[chunks.length - 1].endDate;
  const tasks: WarmupTaskDefinition[] = [];

  if (factSyncInMainSyncEnabled()) {
    for (const chunk of chunks) {
      tasks.push({
        key: `precomputed-facts:daily:chunk:${chunk.label}`,
        handler: precomputedFactsSyncPost,
        source: "bigquery",
        body: {
          mode: normalizedMode === "full" ? "full" : "dirty",
          startDate: chunk.startDate,
          endDate: chunk.endDate,
          includeDaily: true,
          includeMonthly: false,
          dirtyMonthKeys: dirtyMonthKeys || null,
        },
      });
      tasks.push({
        key: `precomputed-facts:monthly:chunk:${chunk.label}`,
        handler: precomputedFactsSyncPost,
        source: "bigquery",
        body: {
          mode: normalizedMode === "full" ? "full" : "dirty",
          startDate: chunk.startDate,
          endDate: chunk.endDate,
          includeDaily: false,
          includeMonthly: true,
          dirtyMonthKeys: dirtyMonthKeys || null,
        },
      });
    }
  }

  if (legacyPrecomputeWarmupEnabled()) {
    for (const chunk of chunks) {
    tasks.push({
      key: `combined-all-subs:simple:arr:chunk:${chunk.label}`,
      handler: combinedAllSubsPost,
      source: "bigquery",
      body: {
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        combineMode: "simple",
        displayMode: "arr",
        planGrain: "monthly",
        precomputeRangeOnly: true,
        forceRefreshPrecomputed: true,
      },
    });
    tasks.push({
      key: `combined-all-subs:grouped:arr:chunk:${chunk.label}`,
      handler: combinedAllSubsPost,
      source: "bigquery",
      body: {
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        combineMode: "grouped",
        displayMode: "arr",
        planGrain: "monthly",
        precomputeRangeOnly: true,
        forceRefreshPrecomputed: true,
      },
    });
    tasks.push({
      key: `combined-billing-overview:no-cac:chunk:${chunk.label}`,
      handler: combinedBillingOverviewPost,
      source: "bigquery",
      body: {
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        grain: "monthly",
        includeCac: false,
        precomputeRangeOnly: true,
        forceRefreshPrecomputed: true,
      },
    });
    tasks.push({
      key: `combined-billing-overview:cac:chunk:${chunk.label}`,
      handler: combinedBillingOverviewPost,
      source: "bigquery",
      body: {
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        grain: "monthly",
        includeCac: true,
        precomputeRangeOnly: true,
        forceRefreshPrecomputed: true,
      },
    });
    tasks.push({
      key: `tofu:month:chunk:${chunk.label}`,
      handler: tofuPost,
      source: "bigquery",
      body: {
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        combineMode: "grouped",
        groupBy: "month",
        precomputeRangeOnly: true,
        forceRefreshPrecomputed: true,
      },
    });
    tasks.push({
      key: `tofu:segment:chunk:${chunk.label}`,
      handler: tofuPost,
      source: "bigquery",
      body: {
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        combineMode: "grouped",
        groupBy: "segment",
        precomputeRangeOnly: true,
        forceRefreshPrecomputed: true,
      },
    });
    tasks.push({
      key: `tofu:plan:chunk:${chunk.label}`,
      handler: tofuPost,
      source: "bigquery",
      body: {
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        combineMode: "grouped",
        groupBy: "plan",
        precomputeRangeOnly: true,
        forceRefreshPrecomputed: true,
      },
    });
    tasks.push({
      key: `ndr-gdr:overall:chunk:${chunk.label}`,
      handler: ndrGdrPost,
      source: "bigquery",
      body: {
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        combineMode: "grouped",
        groupBy: "overall",
        precomputeRangeOnly: true,
        forceRefreshPrecomputed: true,
      },
    });
    tasks.push({
      key: `ndr-gdr:source:chunk:${chunk.label}`,
      handler: ndrGdrPost,
      source: "bigquery",
      body: {
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        combineMode: "grouped",
        groupBy: "source",
        precomputeRangeOnly: true,
        forceRefreshPrecomputed: true,
      },
    });
    tasks.push({
      key: `ndr-gdr:plan:chunk:${chunk.label}`,
      handler: ndrGdrPost,
      source: "bigquery",
      body: {
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        combineMode: "grouped",
        groupBy: "plan",
        precomputeRangeOnly: true,
        forceRefreshPrecomputed: true,
      },
    });
  }
  }

  tasks.push(
    {
      key: "hubspot-view-model:contracted:monthly",
      handler: hubspotViewModelPost,
      source: "hubspot",
      body: {
        startDate: taskStart,
        endDate: taskEnd,
        mode: "contracted",
        grain: "monthly",
      },
    },
    {
      key: "stripe-through-mrr:monthly:none",
      handler: stripeThroughMrrPost,
      source: "bigquery",
      body: {
        startDate: taskStart,
        endDate: taskEnd,
        grain: "monthly",
        groupBy: "none",
        page: 1,
        pageSize: 250,
      },
    },
    {
      key: "stripe-through-mrr:monthly:email",
      handler: stripeThroughMrrPost,
      source: "bigquery",
      body: {
        startDate: taskStart,
        endDate: taskEnd,
        grain: "monthly",
        groupBy: "email",
        page: 1,
        pageSize: 250,
      },
    },
    {
      key: "stripe-billing-overview:monthly",
      handler: stripeBillingOverviewPost,
      source: "bigquery",
      body: {
        startDate: taskStart,
        endDate: taskEnd,
        grain: "monthly",
        groupBy: "none",
      },
    },
    {
      key: "stripe-ai-spend:current-month",
      handler: stripeAiSpendPost,
      source: "bigquery",
      body: {
        startDate: dirtyMonthKeys ? taskStart : currentMonthStart,
        endDate: dirtyMonthKeys ? taskEnd : today,
        grain: "monthly",
      },
    },
    {
      key: "combined-live-arr",
      handler: combinedLiveArrPost,
      source: "mixed",
      body: {},
    },
    {
      key: "home-summary",
      handler: homeSummaryPost,
      source: "mixed",
      body: { refresh: true },
    },
    {
      key: "model-update-analytics:current-day",
      handler: modelUpdateAnalyticsPost,
      source: "mixed",
      body: {
        startDate: today,
        endDate: today,
        forceRefreshPrecomputed: true,
      },
    },
    {
      key: "model-update-analytics:previous-day",
      handler: modelUpdateAnalyticsPost,
      source: "mixed",
      body: {
        startDate: previousDate,
        endDate: previousDate,
        forceRefreshPrecomputed: true,
      },
    },
  );

  return tasks;
}

export async function clearWebsiteCaches(): Promise<CacheSyncClearResult> {
  const inMemory = clearServerResponseCache();
  const persistent = await clearPersistentServerResponseCache();
  clearHubspotMemoryCache();
  clearStripeReportMemoryCache();
  return { inMemory, persistent };
}

export async function runWarmupTaskBatch(
  startIndex: number,
  batchSize: number,
  syncMode: SyncMode = "fast",
  options: WarmupTaskOptions = {},
): Promise<CacheSyncBatchResult> {
  const tasks = buildWarmupTaskDefinitions(syncMode, options);
  const totalTasks = tasks.length;
  const safeStart = Number.isFinite(startIndex) ? Math.max(0, Math.floor(startIndex)) : 0;
  const safeBatchSize = Number.isFinite(batchSize) ? Math.max(1, Math.min(8, Math.floor(batchSize))) : 1;
  const endExclusive = Math.min(totalTasks, safeStart + safeBatchSize);

  const scheduled: Array<{ index: number; task: WarmupTaskDefinition }> = [];
  for (let i = safeStart; i < endExclusive; i += 1) {
    scheduled.push({ index: i, task: tasks[i] });
  }

  const orderedResults: Array<CacheSyncTaskResult | null> = Array.from(
    { length: scheduled.length },
    () => null,
  );

  const pending = Array.from({ length: scheduled.length }, (_, idx) => idx);
  const bigQueryLimit = readConcurrencyLimit("CACHE_SYNC_BIGQUERY_CONCURRENCY", 3, 1, 6);
  const hubspotLimit = readConcurrencyLimit("CACHE_SYNC_HUBSPOT_CONCURRENCY", 1, 1, 3);
  const stripeApiLimit = readConcurrencyLimit("CACHE_SYNC_STRIPE_API_CONCURRENCY", 1, 1, 3);
  const mixedLimit = readConcurrencyLimit("CACHE_SYNC_MIXED_CONCURRENCY", 1, 1, 2);
  const sourceLimitsBase: Record<string, number> = {
    bigquery: bigQueryLimit,
    hubspot: hubspotLimit,
    stripe_api: stripeApiLimit,
    mixed: mixedLimit,
  };
  const sourceLimits: Record<string, number> = { ...sourceLimitsBase };
  let adaptiveWaveLimit = safeBatchSize;
  const adaptiveEnabled = String(process.env.CACHE_SYNC_ADAPTIVE_CONCURRENCY || "1").trim() !== "0";
  const downshiftThreshold = readIntEnv("CACHE_SYNC_ADAPTIVE_DOWNSHIFT_THRESHOLD", 2, 1, 6);
  const upliftSuccessThreshold = readIntEnv("CACHE_SYNC_ADAPTIVE_UPLIFT_SUCCESS_STREAK", 3, 1, 10);
  const taskTimeoutMs = readTaskTimeoutMsForMode(syncMode);
  let successWaveStreak = 0;

  while (pending.length) {
    const wave: Array<{ localIndex: number; task: WarmupTaskDefinition }> = [];
    const sourceUsed: Record<string, number> = {};
    for (let i = 0; i < pending.length && wave.length < adaptiveWaveLimit; ) {
      const localIndex = pending[i];
      const task = scheduled[localIndex].task;
      const source = String(task.source || "mixed");
      const limit = sourceLimits[source] ?? 1;
      const used = sourceUsed[source] || 0;
      if (used < limit) {
        sourceUsed[source] = used + 1;
        wave.push({ localIndex, task });
        pending.splice(i, 1);
        continue;
      }
      i += 1;
    }

    if (!wave.length) {
      const localIndex = pending.shift();
      if (localIndex === undefined) break;
      wave.push({ localIndex, task: scheduled[localIndex].task });
    }

    const waveResults = await Promise.all(wave.map(async ({ localIndex, task }) => ({
      localIndex,
      result: await invokeRoutePostWithRetry(task, { syncMode, timeoutMs: taskTimeoutMs }),
    })));
    let transientFailuresInWave = 0;
    for (const { localIndex, result } of waveResults) {
      const normalized = {
        ...result,
        transient: classifyTransientFailure(result),
        source: result.source || scheduled[localIndex].task.source || "mixed",
      } as CacheSyncTaskResult;
      orderedResults[localIndex] = normalized;
      if (!normalized.ok && normalized.transient) transientFailuresInWave += 1;
    }

    if (adaptiveEnabled) {
      if (transientFailuresInWave >= downshiftThreshold) {
        successWaveStreak = 0;
        adaptiveWaveLimit = Math.max(1, adaptiveWaveLimit - 1);
        for (const { localIndex } of waveResults) {
          const source = String(scheduled[localIndex].task.source || "mixed");
          sourceLimits[source] = Math.max(1, (sourceLimits[source] || 1) - 1);
        }
      } else if (transientFailuresInWave === 0) {
        successWaveStreak += 1;
        if (successWaveStreak >= upliftSuccessThreshold) {
          successWaveStreak = 0;
          adaptiveWaveLimit = Math.min(safeBatchSize, adaptiveWaveLimit + 1);
          for (const source of Object.keys(sourceLimitsBase)) {
            sourceLimits[source] = Math.min(sourceLimitsBase[source], (sourceLimits[source] || 1) + 1);
          }
        }
      } else {
        successWaveStreak = 0;
      }
    }
  }

  const recoveryPasses = syncMode === "full"
    ? readIntEnv("CACHE_SYNC_TRANSIENT_RECOVERY_PASSES_FULL", 2, 0, 5)
    : readIntEnv("CACHE_SYNC_TRANSIENT_RECOVERY_PASSES_FAST", 1, 0, 3);
  const recoveryTimeoutMs = Math.max(
    readIntEnv("CACHE_SYNC_TRANSIENT_RECOVERY_TIMEOUT_MS", 240_000, 15_000, 3_600_000),
    taskTimeoutMs,
  );
  for (let pass = 1; pass <= recoveryPasses; pass += 1) {
    const transientFailureIndexes: number[] = [];
    for (let localIndex = 0; localIndex < orderedResults.length; localIndex += 1) {
      const result = orderedResults[localIndex];
      if (!result || result.ok) continue;
      if (!classifyTransientFailure(result)) continue;
      transientFailureIndexes.push(localIndex);
    }
    if (!transientFailureIndexes.length) break;
    for (const localIndex of transientFailureIndexes) {
      const task = scheduled[localIndex].task;
      const recovered = await invokeRoutePostWithRetry(task, {
        syncMode,
        timeoutMs: recoveryTimeoutMs,
        maxAttempts: 2,
        serialRecovery: true,
      });
      orderedResults[localIndex] = {
        ...recovered,
        transient: classifyTransientFailure(recovered),
        source: recovered.source || task.source || "mixed",
      };
    }
  }

  const results = orderedResults.filter((value): value is CacheSyncTaskResult => Boolean(value));

  return {
    totalTasks,
    startIndex: safeStart,
    nextIndex: endExclusive,
    done: endExclusive >= totalTasks,
    results,
  };
}

export async function initializeSyncRunState(args: {
  warmup: boolean;
  syncMode: SyncMode;
  dirtyMode?: boolean;
  dirtyMonthKeys?: string[];
  startedAtUtc: string;
  totalTasks: number;
  taskKeys: string[];
}) {
  const state: ServerCacheSyncRunState = {
    startedAtUtc: args.startedAtUtc,
    warmup: args.warmup,
    syncMode: normalizeSyncMode(args.syncMode),
    dirtyMode: Boolean(args.dirtyMode),
    dirtyMonthKeys: Array.isArray(args.dirtyMonthKeys) ? args.dirtyMonthKeys : [],
    totalTasks: args.totalTasks,
    nextTaskIndex: 0,
    okTaskCount: 0,
    failedTaskCount: 0,
    failedTaskKeys: [],
    taskKeys: args.taskKeys,
    done: args.totalTasks === 0,
    updatedAtUtc: new Date().toISOString(),
  };
  await writeServerCacheSyncRunState(state);
  return state;
}

export async function getSyncRunState() {
  return readServerCacheSyncRunState();
}

export async function updateSyncRunStateAfterBatch(args: {
  previous: ServerCacheSyncRunState;
  batch: CacheSyncBatchResult;
}) {
  const okDelta = args.batch.results.filter((result) => result.ok).length;
  const failed = args.batch.results.filter((result) => !result.ok);
  const failedTaskKeys = Array.from(new Set([...(args.previous.failedTaskKeys || []), ...failed.map((item) => item.key)]));
  const next: ServerCacheSyncRunState = {
    ...args.previous,
    nextTaskIndex: args.batch.nextIndex,
    okTaskCount: Math.max(0, Number(args.previous.okTaskCount || 0) + okDelta),
    failedTaskCount: Math.max(0, Number(args.previous.failedTaskCount || 0) + failed.length),
    failedTaskKeys,
    done: args.batch.done,
    updatedAtUtc: new Date().toISOString(),
  };
  await writeServerCacheSyncRunState(next);
  return next;
}

export async function writeFinalSyncStatusFromResults(
  startedAtUtc: string,
  warmup: boolean,
  results: CacheSyncTaskResult[],
) {
  const finishedAtUtc = new Date().toISOString();
  const startedAtMs = Date.parse(startedAtUtc);
  const finishedAtMs = Date.parse(finishedAtUtc);
  const tookMs = Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
    ? Math.max(0, finishedAtMs - startedAtMs)
    : results.reduce((sum, result) => sum + Math.max(0, Number(result.tookMs || 0)), 0);
  const okTaskCount = results.filter((task) => task.ok).length;
  const failedTaskCount = results.length - okTaskCount;
  await writeServerCacheSyncStatus({
    startedAtUtc,
    finishedAtUtc,
    tookMs,
    warmup,
    okTaskCount,
    failedTaskCount,
    totalTaskCount: results.length,
  });
}

export async function writeFinalSyncStatusCounts(
  startedAtUtc: string,
  warmup: boolean,
  okTaskCount: number,
  failedTaskCount: number,
  totalTaskCount: number,
) {
  const finishedAtUtc = new Date().toISOString();
  const startedAtMs = Date.parse(startedAtUtc);
  const finishedAtMs = Date.parse(finishedAtUtc);
  const tookMs = Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
    ? Math.max(0, finishedAtMs - startedAtMs)
    : 0;
  await writeServerCacheSyncStatus({
    startedAtUtc,
    finishedAtUtc,
    tookMs,
    warmup,
    okTaskCount: Math.max(0, Math.floor(okTaskCount || 0)),
    failedTaskCount: Math.max(0, Math.floor(failedTaskCount || 0)),
    totalTaskCount: Math.max(0, Math.floor(totalTaskCount || 0)),
  });
}

export async function syncWebsiteCache(options: SyncOptions = {}): Promise<CacheSyncResult> {
  const warmup = options.warmup !== false;
  const syncMode = normalizeSyncMode(options.syncMode);
  const startedAt = Date.now();
  const startedAtUtc = new Date(startedAt).toISOString();
  const cleared = await clearWebsiteCaches();
  const tasks: CacheSyncTaskResult[] = [];
  let dirtyMonthKeys: string[] | null = null;
  let dirtyMode = false;
  if (warmup) {
    const dirtyPlan = await detectDirtyMonthSyncPlan(syncMode).catch(() => null);
    if (dirtyPlan?.useDirtyMonths) {
      dirtyMode = true;
      dirtyMonthKeys = dirtyPlan.dirtyMonthKeys || [];
    }
  }

  if (warmup) {
    let cursor = 0;
    while (true) {
      const batch = await runWarmupTaskBatch(cursor, 6, syncMode, { dirtyMonthKeys });
      tasks.push(...batch.results);
      cursor = batch.nextIndex;
      if (batch.done) break;
    }
  }

  if (warmup) {
    const finalTransientSweepPasses = syncMode === "full"
      ? readIntEnv("CACHE_SYNC_FINAL_TRANSIENT_SWEEP_PASSES_FULL", 2, 0, 5)
      : readIntEnv("CACHE_SYNC_FINAL_TRANSIENT_SWEEP_PASSES_FAST", 1, 0, 3);
    for (let pass = 1; pass <= finalTransientSweepPasses; pass += 1) {
      const failedIndexes = tasks
        .map((task, index) => ({ task, index }))
        .filter(({ task }) => !task.ok && classifyTransientFailure(task))
        .map(({ index }) => index);
      if (!failedIndexes.length) break;
      for (const index of failedIndexes) {
        const retried = await runWarmupTaskBatch(index, 1, syncMode, { dirtyMonthKeys });
        const next = retried.results[0];
        if (next) tasks[index] = next;
      }
    }
  }

  if (warmup && dirtyMode) {
    const failedTaskCount = tasks.filter((task) => !task.ok).length;
    if (failedTaskCount === 0 && Array.isArray(dirtyMonthKeys) && dirtyMonthKeys.length) {
      await resolveDirtyMonthKeys(dirtyMonthKeys).catch(() => undefined);
    }
  }

  await writeFinalSyncStatusFromResults(startedAtUtc, warmup, tasks);
  const finishedAt = Date.now();
  return {
    startedAtUtc,
    finishedAtUtc: new Date(finishedAt).toISOString(),
    tookMs: finishedAt - startedAt,
    warmup,
    cleared,
    tasks,
  };
}
