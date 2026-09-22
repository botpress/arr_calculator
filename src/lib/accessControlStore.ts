import { BlobNotFoundError, head, put } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeAppRoles, type AppRole } from "@/lib/accessRoles";
import { blobAccessMode, blobFetchHeaders, blobReadWriteToken, hasBlobToken } from "@/lib/blobConfig";

export type AccessControlStoreStorageKind = "vercel_blob" | "local_tmp";

export type AccessControlPolicy = {
  version: 2;
  allowedEmails: string[];
  adminEmails: string[];
  viewerEmails: string[];
  salesEmails: string[];
  accountManagementEmails: string[];
  gtmEmails: string[];
  updatedAt: number;
};

type StoredAccessControlPolicy = Omit<Partial<AccessControlPolicy>, "version"> & { version?: 1 | 2 };

const STORE_BLOB_PATH =
  process.env.AUTH_ACCESS_CONTROL_BLOB_PATH || "arr/auth/access-control-v1.json";
const STORE_PATH =
  process.env.AUTH_ACCESS_CONTROL_STORE_PATH || "/tmp/arr-auth-access-control-v1.json";

const REQUIRED_ADMIN_EMAILS = ["hany.safwat@botpress.com", "siya.gupta@botpress.com"];
const cacheTtlMs = Math.max(5_000, Number(process.env.AUTH_ACCESS_CONTROL_CACHE_TTL_MS || "30000"));
let policyCache: { value: AccessControlPolicy; expiresAt: number } | null = null;

function normalizeEmail(raw: unknown) {
  return String(raw || "").trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseCsvEmailSet(raw: string | undefined) {
  return new Set(
    String(raw || "")
      .split(",")
      .map((value) => normalizeEmail(value))
      .filter((value) => isValidEmail(value)),
  );
}

function bootstrapAdminEmails() {
  const admins = parseCsvEmailSet(process.env.AUTH_ADMIN_EMAILS);
  for (const email of REQUIRED_ADMIN_EMAILS) admins.add(normalizeEmail(email));
  return admins;
}

function bootstrapAllowedEmails() {
  const allowed = parseCsvEmailSet(process.env.AUTH_ALLOWED_EMAILS);
  for (const email of bootstrapAdminEmails()) allowed.add(email);
  return allowed;
}

function bootstrapSalesEmails() {
  return parseCsvEmailSet(process.env.AUTH_SALES_EMAILS);
}

function bootstrapAccountManagementEmails() {
  return parseCsvEmailSet(process.env.AUTH_ACCOUNT_MANAGEMENT_EMAILS);
}

function bootstrapGtmEmails() {
  return parseCsvEmailSet(process.env.AUTH_GTM_EMAILS);
}

function normalizePolicy(value: unknown): AccessControlPolicy {
  const parsed = value && typeof value === "object" ? (value as StoredAccessControlPolicy) : {};
  const allowedSet = new Set<string>();
  const adminSet = new Set<string>();
  const viewerSet = new Set<string>();
  const salesSet = new Set<string>();
  const accountManagementSet = new Set<string>();
  const gtmSet = new Set<string>();

  for (const email of parsed.allowedEmails || []) {
    const normalized = normalizeEmail(email);
    if (isValidEmail(normalized)) allowedSet.add(normalized);
  }
  for (const email of parsed.adminEmails || []) {
    const normalized = normalizeEmail(email);
    if (isValidEmail(normalized)) adminSet.add(normalized);
  }
  for (const email of parsed.viewerEmails || []) {
    const normalized = normalizeEmail(email);
    if (isValidEmail(normalized)) viewerSet.add(normalized);
  }
  for (const email of parsed.salesEmails || []) {
    const normalized = normalizeEmail(email);
    if (isValidEmail(normalized)) salesSet.add(normalized);
  }
  for (const email of parsed.accountManagementEmails || []) {
    const normalized = normalizeEmail(email);
    if (isValidEmail(normalized)) accountManagementSet.add(normalized);
  }
  for (const email of parsed.gtmEmails || []) {
    const normalized = normalizeEmail(email);
    if (isValidEmail(normalized)) gtmSet.add(normalized);
  }

  // Version 1 inferred Viewer from an allowed email that had no specialized role.
  if (parsed.version !== 2 && !Array.isArray(parsed.viewerEmails)) {
    for (const email of allowedSet) {
      if (!adminSet.has(email) && !salesSet.has(email) && !accountManagementSet.has(email)) {
        viewerSet.add(email);
      }
    }
  }

  for (const email of bootstrapAdminEmails()) {
    adminSet.add(email);
    allowedSet.add(email);
  }
  for (const email of bootstrapAllowedEmails()) {
    allowedSet.add(email);
  }
  for (const email of bootstrapSalesEmails()) {
    salesSet.add(email);
    allowedSet.add(email);
  }
  for (const email of bootstrapAccountManagementEmails()) {
    accountManagementSet.add(email);
    allowedSet.add(email);
  }
  for (const email of bootstrapGtmEmails()) {
    gtmSet.add(email);
    allowedSet.add(email);
  }

  for (const email of bootstrapAllowedEmails()) {
    if (
      !adminSet.has(email) &&
      !salesSet.has(email) &&
      !accountManagementSet.has(email) &&
      !gtmSet.has(email)
    ) {
      viewerSet.add(email);
    }
  }

  for (const email of adminSet) {
    viewerSet.delete(email);
    salesSet.delete(email);
    accountManagementSet.delete(email);
    gtmSet.delete(email);
    allowedSet.add(email);
  }
  for (const email of viewerSet) allowedSet.add(email);
  for (const email of salesSet) allowedSet.add(email);
  for (const email of accountManagementSet) allowedSet.add(email);
  for (const email of gtmSet) allowedSet.add(email);

  for (const email of allowedSet) {
    if (
      !adminSet.has(email) &&
      !viewerSet.has(email) &&
      !salesSet.has(email) &&
      !accountManagementSet.has(email) &&
      !gtmSet.has(email)
    ) {
      viewerSet.add(email);
    }
  }

  return {
    version: 2,
    allowedEmails: Array.from(allowedSet).sort((a, b) => a.localeCompare(b)),
    adminEmails: Array.from(adminSet).sort((a, b) => a.localeCompare(b)),
    viewerEmails: Array.from(viewerSet).sort((a, b) => a.localeCompare(b)),
    salesEmails: Array.from(salesSet).sort((a, b) => a.localeCompare(b)),
    accountManagementEmails: Array.from(accountManagementSet).sort((a, b) => a.localeCompare(b)),
    gtmEmails: Array.from(gtmSet).sort((a, b) => a.localeCompare(b)),
    updatedAt: Number(parsed.updatedAt || Date.now()),
  };
}

function parsePolicy(raw: string): AccessControlPolicy {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizePolicy(parsed);
  } catch {
    return normalizePolicy(null);
  }
}

