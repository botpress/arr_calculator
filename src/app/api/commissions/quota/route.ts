import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/authOptions";
import { canViewCommissions } from "@/lib/accessRoles";
import { generateSalesQuotaReport } from "@/lib/salesQuotaReport";
import { getOrSetCache, readTtlMs } from "@/lib/serverResponseCache";

export const runtime = "nodejs";
export const maxDuration = 300;

const CACHE_TTL_MS = readTtlMs("API_COMMISSIONS_QUOTA_CACHE_TTL_MS", 5 * 60 * 1000);

export async function GET() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; roles?: string[] } | undefined;
  if (!canViewCommissions(user?.roles || user?.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const targetCurrency = "USD";
    const report = await getOrSetCache(
      `api:commissions:quota:v3:${targetCurrency}`,
      CACHE_TTL_MS,
      () => generateSalesQuotaReport({ targetCurrency }),
    );
    return NextResponse.json(report);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Invalid as-of date") || message === "Invalid targetCurrency" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
