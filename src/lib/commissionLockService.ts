import { lockedMonthFromReport } from "@/lib/commissionLock";
import { readLatestCommissionLocks, type StoredCommissionLock } from "@/lib/commissionLockStore";
import {
  generateCommissionReport,
  type CommissionReportRequest,
  type CommissionReportResponse,
} from "@/lib/commissionsReport";

export type CommissionLockContext = {
  /** Active lock of the requested month, if any. */
  current: StoredCommissionLock | null;
  /** Active locks of earlier months, with snapshots. */
  earlier: StoredCommissionLock[];
};

export async function readCommissionLockContext(month: string): Promise<CommissionLockContext> {
  const latest = await readLatestCommissionLocks(month);
  const active = latest.filter((record) => record.action === "lock" && record.report);
  return {
    current: active.find((record) => record.month === month) || null,
    earlier: active.filter((record) => record.month < month),
  };
}

export function lockedReport(lock: StoredCommissionLock): CommissionReportResponse {
  const report = lock.report!;
  return {
    ...report,
    lock: {
      locked: true,
      lockId: lock.lockId,
      lockedAt: lock.lockedAt,
      lockedByName: lock.lockedByName,
      lockedByEmail: lock.lockedByEmail,
    },
  };
}

/** Cache key fragment that changes whenever any earlier lock changes. */
export function lockContextKey(context: CommissionLockContext) {
  return context.earlier.map((record) => `${record.month}:${record.lockId}`).join(",");
}

/** Computes an open month, carrying adjustments for every earlier locked month. */
export async function generateOpenMonthReport(
  request: CommissionReportRequest,
  context: CommissionLockContext,
): Promise<CommissionReportResponse> {
  return generateCommissionReport(request, {
    lockedMonths: context.earlier.map((record) => lockedMonthFromReport(record.report!)),
  });
}