function encodePolicy(policy: AccessControlPolicy) {
  return JSON.stringify(normalizePolicy(policy));
}

function canUseBlobStorage() {
  return hasBlobToken();
}

async function loadFromBlob() {
  try {
    const token = blobReadWriteToken();
    if (!token) return normalizePolicy(null);
    const meta = await head(STORE_BLOB_PATH, { token });
    if (!meta?.url) return normalizePolicy(null);
    const res = await fetch(meta.url, {
      cache: "no-store",
      headers: blobFetchHeaders(),
    });
    if (!res.ok) return normalizePolicy(null);
    const text = await res.text();
    return parsePolicy(text);
  } catch (error: unknown) {
    if (error instanceof BlobNotFoundError) return normalizePolicy(null);
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("not found") || message.includes("404")) return normalizePolicy(null);
    throw error;
  }
}

async function saveToBlob(policy: AccessControlPolicy) {
  const token = blobReadWriteToken();
  if (!token) throw new Error("Missing blob read/write token");
  await put(STORE_BLOB_PATH, encodePolicy(policy), {
    token,
    access: blobAccessMode(),
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

async function loadFromFile() {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return parsePolicy(raw);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return normalizePolicy(null);
    throw error;
  }
}

async function saveToFile(policy: AccessControlPolicy) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, encodePolicy(policy), "utf8");
}

async function readPolicyUncached() {
  if (canUseBlobStorage()) {
    return { storage: "vercel_blob" as const, policy: await loadFromBlob() };
  }
  return { storage: "local_tmp" as const, policy: await loadFromFile() };
}

export async function loadAccessControlPolicy(options?: { bypassCache?: boolean }): Promise<{
  storage: AccessControlStoreStorageKind;
  policy: AccessControlPolicy;
}> {
  const bypassCache = options?.bypassCache === true;
  if (!bypassCache && policyCache && policyCache.expiresAt > Date.now()) {
    return { storage: canUseBlobStorage() ? "vercel_blob" : "local_tmp", policy: policyCache.value };
  }
  const loaded = await readPolicyUncached();
  policyCache = {
    value: loaded.policy,
    expiresAt: Date.now() + cacheTtlMs,
  };
  return loaded;
}

