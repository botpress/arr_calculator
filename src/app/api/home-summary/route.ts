import { after, NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { homeSummaryAgeHours, readStoredHomeSummary, rebuildHomeSummary } from "@/lib/homeSummaryStore";

export const runtime = "nodejs";
export const maxDuration = 300;
// Older than this, a page view also starts a background rebuild (the nightly job rebuilds anyway).
const REFRESH_AFTER_HOURS = Number(process.env.HOME_SUMMARY_REFRESH_AFTER_HOURS || 6);

async function handle(refresh: boolean) {
  try {
    if (refresh) return NextResponse.json(await rebuildHomeSummary());

    const stored = await readStoredHomeSummary();
    if (!stored) return NextResponse.json(await rebuildHomeSummary());

    // A copy saved before newer fields existed is shown as-is and rebuilt in the background.
    const missingNewFields = !("retention" in stored);
    if (missingNewFields || homeSummaryAgeHours(stored) > REFRESH_AFTER_HOURS) {
      after(() => rebuildHomeSummary().then(() => undefined, () => undefined));
    }
    return NextResponse.json(stored);
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
