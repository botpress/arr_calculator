import { NextResponse } from "next/server";
import { generateMigrationReport } from "@/lib/migrationReport";
import { getOrSetCache, readTtlMs } from "@/lib/serverResponseCache";

export const runtime = "nodejs";
export const maxDuration = 300;

const CACHE_TTL_MS = readTtlMs("API_MIGRATION_CACHE_TTL_MS", 5 * 60 * 1000);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const startDate = String(url.searchParams.get("startDate") || "").trim();
    const endDate = String(url.searchParams.get("endDate") || "").trim();
    const cacheKey = `api:migration:v7:${startDate || "default"}:${endDate || "today"}`;
    const report = await getOrSetCache(cacheKey, CACHE_TTL_MS, () => generateMigrationReport({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }));
    return NextResponse.json(report);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Invalid ") || message.startsWith("Migration reporting starts")
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
