import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/authOptions";
import { canViewCommissions } from "@/lib/accessRoles";
import { generateCommissionReport, type CommissionReportRequest } from "@/lib/commissionsReport";
import { getOrSetCache, readTtlMs, stableStringify } from "@/lib/serverResponseCache";

export const runtime = "nodejs";
export const maxDuration = 300;

const CACHE_TTL_MS = readTtlMs("API_COMMISSIONS_CACHE_TTL_MS", 5 * 60 * 1000);

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; roles?: string[] } | undefined;
  if (!canViewCommissions(user?.roles || user?.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = (await request.json()) as CommissionReportRequest;
    const cacheKey = `api:commissions:v2:${stableStringify(body)}`;
    const report = await getOrSetCache(cacheKey, CACHE_TTL_MS, () => generateCommissionReport(body));
    return NextResponse.json(report);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Invalid month") || message === "Invalid targetCurrency" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
