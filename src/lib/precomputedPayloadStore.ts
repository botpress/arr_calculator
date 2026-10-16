import {
  insertBigQueryRows,
  runBigQuerySqlRows,
  runBigQuerySqlStatement,
  type StripeBigQueryProfile,
} from "@/lib/stripeBigquery";

type StoreOptions = {
  profile?: StripeBigQueryProfile;
};

type PrecomputedPayloadRow = {
  endpoint_key: string;
  cache_key: string;
  start_date: string;
  end_date: string;
  grain: string;
  generated_at: string;
  payload_json: string;
};

export type PrecomputedPayloadRangeRow<T> = {
  cacheKey: string;
  startDate: string;
  endDate: string;
  grain: string;
  generatedAt: string;
  payload: T | null;
};

const PRECOMPUTED_TABLE_PROJECT = String(process.env.PRECOMPUTED_TABLES_PROJECT || "botpress-stripe-data-pipeline")
  .trim() || "botpress-stripe-data-pipeline";
const PRECOMPUTED_TABLE_DATASET = String(process.env.PRECOMPUTED_TABLES_DATASET || "precomputed_tables")
  .trim() || "precomputed_tables";
const PRECOMPUTED_PAYLOAD_TABLE = String(process.env.PRECOMPUTED_PAYLOAD_TABLE || "api_payload_cache")
  .trim() || "api_payload_cache";
const PRECOMPUTED_PROFILE: StripeBigQueryProfile = "stripe_arr_correct";
// Saved results older than this are ignored, so a fix to past data reaches every page within a day.
// The nightly job (08:00 UTC) rebuilds the default ranges, so those stay fresh; other ranges are
// rebuilt on their next view.
const MAX_AGE_HOURS = String(
  Math.max(1, Math.floor(Number(process.env.PRECOMPUTED_PAYLOAD_MAX_AGE_HOURS || 26)) || 26),
);

let ensured = false;

function validateIdentifier(value: string, fallback: string) {
  const normalized = String(value || "").trim() || fallback;
  if (!/^[A-Za-z0-9_]+$/.test(normalized)) {
    throw new Error(`Invalid BigQuery identifier: ${normalized}`);
  }
  return normalized;
}

function tableParts() {
  const project = String(PRECOMPUTED_TABLE_PROJECT || "").trim() || "botpress-stripe-data-pipeline";
  if (!/^[A-Za-z0-9_-]+$/.test(project)) {
    throw new Error(`Invalid BigQuery project id: ${project}`);
  }
  const dataset = validateIdentifier(PRECOMPUTED_TABLE_DATASET, "precomputed_tables");
  const table = validateIdentifier(PRECOMPUTED_PAYLOAD_TABLE, "api_payload_cache");
  return { project, dataset, table, tableRef: `\`${project}.${dataset}.${table}\`` };
}

async function ensureTable(options?: StoreOptions) {
  if (ensured) return;
  const { tableRef } = tableParts();
  await runBigQuerySqlStatement(
    `
CREATE TABLE IF NOT EXISTS ${tableRef} (
  endpoint_key STRING NOT NULL,
  cache_key STRING NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  grain STRING NOT NULL,
  generated_at TIMESTAMP NOT NULL,
  payload_json STRING NOT NULL
)
PARTITION BY DATE(generated_at)
CLUSTER BY endpoint_key, grain, start_date, end_date
`,
    [],
    { profile: options?.profile || PRECOMPUTED_PROFILE },
  );
  ensured = true;
}

export async function readPrecomputedPayload<T>(
  endpointKey: string,
  cacheKey: string,
  options?: StoreOptions,
): Promise<T | null> {
  await ensureTable(options);
  const { tableRef } = tableParts();
  const rows = await runBigQuerySqlRows(
    `
SELECT payload_json
FROM ${tableRef}
WHERE endpoint_key = @endpoint_key
  AND cache_key = @cache_key
  AND generated_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @max_age_hours HOUR)
ORDER BY generated_at DESC
LIMIT 1
`,
    [
      { name: "endpoint_key", type: "STRING", value: String(endpointKey || "").trim() },
      { name: "cache_key", type: "STRING", value: String(cacheKey || "").trim() },
      { name: "max_age_hours", type: "INT64", value: MAX_AGE_HOURS },
    ],
    { profile: options?.profile || PRECOMPUTED_PROFILE },
  );
  const payloadJson = String(rows[0]?.payload_json || "").trim();
  if (!payloadJson) return null;
  try {
    return JSON.parse(payloadJson) as T;
  } catch {
    return null;
  }
}

