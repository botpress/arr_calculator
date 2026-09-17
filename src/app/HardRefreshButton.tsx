"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

function shouldHide(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/privacy-policy" ||
    pathname === "/eula" ||
    pathname === "/tv" ||
    pathname.startsWith("/tv/")
  );
}

function formatMontrealTime(isoUtc: string) {
  const dt = new Date(isoUtc);
  if (Number.isNaN(dt.getTime())) return isoUtc;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(dt);
}

function toIsoDateUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function HardRefreshButton() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAssignedAreaOnly, setIsAssignedAreaOnly] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [lastSyncAtUtc, setLastSyncAtUtc] = useState("");
  const [lastSyncSummary, setLastSyncSummary] = useState("");
  const [syncProgress, setSyncProgress] = useState("");
  const [message, setMessage] = useState("");
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [remainingBackfillLoading, setRemainingBackfillLoading] = useState(false);
  const [arrFteRefreshLoading, setArrFteRefreshLoading] = useState(false);
  const [arrFteStartDate, setArrFteStartDate] = useState("2023-01-01");
  const [arrFteEndDate, setArrFteEndDate] = useState(toIsoDateUtc(new Date()));

  useEffect(() => {
    let active = true;
    const loadSession = async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as { user?: { role?: string; roles?: string[] } };
        if (!active) return;
        const roles = Array.isArray(payload?.user?.roles)
          ? payload.user.roles.map((role) => String(role || "").trim().toLowerCase())
          : [String(payload?.user?.role || "").trim().toLowerCase()];
        const admin = roles.includes("admin");
        setIsAdmin(admin);
        setIsAssignedAreaOnly(!admin && !roles.includes("viewer"));
      } catch {
        if (!active) return;
        setIsAdmin(false);
        setIsAssignedAreaOnly(true);
      } finally {
        if (active) setSessionLoaded(true);
      }
    };
    void loadSession();
    const loadCacheStatus = async () => {
      try {
        const res = await fetch("/api/cache/status", { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          lastSync?: {
            finishedAtUtc?: string;
            okTaskCount?: number;
            failedTaskCount?: number;
            totalTaskCount?: number;
          } | null;
        };
        if (!active) return;
        const finishedAtUtc = String(payload?.lastSync?.finishedAtUtc || "").trim();
        if (finishedAtUtc) {
          setLastSyncAtUtc(finishedAtUtc);
          const ok = Number(payload?.lastSync?.okTaskCount || 0);
          const total = Number(payload?.lastSync?.totalTaskCount || 0);
          if (total > 0) {
            setLastSyncSummary(`${ok}/${total} tasks`);
          }
        }
      } catch {
        if (!active) return;
      }
    };
    void loadCacheStatus();
    return () => {
      active = false;
    };
  }, []);

  if (shouldHide(pathname) || !sessionLoaded || isAssignedAreaOnly) return null;

  async function hardRefresh() {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/cache/hard-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("_hard_refresh", String(Date.now()));
      window.location.replace(nextUrl.toString());
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Hard refresh failed");
      setLoading(false);
    }
  }

  async function syncNow(syncMode: "fast" | "full") {
    setSyncLoading(true);
    setMessage("");
    setSyncProgress("");
    try {
      const startRes = await fetch("/api/cache/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "start", warmup: true, syncMode }),
      });
      if (!startRes.ok) {
        const text = await startRes.text();
        const snippet = text.replace(/\s+/g, " ").slice(0, 220);
        throw new Error(`Sync start failed (${startRes.status}). ${snippet}`);
      }

      const startPayload = (await startRes.json()) as {
        startedAtUtc?: string;
        totalTasks?: number;
        taskKeys?: string[];
        nextTaskIndex?: number;
        done?: boolean;
        resumed?: boolean;
        syncMode?: "fast" | "full";
        okTaskCount?: number;
        failedTaskCount?: number;
      };
      const startedAtUtc = String(startPayload?.startedAtUtc || "").trim() || new Date().toISOString();
      const totalTasks = Math.max(0, Number(startPayload?.totalTasks || 0));
      const taskKeys = Array.isArray(startPayload?.taskKeys)
        ? startPayload.taskKeys.map((value) => String(value || ""))
        : [];
      let nextTaskIndex = Math.max(0, Number(startPayload?.nextTaskIndex || 0));
      let done = Boolean(startPayload?.done) || totalTasks === 0;
      let okTaskCount = Math.max(0, Number(startPayload?.okTaskCount || 0));
      let failedTaskCount = Math.max(0, Number(startPayload?.failedTaskCount || 0));
      const failedTaskReasons = new Map<number, string>();
      const transportFailureIndexes = new Set<number>();
      let transportFailedTaskCount = 0;

      const stepBatchSize = syncMode === "full" ? 1 : 2;
      while (!done) {
        const stepEnd = Math.min(totalTasks, nextTaskIndex + stepBatchSize);
        setSyncProgress(`Running cache warmup tasks ${nextTaskIndex + 1}-${stepEnd}/${totalTasks}...`);
        const currentTaskIndex = nextTaskIndex;
        let stepProcessed = false;
        for (let attempt = 1; attempt <= 2 && !stepProcessed; attempt += 1) {
          let stepRes: Response | null = null;
          let fetchThrown: unknown = null;
          try {
            stepRes = await fetch("/api/cache/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              cache: "no-store",
              body: JSON.stringify({
                action: "step",
                taskIndex: nextTaskIndex,
                batchSize: stepBatchSize,
                syncMode,
              }),
            });
          } catch (error: unknown) {
            fetchThrown = error;
          }
          if (fetchThrown) {
            if (attempt < 2) {
              setSyncProgress(`Retrying task ${nextTaskIndex + 1}/${totalTasks} after transient network error...`);
              continue;
            }
            transportFailedTaskCount += 1;
            failedTaskCount += 1;
            transportFailureIndexes.add(currentTaskIndex);
            const label = taskKeys[currentTaskIndex] || `task ${currentTaskIndex + 1}`;
            const reason = fetchThrown instanceof Error ? fetchThrown.message : "Fetch failed";
            failedTaskReasons.set(currentTaskIndex, `${label}: ${reason}`);
            nextTaskIndex += 1;
            done = nextTaskIndex >= totalTasks;
            setLastSyncSummary(`${okTaskCount}/${okTaskCount + failedTaskCount} tasks`);
            stepProcessed = true;
            continue;
          }
          if (!stepRes) {
            if (attempt < 2) {
              setSyncProgress(`Retrying task ${nextTaskIndex + 1}/${totalTasks} after transient network error...`);
              continue;
            }
            transportFailedTaskCount += 1;
            failedTaskCount += 1;
            transportFailureIndexes.add(currentTaskIndex);
            const label = taskKeys[currentTaskIndex] || `task ${currentTaskIndex + 1}`;
            failedTaskReasons.set(currentTaskIndex, `${label}: No response from sync endpoint.`);
            nextTaskIndex += 1;
            done = nextTaskIndex >= totalTasks;
            setLastSyncSummary(`${okTaskCount}/${okTaskCount + failedTaskCount} tasks`);
            stepProcessed = true;
            continue;
          }
          if (!stepRes.ok) {
            const text = await stepRes.text();
            const snippet = text.replace(/\s+/g, " ").slice(0, 220);
            const looksLikeHtml = snippet.toLowerCase().includes("<!doctype html");
            if (attempt < 2) {
              setSyncProgress(`Retrying task ${nextTaskIndex + 1}/${totalTasks} after transient error...`);
              continue;
            }
            transportFailedTaskCount += 1;
            failedTaskCount += 1;
            transportFailureIndexes.add(currentTaskIndex);
            const label = taskKeys[currentTaskIndex] || `task ${currentTaskIndex + 1}`;
            const reason = looksLikeHtml
              ? "Server returned HTML error page (usually timeout or runtime crash)."
              : snippet;
            failedTaskReasons.set(currentTaskIndex, `${label}: ${reason}`);
            nextTaskIndex += 1;
            done = nextTaskIndex >= totalTasks;
            setLastSyncSummary(`${okTaskCount}/${okTaskCount + failedTaskCount} tasks`);
            stepProcessed = true;
            continue;
          }
          const stepPayload = (await stepRes.json()) as {
            nextIndex?: number;
            done?: boolean;
            okTaskCount?: number;
            failedTaskCount?: number;
            results?: Array<{ ok?: boolean; key?: string; error?: string; status?: number }>;
          };
          const stepResults = Array.isArray(stepPayload?.results) ? stepPayload.results : [];
          for (let idx = 0; idx < stepResults.length; idx += 1) {
            const taskIdx = currentTaskIndex + idx;
            const item = stepResults[idx];
            if (item?.ok) {
              okTaskCount += 1;
              failedTaskReasons.delete(taskIdx);
              if (transportFailureIndexes.delete(taskIdx)) {
                transportFailedTaskCount = Math.max(0, transportFailedTaskCount - 1);
              }
            } else {
              failedTaskCount += 1;
              const label = String(item?.key || taskKeys[taskIdx] || `task ${taskIdx + 1}`);
              const detail = String(item?.error || (item?.status ? `HTTP ${item.status}` : "task failed"));
              failedTaskReasons.set(taskIdx, `${label}: ${detail}`);
            }
          }
          const processedCount = Math.max(1, stepResults.length);
          nextTaskIndex = Math.max(
            currentTaskIndex + processedCount,
            Number(stepPayload?.nextIndex || currentTaskIndex + processedCount),
          );
          done = Boolean(stepPayload?.done) || nextTaskIndex >= totalTasks;
          if (Number.isFinite(Number(stepPayload.okTaskCount)) && Number.isFinite(Number(stepPayload.failedTaskCount))) {
            okTaskCount = Math.max(okTaskCount, Number(stepPayload.okTaskCount || 0));
            failedTaskCount = Math.max(failedTaskCount, Number(stepPayload.failedTaskCount || 0));
          }
          setLastSyncSummary(`${okTaskCount}/${okTaskCount + failedTaskCount} tasks`);
          stepProcessed = true;
        }
      }

      if (failedTaskReasons.size > 0) {
        const retryIndexes = Array.from(failedTaskReasons.keys()).sort((a, b) => a - b);
        for (const index of retryIndexes) {
          setSyncProgress(`Retrying failed task ${index + 1}/${totalTasks}...`);
          let retryRes: Response | null = null;
          try {
            retryRes = await fetch("/api/cache/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              cache: "no-store",
              body: JSON.stringify({
                action: "step",
                taskIndex: index,
                batchSize: 1,
                syncMode,
              }),
            });
          } catch {
            continue;
          }
          if (!retryRes.ok) continue;
          const retryPayload = (await retryRes.json()) as {
            results?: Array<{ ok?: boolean; key?: string; error?: string; status?: number }>;
          };
          const retryItem = Array.isArray(retryPayload?.results) ? retryPayload.results[0] : null;
          if (retryItem?.ok) {
            okTaskCount += 1;
            failedTaskCount = Math.max(0, failedTaskCount - 1);
            failedTaskReasons.delete(index);
            if (transportFailureIndexes.delete(index)) {
              transportFailedTaskCount = Math.max(0, transportFailedTaskCount - 1);
            }
          }
        }
      }

      await fetch("/api/cache/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          action: "complete",
          warmup: true,
          syncMode,
          startedAtUtc,
          okTaskCount,
          failedTaskCount,
          totalTaskCount: okTaskCount + failedTaskCount,
        }),
      });

      setLastSyncAtUtc(new Date().toISOString());
      setLastSyncSummary(`${okTaskCount}/${okTaskCount + failedTaskCount} tasks`);
      if (failedTaskCount > 0) {
        const failedTaskList = Array.from(failedTaskReasons.values()).slice(0, 3).join(" | ");
        const extra = transportFailedTaskCount > 0 ? ` (${transportFailedTaskCount} transport timeout/crash)` : "";
        const detail = failedTaskList ? ` Failed: ${failedTaskList}` : "";
        setMessage(`Sync completed with ${failedTaskCount} failed task(s)${extra}.${detail}`);
      } else {
        setMessage("Sync completed.");
      }
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setSyncProgress("");
      setSyncLoading(false);
    }
  }

  function addMonthsUtc(date: Date, months: number) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  }

  function endOfMonthUtc(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  }

  function buildMonthChunks(startDateIso: string, endDateIso: string, monthsPerChunk: number) {
    const start = new Date(`${startDateIso}T00:00:00.000Z`);
    const end = new Date(`${endDateIso}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) return [];
    const chunks: Array<{ startDate: string; endDate: string; label: string }> = [];
    const chunkMonths = Math.max(1, Math.floor(monthsPerChunk));
    let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cursor.getTime() <= end.getTime()) {
      const chunkStart = cursor;
      const chunkEndCandidate = endOfMonthUtc(addMonthsUtc(chunkStart, chunkMonths - 1));
      const chunkEnd = chunkEndCandidate.getTime() > end.getTime() ? end : chunkEndCandidate;
      const startDate = toIsoDateUtc(chunkStart);
      const endDate = toIsoDateUtc(chunkEnd);
      chunks.push({ startDate, endDate, label: `${startDate}..${endDate}` });
      cursor = addMonthsUtc(chunkStart, chunkMonths);
    }
    return chunks;
  }

  function buildDayChunks(startDateIso: string, endDateIso: string, daysPerChunk: number) {
    const start = new Date(`${startDateIso}T00:00:00.000Z`);
    const end = new Date(`${endDateIso}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) return [];
    const DAY_MS = 24 * 60 * 60 * 1000;
    const chunkDays = Math.max(1, Math.floor(daysPerChunk));
    const chunks: Array<{ startDate: string; endDate: string; label: string }> = [];
    let cursorMs = start.getTime();
    const endMs = end.getTime();
    while (cursorMs <= endMs) {
      const chunkStart = new Date(cursorMs);
      const chunkEndMs = Math.min(endMs, cursorMs + (chunkDays - 1) * DAY_MS);
      const chunkEnd = new Date(chunkEndMs);
      const chunkStartIso = toIsoDateUtc(chunkStart);
      const chunkEndIso = toIsoDateUtc(chunkEnd);
      chunks.push({
        startDate: chunkStartIso,
        endDate: chunkEndIso,
        label: `${chunkStartIso}..${chunkEndIso}`,
      });
      cursorMs = chunkEndMs + DAY_MS;
    }
    return chunks;
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function backfillFacts() {
    setBackfillLoading(true);
    setMessage("");
    setSyncProgress("");
    try {
      const fullHistoryStart = "2023-01-01";
      const endDate = toIsoDateUtc(new Date());
      const monthChunks = buildMonthChunks(fullHistoryStart, endDate, 1);
      if (!monthChunks.length) {
        setMessage("No backfill chunks to run.");
        return;
      }

      const dailyChunkDays = 15;
      let okRuns = 0;
      let failedRuns = 0;
      const failedDetails: string[] = [];
      const DAY_MS = 24 * 60 * 60 * 1000;

      const splitChunk = (chunk: { startDate: string; endDate: string; label: string }, minDays = 1) => {
        const start = new Date(`${chunk.startDate}T00:00:00.000Z`);
        const end = new Date(`${chunk.endDate}T00:00:00.000Z`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) return null;
        const spanDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
        if (spanDays <= Math.max(2, minDays)) return null;

        const firstSpanDays = Math.floor(spanDays / 2);
        if (firstSpanDays <= 0 || firstSpanDays >= spanDays) return null;
        const firstEnd = new Date(start.getTime() + (firstSpanDays - 1) * DAY_MS);
        const secondStart = new Date(firstEnd.getTime() + DAY_MS);
        const secondEnd = end;

        const first = {
          startDate: toIsoDateUtc(start),
          endDate: toIsoDateUtc(firstEnd),
          label: `${toIsoDateUtc(start)}..${toIsoDateUtc(firstEnd)}`,
        };
        const second = {
          startDate: toIsoDateUtc(secondStart),
          endDate: toIsoDateUtc(secondEnd),
          label: `${toIsoDateUtc(secondStart)}..${toIsoDateUtc(secondEnd)}`,
        };
        return [first, second];
      };

      const runPhase = async (
        phase: "daily" | "monthly",
        chunk: { startDate: string; endDate: string; label: string },
        attempt: number,
      ) => {
        const res = await fetch("/api/precomputed-facts/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            mode: "full",
            startDate: chunk.startDate,
            endDate: chunk.endDate,
            includeDaily: phase === "daily",
            includeMonthly: phase === "monthly",
          }),
        });
        const text = await res.text();
        let payload: unknown = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }
        if (!res.ok) {
          const snippet = text.replace(/\s+/g, " ").slice(0, 220);
          const looksLikeHtml = snippet.toLowerCase().includes("<!doctype html");
          const errorMessage =
            payload && typeof payload === "object" && "error" in payload
              ? String((payload as { error?: unknown }).error || "")
              : looksLikeHtml
                ? "Server returned HTML error page (usually timeout/runtime crash)."
                : snippet;
          throw new Error(errorMessage || `HTTP ${res.status}`);
        }
        const ok = Boolean(payload && typeof payload === "object" && "ok" in payload ? (payload as { ok?: unknown }).ok : true);
        if (!ok) {
          const errorMessage =
            payload && typeof payload === "object" && "error" in payload
              ? String((payload as { error?: unknown }).error || "")
              : "";
          throw new Error(errorMessage || `${phase} phase failed`);
        }
        if (attempt > 1) {
          setSyncProgress(`${phase.toUpperCase()} succeeded after retry: ${chunk.label}`);
        }
      };

      for (let monthIndex = 0; monthIndex < monthChunks.length; monthIndex += 1) {
        const monthChunk = monthChunks[monthIndex];
        const dailyBaseChunks = buildDayChunks(monthChunk.startDate, monthChunk.endDate, dailyChunkDays);
        const dailyPendingChunks = [...dailyBaseChunks];

        while (dailyPendingChunks.length > 0) {
          const chunk = dailyPendingChunks.shift()!;
          setSyncProgress(
            `Backfill daily (${monthIndex + 1}/${monthChunks.length} month): ${chunk.label}`,
          );
          let lastError = "";
          let completed = false;
          for (let attempt = 1; attempt <= 3 && !completed; attempt += 1) {
            try {
              await runPhase("daily", chunk, attempt);
              completed = true;
              okRuns += 1;
            } catch (error: unknown) {
              lastError = error instanceof Error ? error.message : "Unknown error";
              if (attempt < 3) {
                await sleep(Math.min(10_000, 1_000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400)));
              }
            }
          }
          if (!completed) {
            const split = splitChunk(chunk, 2);
            if (split) {
              dailyPendingChunks.unshift(split[1], split[0]);
              setSyncProgress(`Split daily chunk ${chunk.label} into smaller windows...`);
              await sleep(250);
              continue;
            }
            failedRuns += 1;
            failedDetails.push(`daily ${chunk.label}: ${lastError || "Unknown error"}`);
          }
          await sleep(250);
        }

        setSyncProgress(`Backfill monthly (${monthIndex + 1}/${monthChunks.length} month): ${monthChunk.label}`);
        let lastError = "";
        let completed = false;
        for (let attempt = 1; attempt <= 3 && !completed; attempt += 1) {
          try {
            await runPhase("monthly", monthChunk, attempt);
            completed = true;
            okRuns += 1;
          } catch (error: unknown) {
            lastError = error instanceof Error ? error.message : "Unknown error";
            if (attempt < 3) {
              await sleep(Math.min(10_000, 1_000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400)));
            }
          }
        }
        if (!completed) {
          const split = splitChunk(monthChunk, 7);
          if (split) {
            monthChunks.splice(monthIndex + 1, 0, split[0], split[1]);
            setSyncProgress(`Split monthly chunk ${monthChunk.label} into smaller windows...`);
          } else {
            failedRuns += 1;
            failedDetails.push(`monthly ${monthChunk.label}: ${lastError || "Unknown error"}`);
          }
        }
        await sleep(350);
      }

      if (failedRuns > 0) {
        setMessage(
          `Fact backfill finished with ${failedRuns} failed run(s). ` +
            `Succeeded: ${okRuns}. ` +
            `Failed: ${failedDetails.slice(0, 3).join(" | ")}`,
        );
      } else {
        setMessage(`Fact backfill completed successfully (${okRuns} runs).`);
      }
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Fact backfill failed");
    } finally {
      setSyncProgress("");
      setBackfillLoading(false);
    }
  }

  async function backfillRemainingOnly() {
    setRemainingBackfillLoading(true);
    setMessage("");
    setSyncProgress("Checking and backfilling remaining gaps...");
    try {
      let round = 0;
      let totalExecuted = 0;
      let plannedTaskCount = 0;
      let remainingTaskCount = 0;

      while (true) {
        round += 1;
        setSyncProgress(`Backfilling remaining gaps (run ${round})...`);
        let res: Response | null = null;
        let lastFetchError = "";
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            res = await fetch("/api/precomputed-facts/backfill-remaining", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              cache: "no-store",
              body: JSON.stringify({ maxTasks: 1, chunkMonths: 1 }),
            });
            break;
          } catch (error: unknown) {
            lastFetchError = error instanceof Error ? error.message : "Failed to fetch";
            if (attempt < 3) await sleep(1_000 * attempt);
          }
        }
        if (!res) throw new Error(lastFetchError || "Failed to fetch");
        const text = await res.text();
        let payload: unknown = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }
        if (!res.ok) {
          const snippet = text.replace(/\s+/g, " ").slice(0, 240);
          const payloadError =
            payload && typeof payload === "object" && "error" in payload
              ? String((payload as { error?: unknown }).error || "")
              : "";
          throw new Error(payloadError || snippet || `HTTP ${res.status}`);
        }

        const shaped = (payload && typeof payload === "object" ? payload : {}) as {
          plannedTaskCount?: unknown;
          executedTaskCount?: unknown;
          remainingTaskCount?: unknown;
          tasks?: Array<{ label?: unknown; ok?: unknown; error?: unknown }>;
        };
        plannedTaskCount = Math.max(0, Number(shaped.plannedTaskCount || 0));
        const executedTaskCount = Math.max(0, Number(shaped.executedTaskCount || 0));
        remainingTaskCount = Math.max(0, Number(shaped.remainingTaskCount || 0));
        totalExecuted += executedTaskCount;

        const tasks = Array.isArray(shaped.tasks) ? shaped.tasks : [];
        const failed = tasks.filter((task) => !Boolean(task?.ok));
        if (failed.length) {
          const failedDetails = failed
            .slice(0, 3)
            .map((task) => `${String(task?.label || "task")}: ${String(task?.error || "failed")}`)
            .join(" | ");
          setMessage(
            `Remaining backfill stopped with ${failed.length} failed task(s). ` +
              `Planned: ${plannedTaskCount}. Executed: ${totalExecuted}. Remaining: ${remainingTaskCount}. ` +
              `Failed: ${failedDetails}`,
          );
          return;
        }
        if (remainingTaskCount <= 0) break;
        await sleep(250);
      }

      if (plannedTaskCount <= 0) {
        setMessage("No remaining backfill gaps found.");
      } else {
        setMessage(`Remaining backfill completed. Planned: ${plannedTaskCount}. Executed: ${totalExecuted}.`);
      }
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Remaining backfill failed");
    } finally {
      setSyncProgress("");
      setRemainingBackfillLoading(false);
    }
  }

  async function refreshArrFteOnly() {
    if (!arrFteStartDate || !arrFteEndDate) {
      setMessage("Select both start and end dates.");
      return;
    }
    if (arrFteEndDate < arrFteStartDate) {
      setMessage("End date must be on or after start date.");
      return;
    }
    setArrFteRefreshLoading(true);
    setMessage("");
    setSyncProgress("Refreshing ARR/FTE cache rows...");
    try {
      const chunks = buildMonthChunks(arrFteStartDate, arrFteEndDate, 3);
      if (!chunks.length) throw new Error("Invalid ARR/FTE date range.");

      let totalUpdatedRows = 0;
      let totalScannedRows = 0;
      const touchedMonths = new Set<string>();

      for (let idx = 0; idx < chunks.length; idx += 1) {
        const chunk = chunks[idx];
        setSyncProgress(`Refreshing ARR/FTE (${idx + 1}/${chunks.length}): ${chunk.label}`);

        let success = false;
        let lastError = "";
        for (let attempt = 1; attempt <= 3 && !success; attempt += 1) {
          try {
            const res = await fetch("/api/combined-billing-overview-arr-fte-refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              cache: "no-store",
              body: JSON.stringify({
                startDate: chunk.startDate,
                endDate: chunk.endDate,
                includeRangeKeys: true,
                includeCanonicalKeys: true,
              }),
            });

            const text = await res.text();
            let payload: Record<string, unknown> | null = null;
            try {
              payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;
            } catch {
              payload = null;
            }

            if (!res.ok) {
              const payloadError = String(payload?.error || "").trim();
              const snippet = text.replace(/\s+/g, " ").slice(0, 220);
              throw new Error(payloadError || snippet || `HTTP ${res.status}`);
            }

            totalUpdatedRows += Math.max(0, Number(payload?.updatedRows || 0));
            totalScannedRows += Math.max(0, Number(payload?.scannedRows || 0));
            const chunkMonths = Array.isArray(payload?.touchedMonths)
              ? payload.touchedMonths.map((value) => String(value || "")).filter(Boolean)
              : [];
            for (const month of chunkMonths) touchedMonths.add(month);
            success = true;
          } catch (error: unknown) {
            lastError = error instanceof Error ? error.message : "Unknown error";
            if (attempt < 3) await sleep(500 * attempt);
          }
        }

        if (!success) {
          throw new Error(`ARR/FTE refresh failed for ${chunk.label}: ${lastError || "Unknown error"}`);
        }
        await sleep(120);
      }

      setMessage(
        `ARR/FTE refresh done. Updated ${totalUpdatedRows} cache row(s) out of ${totalScannedRows} scanned. ` +
          `Months: ${Array.from(touchedMonths).sort().slice(0, 6).join(", ")}${touchedMonths.size > 6 ? "..." : ""}`,
      );
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "ARR/FTE refresh failed");
    } finally {
      setSyncProgress("");
      setArrFteRefreshLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 60,
        display: "grid",
        gap: 6,
        justifyItems: "end",
      }}
    >
      {message ? (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            borderRadius: 8,
            padding: "8px 10px",
            maxWidth: 360,
            fontSize: 12,
          }}
        >
          {message}
        </div>
      ) : null}
      {syncProgress ? (
        <div
          style={{
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            color: "#1e3a8a",
            borderRadius: 8,
            padding: "8px 10px",
            maxWidth: 360,
            fontSize: 12,
          }}
        >
          {syncProgress}
        </div>
      ) : null}
      {isAdmin && debugPanelOpen ? (
        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #cbd5e1",
            color: "#0f172a",
            borderRadius: 10,
            padding: "10px 12px",
            width: 430,
            maxWidth: "calc(100vw - 24px)",
            boxShadow: "0 4px 16px rgba(15,23,42,0.08)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Debug backfill</div>
            <button
              type="button"
              onClick={() => setDebugPanelOpen(false)}
              style={{
                borderRadius: 8,
                border: "1px solid #94a3b8",
                background: "#ffffff",
                color: "#334155",
                padding: "4px 8px",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Close
            </button>
          </div>
          <div style={{ marginTop: 10, borderTop: "1px solid #cbd5e1", paddingTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Remaining backfill only</div>
            <div style={{ fontSize: 11, color: "#334155", lineHeight: 1.4 }}>
              Runs only missing ranges (AI spend history gaps and missing TOFU monthly windows).
            </div>
            <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => void backfillRemainingOnly()}
                disabled={
                  remainingBackfillLoading ||
                  loading ||
                  syncLoading ||
                  backfillLoading ||
                  arrFteRefreshLoading
                }
                style={{
                  borderRadius: 8,
                  border: "1px solid #166534",
                  background: remainingBackfillLoading ? "#166534" : "#16a34a",
                  color: "#ffffff",
                  padding: "6px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor:
                    remainingBackfillLoading ||
                    loading ||
                    syncLoading ||
                    backfillLoading ||
                    arrFteRefreshLoading
                      ? "wait"
                      : "pointer",
                }}
              >
                {remainingBackfillLoading ? "Backfilling..." : "Backfill remaining only"}
              </button>
            </div>
          </div>
          <div style={{ marginTop: 10, borderTop: "1px solid #cbd5e1", paddingTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>ARR/FTE refresh only</div>
            <div style={{ fontSize: 11, color: "#334155", lineHeight: 1.4 }}>
              Recomputes only BambooHR-based ARR/FTE values for combined billing cache rows in this date range.
            </div>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label style={{ fontSize: 11, color: "#334155" }}>
                  Start
                  <input
                    type="date"
                    value={arrFteStartDate}
                    onChange={(event) => setArrFteStartDate(event.target.value)}
                    style={{
                      marginLeft: 6,
                      border: "1px solid #94a3b8",
                      borderRadius: 6,
                      padding: "4px 6px",
                      fontSize: 12,
                    }}
                  />
                </label>
                <label style={{ fontSize: 11, color: "#334155" }}>
                  End
                  <input
                    type="date"
                    value={arrFteEndDate}
                    onChange={(event) => setArrFteEndDate(event.target.value)}
                    style={{
                      marginLeft: 6,
                      border: "1px solid #94a3b8",
                      borderRadius: 6,
                      padding: "4px 6px",
                      fontSize: 12,
                    }}
                  />
                </label>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => void refreshArrFteOnly()}
                  disabled={arrFteRefreshLoading || loading || syncLoading || backfillLoading || remainingBackfillLoading}
                  style={{
                    borderRadius: 8,
                    border: "1px solid #0f766e",
                    background: arrFteRefreshLoading ? "#115e59" : "#0f766e",
                    color: "#ffffff",
                    padding: "6px 10px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor:
                      arrFteRefreshLoading || loading || syncLoading || backfillLoading || remainingBackfillLoading
                        ? "wait"
                        : "pointer",
                  }}
                >
                  {arrFteRefreshLoading ? "Refreshing..." : "Refresh ARR/FTE only"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8 }}>
        {isAdmin ? (
          <>
            <button
              type="button"
              onClick={() => void syncNow("fast")}
              disabled={syncLoading || backfillLoading || remainingBackfillLoading || arrFteRefreshLoading || loading}
              style={{
                borderRadius: 10,
                border: "1px solid #1d4ed8",
                background: syncLoading ? "#1e3a8a" : "#2563eb",
                color: "#ffffff",
                padding: "10px 12px",
                fontSize: 13,
                fontWeight: 700,
                cursor:
                  syncLoading || backfillLoading || remainingBackfillLoading || arrFteRefreshLoading || loading
                    ? "wait"
                    : "pointer",
              }}
              title="Sync dirty changes only (fast incremental)"
            >
              {syncLoading ? "Syncing..." : "Sync now (dirty)"}
            </button>
            <button
              type="button"
              onClick={() => void syncNow("full")}
              disabled={syncLoading || backfillLoading || remainingBackfillLoading || arrFteRefreshLoading || loading}
              style={{
                borderRadius: 10,
                border: "1px solid #475569",
                background: syncLoading ? "#334155" : "#64748b",
                color: "#ffffff",
                padding: "10px 12px",
                fontSize: 13,
                fontWeight: 700,
                cursor:
                  syncLoading || backfillLoading || remainingBackfillLoading || arrFteRefreshLoading || loading
                    ? "wait"
                    : "pointer",
              }}
              title="Full historical sync"
            >
              {syncLoading ? "Syncing..." : "Full sync"}
            </button>
            <button
              type="button"
              onClick={() => setDebugPanelOpen((prev) => !prev)}
              disabled={syncLoading || backfillLoading || remainingBackfillLoading || arrFteRefreshLoading || loading}
              style={{
                borderRadius: 10,
                border: "1px solid #0369a1",
                background: debugPanelOpen ? "#075985" : "#0ea5e9",
                color: "#ffffff",
                padding: "10px 12px",
                fontSize: 13,
                fontWeight: 700,
                cursor:
                  syncLoading || backfillLoading || remainingBackfillLoading || arrFteRefreshLoading || loading
                    ? "wait"
                    : "pointer",
              }}
              title="Run targeted date-range fact sync and view step-level output"
            >
              {debugPanelOpen ? "Hide debug" : "Debug backfill"}
            </button>
            <button
              type="button"
              onClick={() => void backfillFacts()}
              disabled={backfillLoading || syncLoading || remainingBackfillLoading || arrFteRefreshLoading || loading}
              style={{
                borderRadius: 10,
                border: "1px solid #065f46",
                background: backfillLoading ? "#065f46" : "#0f766e",
                color: "#ffffff",
                padding: "10px 12px",
                fontSize: 13,
                fontWeight: 700,
                cursor:
                  backfillLoading || syncLoading || remainingBackfillLoading || arrFteRefreshLoading || loading
                    ? "wait"
                    : "pointer",
              }}
              title="Chunked full backfill into fact tables (safe retries)"
            >
              {backfillLoading ? "Backfilling..." : "Backfill facts"}
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => void hardRefresh()}
          disabled={loading || syncLoading || backfillLoading || remainingBackfillLoading || arrFteRefreshLoading}
          style={{
            borderRadius: 10,
            border: "1px solid #0f172a",
            background: loading ? "#1f2937" : "#111827",
            color: "#ffffff",
            padding: "10px 12px",
            fontSize: 13,
            fontWeight: 700,
            cursor:
              loading || syncLoading || backfillLoading || remainingBackfillLoading || arrFteRefreshLoading
                ? "wait"
                : "pointer",
          }}
          title="Clear server caches and reload all data from scratch"
        >
          {loading ? "Refreshing..." : "Hard refresh"}
        </button>
      </div>
      {lastSyncAtUtc ? (
        <div
          style={{
            background: "#ecfdf5",
            border: "1px solid #a7f3d0",
            color: "#065f46",
            borderRadius: 8,
            padding: "6px 10px",
            maxWidth: 420,
            fontSize: 12,
          }}
        >
          Last sync: {formatMontrealTime(lastSyncAtUtc)} ET
          {lastSyncSummary ? ` (${lastSyncSummary})` : ""}
        </div>
      ) : null}
    </div>
  );
}