export async function saveAccessControlPolicy(policy: AccessControlPolicy): Promise<{
  storage: AccessControlStoreStorageKind;
  policy: AccessControlPolicy;
}> {
  const normalized = normalizePolicy({
    ...policy,
    updatedAt: Date.now(),
  });
  if (canUseBlobStorage()) {
    await saveToBlob(normalized);
    policyCache = { value: normalized, expiresAt: Date.now() + cacheTtlMs };
    return { storage: "vercel_blob", policy: normalized };
  }
  await saveToFile(normalized);
  policyCache = { value: normalized, expiresAt: Date.now() + cacheTtlMs };
  return { storage: "local_tmp", policy: normalized };
}

export function accessRolesForEmail(policy: AccessControlPolicy, email: string): AppRole[] {
  const normalized = normalizeEmail(email);
  if (policy.adminEmails.includes(normalized)) return ["admin"];
  const roles: AppRole[] = [];
  if (policy.viewerEmails.includes(normalized)) roles.push("viewer");
  if (policy.salesEmails.includes(normalized)) roles.push("sales");
  if (policy.accountManagementEmails.includes(normalized)) roles.push("account_management");
  if (policy.gtmEmails.includes(normalized)) roles.push("gtm");
  return normalizeAppRoles(roles);
}

function policyWithEmailRoles(policy: AccessControlPolicy, email: string, roles: unknown) {
  const allowed = new Set(policy.allowedEmails);
  const admins = new Set(policy.adminEmails);
  const viewers = new Set(policy.viewerEmails);
  const sales = new Set(policy.salesEmails);
  const accountManagement = new Set(policy.accountManagementEmails);
  const gtm = new Set(policy.gtmEmails);
  const normalizedRoles = normalizeAppRoles(roles);

  allowed.add(email);
  admins.delete(email);
  viewers.delete(email);
  sales.delete(email);
  accountManagement.delete(email);
  gtm.delete(email);

  if (normalizedRoles.includes("admin")) {
    admins.add(email);
  } else {
    if (normalizedRoles.includes("viewer")) viewers.add(email);
    if (normalizedRoles.includes("sales")) sales.add(email);
    if (normalizedRoles.includes("account_management")) accountManagement.add(email);
    if (normalizedRoles.includes("gtm")) gtm.add(email);
  }

  return {
    version: 2 as const,
    allowedEmails: Array.from(allowed),
    adminEmails: Array.from(admins),
    viewerEmails: Array.from(viewers),
    salesEmails: Array.from(sales),
    accountManagementEmails: Array.from(accountManagement),
    gtmEmails: Array.from(gtm),
    updatedAt: Date.now(),
  };
}

export async function upsertAccessEmail(email: string, roles: AppRole | AppRole[]) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new Error("Invalid email address");
  }
  const loaded = await loadAccessControlPolicy({ bypassCache: true });
  return saveAccessControlPolicy(policyWithEmailRoles(loaded.policy, normalized, roles));
}

export async function setEmailRoles(email: string, roles: AppRole[]) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new Error("Invalid email address");
  }
  const normalizedRoles = normalizeAppRoles(roles);
  if (bootstrapAdminEmails().has(normalized) && !normalizedRoles.includes("admin")) {
    throw new Error("Cannot change a required admin role");
  }
  const loaded = await loadAccessControlPolicy({ bypassCache: true });
  return saveAccessControlPolicy(policyWithEmailRoles(loaded.policy, normalized, normalizedRoles));
}

export async function setEmailRole(email: string, role: AppRole) {
  return setEmailRoles(email, [role]);
}

export async function removeAccessEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new Error("Invalid email address");
  }
  const requiredAdmins = bootstrapAdminEmails();
  if (requiredAdmins.has(normalized)) {
    throw new Error("Cannot remove a required admin email");
  }
  const loaded = await loadAccessControlPolicy({ bypassCache: true });
  const allowed = new Set(loaded.policy.allowedEmails);
  const admins = new Set(loaded.policy.adminEmails);
  const viewers = new Set(loaded.policy.viewerEmails);
  const sales = new Set(loaded.policy.salesEmails);
  const accountManagement = new Set(loaded.policy.accountManagementEmails);
  const gtm = new Set(loaded.policy.gtmEmails);
  allowed.delete(normalized);
  admins.delete(normalized);
  viewers.delete(normalized);
  sales.delete(normalized);
  accountManagement.delete(normalized);
  gtm.delete(normalized);
  for (const required of requiredAdmins) {
    allowed.add(required);
    admins.add(required);
  }
  return saveAccessControlPolicy({
    version: 2,
    allowedEmails: Array.from(allowed),
    adminEmails: Array.from(admins),
    viewerEmails: Array.from(viewers),
    salesEmails: Array.from(sales),
    accountManagementEmails: Array.from(accountManagement),
    gtmEmails: Array.from(gtm),
    updatedAt: Date.now(),
  });
}
