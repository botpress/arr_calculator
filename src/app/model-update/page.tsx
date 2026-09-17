"use client";

import React, { useMemo, useState } from "react";

type AnalyticsBlock = {
  status: "ok" | "not_configured" | "error";
  value: number | null;
  details?: string;
};

type AnalyticsResponse = {
  startDate: string;
  endDate: string;
  mixpanelMetrics: {
    dauLastDay: AnalyticsBlock;
    wauLastDay: AnalyticsBlock;
    mauLastDay: AnalyticsBlock;
    signupsInMonth: AnalyticsBlock;
    productionMessagesInMonth: AnalyticsBlock;
    highVolumeWorkspacesInMonth: AnalyticsBlock;
    activeBuilders10of30: AnalyticsBlock;
  };
  googleAnalytics: AnalyticsBlock;
};

type MrrChangeTypeTotals = {
  newTotal: number;
  reactivationTotal: number;
  expansionTotal: number;
  contractionTotal: number;
  churnTotal: number;
};

type NewHireRow = {
  department: string;
  jobTitle: string;
  type: string;
  qc: boolean;
  greySkyBaseline: string;
  categorization: string;
  name: string;
  startDate: string;
  salary: string;
};

type TerminationRow = {
  department: string;
  jobTitle: string;
  name: string;
  terminationDate: string;
};

type SalaryChangeRow = {
  department: string;
  jobTitle: string;
  name: string;
  effectiveDate: string;
  oldSalary: string;
  newSalary: string;
};

type DepartmentChangeRow = {
  jobTitle: string;
  name: string;
  effectiveDate: string;
  oldDepartment: string;
  newDepartment: string;
};

type UnmatchedTransactionalDealRow = {
  dealId: string;
  dealMatchType: "transactional_closed_won" | "closed_lost_selfserve";
  dealName: string;
  closeDateUtc: string;
  workspaceId: string;
  primaryCompanyId: string;
  unmatchedReason: "missing_workspace_id" | "no_stripe_customer_mapping";
};

type UnmatchedTransactionalDealsResponse = {
  startDate: string;
  endDate: string;
  stageIds: string[];
  workspacePropertyCandidates: string[];
  summary: {
    totalTransactionalDeals: number;
    matchedDeals: number;
    unmatchedDeals: number;
    missingWorkspaceIdDeals: number;
    noStripeMappingDeals: number;
  };
  rows: UnmatchedTransactionalDealRow[];
};

type SalesledAllSubsResponse = {
  startDate: string;
  endDate: string;
  header: string[];
  rows: string[][];
  summary: {
    totalRows: number;
    monthCount: number;
  };
};

type UploadFieldKey =
  | "stripeMrrPerCustomer"
  | "stripeMrrChanges"
  | "stripeSubscriptionMetrics"
  | "salesAssistWorkspaceIds"
  | "salesledArrFromHibob";

type UploadField = {
  key: UploadFieldKey;
  label: string;
  hint: string;
};

const UPLOAD_FIELDS: UploadField[] = [
  {
    key: "stripeMrrPerCustomer",
    label: "Stripe MRR per customer",
    hint: "CSV or XLSX export",
  },
  {
    key: "stripeMrrChanges",
    label: "Stripe MRR changes",
    hint: "CSV or XLSX export",
  },
  {
    key: "stripeSubscriptionMetrics",
    label: "Stripe subscription metrics",
    hint: "CSV or XLSX export",
  },
  {
    key: "salesAssistWorkspaceIds",
    label: "Sales assist workspace IDs",
    hint: "CSV or TXT list",
  },
  {
    key: "salesledArrFromHibob",
    label: "Sales-led ARR from Hibob",
    hint: "CSV or XLSX export",
  },
];

