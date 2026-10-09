import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { hasAppRole } from "@/lib/accessRoles";
import { authOptions } from "@/lib/authOptions";
import { applyTeamScorecardManualValues } from "@/lib/teamScorecardManualValues";
import {
  loadTeamScorecardManualValues,
  saveTeamScorecardManualValue,
} from "@/lib/teamScorecardManualValuesStore";
import {
  generateTeamScorecardReport,
  normalizeTeamScorecardRequest,
  type TeamScorecardReportRequest,
} from "@/lib/teamScorecardReport";
import { getOrSetCache, readTtlMs, stableStringify } from "@/lib/serverResponseCache";

export const runtime = "nodejs";
export const maxDuration = 300;

const CACHE_TTL_MS = readTtlMs("API_TEAM_SCORECARDS_CACHE_TTL_MS", 5 * 60 * 1000);

type ManualValueRequest = TeamScorecardReportRequest & {
  metricId?: string;
  value?: number | null;
};

async function sessionUser() {
  const session = await getServerSession(authOptions);
  return session?.user as { email?: string | null; role?: string; roles?: string[] } | undefined;
}

async function reportWithManualValues(body: TeamScorecardReportRequest, canEditManualValues: boolean) {
  const cacheKey = `api:team-scorecards:v3:${stableStringify(body)}`;
  const baseReport = await getOrSetCache(cacheKey, CACHE_TTL_MS, () => generateTeamScorecardReport(body));
  const manualValues = await loadTeamScorecardManualValues(baseReport.teamKey, baseReport.endDate.slice(0, 7));
  return { ...applyTeamScorecardManualValues(baseReport, manualValues), canEditManualValues };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TeamScorecardReportRequest;
    const user = await sessionUser();
    const report = await reportWithManualValues(body, hasAppRole(user?.roles || user?.role, "admin"));
    return NextResponse.json(report);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Invalid") || message.includes("startDate") || message.includes("endDate") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await sessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasAppRole(user.roles || user.role, "admin")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as ManualValueRequest;
    const normalized = normalizeTeamScorecardRequest(body);
    const metricId = String(body.metricId || "").trim();
    if (!metricId) return NextResponse.json({ error: "Invalid metric" }, { status: 400 });

    const baseReport = await generateTeamScorecardReport(normalized);
    const metric = baseReport.metrics.find((candidate) => candidate.id === metricId);
    if (!metric) return NextResponse.json({ error: "Invalid metric" }, { status: 400 });
    if (metric.valueKind === "calculated" || metric.values.length) {
      return NextResponse.json({ error: "Calculated metrics cannot be manually overwritten." }, { status: 409 });
    }

    const clearing = body.value === null;
    const value = clearing ? null : Number(body.value);
    if (!clearing && (!Number.isFinite(value) || Math.abs(value as number) > 1_000_000_000_000_000)) {
      return NextResponse.json({ error: "Enter a valid number." }, { status: 400 });
    }

    await saveTeamScorecardManualValue({
      team: normalized.team,
      periodMonth: normalized.endDate.slice(0, 7),
      metricId,
      value,
      updatedBy: String(user.email || "admin").trim().toLowerCase(),
    });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Invalid") || message.includes("startDate") || message.includes("endDate") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
