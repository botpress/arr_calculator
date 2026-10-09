export type TvDashboardCredentials = {
  username: string;
  password: string;
};

export const TV_DASHBOARD_SESSION_COOKIE = "tv_dashboard_session";
export const TV_DASHBOARD_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const TV_PAGE_PREFIX = "/tv/scorecards";
const TV_API_PREFIX = "/api/tv/team-scorecards";
const TV_SESSION_VERSION = "v1";

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return mismatch === 0;
}

export function isTvDashboardPath(pathname: string) {
  const normalized = String(pathname || "").trim();
  return (
    normalized === TV_PAGE_PREFIX ||
    normalized.startsWith(`${TV_PAGE_PREFIX}/`) ||
    normalized === TV_API_PREFIX ||
    normalized.startsWith(`${TV_API_PREFIX}/`)
  );
}

export function readTvDashboardCredentials(): TvDashboardCredentials | null {
  const username = String(process.env.TV_DASHBOARD_USERNAME || "").trim();
  const password = String(process.env.TV_DASHBOARD_PASSWORD || "");
  if (!username || !password) return null;
  return { username, password };
}

export function readTvDashboardSigningSecret() {
  const secret = String(process.env.AUTH_SECRET || "");
  return secret || null;
}

export function verifyTvDashboardAuthorization(
  authorizationHeader: string | null | undefined,
  credentials: TvDashboardCredentials,
) {
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(String(authorizationHeader || "").trim());
  if (!match) return false;

  try {
    const decoded = atob(match[1]);
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 1) return false;

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);
    return (
      constantTimeEqual(username, credentials.username) &&
      constantTimeEqual(password, credentials.password)
    );
  } catch {
    return false;
  }
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signTvDashboardSession(
  expiresAtSeconds: number,
  credentials: TvDashboardCredentials,
  signingSecret: string,
) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = [
    TV_SESSION_VERSION,
    String(expiresAtSeconds),
    credentials.username,
    credentials.password,
  ].join("\u0000");
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export async function createTvDashboardSessionToken(
  credentials: TvDashboardCredentials,
  signingSecret: string,
  nowMs = Date.now(),
) {
  const expiresAtSeconds = Math.floor(nowMs / 1000) + TV_DASHBOARD_SESSION_MAX_AGE_SECONDS;
  const signature = await signTvDashboardSession(expiresAtSeconds, credentials, signingSecret);
  return `${expiresAtSeconds}.${signature}`;
}

export async function verifyTvDashboardSessionToken(
  token: string | null | undefined,
  credentials: TvDashboardCredentials,
  signingSecret: string,
  nowMs = Date.now(),
) {
  const [expiresRaw, signature, extra] = String(token || "").split(".");
  if (extra !== undefined || !/^\d+$/.test(expiresRaw || "") || !/^[a-f0-9]{64}$/.test(signature || "")) {
    return false;
  }

  const expiresAtSeconds = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= Math.floor(nowMs / 1000)) {
    return false;
  }

  const expected = await signTvDashboardSession(expiresAtSeconds, credentials, signingSecret);
  return constantTimeEqual(signature, expected);
}
