import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildHomeSummaryPayload, HOME_SUMMARY_CACHE_KEY } from "@/lib/homeSummary";
import { getOrSetCache, readTtlMs, setServerResponseCache } from "@/lib/serverResponseCache";

export const runtime = "nodejs";
export const maxDuration = 300;
// Rebuilt by the nightly job; "Refresh" rebuilds on demand.
const CACHE_TTL_MS = readTtlMs("API_HOME_SUMMARY_CACHE_TTL_MS", 24 * 60 * 60 * 1000);

async function handle(refresh: boolean) {
  try {
    if (refresh) {
      const payload = await buildHomeSummaryPayload();
      await setServerResponseCache(HOME_SUMMARY_CACHE_KEY, CACHE_TTL_MS, payload);
      return NextResponse.json(payload);
    }
    const payload = await getOrSetCache(HOME_SUMMARY_CACHE_KEY, CACHE_TTL_MS, () => buildHomeSummaryPayload());
    return NextResponse.json(payload);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req.nextUrl.searchParams.get("refresh") === "1");
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { refresh?: boolean };
  return handle(body?.refresh === true);
}
