import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/authOptions";
import { canViewGtm } from "@/lib/accessRoles";
import { queryGtmDetails, validateGtmDetailRequest, type GtmDetailRequest } from "@/lib/gtmDetails";
import { getOrSetCache, readTtlMs, stableStringify } from "@/lib/serverResponseCache";

export const runtime = "nodejs";
export const maxDuration = 300;

const CACHE_TTL_MS = readTtlMs("API_GTM_DETAILS_CACHE_TTL_MS", 5 * 60 * 1000);

async function run(raw: Partial<GtmDetailRequest>) {
  const request = validateGtmDetailRequest(raw);
  const cacheKey = `api:gtm:details:${stableStringify(request)}`;
  return getOrSetCache(cacheKey, CACHE_TTL_MS, () => queryGtmDetails(request));
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
    const body = (raw ? JSON.parse(raw) : {}) as Partial<GtmDetailRequest>;
    return NextResponse.json(await run(body));
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
