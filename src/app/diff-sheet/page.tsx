"use client";

import React, { useMemo, useState } from "react";

type StripeMonthRow = {
  customerId: string;
  websiteArr: number;
};

type CsvRow = {
  customerId: string;
  excelArr: number;
};

type DiffRow = {
  customerId: string;
  websiteArr: number | null;
  excelArr: number | null;
  difference: number;
};

type SortColumn = "customerId" | "websiteArr" | "excelArr" | "difference";
type SortDirection = "asc" | "desc";

const EPSILON = 1e-9;

function defaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isZero(n: number) {
  return Math.abs(Number(n) || 0) <= EPSILON;
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function parseCsvLine(line: string) {
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
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

function normalizeHeader(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseAmount(rawValue: string, lineNumber: number) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) {
    throw new Error(`Row ${lineNumber}: ARR is required.`);
  }

  const isNegativeByParens = trimmed.startsWith("(") && trimmed.endsWith(")");
  const normalized = trimmed.replace(/[$,\s()]/g, "");
  if (!normalized) {
    throw new Error(`Row ${lineNumber}: ARR is invalid.`);
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Row ${lineNumber}: ARR is invalid.`);
  }

  return isNegativeByParens ? -parsed : parsed;
}

function parseCsvRows(csvText: string): CsvRow[] {
  const nonEmptyLines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (nonEmptyLines.length < 2) {
    throw new Error("CSV must include a header row and at least one data row.");
  }

  const headerCells = parseCsvLine(nonEmptyLines[0]);
  if (headerCells.length < 2) {
    throw new Error("CSV header must contain two columns: customer_id and arr.");
  }

  const firstHeader = normalizeHeader(headerCells[0]);
  const secondHeader = normalizeHeader(headerCells[1]);
  if (firstHeader !== "customerid" || secondHeader !== "arr") {
    throw new Error("CSV header must be: customer_id, arr");
  }

  const byCustomerId = new Map<string, number>();
  for (let i = 1; i < nonEmptyLines.length; i += 1) {
    const lineNumber = i + 1;
    const rawCells = parseCsvLine(nonEmptyLines[i]);
    if (rawCells.length < 2) {
      throw new Error(`Row ${lineNumber}: expected customer_id and arr.`);
    }

    const customerId = String(rawCells[0] || "").trim();
    const rawArrValue = rawCells.slice(1).join(",").trim();
    if (!customerId) {
      throw new Error(`Row ${lineNumber}: customer_id is required.`);
    }

    const amount = parseAmount(rawArrValue, lineNumber);
    byCustomerId.set(customerId, round2((byCustomerId.get(customerId) || 0) + amount));
  }

  return Array.from(byCustomerId.entries())
    .map(([customerId, excelArr]) => ({ customerId, excelArr }))
    .sort((a, b) => a.customerId.localeCompare(b.customerId));
}

function shouldHideRow(websiteArr: number | null, excelArr: number | null) {
  const websiteExists = websiteArr !== null;
  const excelExists = excelArr !== null;
  const websiteValue = websiteArr ?? 0;
  const excelValue = excelArr ?? 0;

  if (websiteExists && excelExists && isZero(websiteValue) && isZero(excelValue)) {
    return true;
  }
  if (!websiteExists && excelExists && isZero(excelValue)) {
    return true;
  }
  if (websiteExists && !excelExists && isZero(websiteValue)) {
    return true;
  }
  return false;
}

function compareNullableNumber(a: number | null, b: number | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function parseJsonOrThrow(text: string, status: number, context: string) {
  try {
    return text ? (JSON.parse(text) as { rows?: StripeMonthRow[]; error?: string }) : {};
  } catch {
    const isHtml = /<!doctype html|<html/i.test(String(text || ""));
    const snippet = String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
    const reason = isHtml
      ? "Received HTML instead of JSON (likely auth redirect or server error page)."
      : "Received non-JSON response.";
    throw new Error(`${context} failed (${status}). ${reason}${snippet ? ` Response: ${snippet}` : ""}`);
  }
}

export default function DiffSheetPage() {
  const [month, setMonth] = useState(defaultMonth());
  const [stripeRows, setStripeRows] = useState<StripeMonthRow[]>([]);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState("");

  const [loadingStripe, setLoadingStripe] = useState(false);
  const [loadingCsv, setLoadingCsv] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortColumn, setSortColumn] = useState<SortColumn>("difference");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  async function loadStripeMonth() {
    setLoadingStripe(true);
    setError(null);
    try {
      const res = await fetch("/api/diff-sheet/stripe-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const text = await res.text();
      const json = parseJsonOrThrow(text, res.status, "Stripe month fetch");
      if (!res.ok) {
        throw new Error(json.error || `Failed to fetch Stripe data (${res.status})`);
      }
      setStripeRows(Array.isArray(json.rows) ? json.rows : []);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to fetch Stripe data.";
      setError(message);
    } finally {
      setLoadingStripe(false);
    }
  }

  async function onCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadingCsv(true);
    setError(null);
    try {
      const csvText = await file.text();
      const parsed = parseCsvRows(csvText);
      setCsvRows(parsed);
      setUploadedFileName(file.name);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "CSV parsing failed.";
      setError(message);
      setCsvRows([]);
      setUploadedFileName("");
    } finally {
      setLoadingCsv(false);
      e.target.value = "";
    }
  }

  const stripeByCustomerId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stripeRows) {
      map.set(String(row.customerId || "").trim(), Number(row.websiteArr || 0));
    }
    return map;
  }, [stripeRows]);

  const csvByCustomerId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of csvRows) {
      map.set(String(row.customerId || "").trim(), Number(row.excelArr || 0));
    }
    return map;
  }, [csvRows]);

  const diffRows = useMemo(() => {
    const allCustomerIds = new Set<string>([...stripeByCustomerId.keys(), ...csvByCustomerId.keys()]);
    const merged: DiffRow[] = [];

    for (const customerId of allCustomerIds) {
      const websiteArr = stripeByCustomerId.has(customerId) ? Number(stripeByCustomerId.get(customerId) || 0) : null;
      const excelArr = csvByCustomerId.has(customerId) ? Number(csvByCustomerId.get(customerId) || 0) : null;
      if (shouldHideRow(websiteArr, excelArr)) continue;

      merged.push({
        customerId,
        websiteArr,
        excelArr,
        difference: round2((websiteArr ?? 0) - (excelArr ?? 0)),
      });
    }

    return merged.sort((a, b) => {
      let base = 0;
      if (sortColumn === "customerId") {
        base = a.customerId.localeCompare(b.customerId, undefined, { numeric: true, sensitivity: "base" });
      } else if (sortColumn === "websiteArr") {
        base = compareNullableNumber(a.websiteArr, b.websiteArr);
      } else if (sortColumn === "excelArr") {
        base = compareNullableNumber(a.excelArr, b.excelArr);
      } else {
        base = a.difference - b.difference;
      }
      if (base === 0) {
        return a.customerId.localeCompare(b.customerId, undefined, { numeric: true, sensitivity: "base" });
      }
      return sortDirection === "asc" ? base : -base;
    });
  }, [stripeByCustomerId, csvByCustomerId, sortColumn, sortDirection]);

  const totals = useMemo(() => {
    return diffRows.reduce(
      (acc, row) => {
        acc.website += row.websiteArr ?? 0;
        acc.excel += row.excelArr ?? 0;
        acc.diff += row.difference;
        return acc;
      },
      { website: 0, excel: 0, diff: 0 },
    );
  }, [diffRows]);

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Revenue intelligence</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Diff Sheet</h1>
            <p className="stripe-ui__subtitle">
              Compare Stripe website ARR to uploaded CSV ARR by customer ID. Missing values are shown as DNE and treated as
              zero for difference calculation.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Controls</h2>
        <p className="stripe-ui__panel-subtitle">Pick month, load Stripe data, upload CSV, and sort the comparison table.</p>

        <div className="stripe-ui__control-grid">
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="diff-sheet-month">
              Month
            </label>
            <input
              id="diff-sheet-month"
              className="stripe-ui__control"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="diff-load-stripe">
              Stripe data
            </label>
            <button
              id="diff-load-stripe"
              className="stripe-ui__btn stripe-ui__btn--primary"
              onClick={loadStripeMonth}
              disabled={loadingStripe}
            >
              {loadingStripe ? "Loading..." : "Load Stripe ARR"}
            </button>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="diff-csv-upload">
              Upload CSV
            </label>
            <input
              id="diff-csv-upload"
              className="stripe-ui__control"
              type="file"
              accept=".csv,text/csv"
              onChange={onCsvUpload}
              disabled={loadingCsv}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="diff-sort-by">
              Sort by
            </label>
            <select
              id="diff-sort-by"
              className="stripe-ui__control"
              value={sortColumn}
              onChange={(e) => setSortColumn(e.target.value as SortColumn)}
            >
              <option value="customerId">Customer ID</option>
              <option value="websiteArr">Website ARR</option>
              <option value="excelArr">Excel ARR</option>
              <option value="difference">Difference</option>
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="diff-sort-order">
              Sort order
            </label>
            <select
              id="diff-sort-order"
              className="stripe-ui__control"
              value={sortDirection}
              onChange={(e) => setSortDirection(e.target.value as SortDirection)}
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
        </div>

        <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          {uploadedFileName ? `CSV loaded: ${uploadedFileName}` : "CSV expected format: customer_id,arr"}
        </p>
      </section>

      {error && (
        <div className="stripe-ui__error ui-reveal ui-reveal-1" role="alert" aria-live="assertive">
          <div>{error}</div>
        </div>
      )}

      <section className="stripe-ui__panel ui-reveal ui-reveal-2">
        <div className="stripe-ui__stats">
          <div className="stripe-ui__stat">
            <p className="stripe-ui__stat-label">Stripe customers</p>
            <p className="stripe-ui__stat-value">{stripeRows.length}</p>
          </div>
          <div className="stripe-ui__stat">
            <p className="stripe-ui__stat-label">CSV customers</p>
            <p className="stripe-ui__stat-value">{csvRows.length}</p>
          </div>
          <div className="stripe-ui__stat">
            <p className="stripe-ui__stat-label">Displayed rows</p>
            <p className="stripe-ui__stat-value">{diffRows.length}</p>
          </div>
        </div>

        <div className={`stripe-ui__table-wrap stripe-ui__table-wrap--comfortable`} style={{ marginTop: "0.9rem" }}>
          <table className="stripe-ui__table" aria-label="Diff sheet totals">
            <thead>
              <tr>
                <th className="stripe-ui__num">Total Website ARR</th>
                <th className="stripe-ui__num">Total Excel ARR</th>
                <th className="stripe-ui__num">Total Difference</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="stripe-ui__num">{fmtMoney(round2(totals.website))}</td>
                <td className="stripe-ui__num">{fmtMoney(round2(totals.excel))}</td>
                <td className={`stripe-ui__num ${totals.diff < 0 ? "stripe-ui__money--negative" : "stripe-ui__money--positive"}`}>
                  {fmtMoney(round2(totals.diff))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-3">
        <h2 className="stripe-ui__panel-title">Customer comparison</h2>
        <p className="stripe-ui__panel-subtitle">
          Hidden rows: both sides are zero, or one side is DNE while the other side is zero.
        </p>

        <div className={`stripe-ui__table-wrap stripe-ui__table-wrap--comfortable`}>
          <table className="stripe-ui__table" aria-label="Diff sheet customer table">
            <thead>
              <tr>
                <th>Customer ID</th>
                <th className="stripe-ui__num">Website ARR</th>
                <th className="stripe-ui__num">Excel ARR</th>
                <th className="stripe-ui__num">Difference</th>
              </tr>
            </thead>
            <tbody>
              {diffRows.map((row) => (
                <tr key={row.customerId}>
                  <td>{row.customerId || "(blank)"}</td>
                  <td className="stripe-ui__num">{row.websiteArr === null ? "DNE" : fmtMoney(row.websiteArr)}</td>
                  <td className="stripe-ui__num">{row.excelArr === null ? "DNE" : fmtMoney(row.excelArr)}</td>
                  <td className={`stripe-ui__num ${row.difference < 0 ? "stripe-ui__money--negative" : "stripe-ui__money--positive"}`}>
                    {fmtMoney(row.difference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {diffRows.length === 0 && (
          <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            No rows to display yet. Load Stripe data and/or upload CSV first.
          </p>
        )}
      </section>
    </div>
  );
}
