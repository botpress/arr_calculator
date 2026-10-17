import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/authOptions";
import { hasAppRole } from "@/lib/accessRoles";
import { isIsoMonth } from "@/lib/commissionLock";
import { recordCommissionLock } from "@/lib/commissionLockStore";
import { generateOpenMonthReport, readCommissionLockContext } from "@/lib/commissionLockService";

export const runtime = "nodejs";
export const maxDuration = 300;

type LockRequest = {
  month?: string;
  action?: "lock" | "unlock";
  targetCurrency?: string;
};

function currentUtcMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Admin-only: lock a month (save an immutable snapshot) or unlock it (records an unlock row).
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { name?: string | null; email?: string | null; role?: string; roles?: string[] } | undefined;
  if (!hasAppRole(user?.roles || user?.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = (await request.json()) as LockRequest;
    const month = String(body?.month || "").trim();
    const action = body?.action === "unlock" ? "unlock" : body?.action === "lock" ? "lock" : null;
    if (!isIsoMonth(month)) return NextResponse.json({ error: "Invalid month; expected YYYY-MM" }, { status: 400 });
    if (!action) return NextResponse.json({ error: "Invalid action; expected lock or unlock" }, { status: 400 });

    const byName = String(user?.name || user?.email || "Unknown admin").trim();
    const byEmail = String(user?.email || "").trim().toLowerCase();
    const context = await readCommissionLockContext(month);

    if (action === "unlock") {
      if (!context.current) return NextResponse.json({ error: `${month} is not locked` }, { status: 409 });
      const record = await recordCommissionLock({ month, action: "unlock", byName, byEmail });
      return NextResponse.json({ ok: true, record });
    }

    if (context.current) return NextResponse.json({ error: `${month} is already locked` }, { status: 409 });
    if (month >= currentUtcMonth()) {
      return NextResponse.json({ error: "Only a month that has ended can be locked" }, { status: 400 });
    }

    // Always recompute from fresh data (no response cache) so the snapshot is what gets paid.
    const report = await generateOpenMonthReport({ month, targetCurrency: body?.targetCurrency || "USD" }, context);
    const snapshot = { ...report, lock: null, canManageLocks: undefined };
    const record = await recordCommissionLock({ month, action: "lock", byName, byEmail, report: snapshot });
    return NextResponse.json({
      ok: true,
      record,
      report: {
        ...snapshot,
        canManageLocks: true,
        lock: {
          locked: true,
          lockId: record.lockId,
          lockedAt: record.lockedAt,
          lockedByName: record.lockedByName,
          lockedByEmail: record.lockedByEmail,
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