export async function writePrecomputedPayload(
  row: Omit<PrecomputedPayloadRow, "generated_at">,
  options?: StoreOptions,
) {
  await ensureTable(options);
  const { project, dataset, table, tableRef } = tableParts();
  await runBigQuerySqlStatement(
    `
DELETE FROM ${tableRef}
WHERE endpoint_key = @endpoint_key
  AND cache_key = @cache_key
`,
    [
      { name: "endpoint_key", type: "STRING", value: String(row.endpoint_key || "").trim() },
      { name: "cache_key", type: "STRING", value: String(row.cache_key || "").trim() },
    ],
    { profile: options?.profile || PRECOMPUTED_PROFILE },
  );

  await insertBigQueryRows({
    projectId: project,
    dataset,
    table,
    rows: [
      {
        endpoint_key: String(row.endpoint_key || "").trim(),
        cache_key: String(row.cache_key || "").trim(),
        start_date: String(row.start_date || "").trim(),
        end_date: String(row.end_date || "").trim(),
        grain: String(row.grain || "").trim(),
        generated_at: new Date().toISOString(),
        payload_json: String(row.payload_json || ""),
      },
    ],
    options: { profile: options?.profile || PRECOMPUTED_PROFILE },
  });
}

export async function listLatestPrecomputedPayloadRows<T>(
  endpointKey: string,
  args: {
    startDate?: string;
    endDate?: string;
    grain?: string;
    cacheKeyPrefix?: string;
    limit?: number;
  },
  options?: StoreOptions,
): Promise<Array<PrecomputedPayloadRangeRow<T>>> {
  await ensureTable(options);
  const { tableRef } = tableParts();
  const rows = await runBigQuerySqlRows(
    `
SELECT
  cache_key,
  CAST(start_date AS STRING) AS start_date,
  CAST(end_date AS STRING) AS end_date,
  grain,
  CAST(generated_at AS STRING) AS generated_at,
  payload_json
FROM ${tableRef}
WHERE endpoint_key = @endpoint_key
  AND (@grain = "" OR grain = @grain)
  AND (@start_date = "" OR end_date >= DATE(@start_date))
  AND (@end_date = "" OR start_date <= DATE(@end_date))
  AND (@cache_key_prefix = "" OR STARTS_WITH(cache_key, @cache_key_prefix))
  AND generated_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @max_age_hours HOUR)
QUALIFY ROW_NUMBER() OVER (PARTITION BY cache_key ORDER BY generated_at DESC) = 1
ORDER BY start_date ASC, end_date ASC
LIMIT @limit
`,
    [
      { name: "endpoint_key", type: "STRING", value: String(endpointKey || "").trim() },
      { name: "grain", type: "STRING", value: String(args.grain || "").trim() },
      { name: "start_date", type: "STRING", value: String(args.startDate || "").trim() },
      { name: "end_date", type: "STRING", value: String(args.endDate || "").trim() },
      { name: "cache_key_prefix", type: "STRING", value: String(args.cacheKeyPrefix || "").trim() },
      { name: "limit", type: "INT64", value: String(Math.max(1, Math.min(5000, Number(args.limit || 500)))) },
      { name: "max_age_hours", type: "INT64", value: MAX_AGE_HOURS },
    ],
    { profile: options?.profile || PRECOMPUTED_PROFILE },
  );
  return rows.map((row) => {
    const payloadJson = String(row.payload_json || "");
    let payload: T | null = null;
    try {
      payload = payloadJson ? (JSON.parse(payloadJson) as T) : null;
    } catch {
      payload = null;
    }
    return {
      cacheKey: String(row.cache_key || ""),
      startDate: String(row.start_date || ""),
      endDate: String(row.end_date || ""),
      grain: String(row.grain || ""),
      generatedAt: String(row.generated_at || ""),
      payload,
    };
  });
}
