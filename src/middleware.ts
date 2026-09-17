import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  canViewCommissions,
  canViewGtm,
  defaultApplicationPathForRoles,
  hasAppRole,
  isAssignedAreaOnlyUser,
  isAssignedRoleAllowedApplicationPath,
  normalizeAppRoles,
} from "@/lib/accessRoles";
import {
  createTvDashboardSessionToken,
  isTvDashboardPath,
  readTvDashboardCredentials,
  readTvDashboardSigningSecret,
  TV_DASHBOARD_SESSION_COOKIE,
  TV_DASHBOARD_SESSION_MAX_AGE_SECONDS,
  verifyTvDashboardAuthorization,
  verifyTvDashboardSessionToken,
} from "@/lib/tvDashboardAuth";

const PUBLIC_PAGE_PATHS = new Set<string>(["/login", "/privacy-policy", "/eula"]);
const PUBLIC_API_PATH_PREFIXES = [
  "/api/auth",
  "/api/quickbooks/callback",
  "/api/quickbooks/keepalive",
  "/api/slack/daily-arr-summary",
  "/api/stripe-sync",
  "/api/stripe-sync/status",
  "/api/stripe-upcoming-sync",
  "/api/stripe-upcoming-snapshots-cleanup",
  "/api/stripe-bigquery-refresh",
  "/api/hubspot-current-metrics-sync",
  "/api/cache/nightly-sync",
  "/api/customer-monthly-history-sync",
  "/api/billing/monthly-draft-invoices",
];
const ADMIN_PAGE_PATH_PREFIXES = ["/model-update"];
const ADMIN_API_PATH_PREFIXES = ["/api/model-update"];
const COMMISSIONS_PAGE_PATH_PREFIXES = ["/commissions"];
const COMMISSIONS_API_PATH_PREFIXES = ["/api/commissions"];
const GTM_PAGE_PATH_PREFIXES = ["/gtm"];
const GTM_API_PATH_PREFIXES = ["/api/gtm"];

function isPublicApiPath(pathname: string) {
  return PUBLIC_API_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function matchesAnyPrefix(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

async function tvDashboardResponse(request: NextRequest) {
  const credentials = readTvDashboardCredentials();
  const signingSecret = readTvDashboardSigningSecret();
  const securityHeaders = {
    "Cache-Control": "private, no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };

  if (!credentials || !signingSecret) {
    return new NextResponse("TV dashboard access is not configured.", {
      status: 503,
      headers: securityHeaders,
    });
  }

  const authorizedByBasic = verifyTvDashboardAuthorization(
    request.headers.get("authorization"),
    credentials,
  );
  const authorizedBySession = await verifyTvDashboardSessionToken(
    request.cookies.get(TV_DASHBOARD_SESSION_COOKIE)?.value,
    credentials,
    signingSecret,
  );

  if (!authorizedByBasic && !authorizedBySession) {
    return new NextResponse("Authentication required.", {
      status: 401,
      headers: {
        ...securityHeaders,
        "WWW-Authenticate": 'Basic realm="Performance Dashboards", charset="UTF-8"',
      },
    });
  }

  const response = NextResponse.next();
  if (authorizedByBasic) {
    response.cookies.set({
      name: TV_DASHBOARD_SESSION_COOKIE,
      value: await createTvDashboardSessionToken(credentials, signingSecret),
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "strict",
      path: "/",
      maxAge: TV_DASHBOARD_SESSION_MAX_AGE_SECONDS,
    });
  }
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  return response;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isTvDashboardPath(pathname)) return await tvDashboardResponse(request);
  if (PUBLIC_PAGE_PATHS.has(pathname)) return NextResponse.next();
  if (pathname.startsWith("/api/") && isPublicApiPath(pathname)) return NextResponse.next();

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
  });
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.nextUrl.origin);
    const callbackUrl = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  const roles = normalizeAppRoles(token.roles || token.role);
  const isAdmin = hasAppRole(roles, "admin");
  if (isAssignedAreaOnlyUser(roles) && !isAssignedRoleAllowedApplicationPath(roles, pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL(defaultApplicationPathForRoles(roles), request.nextUrl.origin));
  }

  const requiresAdminPage = matchesAnyPrefix(pathname, ADMIN_PAGE_PATH_PREFIXES);
  const requiresAdminApi = pathname.startsWith("/api/")
    ? matchesAnyPrefix(pathname, ADMIN_API_PATH_PREFIXES)
    : false;
  if ((requiresAdminPage || requiresAdminApi) && !isAdmin) {
    if (requiresAdminApi) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/combined-all-subs?error=admin_required", request.nextUrl.origin));
  }

  const requiresCommissionsPage = matchesAnyPrefix(pathname, COMMISSIONS_PAGE_PATH_PREFIXES);
  const requiresCommissionsApi = pathname.startsWith("/api/")
    ? matchesAnyPrefix(pathname, COMMISSIONS_API_PATH_PREFIXES)
    : false;
  if ((requiresCommissionsPage || requiresCommissionsApi) && !canViewCommissions(roles)) {
    if (requiresCommissionsApi) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/combined-all-subs?error=admin_required", request.nextUrl.origin));
  }

  const requiresGtmPage = matchesAnyPrefix(pathname, GTM_PAGE_PATH_PREFIXES);
  const requiresGtmApi = pathname.startsWith("/api/")
    ? matchesAnyPrefix(pathname, GTM_API_PATH_PREFIXES)
    : false;
  if ((requiresGtmPage || requiresGtmApi) && !canViewGtm(roles)) {
    if (requiresGtmApi) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/combined-all-subs?error=gtm_required", request.nextUrl.origin));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
