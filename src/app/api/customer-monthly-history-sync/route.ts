import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { normalizeAppRole } from "@/lib/accessRoles";
import { authOptions } from "@/lib/authOptions";
import { startCustomerMonthlyHistoryRefresh } from "@/lib/customerMonthlyHistory";

export const runtime = "nodejs";
export const maxDuration = 800;

async function authorizationKind(req: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return "cron" as const;
  if (req.method !== "POST") return null;

  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const role = (session.user as { role?: string }).role;
  return normalizeAppRole(role) === "admin" ? "admin" as const : "forbidden" as const;
}

async function handle(req: Request) {
  const authorization = await authorizationKind(req);
  if (!authorization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (authorization === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await startCustomerMonthlyHistoryRefresh();
  return NextResponse.json({ ok: true, status: "started", triggeredBy: authorization, ...result }, { status: 202 });
}

export async function GET(req: Request) {
  try {
    return await handle(req);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
