import { NextResponse } from "next/server";
import { queryPlgMetrics } from "@/lib/plgMetricsBigquery";
import { getOrSetCache, readTtlMs } from "@/lib/serverResponseCache";

export const runtime = "nodejs";
export const maxDuration = 300;

const CACHE_TTL_MS = readTtlMs("API_PLG_METRICS_CACHE_TTL_MS", 5 * 60 * 1000);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const asOfDate = String(searchParams.get("asOfDate") || "").trim();
    const report = await getOrSetCache(
      `api:plg-metrics:v1:${asOfDate || "latest"}`,
      CACHE_TTL_MS,
      () => queryPlgMetrics({ asOfDate }),
    );
    return NextResponse.json(report);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message.startsWith("Invalid ") ? 400 : 500 },
    );
  }
}
