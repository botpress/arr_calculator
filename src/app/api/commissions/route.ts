import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/authOptions";
import { canViewCommissions, hasAppRole } from "@/lib/accessRoles";
import { generateCommissionReport, type CommissionReportRequest } from "@/lib/commissionsReport";
import {
  generateOpenMonthReport,
  lockContextKey,
  lockedReport,
  readCommissionLockContext,
} from "@/lib/commissionLockService";
import { getOrSetCache, readTtlMs, stableStringify } from "@/lib/serverResponseCache";

export const runtime = "nodejs";
export const maxDuration = 300;

const CACHE_TTL_MS = readTtlMs("API_COMMISSIONS_CACHE_TTL_MS", 5 * 60 * 1000);

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; roles?: string[] } | undefined;
  if (!canViewCommissions(user?.roles || user?.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const canManageLocks = hasAppRole(user?.roles || user?.role, "admin");

  try {
    const body = (await request.json()) as CommissionReportRequest;
    const month = String(body?.month || "").trim();

    let context: Awaited<ReturnType<typeof readCommissionLockContext>> | null = null;
    try {
      context = await readCommissionLockContext(month);
    } catch (lockError: unknown) {
      if (lockError instanceof Error && lockError.message.startsWith("Invalid month")) throw lockError;
      context = null;
    }

    if (context?.current) {
      return NextResponse.json({ ...lockedReport(context.current), canManageLocks });
    }

    if (!context) {
      const cacheKey = `api:commissions:v3:nolocks:${stableStringify(body)}`;
      const report = await getOrSetCache(cacheKey, CACHE_TTL_MS, () => generateCommissionReport(body));
      return NextResponse.json({
        ...report,
        canManageLocks,
        warnings: [
          "Month locks could not be read, so this view has no lock status and no adjustments for locked months. Do not pay from it until locks load.",
          ...report.warnings,
        ],
      });
    }

    const lockedContext = context;
    const cacheKey = `api:commissions:v3:${stableStringify(body)}:locks=${lockContextKey(lockedContext)}`;
    const report = await getOrSetCache(cacheKey, CACHE_TTL_MS, () => generateOpenMonthReport(body, lockedContext));
    return NextResponse.json({ ...report, canManageLocks });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Invalid month") || message === "Invalid targetCurrency" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
