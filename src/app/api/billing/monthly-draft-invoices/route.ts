import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/authOptions";
import { normalizeAppRole } from "@/lib/accessRoles";
import { monthlyDraftInvoicesEnabled, runMonthlyDraftInvoiceJob } from "@/lib/monthlyDraftInvoices";

export const runtime = "nodejs";
export const maxDuration = 300;

type RequestBody = {
  month?: string;
  dryRun?: boolean;
  maxDeals?: number;
};

async function authorizationKind(req: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return "cron" as const;
  if (req.method !== "POST") return null;

  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const role = (session.user as { role?: string }).role;
  return normalizeAppRole(role) === "admin" ? "admin" as const : "forbidden" as const;
}

function boolValue(value: unknown, fallback: boolean) {
  if (value == null || String(value).trim() === "") return fallback;
  return ["1", "true", "yes", "y"].includes(String(value).trim().toLowerCase());
}

async function handle(req: Request) {
  const authorization = await authorizationKind(req);
  if (!authorization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (authorization === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: RequestBody = {};
  if (req.method !== "GET") {
    try {
      body = await req.json() as RequestBody;
    } catch {
      body = {};
    }
  }
  const url = new URL(req.url);
  const enabled = monthlyDraftInvoicesEnabled();
  const requestedDryRun = boolValue(body.dryRun ?? url.searchParams.get("dryRun"), !enabled);
  const dryRun = requestedDryRun || !enabled;
  const month = String(body.month || url.searchParams.get("month") || "").trim() || undefined;
  const maxDealsRaw = body.maxDeals ?? url.searchParams.get("maxDeals") ?? undefined;
  const maxDeals = maxDealsRaw == null ? undefined : Number(maxDealsRaw);
  const result = await runMonthlyDraftInvoiceJob({ billingMonth: month, dryRun, maxDeals });

  return NextResponse.json({
    ...result,
    enabled,
    guardMessage: enabled ? null : "BILLING_DRAFTS_ENABLED is not true; this run was forced to dry-run mode.",
  });
}

export async function GET(req: Request) {
  try {
    return await handle(req);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