function defaultDateRange() {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end,
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatBytes(value: number) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function normalizeHeader(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseDelimitedLine(line: string, delimiter: "," | "\t") {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function detectDelimiter(line: string): "," | "\t" {
  const commaCount = (line.match(/,/g) || []).length;
  const tabCount = (line.match(/\t/g) || []).length;
  return tabCount > commaCount ? "\t" : ",";
}

function parseDelimitedRows(text: string) {
  const nonEmptyLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!nonEmptyLines.length) {
    throw new Error("CSV is empty.");
  }
  const delimiter = detectDelimiter(nonEmptyLines[0]);
  const rows = nonEmptyLines.map((line) => parseDelimitedLine(line, delimiter));
  return { rows, delimiter };
}

function parseMoneyLike(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const negativeParens = raw.startsWith("(") && raw.endsWith(")");
  const cleaned = raw.replace(/[$,\s()]/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return negativeParens ? -parsed : parsed;
}

function normalizeCustomerIdToken(value: string) {
  return String(value || "").trim().toLowerCase();
}

function formatUnmatchedReason(reason: UnmatchedTransactionalDealRow["unmatchedReason"]) {
  if (reason === "missing_workspace_id") return "Missing workspace ID on deal";
  return "Workspace ID has no Stripe customer mapping";
}

function formatDealMatchType(value: UnmatchedTransactionalDealRow["dealMatchType"]) {
  if (value === "closed_lost_selfserve") return "Closed lost (self-serve reason)";
  return "Transactional closed won";
}

function normalizeEventType(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "");
}

function parseEventTimestampMs(rawValue: string) {
  const value = String(rawValue || "").trim();
  if (!value) return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6] || "0");
    return Date.UTC(year, month - 1, day, hour, minute, second, 0);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isoDayFromTimestampMs(ms: number) {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function csvEscape(value: string | number | null | undefined) {
  const str = value == null ? "" : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function downloadCsv(filename: string, rows: string[][]) {
  const lines = rows.map((row) => row.map((cell) => csvEscape(cell)).join(","));
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function summarizeNonJsonResponse(text: string) {
  const collapsed = String(text || "").replace(/\s+/g, " ").trim();
  return collapsed.slice(0, 180);
}

async function readJsonOrThrow<T>(res: Response, contextLabel: string): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const looksHtml = /<!doctype html|<html/i.test(text);
    const summary = summarizeNonJsonResponse(text);
    const hint = looksHtml
      ? "Received HTML instead of JSON (likely auth redirect or server error page)."
      : "Received non-JSON response from server.";
    throw new Error(`${contextLabel} failed (${res.status}). ${hint}${summary ? ` Response: ${summary}` : ""}`);
  }
}

function roundTo(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function formatAmountForCsv(value: number) {
  const n = roundTo(value, 6);
  if (Math.abs(n) <= 1e-9) return "0";
  return String(n);
}

type StripeMrrCustomerRow = {
  customerId: string;
  email: string;
  signedUp: string;
  firstMonthOfMrr: string;
  mrr: string;
};

type ParsedStripeMrr = {
  monthColumn: string;
  rows: StripeMrrCustomerRow[];
};

function parseStripeMrrPerCustomerCsv(text: string): ParsedStripeMrr {
  const { rows } = parseDelimitedRows(text);
  if (rows.length < 2) {
    throw new Error("Stripe MRR per customer file must include header and at least one data row.");
  }
  const header = rows[0];
  const normalizedHeader = header.map((cell) => normalizeHeader(cell));
  const customerIdIdx = normalizedHeader.findIndex((h) => h === "customerid");
  const customerEmailIdx = normalizedHeader.findIndex((h) => h === "customeremail");
  const customerStartDateIdx = normalizedHeader.findIndex((h) => h === "customerstartdate");

  if (customerIdIdx < 0) throw new Error("Stripe MRR file missing required column: Customer ID.");
  if (customerEmailIdx < 0) throw new Error("Stripe MRR file missing required column: Customer Email.");
  if (customerStartDateIdx < 0) throw new Error("Stripe MRR file missing required column: Customer Start Date.");

  let monthColumnIdx = -1;
  for (let i = normalizedHeader.length - 1; i >= 0; i -= 1) {
    if (/^\d{4}\d{2}$/.test(normalizedHeader[i])) {
      monthColumnIdx = i;
      break;
    }
  }
  if (monthColumnIdx < 0) {
    throw new Error("Stripe MRR file missing month column (expected header like YYYY-MM).");
  }
  const monthColumn = String(header[monthColumnIdx] || "").trim();

  const byCustomerId = new Map<string, StripeMrrCustomerRow>();
  for (let i = 1; i < rows.length; i += 1) {
    const line = rows[i];
    const customerId = String(line[customerIdIdx] || "").trim();
    if (!customerId) continue;
    const email = String(line[customerEmailIdx] || "").trim();
    const signedUp = String(line[customerStartDateIdx] || "").trim();
    const firstMonthOfMrr = /^\d{4}-\d{2}-\d{2}$/.test(signedUp) ? signedUp.slice(0, 7) : "";
    const mrrNumber = parseMoneyLike(String(line[monthColumnIdx] || ""));
    const existing = byCustomerId.get(customerId);
    if (!existing) {
      byCustomerId.set(customerId, {
        customerId,
        email,
        signedUp,
        firstMonthOfMrr,
        mrr: String(mrrNumber),
      });
      continue;
    }
    const mergedMrr = parseMoneyLike(existing.mrr) + mrrNumber;
    byCustomerId.set(customerId, {
      ...existing,
      email: existing.email || email,
      signedUp: existing.signedUp || signedUp,
      firstMonthOfMrr: existing.firstMonthOfMrr || firstMonthOfMrr,
      mrr: String(mergedMrr),
    });
  }

  return {
    monthColumn,
    rows: Array.from(byCustomerId.values()).sort((a, b) => a.customerId.localeCompare(b.customerId)),
  };
}

function extractWorkspaceIdsFromSalesAssistCsv(text: string) {
  const { rows } = parseDelimitedRows(text);
  if (!rows.length) return [];
  const headerNorm = rows[0].map((cell) => normalizeHeader(cell));
  const workspaceIdIdx = findHeaderIndex(headerNorm, [
    "What is the primary workspace ID?",
    "Primary workspace ID",
    "workspace_id",
    "workspace id",
    "workspaceid",
  ]);
  const startRow = workspaceIdIdx >= 0 ? 1 : 0;
  const out = new Set<string>();

  for (let i = startRow; i < rows.length; i += 1) {
    const source = workspaceIdIdx >= 0 ? String(rows[i]?.[workspaceIdIdx] || "").trim() : rows[i].join(" ").trim();
    if (!source) continue;
    const strictMatches = source.match(/wkspace_[a-z0-9]+/gi);
    if (strictMatches?.length) {
      for (const match of strictMatches) out.add(match.trim().toLowerCase());
      continue;
    }
    const tokens = source.split(/[,\s|;\n\r\t]+/).map((token) => token.trim()).filter(Boolean);
    for (const token of tokens) {
      if (token.toLowerCase().startsWith("wkspace_")) out.add(token.toLowerCase());
    }
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

type ParsedMrrChangeRow = {
  eventTimestampRaw: string;
  eventTypeRaw: string;
  customerId: string;
  currency: string;
  amount: number;
  timestampMs: number;
  dayKey: string;
  sign: 1 | -1;
};

function parseMrrChangesCsv(text: string): ParsedMrrChangeRow[] {
  const { rows } = parseDelimitedRows(text);
  if (rows.length < 2) {
    throw new Error("Stripe MRR changes file must include header and at least one data row.");
  }

  const headerNorm = rows[0].map((cell) => normalizeHeader(cell));
  const eventTimestampIdx = findHeaderIndex(headerNorm, ["event_timestamp", "event timestamp"]);
  const eventTypeIdx = findHeaderIndex(headerNorm, ["event_type", "event type"]);
  const customerIdIdx = findHeaderIndex(headerNorm, ["customer_id", "customer id"]);
  const currencyIdx = findHeaderIndex(headerNorm, ["currency"]);
  const mrrChangeIdx = findHeaderIndex(headerNorm, ["mrr_change", "mrr change"]);

  if (eventTimestampIdx < 0) throw new Error("MRR changes file missing event_timestamp column.");
  if (eventTypeIdx < 0) throw new Error("MRR changes file missing event_type column.");
  if (customerIdIdx < 0) throw new Error("MRR changes file missing customer_id column.");
  if (currencyIdx < 0) throw new Error("MRR changes file missing currency column.");
  if (mrrChangeIdx < 0) throw new Error("MRR changes file missing mrr_change column.");

  const out: ParsedMrrChangeRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const line = rows[i];
    const eventTimestampRaw = String(line[eventTimestampIdx] || "").trim();
    const eventTypeRaw = String(line[eventTypeIdx] || "").trim();
    const customerId = String(line[customerIdIdx] || "").trim();
    const currency = String(line[currencyIdx] || "").trim().toLowerCase();
    const amount = parseMoneyLike(String(line[mrrChangeIdx] || "0"));
    const timestampMs = parseEventTimestampMs(eventTimestampRaw);
    if (!eventTimestampRaw || !eventTypeRaw || !customerId || !currency || !Number.isFinite(timestampMs)) {
      continue;
    }
    const normalizedType = normalizeEventType(eventTypeRaw);
    const sign: 1 | -1 =
      amount < 0
        ? -1
        : amount > 0
          ? 1
          : normalizedType === "downgrade" || normalizedType === "contraction" || normalizedType === "churn"
            ? -1
            : 1;
    out.push({
      eventTimestampRaw,
      eventTypeRaw,
      customerId,
      currency,
      amount,
      timestampMs,
      dayKey: isoDayFromTimestampMs(timestampMs),
      sign,
    });
  }

  out.sort((a, b) => {
    if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs;
    if (a.customerId !== b.customerId) return a.customerId.localeCompare(b.customerId);
    if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
    return a.eventTypeRaw.localeCompare(b.eventTypeRaw);
  });
  return out;
}

function computeMrrChangeTotals(rows: ParsedMrrChangeRow[]): MrrChangeTypeTotals {
  const totals: MrrChangeTypeTotals = {
    newTotal: 0,
    reactivationTotal: 0,
    expansionTotal: 0,
    contractionTotal: 0,
    churnTotal: 0,
  };
  for (const row of rows) {
    const t = normalizeEventType(row.eventTypeRaw);
    const amount = Math.abs(Number(row.amount || 0));
    if (amount <= 1e-9) continue;
    if (t === "new") totals.newTotal += amount;
    else if (t === "reactivation") totals.reactivationTotal += amount;
    else if (t === "upgrade" || t === "expansion") totals.expansionTotal += amount;
    else if (t === "downgrade" || t === "contraction") totals.contractionTotal += amount;
    else if (t === "churn") totals.churnTotal += amount;
  }
  return {
    newTotal: roundTo(totals.newTotal, 6),
    reactivationTotal: roundTo(totals.reactivationTotal, 6),
    expansionTotal: roundTo(totals.expansionTotal, 6),
    contractionTotal: roundTo(totals.contractionTotal, 6),
    churnTotal: roundTo(totals.churnTotal, 6),
  };
}

function applyMrrChangeCleanupRules(sourceRows: ParsedMrrChangeRow[]) {
  const rows = sourceRows.map((row) => ({ ...row }));
  const removed = new Array(rows.length).fill(false);
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const EPSILON = 1e-9;
  const byCustomerCurrency = new Map<string, number[]>();

  for (let i = 0; i < rows.length; i += 1) {
    const key = `${normalizeCustomerIdToken(rows[i].customerId)}|${rows[i].currency}`;
    if (!byCustomerCurrency.has(key)) byCustomerCurrency.set(key, []);
    byCustomerCurrency.get(key)?.push(i);
  }

  for (const indexes of byCustomerCurrency.values()) {
    for (let p = 0; p < indexes.length; p += 1) {
      const i = indexes[p];
      if (removed[i]) continue;
      const first = rows[i];
      const firstType = normalizeEventType(first.eventTypeRaw);
      const counterpart = firstType === "upgrade" ? "downgrade" : firstType === "new" ? "churn" : "";
      if (!counterpart) continue;
      const targetAmount = Math.abs(first.amount);

      for (let q = p + 1; q < indexes.length; q += 1) {
        const j = indexes[q];
        if (removed[j]) continue;
        const second = rows[j];
        const diffMs = second.timestampMs - first.timestampMs;
        if (diffMs < 0) continue;
        if (diffMs > SEVEN_DAYS_MS) break;
        const secondType = normalizeEventType(second.eventTypeRaw);
        if (secondType !== counterpart) continue;
        if (Math.abs(Math.abs(second.amount) - targetAmount) > EPSILON) continue;
        removed[i] = true;
        removed[j] = true;
        break;
      }
    }
  }

  const remainingIndexes = rows.map((_, idx) => idx).filter((idx) => !removed[idx]);
  const adjustedRows = remainingIndexes.map((idx) => rows[idx]);
  const removedAdjusted = new Array(adjustedRows.length).fill(false);
  const byCustomerCurrencyDay = new Map<string, number[]>();
  for (let i = 0; i < adjustedRows.length; i += 1) {
    const row = adjustedRows[i];
    const key = `${normalizeCustomerIdToken(row.customerId)}|${row.currency}|${row.dayKey}`;
    if (!byCustomerCurrencyDay.has(key)) byCustomerCurrencyDay.set(key, []);
    byCustomerCurrencyDay.get(key)?.push(i);
  }

  for (const indexes of byCustomerCurrencyDay.values()) {
    indexes.sort((a, b) => adjustedRows[a].timestampMs - adjustedRows[b].timestampMs);
    const pendingDowngrades: number[] = [];

    for (const idx of indexes) {
      if (removedAdjusted[idx]) continue;
      const row = adjustedRows[idx];
      const t = normalizeEventType(row.eventTypeRaw);
      if (t === "downgrade") {
        pendingDowngrades.push(idx);
        continue;
      }
      if (t !== "upgrade") continue;

      let upgradeRemaining = Math.abs(row.amount);
      while (upgradeRemaining > EPSILON && pendingDowngrades.length) {
        const dIdx = pendingDowngrades[pendingDowngrades.length - 1];
        if (removedAdjusted[dIdx]) {
          pendingDowngrades.pop();
          continue;
        }
        const downRow = adjustedRows[dIdx];
        const downgradeRemaining = Math.abs(downRow.amount);
        if (downgradeRemaining <= EPSILON) {
          removedAdjusted[dIdx] = true;
          pendingDowngrades.pop();
          continue;
        }
        if (downgradeRemaining > upgradeRemaining + EPSILON) {
          downRow.amount = downRow.sign * roundTo(downgradeRemaining - upgradeRemaining, 6);
          upgradeRemaining = 0;
          break;
        }
        if (upgradeRemaining > downgradeRemaining + EPSILON) {
          upgradeRemaining = roundTo(upgradeRemaining - downgradeRemaining, 6);
          removedAdjusted[dIdx] = true;
          pendingDowngrades.pop();
          continue;
        }
        removedAdjusted[dIdx] = true;
        pendingDowngrades.pop();
        upgradeRemaining = 0;
      }

      if (upgradeRemaining <= EPSILON) {
        removedAdjusted[idx] = true;
      } else {
        row.amount = row.sign * upgradeRemaining;
      }
    }
  }

  const finalRows = adjustedRows.filter((_, idx) => !removedAdjusted[idx] && Math.abs(adjustedRows[idx].amount) > 1e-9);
  finalRows.sort((a, b) => {
    if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs;
    if (a.customerId !== b.customerId) return a.customerId.localeCompare(b.customerId);
    return a.eventTypeRaw.localeCompare(b.eventTypeRaw);
  });
  return finalRows;
}

function mrrChangeRowsToCsvRows(rows: ParsedMrrChangeRow[]) {
  const header = ["event_timestamp", "event_type", "customer_id", "currency", "mrr_change"];
  const out: string[][] = [header];
  for (const row of rows) {
    out.push([
      row.eventTimestampRaw,
      row.eventTypeRaw,
      row.customerId,
      row.currency,
      formatAmountForCsv(row.amount),
    ]);
  }
  return out;
}

const NEW_HIRES_COLUMNS = [
  "Department",
  "Job Title",
  "Type",
  "QC?",
  "Grey Sky=2 Baseline=1",
  "Categorization sales or non sales (for commission)",
  "Name",
  "Start Date",
  "salary",
] as const;

const TERMINATIONS_COLUMNS = ["Department", "Job Title", "Name", "Termination Date"] as const;

const SALARY_CHANGES_COLUMNS = [
  "Department",
  "Job Title",
  "Name",
  "Effective Date",
  "Old Salary",
  "New Salary",
] as const;

const DEPARTMENT_CHANGES_COLUMNS = [
  "Job Title",
  "Name",
  "Effective Date",
  "Old Department",
  "New Department",
] as const;

function newHiresToCsvRows(rows: NewHireRow[]) {
  const out: string[][] = [Array.from(NEW_HIRES_COLUMNS)];
  for (const row of rows) {
    out.push([
      row.department || "",
      row.jobTitle || "",
      row.type || "",
      row.qc ? "true" : "false",
      row.greySkyBaseline || "",
      row.categorization || "",
      row.name || "",
      row.startDate || "",
      row.salary || "",
    ]);
  }
  return out;
}

function buildReformattedStripeRows(parsed: ParsedStripeMrr) {
  const header = [
    "Customer ID",
    "First Month of MRR",
    "Signed up",
    "Initial Subscription $",
    "Email",
    "New Enterprise",
    "Sales-Assist",
    "Opp name",
    "Employee Count",
    parsed.monthColumn,
  ];
  const body = parsed.rows.map((row) => [
    row.customerId,
    row.firstMonthOfMrr,
    row.signedUp,
    "",
    row.email,
    "",
    "",
    "",
    "",
    row.mrr,
  ]);
  return [header, ...body];
}

function findHeaderIndex(normalizedHeader: string[], aliases: string[]) {
  const aliasSet = new Set(aliases.map((alias) => normalizeHeader(alias)));
  for (let i = 0; i < normalizedHeader.length; i += 1) {
    if (aliasSet.has(normalizedHeader[i])) return i;
  }
  return -1;
}

function toColumnA1(index: number) {
  let value = index + 1;
  let column = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }
  return column;
}

function parseMonthKey(month: string) {
  const trimmed = String(month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function parseIsoDate(dateText: string) {
  const text = String(dateText || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

function sampleDatePattern(rows: string[][], columnIdx: number) {
  if (columnIdx < 0) return null;
  for (let i = 1; i < rows.length; i += 1) {
    const value = String(rows[i]?.[columnIdx] || "").trim();
    if (!value) continue;
    if (/^\d{4}-\d{2}$/.test(value)) return "yyyy-mm";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "yyyy-mm-dd";
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) return "m/d/yyyy";
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(value)) return "m-d-yyyy";
  }
  return null;
}

function formatDateLikeSample(sourceIsoDate: string, pattern: string | null, forMonthOnly: boolean) {
  const iso = parseIsoDate(sourceIsoDate);
  if (!iso) return forMonthOnly ? sourceIsoDate.slice(0, 7) : sourceIsoDate;
  const [year, month, day] = iso.split("-");
  if (pattern === "yyyy-mm") return `${year}-${month}`;
  if (pattern === "yyyy-mm-dd") return forMonthOnly ? `${year}-${month}-01` : iso;
  if (pattern === "m/d/yyyy") return forMonthOnly ? `${Number(month)}/1/${year}` : `${Number(month)}/${Number(day)}/${year}`;
  if (pattern === "m-d-yyyy") return forMonthOnly ? `${Number(month)}-1-${year}` : `${Number(month)}-${Number(day)}-${year}`;
  return forMonthOnly ? `${year}-${month}` : iso;
}

function isMonthWithinSelectedRange(month: string, startDate: string, endDate: string) {
  const monthKey = parseMonthKey(month);
  if (!monthKey) return false;
  const startMonth = startDate.slice(0, 7);
  const endMonth = endDate.slice(0, 7);
  return monthKey >= startMonth && monthKey <= endMonth;
}

function mergeIntoSelfserveAllSubsCsv(
  selfserveCsvText: string,
  parsedStripe: ParsedStripeMrr,
  startDate: string,
  endDate: string,
  salesAssistCustomerIds: Set<string>,
): string[][] {
  const { rows } = parseDelimitedRows(selfserveCsvText);
  if (rows.length < 1) throw new Error("Current selfserve-all-subs file is empty.");

  const header = [...rows[0]];
  const normalizedHeader = header.map((cell) => normalizeHeader(cell));
  const customerIdIdx = findHeaderIndex(normalizedHeader, ["Customer ID", "customer_id", "customerid"]);
  if (customerIdIdx < 0) {
    throw new Error("Current selfserve-all-subs file missing Customer ID column.");
  }
  let salesAssistIdx = findHeaderIndex(normalizedHeader, ["Sales-Assist", "Sales Assist", "sales_assist", "salesassist"]);
  if (salesAssistIdx < 0) {
    header.push("Sales-Assist");
    salesAssistIdx = header.length - 1;
  }
  const monthColumn = parsedStripe.monthColumn;
  let monthColumnIdx = header.findIndex((h) => normalizeHeader(h) === normalizeHeader(monthColumn));
  if (monthColumnIdx < 0) {
    header.push(monthColumn);
    monthColumnIdx = header.length - 1;
  }

  const firstMonthIdx = findHeaderIndex(normalizedHeader, ["First Month of MRR"]);
  const signedUpIdx = findHeaderIndex(normalizedHeader, ["Signed up", "signed_up"]);
  const initialSubIdx = findHeaderIndex(normalizedHeader, ["Initial Subscription $", "initial_subscription"]);
  const emailIdx = findHeaderIndex(normalizedHeader, ["Email", "Customer Email"]);
  const monthColumnIndexes = header
    .map((cell, idx) => ({ idx, month: parseMonthKey(String(cell || "").trim()) }))
    .filter((entry): entry is { idx: number; month: string } => entry.month !== null)
    .map((entry) => entry.idx);
  const firstMonthColumnIdx = monthColumnIndexes.length ? Math.min(...monthColumnIndexes) : -1;
  const lastMonthColumnIdx = monthColumnIndexes.length ? Math.max(...monthColumnIndexes) : -1;
  const firstMonthPattern = sampleDatePattern(rows, firstMonthIdx);
  const signedUpPattern = sampleDatePattern(rows, signedUpIdx);

  const stripeByCustomer = new Map(parsedStripe.rows.map((row) => [row.customerId, row]));
  const seenCustomerIds = new Set<string>();
  const outputRows: string[][] = [header];

  for (let i = 1; i < rows.length; i += 1) {
    const row = [...rows[i]];
    while (row.length < header.length) row.push("");
    const customerId = String(row[customerIdIdx] || "").trim();
    if (!customerId) {
      outputRows.push(row);
      continue;
    }
    if (salesAssistIdx >= 0 && salesAssistCustomerIds.has(normalizeCustomerIdToken(customerId))) {
      row[salesAssistIdx] = "Yes";
    }
    const stripeMatch = stripeByCustomer.get(customerId);
    if (stripeMatch) {
      row[monthColumnIdx] = stripeMatch.mrr;
      if (firstMonthIdx >= 0 && !String(row[firstMonthIdx] || "").trim()) row[firstMonthIdx] = stripeMatch.firstMonthOfMrr;
      if (signedUpIdx >= 0 && !String(row[signedUpIdx] || "").trim()) row[signedUpIdx] = stripeMatch.signedUp;
      if (initialSubIdx >= 0 && !String(row[initialSubIdx] || "").trim()) row[initialSubIdx] = "";
      if (emailIdx >= 0 && !String(row[emailIdx] || "").trim()) row[emailIdx] = stripeMatch.email;
      seenCustomerIds.add(customerId);
    }
    outputRows.push(row);
  }

  for (const stripeRow of parsedStripe.rows) {
    if (seenCustomerIds.has(stripeRow.customerId)) continue;
    if (!isMonthWithinSelectedRange(stripeRow.firstMonthOfMrr, startDate, endDate)) continue;

    const newRow = new Array(header.length).fill("");
    newRow[customerIdIdx] = stripeRow.customerId;
    for (const idx of monthColumnIndexes) {
      const monthHeader = parseMonthKey(String(header[idx] || "").trim());
      if (monthHeader && monthHeader < monthColumn) newRow[idx] = "0";
    }
    newRow[monthColumnIdx] = stripeRow.mrr;
    if (firstMonthIdx >= 0) {
      newRow[firstMonthIdx] = formatDateLikeSample(
        `${stripeRow.firstMonthOfMrr}-01`,
        firstMonthPattern,
        true,
      );
    }
    if (signedUpIdx >= 0) newRow[signedUpIdx] = formatDateLikeSample(stripeRow.signedUp, signedUpPattern, false);
    if (initialSubIdx >= 0 && firstMonthColumnIdx >= 0 && lastMonthColumnIdx >= firstMonthColumnIdx) {
      const rowNumber = outputRows.length + 1;
      const startRef = `${toColumnA1(firstMonthColumnIdx)}${rowNumber}`;
      const endRef = `${toColumnA1(lastMonthColumnIdx)}${rowNumber}`;
      newRow[initialSubIdx] = `=IFERROR(INDEX(FILTER(${startRef}:${endRef},${startRef}:${endRef}<>0),1),0)`;
    }
    if (salesAssistIdx >= 0 && salesAssistCustomerIds.has(normalizeCustomerIdToken(stripeRow.customerId))) {
      newRow[salesAssistIdx] = "Yes";
    }
    if (emailIdx >= 0) newRow[emailIdx] = stripeRow.email;
    outputRows.push(newRow);
  }

  return outputRows;
}

function asNumberOrZero(value: string) {
  const parsed = Number(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeEmailToken(value: string) {
  return String(value || "").trim().toLowerCase();
}

function signedUpSortScore(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return Number.POSITIVE_INFINITY;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const ts = Date.parse(`${raw}T00:00:00Z`);
    return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
  }
  const mdY = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (mdY) {
    const month = Number(mdY[1]);
    const day = Number(mdY[2]);
    const year = Number(mdY[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return Date.UTC(year, month - 1, day);
    }
  }
  const fallback = Date.parse(raw);
  return Number.isFinite(fallback) ? fallback : Number.POSITIVE_INFINITY;
}

function mergeSelfserveRowsByEmail(rows: string[][]): string[][] {
  if (!rows.length) throw new Error("No rows to merge by email.");
  const sourceHeader = rows[0];
  const sourceHeaderNormalized = sourceHeader.map((value) => normalizeHeader(value));
  const sourceIndexByKey = new Map<string, number>();
  for (let i = 0; i < sourceHeader.length; i += 1) {
    sourceIndexByKey.set(sourceHeader[i], i);
  }
  const baseColumns = [
    "Customer ID",
    "First Month of MRR",
    "Signed up",
    "Initial Subscription $",
    "Email",
    "New Enterprise",
    "Sales-Assist",
    "Opp name",
    "Employee Count",
  ];
  const monthColumns = sourceHeader.filter((key) => /^\d{4}-\d{2}$/.test(String(key || "").trim()));
  const outputHeader = [...baseColumns, ...monthColumns];

  const emailColumn = "Email";
  const customerIdColumn = "Customer ID";
  const signedUpColumn = "Signed up";
  const firstMonthColumn = "First Month of MRR";
  const initialSubColumn = "Initial Subscription $";
  const newEnterpriseColumn = "New Enterprise";
  const salesAssistColumn = "Sales-Assist";
  const oppNameColumn = "Opp name";
  const employeeCountColumn = "Employee Count";
  const resolveSourceColumnValue = (row: string[], outputKey: string) => {
    const exactIdx = sourceIndexByKey.get(outputKey);
    if (typeof exactIdx === "number" && exactIdx >= 0) return String(row[exactIdx] || "").trim();
    const normalized = normalizeHeader(outputKey);
    const idx = sourceHeaderNormalized.findIndex((item) => item === normalized);
    if (idx >= 0) return String(row[idx] || "").trim();
    return "";
  };

  const grouped = new Map<string, string[][]>();
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const emailValue = resolveSourceColumnValue(row, emailColumn);
    const groupKey = normalizeEmailToken(emailValue) || `(blank-email-${i})`;
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey)?.push(row);
  }

  const outRows: string[][] = [outputHeader];
  for (const group of grouped.values()) {
    const flattened: Record<string, string> = {};
    for (const row of group) {
      for (const key of outputHeader) {
        const value = resolveSourceColumnValue(row, key);
        if (!key) continue;
        if (/^20/.test(key) && value) {
          const prev = asNumberOrZero(flattened[key] || "0");
          flattened[key] = String(prev + asNumberOrZero(value));
        } else if (!flattened[key] && value) {
          flattened[key] = value;
        }
      }
    }

    let earliest = group[0];
    for (const candidate of group) {
      const candScore = signedUpSortScore(resolveSourceColumnValue(candidate, signedUpColumn));
      const earlyScore = signedUpSortScore(resolveSourceColumnValue(earliest, signedUpColumn));
      if (candScore < earlyScore) earliest = candidate;
    }

    flattened[customerIdColumn] = resolveSourceColumnValue(earliest, customerIdColumn) || flattened[customerIdColumn] || "";
    flattened[firstMonthColumn] = "";
    flattened[initialSubColumn] = "";
    flattened[newEnterpriseColumn] = flattened[newEnterpriseColumn] || "";
    flattened[salesAssistColumn] = flattened[salesAssistColumn] || "";
    flattened[oppNameColumn] = flattened[oppNameColumn] || "";
    flattened[employeeCountColumn] = flattened[employeeCountColumn] || "";
    for (const month of monthColumns) {
      if (!flattened[month]) flattened[month] = "";
    }

    outRows.push(outputHeader.map((key) => flattened[key] || ""));
  }

  return outRows;
}

export default function ModelUpdatePage() {
  const defaults = useMemo(() => defaultDateRange(), []);
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [files, setFiles] = useState<Partial<Record<UploadFieldKey, File>>>({});
  const [error, setError] = useState<string | null>(null);
  const [readyMessage, setReadyMessage] = useState<string | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsResponse | null>(null);
  const [currentSelfserveAllSubsFile, setCurrentSelfserveAllSubsFile] = useState<File | null>(null);
  const [transformError, setTransformError] = useState<string | null>(null);
  const [transformSuccess, setTransformSuccess] = useState<string | null>(null);
  const [mrrChangesTotals, setMrrChangesTotals] = useState<MrrChangeTypeTotals | null>(null);
  const [newHires, setNewHires] = useState<NewHireRow[]>([]);
  const [terminations, setTerminations] = useState<TerminationRow[]>([]);
  const [salaryChanges, setSalaryChanges] = useState<SalaryChangeRow[]>([]);
  const [departmentChanges, setDepartmentChanges] = useState<DepartmentChangeRow[]>([]);
  const [newHiresLoading, setNewHiresLoading] = useState(false);
  const [newHiresError, setNewHiresError] = useState<string | null>(null);
  const [unmatchedDealsLoading, setUnmatchedDealsLoading] = useState(false);
  const [unmatchedDealsError, setUnmatchedDealsError] = useState<string | null>(null);
  const [unmatchedDealsData, setUnmatchedDealsData] = useState<UnmatchedTransactionalDealsResponse | null>(null);

  const missingFields = UPLOAD_FIELDS.filter((field) => !files[field.key]);

  function onFileChange(field: UploadFieldKey, file: File | null) {
    setFiles((prev) => {
      const next = { ...prev };
      if (file) next[field] = file;
      else delete next[field];
      return next;
    });
    setError(null);
    setReadyMessage(null);
    if (field === "stripeMrrPerCustomer") {
      setTransformError(null);
      setTransformSuccess(null);
    }
    if (field === "stripeMrrChanges") {
      setMrrChangesTotals(null);
      setTransformError(null);
      setTransformSuccess(null);
    }
  }

  function onSelfserveFileChange(file: File | null) {
    setCurrentSelfserveAllSubsFile(file);
    setTransformError(null);
    setTransformSuccess(null);
  }

  function onStartDateChange(value: string) {
    setStartDate(value);
    setUnmatchedDealsError(null);
    setUnmatchedDealsData(null);
  }

  function onEndDateChange(value: string) {
    setEndDate(value);
    setUnmatchedDealsError(null);
    setUnmatchedDealsData(null);
  }

  function validateInputs() {
    if (!startDate || !endDate) {
      setError("Start date and end date are required.");
      setReadyMessage(null);
      return;
    }
    if (endDate < startDate) {
      setError("End date must be greater than or equal to start date.");
      setReadyMessage(null);
      return;
    }
    if (missingFields.length > 0) {
      setError(`Missing file uploads: ${missingFields.map((field) => field.label).join(", ")}`);
      setReadyMessage(null);
      return;
    }

    setError(null);
    setReadyMessage(
      `Inputs ready for model update run. Date range: ${startDate} to ${endDate}. Uploaded files: ${UPLOAD_FIELDS.length}/${UPLOAD_FIELDS.length}.`,
    );
  }

  async function fetchAnalytics() {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const res = await fetch("/api/model-update-analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate }),
      });
      const json = await readJsonOrThrow<unknown>(res, "Analytics request");
      if (!res.ok) {
        if (json && typeof json === "object" && "error" in json) {
          throw new Error(String((json as { error?: unknown }).error || "Analytics request failed"));
        }
        throw new Error(`Analytics request failed (${res.status})`);
      }
      if (!json || typeof json !== "object") throw new Error("Invalid analytics response");
      setAnalyticsData(json as AnalyticsResponse);
    } catch (e: unknown) {
      setAnalyticsError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setAnalyticsLoading(false);
    }
  }

  async function downloadReformattedStripeMrrCsv() {
    setTransformError(null);
    setTransformSuccess(null);
    try {
      const stripeFile = files.stripeMrrPerCustomer;
      if (!stripeFile) throw new Error("Upload Stripe MRR per customer file first.");
      const parsed = parseStripeMrrPerCustomerCsv(await stripeFile.text());
      const csvRows = buildReformattedStripeRows(parsed);
      downloadCsv(`stripe-mrr-per-customer-reformatted-${parsed.monthColumn}.csv`, csvRows);
      setTransformSuccess(`Downloaded reformatted Stripe MRR CSV for ${parsed.monthColumn} (${parsed.rows.length} customers).`);
    } catch (e: unknown) {
      setTransformError(e instanceof Error ? e.message : "Failed to reformat Stripe MRR CSV.");
    }
  }

  async function downloadMergedSelfserveAllSubsCsv() {
    setTransformError(null);
    setTransformSuccess(null);
    try {
      const { parsedStripe, merged, salesAssistCustomerIds } = await buildSelfserveAllSubsMonthRows();
      downloadCsv(`selfserve-all-subs-month-${parsedStripe.monthColumn}.csv`, merged);
      setTransformSuccess(
        `Downloaded merged selfserve-all-subs CSV for ${parsedStripe.monthColumn}. Sales-assist customers marked: ${salesAssistCustomerIds.size}.`,
      );
    } catch (e: unknown) {
      setTransformError(e instanceof Error ? e.message : "Failed to build merged selfserve-all-subs CSV.");
    }
  }

  async function buildSelfserveAllSubsMonthRows() {
    const stripeFile = files.stripeMrrPerCustomer;
    if (!stripeFile) throw new Error("Upload Stripe MRR per customer file first.");
    if (!currentSelfserveAllSubsFile) throw new Error("Upload current selfserve-all-subs file.");
    const salesAssistFile = files.salesAssistWorkspaceIds;
    if (!salesAssistFile) throw new Error("Upload sales assist workspace IDs file first.");
    const parsedStripe = parseStripeMrrPerCustomerCsv(await stripeFile.text());
    const workspaceIds = extractWorkspaceIdsFromSalesAssistCsv(await salesAssistFile.text());
    const salesAssistCustomerIds = new Set<string>();
    if (workspaceIds.length) {
      const res = await fetch("/api/model-update-sales-assist-customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceIds }),
      });
      const json = await readJsonOrThrow<{ customerIds?: string[]; error?: string }>(
        res,
        "Sales-assist customer mapping request",
      );
      if (!res.ok) {
        throw new Error(json.error || `Failed to map workspace IDs (${res.status})`);
      }
      for (const customerId of Array.isArray(json.customerIds) ? json.customerIds : []) {
        const normalized = normalizeCustomerIdToken(customerId);
        if (normalized) salesAssistCustomerIds.add(normalized);
      }
    }
    const merged = mergeIntoSelfserveAllSubsCsv(
      await currentSelfserveAllSubsFile.text(),
      parsedStripe,
      startDate,
      endDate,
      salesAssistCustomerIds,
    );
    return {
      parsedStripe,
      merged,
      salesAssistCustomerIds,
    };
  }

  async function downloadSelfserveAllMergedCsv() {
    setTransformError(null);
    setTransformSuccess(null);
    try {
      const { parsedStripe, merged } = await buildSelfserveAllSubsMonthRows();
      const groupedByEmail = mergeSelfserveRowsByEmail(merged);
      downloadCsv(`selfserve-all-merged-${parsedStripe.monthColumn}.csv`, groupedByEmail);
      setTransformSuccess(
        `Downloaded selfserve-all-merged CSV for ${parsedStripe.monthColumn} (${Math.max(groupedByEmail.length - 1, 0)} grouped emails).`,
      );
    } catch (e: unknown) {
      setTransformError(e instanceof Error ? e.message : "Failed to build selfserve-all-merged CSV.");
    }
  }

  async function downloadSalesledAllSubsCsv() {
    setTransformError(null);
    setTransformSuccess(null);
    try {
      const res = await fetch("/api/model-update-salesled-all-subs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate }),
      });
      const json = await readJsonOrThrow<SalesledAllSubsResponse & { error?: string }>(
        res,
        "Salesled all-subs request",
      );
      if (!res.ok) {
        throw new Error(json?.error || `Failed to build salesled-all-subs CSV (${res.status})`);
      }
      if (!json || !Array.isArray(json.header) || !Array.isArray(json.rows)) {
        throw new Error("Invalid salesled-all-subs response");
      }
      const csvRows = [json.header, ...json.rows];
      downloadCsv(`salesled-all-subs-${json.startDate}-to-${json.endDate}.csv`, csvRows);
      setTransformSuccess(
        `Downloaded salesled-all-subs CSV with ${json.summary.totalRows} rows across ${json.summary.monthCount} months.`,
      );
    } catch (e: unknown) {
      setTransformError(e instanceof Error ? e.message : "Failed to build salesled-all-subs CSV.");
    }
  }

  async function processMrrChangesAndDownload() {
    setTransformError(null);
    setTransformSuccess(null);
    setMrrChangesTotals(null);
    try {
      const mrrFile = files.stripeMrrChanges;
      if (!mrrFile) throw new Error("Upload Stripe MRR changes file first.");
      const parsed = parseMrrChangesCsv(await mrrFile.text());
      const cleaned = applyMrrChangeCleanupRules(parsed);
      const totals = computeMrrChangeTotals(cleaned);
      setMrrChangesTotals(totals);
      const csvRows = mrrChangeRowsToCsvRows(cleaned);
      downloadCsv("stripe-mrr-changes-cleaned.csv", csvRows);
      setTransformSuccess(`Downloaded cleaned MRR changes CSV. Rows before: ${parsed.length}, after: ${cleaned.length}.`);
    } catch (e: unknown) {
      setTransformError(e instanceof Error ? e.message : "Failed to process MRR changes file.");
    }
  }

  async function loadNewHires() {
    setNewHiresLoading(true);
    setNewHiresError(null);
    try {
      const res = await fetch("/api/model-update-new-hires", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate }),
      });
      const json = await readJsonOrThrow<{
        newHires?: NewHireRow[];
        terminations?: TerminationRow[];
        salaryChanges?: SalaryChangeRow[];
        departmentChanges?: DepartmentChangeRow[];
        error?: string;
      }>(res, "Workforce changes request");
      if (!res.ok) {
        throw new Error(json.error || `Failed to load workforce changes (${res.status})`);
      }
      setNewHires(Array.isArray(json.newHires) ? json.newHires : []);
      setTerminations(Array.isArray(json.terminations) ? json.terminations : []);
      setSalaryChanges(Array.isArray(json.salaryChanges) ? json.salaryChanges : []);
      setDepartmentChanges(Array.isArray(json.departmentChanges) ? json.departmentChanges : []);
    } catch (e: unknown) {
      setNewHiresError(e instanceof Error ? e.message : "Failed to load workforce changes.");
      setNewHires([]);
      setTerminations([]);
      setSalaryChanges([]);
      setDepartmentChanges([]);
    } finally {
      setNewHiresLoading(false);
    }
  }

  function downloadNewHiresCsv() {
    if (!newHires.length) {
      setNewHiresError("Load new hires first to download CSV.");
      return;
    }
    setNewHiresError(null);
    downloadCsv(`model-update-new-hires-${startDate}-to-${endDate}.csv`, newHiresToCsvRows(newHires));
  }

  async function loadUnmatchedTransactionalDeals() {
    setUnmatchedDealsLoading(true);
    setUnmatchedDealsError(null);
    try {
      const res = await fetch("/api/model-update-unmatched-transactional-deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate }),
      });
      const json = await readJsonOrThrow<UnmatchedTransactionalDealsResponse & { error?: string }>(
        res,
        "Unmatched transactional deals request",
      );
      if (!res.ok) {
        throw new Error(json?.error || `Failed to load debug deals (${res.status})`);
      }
      if (!json || typeof json !== "object") {
        throw new Error("Invalid debug response");
      }
      setUnmatchedDealsData(json);
    } catch (e: unknown) {
      setUnmatchedDealsError(e instanceof Error ? e.message : "Failed to load unmatched sales-assist deals.");
      setUnmatchedDealsData(null);
    } finally {
      setUnmatchedDealsLoading(false);
    }
  }

  function downloadUnmatchedDealsCsv() {
    if (!unmatchedDealsData) {
      setUnmatchedDealsError("Load unmatched sales-assist deals first.");
      return;
    }
    setUnmatchedDealsError(null);
    const rows: string[][] = [
      [
        "deal_id",
        "deal_match_type",
        "deal_name",
        "close_date_utc",
        "workspace_id",
        "primary_company_id",
        "unmatched_reason",
      ],
      ...unmatchedDealsData.rows.map((row) => [
        row.dealId,
        formatDealMatchType(row.dealMatchType),
        row.dealName,
        row.closeDateUtc,
        row.workspaceId,
        row.primaryCompanyId,
        formatUnmatchedReason(row.unmatchedReason),
      ]),
    ];
    downloadCsv(
      `model-update-unmatched-transactional-deals-${unmatchedDealsData.startDate}-to-${unmatchedDealsData.endDate}.csv`,
      rows,
    );
  }

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Model operations</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Model Update</h1>
            <p className="stripe-ui__subtitle">
              Upload required source files and date range for model refresh input packaging.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Inputs</h2>
        <p className="stripe-ui__panel-subtitle">
          Provide date range and upload all 5 files. Files are currently validated client-side.
        </p>

        <div className="stripe-ui__control-grid" style={{ gridTemplateColumns: "repeat(3, minmax(180px, 1fr))" }}>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="model-update-start-date">
              Start date
            </label>
            <input
              id="model-update-start-date"
              className="stripe-ui__control"
              type="date"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
            />
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="model-update-end-date">
              End date
            </label>
            <input
              id="model-update-end-date"
              className="stripe-ui__control"
              type="date"
              value={endDate}
              onChange={(e) => onEndDateChange(e.target.value)}
            />
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="model-update-validate">
              Validate
            </label>
            <button
              id="model-update-validate"
              className="stripe-ui__btn stripe-ui__btn--primary"
              onClick={validateInputs}
            >
              Validate inputs
            </button>
          </div>
        </div>

        <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem" }}>
          <table className="stripe-ui__table" aria-label="Model update file uploads">
            <thead>
              <tr>
                <th>Input</th>
                <th>Upload</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {UPLOAD_FIELDS.map((field) => {
                const file = files[field.key];
                return (
                  <tr key={field.key}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{field.label}</div>
                      <div className="stripe-ui__hint">{field.hint}</div>
                    </td>
                    <td>
                      <input
                        className="stripe-ui__control"
                        type="file"
                        onChange={(e) => onFileChange(field.key, e.target.files?.[0] || null)}
                      />
                    </td>
                    <td>
                      {file ? (
                        <span>
                          {file.name} ({formatBytes(file.size)})
                        </span>
                      ) : (
                        <span style={{ opacity: 0.75 }}>Missing</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {error && (
          <p className="stripe-ui__panel-subtitle" style={{ color: "#fca5a5", marginTop: "0.75rem", marginBottom: 0 }}>
            {error}
          </p>
        )}
        {readyMessage && (
          <p className="stripe-ui__panel-subtitle" style={{ color: "#86efac", marginTop: "0.75rem", marginBottom: 0 }}>
            {readyMessage}
          </p>
        )}
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-2">
        <h2 className="stripe-ui__panel-title">Selfserve All Subs Month Builder</h2>
        <p className="stripe-ui__panel-subtitle">
          Uses uploaded Stripe MRR per customer CSV, reformats it, and optionally merges it into current selfserve-all-subs by Customer ID.
        </p>
        <div className="stripe-ui__control-grid" style={{ gridTemplateColumns: "repeat(2, minmax(220px, 1fr))" }}>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="model-update-selfserve-all-subs-file">
              Current selfserve-all-subs file (CSV)
            </label>
            <input
              id="model-update-selfserve-all-subs-file"
              className="stripe-ui__control"
              type="file"
              accept=".csv,text/csv,.txt,text/plain"
              onChange={(e) => onSelfserveFileChange(e.target.files?.[0] || null)}
            />
            <div className="stripe-ui__hint">
              {currentSelfserveAllSubsFile
                ? `${currentSelfserveAllSubsFile.name} (${formatBytes(currentSelfserveAllSubsFile.size)})`
                : "Optional for merge. Required for selfserve-all-subs output."}
            </div>
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label">Build files</label>
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
              <button className="stripe-ui__btn stripe-ui__btn--secondary" onClick={() => void downloadReformattedStripeMrrCsv()}>
                Download reformatted Stripe MRR CSV
              </button>
              <button className="stripe-ui__btn stripe-ui__btn--primary" onClick={() => void downloadMergedSelfserveAllSubsCsv()}>
                Download selfserve-all-subs-month CSV
              </button>
              <button className="stripe-ui__btn stripe-ui__btn--primary" onClick={() => void downloadSelfserveAllMergedCsv()}>
                Download selfserve-all-merged CSV
              </button>
              <button className="stripe-ui__btn stripe-ui__btn--primary" onClick={() => void downloadSalesledAllSubsCsv()}>
                Download salesled-all-subs CSV
              </button>
              <button className="stripe-ui__btn stripe-ui__btn--secondary" onClick={() => void processMrrChangesAndDownload()}>
                Process MRR changes CSV
              </button>
            </div>
          </div>
        </div>

        {transformError ? (
          <p className="stripe-ui__panel-subtitle" style={{ color: "#fca5a5", marginTop: "0.75rem", marginBottom: 0 }}>
            {transformError}
          </p>
        ) : null}
        {transformSuccess ? (
          <p className="stripe-ui__panel-subtitle" style={{ color: "#86efac", marginTop: "0.75rem", marginBottom: 0 }}>
            {transformSuccess}
          </p>
        ) : null}
        {mrrChangesTotals ? (
          <div className="stripe-ui__stats-grid" style={{ marginTop: "0.9rem" }}>
            <div className="stripe-ui__stat">
              <p className="stripe-ui__stat-label">New</p>
              <p className="stripe-ui__stat-value">{formatNumber(mrrChangesTotals.newTotal)}</p>
            </div>
            <div className="stripe-ui__stat">
              <p className="stripe-ui__stat-label">Reactivation</p>
              <p className="stripe-ui__stat-value">{formatNumber(mrrChangesTotals.reactivationTotal)}</p>
            </div>
            <div className="stripe-ui__stat">
              <p className="stripe-ui__stat-label">Expansion</p>
              <p className="stripe-ui__stat-value">{formatNumber(mrrChangesTotals.expansionTotal)}</p>
            </div>
            <div className="stripe-ui__stat">
              <p className="stripe-ui__stat-label">Contraction</p>
              <p className="stripe-ui__stat-value">{formatNumber(mrrChangesTotals.contractionTotal)}</p>
            </div>
            <div className="stripe-ui__stat">
              <p className="stripe-ui__stat-label">Churn</p>
              <p className="stripe-ui__stat-value">{formatNumber(mrrChangesTotals.churnTotal)}</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-3">
        <h2 className="stripe-ui__panel-title">New Hires (BambooHR)</h2>
        <p className="stripe-ui__panel-subtitle">
          Loads hires, terminations, salary changes, and department changes inside the selected date range.
        </p>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
          <button className="stripe-ui__btn stripe-ui__btn--primary" onClick={() => void loadNewHires()} disabled={newHiresLoading}>
            {newHiresLoading ? "Loading..." : "Load Workforce Changes"}
          </button>
          <button className="stripe-ui__btn stripe-ui__btn--secondary" onClick={downloadNewHiresCsv} disabled={!newHires.length}>
            Download New Hires CSV
          </button>
        </div>
        {newHiresError ? (
          <p className="stripe-ui__panel-subtitle" style={{ color: "#fca5a5", marginTop: "0.75rem", marginBottom: 0 }}>
            {newHiresError}
          </p>
        ) : null}
        {newHires.length ? (
          <div className="stripe-ui__table-wrap">
            <table className="stripe-ui__table" aria-label="New hires">
              <thead>
                <tr>
                  {NEW_HIRES_COLUMNS.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {newHires.map((row, idx) => (
                  <tr key={`${row.name}-${row.startDate}-${idx}`}>
                    <td>{row.department}</td>
                    <td>{row.jobTitle}</td>
                    <td>{row.type}</td>
                    <td>{row.qc ? "true" : "false"}</td>
                    <td>{row.greySkyBaseline}</td>
                    <td>{row.categorization}</td>
                    <td>{row.name}</td>
                    <td>{row.startDate}</td>
                    <td>{row.salary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {terminations.length ? (
          <div style={{ marginTop: "1rem" }}>
            <h3 className="stripe-ui__panel-title" style={{ marginBottom: "0.6rem", fontSize: "1rem" }}>
              Terminations (BambooHR)
            </h3>
            <div className="stripe-ui__table-wrap">
              <table className="stripe-ui__table" aria-label="Terminations">
                <thead>
                  <tr>
                    {TERMINATIONS_COLUMNS.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {terminations.map((row, idx) => (
                    <tr key={`${row.name}-${row.terminationDate}-${idx}`}>
                      <td>{row.department}</td>
                      <td>{row.jobTitle}</td>
                      <td>{row.name}</td>
                      <td>{row.terminationDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {salaryChanges.length ? (
          <div style={{ marginTop: "1rem" }}>
            <h3 className="stripe-ui__panel-title" style={{ marginBottom: "0.6rem", fontSize: "1rem" }}>
              Salary Changes (BambooHR)
            </h3>
            <div className="stripe-ui__table-wrap">
              <table className="stripe-ui__table" aria-label="Salary changes">
                <thead>
                  <tr>
                    {SALARY_CHANGES_COLUMNS.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {salaryChanges.map((row, idx) => (
                    <tr key={`${row.name}-${row.effectiveDate}-${idx}`}>
                      <td>{row.department}</td>
                      <td>{row.jobTitle}</td>
                      <td>{row.name}</td>
                      <td>{row.effectiveDate}</td>
                      <td>{row.oldSalary}</td>
                      <td>{row.newSalary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {departmentChanges.length ? (
          <div style={{ marginTop: "1rem" }}>
            <h3 className="stripe-ui__panel-title" style={{ marginBottom: "0.6rem", fontSize: "1rem" }}>
              Department Changes (BambooHR)
            </h3>
            <div className="stripe-ui__table-wrap">
              <table className="stripe-ui__table" aria-label="Department changes">
                <thead>
                  <tr>
                    {DEPARTMENT_CHANGES_COLUMNS.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {departmentChanges.map((row, idx) => (
                    <tr key={`${row.name}-${row.effectiveDate}-${idx}`}>
                      <td>{row.jobTitle}</td>
                      <td>{row.name}</td>
                      <td>{row.effectiveDate}</td>
                      <td>{row.oldDepartment}</td>
                      <td>{row.newDepartment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-4">
        <h2 className="stripe-ui__panel-title">Analytics (Mixpanel + Google Analytics)</h2>
        <p className="stripe-ui__panel-subtitle">
          Mixpanel metrics are shown for the selected range (DAU/WAU/MAU on last day, plus monthly totals).
        </p>
        <div className="stripe-ui__control-grid" style={{ gridTemplateColumns: "repeat(3, minmax(180px, 1fr))" }}>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label">Mixpanel endpoint env(s)</label>
            <div className="stripe-ui__hint">`MODEL_UPDATE_MIXPANEL_ENDPOINT` or metric-specific endpoint vars</div>
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label">Google Analytics endpoint env</label>
            <div className="stripe-ui__hint">`MODEL_UPDATE_GA_ENDPOINT`</div>
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="model-update-fetch-analytics">
              Fetch
            </label>
            <button
              id="model-update-fetch-analytics"
              className="stripe-ui__btn stripe-ui__btn--ghost"
              onClick={() => void fetchAnalytics()}
              disabled={analyticsLoading}
            >
              {analyticsLoading ? "Fetching..." : "Fetch analytics"}
            </button>
          </div>
        </div>

        {analyticsError && (
          <p className="stripe-ui__panel-subtitle" style={{ color: "#fca5a5", marginTop: "0.75rem", marginBottom: 0 }}>
            {analyticsError}
          </p>
        )}

        {analyticsData && (
          <div className="stripe-ui__stats-grid" style={{ marginTop: "0.9rem", marginBottom: "0.9rem" }}>
            <div className="stripe-ui__stat">
              <p className="stripe-ui__stat-label">DAU (last day)</p>
              <p className="stripe-ui__stat-value">
                {analyticsData.mixpanelMetrics.dauLastDay.value != null ? formatNumber(analyticsData.mixpanelMetrics.dauLastDay.value) : "—"}
              </p>
              <p className="stripe-ui__hint">
                {analyticsData.mixpanelMetrics.dauLastDay.status}
                {analyticsData.mixpanelMetrics.dauLastDay.details ? `: ${analyticsData.mixpanelMetrics.dauLastDay.details}` : ""}
              </p>
            </div>
            <div className="stripe-ui__stat">
              <p className="stripe-ui__stat-label">WAU (last day)</p>
              <p className="stripe-ui__stat-value">
                {analyticsData.mixpanelMetrics.wauLastDay.value != null ? formatNumber(analyticsData.mixpanelMetrics.wauLastDay.value) : "—"}
              </p>
              <p className="stripe-ui__hint">
                {analyticsData.mixpanelMetrics.wauLastDay.status}
                {analyticsData.mixpanelMetrics.wauLastDay.details ? `: ${analyticsData.mixpanelMetrics.wauLastDay.details}` : ""}
              </p>
            </div>
            <div className="stripe-ui__stat">
              <p className="stripe-ui__stat-label">MAU (last day)</p>
              <p className="stripe-ui__stat-value">
                {analyticsData.mixpanelMetrics.mauLastDay.value != null ? formatNumber(analyticsData.mixpanelMetrics.mauLastDay.value) : "—"}
              </p>
              <p className="stripe-ui__hint">
                {analyticsData.mixpanelMetrics.mauLastDay.status}
                {analyticsData.mixpanelMetrics.mauLastDay.details ? `: ${analyticsData.mixpanelMetrics.mauLastDay.details}` : ""}
              </p>
            </div>
            <div className="stripe-ui__stat">
              <p className="stripe-ui__stat-label">Signups (month)</p>
              <p className="stripe-ui__stat-value">
                {analyticsData.mixpanelMetrics.signupsInMonth.value != null ? formatNumber(analyticsData.mixpanelMetrics.signupsInMonth.value) : "—"}
              </p>
              <p className="stripe-ui__hint">
                {analyticsData.mixpanelMetrics.signupsInMonth.status}
                {analyticsData.mixpanelMetrics.signupsInMonth.details ? `: ${analyticsData.mixpanelMetrics.signupsInMonth.details}` : ""}
              </p>
            </div>
            <div className="stripe-ui__stat">
              <p className="stripe-ui__stat-label">Production messages (month)</p>
              <p className="stripe-ui__stat-value">
                {analyticsData.mixpanelMetrics.productionMessagesInMonth.value != null ? formatNumber(analyticsData.mixpanelMetrics.productionMessagesInMonth.value) : "—"}
              </p>
              <p className="stripe-ui__hint">
                {analyticsData.mixpanelMetrics.productionMessagesInMonth.status}
                {analyticsData.mixpanelMetrics.productionMessagesInMonth.details ? `: ${analyticsData.mixpanelMetrics.productionMessagesInMonth.details}` : ""}
              </p>
            </div>
            <div className="stripe-ui__stat">
              <p className="stripe-ui__stat-label">High Volume Workspaces (1k incoming)</p>
              <p className="stripe-ui__stat-value">
                {analyticsData.mixpanelMetrics.highVolumeWorkspacesInMonth.value != null ? formatNumber(analyticsData.mixpanelMetrics.highVolumeWorkspacesInMonth.value) : "—"}
              </p>
              <p className="stripe-ui__hint">
                {analyticsData.mixpanelMetrics.highVolumeWorkspacesInMonth.status}
                {analyticsData.mixpanelMetrics.highVolumeWorkspacesInMonth.details
                  ? `: ${analyticsData.mixpanelMetrics.highVolumeWorkspacesInMonth.details}`
                  : ""}
              </p>
            </div>
            <div className="stripe-ui__stat">
              <p className="stripe-ui__stat-label">Active Builders (10 of 30 days)</p>
              <p className="stripe-ui__stat-value">
                {analyticsData.mixpanelMetrics.activeBuilders10of30.value != null ? formatNumber(analyticsData.mixpanelMetrics.activeBuilders10of30.value) : "—"}
              </p>
              <p className="stripe-ui__hint">
                {analyticsData.mixpanelMetrics.activeBuilders10of30.status}
                {analyticsData.mixpanelMetrics.activeBuilders10of30.details ? `: ${analyticsData.mixpanelMetrics.activeBuilders10of30.details}` : ""}
              </p>
            </div>
            <div className="stripe-ui__stat">
              <p className="stripe-ui__stat-label">Google Analytics</p>
              <p className="stripe-ui__stat-value">
                {analyticsData.googleAnalytics.value != null ? formatNumber(analyticsData.googleAnalytics.value) : "—"}
              </p>
              <p className="stripe-ui__hint">
                {analyticsData.googleAnalytics.status}
                {analyticsData.googleAnalytics.details ? `: ${analyticsData.googleAnalytics.details}` : ""}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-5">
        <h2 className="stripe-ui__panel-title">Debug: Unmatched Sales-Assist Deals</h2>
        <p className="stripe-ui__panel-subtitle">
          Shows sales-assist candidate deals (transactional closed won and closed-lost deals with self-serve reasons)
          in the selected date range that were not matched to any Stripe customer by workspace ID.
        </p>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
          <button
            className="stripe-ui__btn stripe-ui__btn--primary"
            onClick={() => void loadUnmatchedTransactionalDeals()}
            disabled={unmatchedDealsLoading}
          >
            {unmatchedDealsLoading ? "Loading..." : "Load unmatched deals"}
          </button>
          <button
            className="stripe-ui__btn stripe-ui__btn--secondary"
            onClick={downloadUnmatchedDealsCsv}
            disabled={!unmatchedDealsData}
          >
            Download debug CSV
          </button>
        </div>

        {unmatchedDealsError ? (
          <p className="stripe-ui__panel-subtitle" style={{ color: "#fca5a5", marginTop: "0.75rem", marginBottom: 0 }}>
            {unmatchedDealsError}
          </p>
        ) : null}

        {unmatchedDealsData ? (
          <>
            <div className="stripe-ui__stats-grid" style={{ marginBottom: "0.9rem" }}>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Total sales-assist deals</p>
                <p className="stripe-ui__stat-value">{formatNumber(unmatchedDealsData.summary.totalTransactionalDeals)}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Matched deals</p>
                <p className="stripe-ui__stat-value">{formatNumber(unmatchedDealsData.summary.matchedDeals)}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Unmatched deals</p>
                <p className="stripe-ui__stat-value">{formatNumber(unmatchedDealsData.summary.unmatchedDeals)}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Missing workspace ID</p>
                <p className="stripe-ui__stat-value">{formatNumber(unmatchedDealsData.summary.missingWorkspaceIdDeals)}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">No Stripe mapping</p>
                <p className="stripe-ui__stat-value">{formatNumber(unmatchedDealsData.summary.noStripeMappingDeals)}</p>
              </div>
            </div>

            {unmatchedDealsData.rows.length ? (
              <>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.55rem" }}>
                  <button className="stripe-ui__btn stripe-ui__btn--secondary" onClick={downloadUnmatchedDealsCsv}>
                    Download table CSV
                  </button>
                </div>
                <div className="stripe-ui__table-wrap">
                  <table className="stripe-ui__table" aria-label="Unmatched sales-assist deals">
                    <thead>
                      <tr>
                        <th>Deal ID</th>
                        <th>Deal type</th>
                        <th>Deal name</th>
                        <th>Close date (UTC)</th>
                        <th>Workspace ID</th>
                        <th>Primary company ID</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmatchedDealsData.rows.map((row) => (
                        <tr key={row.dealId}>
                          <td>{row.dealId}</td>
                          <td>{formatDealMatchType(row.dealMatchType)}</td>
                          <td>{row.dealName || "—"}</td>
                          <td>{row.closeDateUtc || "—"}</td>
                          <td>{row.workspaceId || "—"}</td>
                          <td>{row.primaryCompanyId || "—"}</td>
                          <td>{formatUnmatchedReason(row.unmatchedReason)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
                No unmatched sales-assist deals found for the selected date range.
              </p>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
