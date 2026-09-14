import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/authOptions";
import { canViewGtm } from "@/lib/accessRoles";
import { generateGtmReport } from "@/lib/gtmReport";
import { getOrSetCache, readTtlMs } from "@/lib/serverResponseCache";

export const runtime = "nodejs";
export const maxDuration = 300;

const CACHE_TTL_MS = readTtlMs("API_GTM_CACHE_TTL_MS", 5 * 60 * 1000);

type RequestBody = {
  weekEndDate?: string;
};

function parsePayload(raw: Partial<RequestBody>) {
  const weekEndDate = String(raw.weekEndDate || "").trim();
  if (weekEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(weekEndDate)) throw new Error("Invalid weekEndDate. Expected YYYY-MM-DD.");
  return { weekEndDate };
}

async function run(raw: Partial<RequestBody>) {
  const payload = parsePayload(raw);
  const cacheKey = `api:gtm:weekly:v2:${payload.weekEndDate || "default"}`;
  return getOrSetCache(cacheKey, CACHE_TTL_MS, () => generateGtmReport(payload));
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const status = message.startsWith("Invalid ") ? 400 : 500;
  return NextResponse.json({ error: message }, { status });
}

async function hasGtmAccess() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; roles?: string[] } | undefined;
  return canViewGtm(user?.roles || user?.role);
}

export async function POST(req: Request) {
  if (!(await hasGtmAccess())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const raw = await req.text();
    const body = (raw ? JSON.parse(raw) : {}) as Partial<RequestBody>;
    return NextResponse.json(await run(body));
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function GET(req: Request) {
  if (!(await hasGtmAccess())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { searchParams } = new URL(req.url);
    return NextResponse.json(
      await run({
        weekEndDate: searchParams.get("weekEndDate") || "",
      }),
    );
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
