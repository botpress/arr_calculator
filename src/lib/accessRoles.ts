export type AppRole = "admin" | "viewer" | "sales" | "account_management" | "gtm";

const APP_ROLE_ORDER: AppRole[] = ["admin", "viewer", "sales", "account_management", "gtm"];

function parseAppRole(value: unknown): AppRole | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "admin") return "admin";
  if (normalized === "viewer") return "viewer";
  if (normalized === "sales") return "sales";
  if (normalized === "gtm") return "gtm";
  if (["account_management", "account management", "account-management"].includes(normalized)) {
    return "account_management";
  }
  return null;
}

export function normalizeAppRole(value: unknown): AppRole {
  return parseAppRole(value) || "viewer";
}

export function normalizeAppRoles(value: unknown): AppRole[] {
  const values = Array.isArray(value) ? value : [value];
  const roles = new Set<AppRole>();
  for (const candidate of values) {
    const role = parseAppRole(candidate);
    if (role) roles.add(role);
  }
  if (roles.has("admin")) return ["admin"];
  if (!roles.size) return ["viewer"];
  return APP_ROLE_ORDER.filter((role) => roles.has(role));
}

export function primaryAppRole(value: unknown): AppRole {
  const roles = normalizeAppRoles(value);
  return roles.includes("admin")
    ? "admin"
    : roles.includes("sales")
      ? "sales"
      : roles.includes("account_management")
        ? "account_management"
        : roles.includes("gtm")
          ? "gtm"
          : "viewer";
}

export function hasAppRole(value: unknown, role: AppRole) {
  return normalizeAppRoles(value).includes(role);
}

export function canViewCommissions(roles: unknown) {
  return hasAppRole(roles, "admin") || hasAppRole(roles, "sales");
}

export function canViewGtm(roles: unknown) {
  return hasAppRole(roles, "admin") || hasAppRole(roles, "gtm");
}

export function canViewStandardDashboards(roles: unknown) {
  return hasAppRole(roles, "admin") || hasAppRole(roles, "viewer");
}

export function isSalesOnlyRole(roles: unknown) {
  const normalized = normalizeAppRoles(roles);
  return normalized.length === 1 && normalized[0] === "sales";
}

export function isAccountManagementOnlyRole(roles: unknown) {
  const normalized = normalizeAppRoles(roles);
  return normalized.length === 1 && normalized[0] === "account_management";
}

export function isGtmOnlyRole(roles: unknown) {
  const normalized = normalizeAppRoles(roles);
  return normalized.length === 1 && normalized[0] === "gtm";
}

export function isAssignedAreaOnlyUser(roles: unknown) {
  const normalized = normalizeAppRoles(roles);
  return !normalized.includes("admin") && !normalized.includes("viewer");
}

export function isSalesAllowedApplicationPath(pathname: string) {
  const normalized = String(pathname || "").trim();
  return (
    normalized === "/commissions" ||
    normalized.startsWith("/commissions/") ||
    normalized === "/api/commissions" ||
    normalized.startsWith("/api/commissions/")
  );
}

export function isAccountManagementAllowedApplicationPath(pathname: string) {
  const normalized = String(pathname || "").trim();
  return (
    normalized === "/migration" ||
    normalized.startsWith("/migration/") ||
    normalized === "/api/migration" ||
    normalized.startsWith("/api/migration/")
  );
}

export function isGtmAllowedApplicationPath(pathname: string) {
  const normalized = String(pathname || "").trim();
  return (
    normalized === "/gtm" ||
    normalized.startsWith("/gtm/") ||
    normalized === "/api/gtm" ||
    normalized.startsWith("/api/gtm/")
  );
}

export function isAssignedRoleAllowedApplicationPath(roles: unknown, pathname: string) {
  const normalized = normalizeAppRoles(roles);
  return (
    (normalized.includes("sales") && isSalesAllowedApplicationPath(pathname)) ||
    (normalized.includes("account_management") && isAccountManagementAllowedApplicationPath(pathname)) ||
    (normalized.includes("gtm") && isGtmAllowedApplicationPath(pathname))
  );
}

export function defaultApplicationPathForRoles(roles: unknown) {
  const normalized = normalizeAppRoles(roles);
  if (normalized.includes("admin") || normalized.includes("viewer")) return "/combined-all-subs";
  if (normalized.includes("sales")) return "/commissions";
  if (normalized.includes("account_management")) return "/migration";
  if (normalized.includes("gtm")) return "/gtm";
  return "/combined-all-subs";
}
