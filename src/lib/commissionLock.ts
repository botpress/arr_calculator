// Pure month-lock logic for the Commissions report.
//
// A locked month is an immutable snapshot of what was paid. When a later, open month is
// computed, everything the current data would attribute to a locked month is compared with
// what that month (plus adjustments already paid in later locked months) actually paid. Any
// difference becomes an adjustment line in the open month, so nothing is lost or paid twice.

export type CommissionLedgerKind = "commission" | "clawback";

export type CommissionLedgerEntry = {
  /** Month the amount belongs to (YYYY-MM): close month for commission, event month for clawback. */
  month: string;
  dealId: string;
  dealName: string;
  ownerId: string;
  ownerName: string;
  kind: CommissionLedgerKind;
  /** Signed effect on pay: commission positive, clawback negative. */
  amount: number;
};

export type CommissionAdjustment = {
  forMonth: string;
  dealId: string;
  dealName: string;
  hubspotUrl?: string;
  ownerId: string;
  ownerName: string;
  kind: CommissionLedgerKind;
  previousAmount: number;
  currentAmount: number;
  /** currentAmount - previousAmount: what the open month pays (or recovers). */
  amount: number;
  reason: string;
};

export type CommissionLockedMonth = {
  month: string;
  /** Entries paid in the locked month's own report (commission and clawback rows). */
  entries: CommissionLedgerEntry[];
  /** Adjustment lines included in the locked month's snapshot (for earlier locked months). */
  adjustments: CommissionAdjustment[];
};

export type CommissionLockRecord = {
  month: string;
  action: "lock" | "unlock";
  lockId: string;
  lockedAt: string;
  lockedByName: string;
  lockedByEmail: string;
};

/** Minimal shape of a report needed to extract its ledger (keeps this file free of report imports). */
export type CommissionReportLedgerSource = {
  month: string;
  owners: Array<{
    ownerId: string;
    ownerName: string;
    deals: Array<{
      dealId: string;
      dealName: string;
      ownerId: string;
      ownerName: string;
      grossCommission: number;
      clawback: number;
    }>;
    adjustments?: CommissionAdjustment[];
  }>;
  adjustments?: CommissionAdjustment[];
};

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function entryKey(entry: { dealId: string; kind: CommissionLedgerKind; ownerId: string }) {
  return `${entry.dealId}|${entry.kind}|${entry.ownerId || "unassigned"}`;
}

export function isIsoMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || "").trim());
}

/** Latest record per month wins; returns the months whose latest record is a lock. */
export function activeLocksByMonth(records: CommissionLockRecord[]) {
  const latest = new Map<string, CommissionLockRecord>();
  for (const record of records) {
    if (!isIsoMonth(record.month)) continue;
    const current = latest.get(record.month);
    const recordMs = Date.parse(record.lockedAt);
    const currentMs = current ? Date.parse(current.lockedAt) : Number.NEGATIVE_INFINITY;
    if (!current || recordMs > currentMs || (recordMs === currentMs && record.lockId > current.lockId)) {
      latest.set(record.month, record);
    }
  }
  const active = new Map<string, CommissionLockRecord>();
  for (const [month, record] of latest) if (record.action === "lock") active.set(month, record);
  return active;
}

/** Ledger entries (commission and clawback) that a month report paid in its own rows. */
export function ledgerEntriesFromReport(report: CommissionReportLedgerSource): CommissionLedgerEntry[] {
  const entries: CommissionLedgerEntry[] = [];
  for (const owner of report.owners || []) {
    for (const row of owner.deals || []) {
      const base = {
        month: report.month,
        dealId: row.dealId,
        dealName: row.dealName,
        ownerId: row.ownerId || owner.ownerId || "",
        ownerName: row.ownerName || owner.ownerName || "",
      };
      if (Number(row.grossCommission || 0) > 0) {
        entries.push({ ...base, kind: "commission", amount: round2(row.grossCommission) });
      }
      if (Number(row.clawback || 0) > 0) {
        entries.push({ ...base, kind: "clawback", amount: round2(-row.clawback) });
      }
    }
  }
  return entries;
}

/** Adjustment lines included in a report (top-level list, falling back to per-owner lists). */
export function adjustmentsFromReport(report: CommissionReportLedgerSource): CommissionAdjustment[] {
  if (Array.isArray(report.adjustments)) return report.adjustments;
  return (report.owners || []).flatMap((owner) => owner.adjustments || []);
}

