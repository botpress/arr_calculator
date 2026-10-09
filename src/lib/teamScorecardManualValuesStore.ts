import { BlobNotFoundError, head, put } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { blobAccessMode, blobFetchHeaders, blobReadWriteToken, hasBlobToken } from "@/lib/blobConfig";
import type { TeamScorecardKey } from "@/lib/teamScorecardDefinitions";

export type TeamScorecardManualValue = {
  value: number;
  updatedAt: string;
  updatedBy: string;
};

export type TeamScorecardManualValues = Record<string, TeamScorecardManualValue>;

const STORE_BLOB_PREFIX =
  process.env.TEAM_SCORECARD_MANUAL_VALUES_BLOB_PREFIX || "arr/team-scorecards/manual-values-v1";
const STORE_PATH_PREFIX =
  process.env.TEAM_SCORECARD_MANUAL_VALUES_STORE_PATH || "/tmp/arr-team-scorecard-manual-values-v1";

function validatePeriodMonth(periodMonth: string) {
  if (!/^\d{4}-\d{2}$/.test(periodMonth)) throw new Error("Invalid scorecard period month");
  return periodMonth;
}

function storagePath(team: TeamScorecardKey, periodMonth: string) {
  return `${validatePeriodMonth(periodMonth)}/${team}.json`;
}

function normalizeValues(value: unknown): TeamScorecardManualValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: TeamScorecardManualValues = {};
  for (const [metricId, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Partial<TeamScorecardManualValue>;
    const numericValue = Number(record.value);
    if (!metricId || !Number.isFinite(numericValue)) continue;
    normalized[metricId] = {
      value: numericValue,
      updatedAt: String(record.updatedAt || ""),
      updatedBy: String(record.updatedBy || ""),
    };
  }
  return normalized;
}

function parseValues(raw: string) {
  try {
    return normalizeValues(JSON.parse(raw));
  } catch {
    return {};
  }
}

async function loadFromBlob(team: TeamScorecardKey, periodMonth: string) {
  const token = blobReadWriteToken();
  if (!token) return {};
  const pathname = `${STORE_BLOB_PREFIX}/${storagePath(team, periodMonth)}`;
  try {
    const meta = await head(pathname, { token });
    if (!meta?.url) return {};
    const response = await fetch(meta.url, { cache: "no-store", headers: blobFetchHeaders() });
    if (!response.ok) return {};
    return parseValues(await response.text());
  } catch (error: unknown) {
    if (error instanceof BlobNotFoundError) return {};
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("not found") || message.includes("404")) return {};
    throw error;
  }
}

async function saveToBlob(team: TeamScorecardKey, periodMonth: string, values: TeamScorecardManualValues) {
  const token = blobReadWriteToken();
  if (!token) throw new Error("Missing blob read/write token");
  const pathname = `${STORE_BLOB_PREFIX}/${storagePath(team, periodMonth)}`;
  await put(pathname, JSON.stringify(values), {
    token,
    access: blobAccessMode(),
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

async function loadFromFile(team: TeamScorecardKey, periodMonth: string) {
  const pathname = path.join(STORE_PATH_PREFIX, storagePath(team, periodMonth));
  try {
    return parseValues(await fs.readFile(pathname, "utf8"));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {};
    throw error;
  }
}

async function saveToFile(team: TeamScorecardKey, periodMonth: string, values: TeamScorecardManualValues) {
  const pathname = path.join(STORE_PATH_PREFIX, storagePath(team, periodMonth));
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, JSON.stringify(values), "utf8");
}

export async function loadTeamScorecardManualValues(team: TeamScorecardKey, periodMonth: string) {
  return hasBlobToken()
    ? loadFromBlob(team, periodMonth)
    : loadFromFile(team, periodMonth);
}

let pendingWrite: Promise<void> = Promise.resolve();

export async function saveTeamScorecardManualValue(input: {
  team: TeamScorecardKey;
  periodMonth: string;
  metricId: string;
  value: number | null;
  updatedBy: string;
}) {
  let saved: TeamScorecardManualValues = {};
  const write = pendingWrite.then(async () => {
    const values = await loadTeamScorecardManualValues(input.team, input.periodMonth);
    if (input.value == null) {
      delete values[input.metricId];
    } else {
      values[input.metricId] = {
        value: input.value,
        updatedAt: new Date().toISOString(),
        updatedBy: input.updatedBy,
      };
    }
    if (hasBlobToken()) await saveToBlob(input.team, input.periodMonth, values);
    else await saveToFile(input.team, input.periodMonth, values);
    saved = values;
  });
  pendingWrite = write.catch(() => undefined);
  await write;
  return saved;
}
