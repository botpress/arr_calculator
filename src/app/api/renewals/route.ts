import { NextResponse } from "next/server";
import { generateRenewalsReport } from "@/lib/renewalsReport";
import { todayIsoUtc } from "@/lib/renewalsRules";
import { getOrSetCache, readTtlMs, setServerResponseCache } from "@/lib/serverResponseCache";

export const runtime = "nodejs";
export const maxDuration = 300;

const CACHE_TTL_MS = readTtlMs("API_RENEWALS_CACHE_TTL_MS", 60 * 60 * 1000);

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { refresh?: boolean };
    // The as-of date is part of the key so the window rolls over at midnight UTC.
    const cacheKey = `api:renewals:v1:${todayIsoUtc()}`;
    if (body?.refresh === true) {
      const report = await generateRenewalsReport();
      await setServerResponseCache(cacheKey, CACHE_TTL_MS, report);
      return NextResponse.json(report);
    }
    const report = await getOrSetCache(cacheKey, CACHE_TTL_MS, () => generateRenewalsReport());
    return NextResponse.json(report);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