export function lockedMonthFromReport(report: CommissionReportLedgerSource): CommissionLockedMonth {
  return {
    month: report.month,
    entries: ledgerEntriesFromReport(report),
    adjustments: adjustmentsFromReport(report),
  };
}

function adjustmentReason(
  forMonth: string,
  kind: CommissionLedgerKind,
  previous: number,
  current: number,
) {
  const hadPrevious = Math.abs(previous) >= 0.005;
  const hasCurrent = Math.abs(current) >= 0.005;
  if (kind === "commission") {
    if (!hadPrevious) return `Commission now dated ${forMonth} but not in the locked report (late-closed or re-dated deal)`;
    if (!hasCurrent) return `Commission paid in the locked report no longer qualifies (deal deleted, reverted, re-dated or a duplicate)`;
    return `Commission amount changed from ${previous.toFixed(2)} to ${current.toFixed(2)}`;
  }
  if (!hadPrevious) return `Clawback dated ${forMonth} recorded after the month was locked`;
  if (!hasCurrent) return `Clawback in the locked report no longer applies`;
  return `Clawback changed from ${(-previous).toFixed(2)} to ${(-current).toFixed(2)}`;
}

/**
 * Adjustments the open month must carry for earlier locked months.
 *
 * `currentLedger` holds what today's data attributes to every month. For each locked month L
 * before `openMonth` (and not before `earliestComparableMonth`, where the lookback can no
 * longer see every deal), the amount already paid for L is L's own snapshot plus adjustments
 * for L that later locked months (between L and the open month) already paid. The difference
 * per deal, kind and owner becomes an adjustment.
 */
export function computeLockAdjustments(input: {
  openMonth: string;
  currentLedger: CommissionLedgerEntry[];
  lockedMonths: CommissionLockedMonth[];
  earliestComparableMonth?: string;
}): CommissionAdjustment[] {
  const openMonth = input.openMonth;
  const earliest = input.earliestComparableMonth || "";
  const locked = input.lockedMonths
    .filter((entry) => entry.month < openMonth)
    .sort((a, b) => a.month.localeCompare(b.month));
  const adjustments: CommissionAdjustment[] = [];

  for (const lockedMonth of locked) {
    const forMonth = lockedMonth.month;
    if (earliest && forMonth < earliest) continue;

    type Side = { amount: number; dealName: string; ownerName: string; ownerId: string; dealId: string; kind: CommissionLedgerKind };
    const paid = new Map<string, Side>();
    const addPaid = (key: string, side: Side) => {
      const current = paid.get(key);
      if (current) current.amount = round2(current.amount + side.amount);
      else paid.set(key, { ...side, amount: round2(side.amount) });
    };
    for (const entry of lockedMonth.entries) {
      if (entry.month && entry.month !== forMonth) continue;
      addPaid(entryKey(entry), entry);
    }
    for (const later of locked) {
      if (later.month <= forMonth) continue;
      for (const adjustment of later.adjustments) {
        if (adjustment.forMonth !== forMonth) continue;
        addPaid(entryKey(adjustment), { ...adjustment, amount: adjustment.amount });
      }
    }

    const current = new Map<string, Side>();
    for (const entry of input.currentLedger) {
      if (entry.month !== forMonth) continue;
      const key = entryKey(entry);
      const existing = current.get(key);
      if (existing) existing.amount = round2(existing.amount + entry.amount);
      else current.set(key, { ...entry, amount: round2(entry.amount) });
    }

    const keys = Array.from(new Set([...paid.keys(), ...current.keys()])).sort();
    for (const key of keys) {
      const previousSide = paid.get(key);
      const currentSide = current.get(key);
      const previousAmount = round2(previousSide?.amount || 0);
      const currentAmount = round2(currentSide?.amount || 0);
      const amount = round2(currentAmount - previousAmount);
      if (Math.abs(amount) < 0.01) continue;
      const source = (currentSide || previousSide)!;
      adjustments.push({
        forMonth,
        dealId: source.dealId,
        dealName: currentSide?.dealName || previousSide?.dealName || source.dealId,
        ownerId: source.ownerId,
        ownerName: currentSide?.ownerName || previousSide?.ownerName || "",
        kind: source.kind,
        previousAmount,
        currentAmount,
        amount,
        reason: adjustmentReason(forMonth, source.kind, previousAmount, currentAmount),
      });
    }
  }

  return adjustments;
}

export function adjustmentLabel(adjustment: CommissionAdjustment) {
  return `Adjustment for ${adjustment.forMonth}: ${adjustment.reason}`;
}
