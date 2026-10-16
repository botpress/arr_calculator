import { BlobNotFoundError, head, put } from "@vercel/blob";
import { blobFetchHeaders, blobReadWriteToken } from "@/lib/blobConfig";
import { buildHomeSummaryPayload, type HomeSummaryPayload } from "@/lib/homeSummary";

// The homepage's last good payload, kept outside the response cache so the nightly wipe and
// "Hard refresh" never leave the homepage empty. Pages read this copy and rebuild in the background.
const STORE_PATH = String(process.env.HOME_SUMMARY_STORE_PATH || "arr/home-summary/v1/latest.json").trim();

// Other server instances may have saved a newer copy, so the in-memory one is re-checked every few minutes.
const MEMORY_COPY_MS = 5 * 60 * 1000;
let memoryCopy: HomeSummaryPayload | null = null;
let memoryCopyAt = 0;
let rebuildInFlight: Promise<HomeSummaryPayload> | null = null;

export async function readStoredHomeSummary(): Promise<HomeSummaryPayload | null> {
  if (memoryCopy && Date.now() - memoryCopyAt < MEMORY_COPY_MS) return memoryCopy;
  const token = blobReadWriteToken();
  if (!token) return null;
  try {
    const meta = await head(STORE_PATH, { token });
    const res = await fetch(meta.url, { headers: blobFetchHeaders(), cache: "no-store" });
    if (!res.ok) return memoryCopy;
    memoryCopy = (await res.json()) as HomeSummaryPayload;
    memoryCopyAt = Date.now();
    return memoryCopy;
  } catch (error: unknown) {
    if (error instanceof BlobNotFoundError) return memoryCopy;
    return memoryCopy;
  }
}

async function writeStoredHomeSummary(payload: HomeSummaryPayload) {
  memoryCopy = payload;
  memoryCopyAt = Date.now();
  const token = blobReadWriteToken();
  if (!token) return;
  await put(STORE_PATH, JSON.stringify(payload), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
    token,
  });
}

// One rebuild at a time per server instance; callers share it.
export function rebuildHomeSummary(): Promise<HomeSummaryPayload> {
  if (!rebuildInFlight) {
    rebuildInFlight = (async () => {
      const payload = await buildHomeSummaryPayload();
      await writeStoredHomeSummary(payload);
      return payload;
    })().finally(() => {
      rebuildInFlight = null;
    });
  }
  return rebuildInFlight;
}

export function homeSummaryAgeHours(payload: HomeSummaryPayload) {
  const at = Date.parse(payload.generatedAtUtc);
  return Number.isFinite(at) ? (Date.now() - at) / 3_600_000 : Infinity;
}
