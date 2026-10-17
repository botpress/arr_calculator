import { randomUUID } from "node:crypto";
import {
  insertBigQueryRows,
  runBigQuerySqlRows,
  runBigQuerySqlStatement,
  type StripeBigQueryProfile,
} from "@/lib/stripeBigquery";
import { isIsoMonth, type CommissionLockRecord } from "@/lib/commissionLock";
import type { CommissionReportResponse } from "@/lib/commissionsReport";

// Insert-only store of commission month locks. Every lock and unlock is a new row; the latest
// row per month decides whether the month is locked. Rows are never updated or deleted.

const PROFILE: StripeBigQueryProfile = "stripe_arr_correct";
const PROJECT = String(process.env.PRECOMPUTED_TABLES_PROJECT || "botpress-stripe-data-pipeline").trim() ||
  "botpress-stripe-data-pipeline";
const DATASET = String(process.env.PRECOMPUTED_TABLES_DATASET || "precomputed_tables").trim() || "precomputed_tables";
const TABLE = String(process.env.COMMISSION_LOCKS_TABLE || "commission_month_locks").trim() || "commission_month_locks";

let ensured = false;

function tableParts() {
  if (!/^[A-Za-z0-9_-]+$/.test(PROJECT)) throw new Error(`Invalid BigQuery project id: ${PROJECT}`);
  if (!/^[A-Za-z0-9_]+$/.test(DATASET)) throw new Error(`Invalid BigQuery identifier: ${DATASET}`);
  if (!/^[A-Za-z0-9_]+$/.test(TABLE)) throw new Error(`Invalid BigQuery identifier: ${TABLE}`);
  return { project: PROJECT, dataset: DATASET, table: TABLE, tableRef: `\`${PROJECT}.${DATASET}.${TABLE}\`` };
}

async function ensureTable() {
  if (ensured) return;
  const { tableRef } = tableParts();
  await runBigQuerySqlStatement(
    `
CREATE TABLE IF NOT EXISTS ${tableRef} (
  lock_id STRING NOT NULL,
  month STRING NOT NULL,
  action STRING NOT NULL,
  recorded_at TIMESTAMP NOT NULL,
  recorded_by_name STRING,
  recorded_by_email STRING,
  report_json STRING
)
CLUSTER BY month
`,
    [],
    { profile: PROFILE },
  );
  ensured = true;
}

export type StoredCommissionLock = CommissionLockRecord & {
  report: CommissionReportResponse | null;
};

/** Latest lock/unlock record for every month up to and including `throughMonth`. */
export async function readLatestCommissionLocks(throughMonth: string): Promise<StoredCommissionLock[]> {
  if (!isIsoMonth(throughMonth)) throw new Error("Invalid month; expected YYYY-MM");
  await ensureTable();
  const { tableRef } = tableParts();
  const rows = await runBigQuerySqlRows(
    `
SELECT
  lock_id,
  month,
  action,
  FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', recorded_at, 'UTC') AS recorded_at,
  recorded_by_name,
  recorded_by_email,
  IF(action = 'lock', report_json, NULL) AS report_json
FROM ${tableRef}
WHERE month <= @through_month
QUALIFY ROW_NUMBER() OVER (PARTITION BY month ORDER BY recorded_at DESC, lock_id DESC) = 1
ORDER BY month
`,
    [{ name: "through_month", type: "STRING", value: throughMonth }],
    { profile: PROFILE },
  );
  return rows.map((row) => {
    let report: CommissionReportResponse | null = null;
    const json = String(row.report_json || "");
    if (json) {
      try {
        report = JSON.parse(json) as CommissionReportResponse;
      } catch {
        report = null;
      }
    }
    return {
      lockId: String(row.lock_id || ""),
      month: String(row.month || ""),
      action: String(row.action || "") === "lock" ? "lock" : "unlock",
      lockedAt: String(row.recorded_at || ""),
      lockedByName: String(row.recorded_by_name || ""),
      lockedByEmail: String(row.recorded_by_email || ""),
      report,
    } satisfies StoredCommissionLock;
  });
}

export async function recordCommissionLock(input: {
  month: string;
  action: "lock" | "unlock";
  byName: string;
  byEmail: string;
  report?: CommissionReportResponse;
}) {
  if (!isIsoMonth(input.month)) throw new Error("Invalid month; expected YYYY-MM");
  await ensureTable();
  const { project, dataset, table } = tableParts();
  const record = {
    lock_id: randomUUID(),
    month: input.month,
    action: input.action,
    recorded_at: new Date().toISOString(),
    recorded_by_name: input.byName,
    recorded_by_email: input.byEmail,
    report_json: input.action === "lock" && input.report ? JSON.stringify(input.report) : null,
  };
  await insertBigQueryRows({ projectId: project, dataset, table, rows: [record], options: { profile: PROFILE } });
  return {
    lockId: record.lock_id,
    month: record.month,
    action: record.action,
    lockedAt: record.recorded_at,
    lockedByName: record.recorded_by_name,
    lockedByEmail: record.recorded_by_email,
  } satisfies CommissionLockRecord;
}
