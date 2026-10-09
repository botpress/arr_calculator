import { NextResponse } from "next/server";
import {
  generateAccountManagementReport,
  type AccountManagementReportRequest,
} from "@/lib/accountManagementReport";
import { getOrSetCache, readTtlMs, stableStringify } from "@/lib/serverResponseCache";

export const runtime = "nodejs";
export const maxDuration = 300;

const CACHE_TTL_MS = readTtlMs("API_ACCOUNT_MANAGEMENT_CACHE_TTL_MS", 5 * 60 * 1000);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AccountManagementReportRequest;
    const cacheKey = `api:account-management:v12:${stableStringify(body)}`;
    const report = await getOrSetCache(cacheKey, CACHE_TTL_MS, () => generateAccountManagementReport(body));
    return NextResponse.json(report);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Invalid quarter") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
