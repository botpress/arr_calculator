"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Grain, ReportResponse } from "@/lib/types";

type CurrencyDisplay = "normal" | "thousands" | "millions";
type GroupField = "customerId" | "lineItemDescription" | "lineItemDescriptionPrefix";
type RowDensity = "comfortable" | "compact";

const GROUP_BY_OPTIONS: Array<{ key: GroupField; label: string }> = [
  { key: "customerId", label: "Customer ID" },
  { key: "lineItemDescription", label: "Line Item Description" },
  { key: "lineItemDescriptionPrefix", label: "Line Description (before ' - ')" },
];

const GRAIN_OPTIONS: Grain[] = ["monthly", "quarterly", "annually", "daily"];
const CURRENCY_DISPLAY_OPTIONS: CurrencyDisplay[] = ["normal", "thousands", "millions"];
const ROW_DENSITY_OPTIONS: RowDensity[] = ["comfortable", "compact"];

const URL_PARAM_KEYS = [
  "startDate",
  "endDate",
  "grain",
  "currencyDisplay",
  "groupByFields",
  "filterCustomerId",
  "filterLineItemDescription",
  "filterLineItemDescriptionPrefix",
  "sortByPeriodKey",
  "page",
  "rowDensity",
] as const;
const URL_PARAM_KEY_SET = new Set<string>(URL_PARAM_KEYS);

const FIXED_PAGE_SIZE = 1000;

type UiRow = {
  customerId: string;
  lineItemId: string;
  lineItemDescription: string;
  groupValues: Partial<Record<GroupField, string>>;
  valuesByPeriod: Record<string, number>;
};

type StripeUrlState = {
  startDate: string;
  endDate: string;
  grain: Grain;
  currencyDisplay: CurrencyDisplay;
  groupByFields: GroupField[];
  filterCustomerId: string;
  filterLineItemDescription: string;
  filterLineItemDescriptionPrefix: string;
  sortByPeriodKey: string;
  page: number;
  rowDensity: RowDensity;
  hadParams: boolean;
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate());
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: toIso(start), endDate: toIso(end) };
}

function parseOneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T) {
  if (!raw) return fallback;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function parseIsoDate(raw: string | null, fallback: string) {
  if (!raw) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

function parseGroupByFields(raw: string | null): GroupField[] {
  if (!raw) return [];
  const allowed = new Set<GroupField>(GROUP_BY_OPTIONS.map((o) => o.key));
  const unique = new Set<GroupField>();
  for (const token of raw.split(",")) {
    const candidate = token.trim();
    if (allowed.has(candidate as GroupField)) unique.add(candidate as GroupField);
  }
  return Array.from(unique);
}

function readStripeUrlState(defaults: { startDate: string; endDate: string }): StripeUrlState | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const hadParams = Array.from(params.keys()).some((key) => URL_PARAM_KEY_SET.has(key));

  const pageRaw = Number(params.get("page") || "1");
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  return {
    startDate: parseIsoDate(params.get("startDate"), defaults.startDate),
    endDate: parseIsoDate(params.get("endDate"), defaults.endDate),
    grain: parseOneOf(params.get("grain"), GRAIN_OPTIONS, "monthly"),
    currencyDisplay: parseOneOf(params.get("currencyDisplay"), CURRENCY_DISPLAY_OPTIONS, "normal"),
    groupByFields: parseGroupByFields(params.get("groupByFields")),
    filterCustomerId: params.get("filterCustomerId") || "",
    filterLineItemDescription: params.get("filterLineItemDescription") || "",
    filterLineItemDescriptionPrefix: params.get("filterLineItemDescriptionPrefix") || "",
    sortByPeriodKey: params.get("sortByPeriodKey") || "none",
    page,
    rowDensity: parseOneOf(params.get("rowDensity"), ROW_DENSITY_OPTIONS, "comfortable"),
    hadParams,
  };
}

function stickyClassForColumn(idx: number, leadColumnCount: number) {
  if (idx >= leadColumnCount || idx > 2) return "";
  return `stripe-ui__sticky-col-${idx}`;
}

export default function StripePage() {
  const defaultRange = useMemo(() => defaultDateRange(), []);

  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [grain, setGrain] = useState<Grain>("monthly");
  const [currencyDisplay, setCurrencyDisplay] = useState<CurrencyDisplay>("normal");
  const [rowDensity, setRowDensity] = useState<RowDensity>("comfortable");

  const [groupByFields, setGroupByFields] = useState<GroupField[]>([]);
  const [groupByToAdd, setGroupByToAdd] = useState<GroupField | "none">("none");

  const [filterCustomerId, setFilterCustomerId] = useState("");
  const [filterLineItemDescription, setFilterLineItemDescription] = useState("");
  const [filterLineItemDescriptionPrefix, setFilterLineItemDescriptionPrefix] = useState("");
  const [sortByPeriodKey, setSortByPeriodKey] = useState<string>("none");

  const [page, setPage] = useState(1);
  const [pageJumpInput, setPageJumpInput] = useState("1");
  const [hasRunOnce, setHasRunOnce] = useState(false);

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initializedFromUrlRef = useRef(false);
  const skipFirstPageResetRef = useRef(true);

  useEffect(() => {
    const parsed = readStripeUrlState(defaultRange);
    if (parsed) {
      setStartDate(parsed.startDate);
      setEndDate(parsed.endDate);
      setGrain(parsed.grain);
      setCurrencyDisplay(parsed.currencyDisplay);
      setRowDensity(parsed.rowDensity);
      setGroupByFields(parsed.groupByFields);
      setFilterCustomerId(parsed.filterCustomerId);
      setFilterLineItemDescription(parsed.filterLineItemDescription);
      setFilterLineItemDescriptionPrefix(parsed.filterLineItemDescriptionPrefix);
      setSortByPeriodKey(parsed.sortByPeriodKey);
      setPage(parsed.page);
      setPageJumpInput(String(parsed.page));
      setHasRunOnce(parsed.hadParams);
    }
    initializedFromUrlRef.current = true;
  }, [defaultRange]);

  const run = useCallback(async () => {
    setHasRunOnce(true);
    setLoading(true);
    setError(null);
    setData(null);

    try {
      let res = await fetch("/api/stripe-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          grain,
          filterCustomerId,
          filterLineItemDescription,
          filterLineItemDescriptionPrefix,
          groupByFields,
          sortByPeriodKey,
          page,
        }),
      });
      if (res.status === 405) {
        const qs = new URLSearchParams({
          startDate,
          endDate,
          grain,
          filterCustomerId,
          filterLineItemDescription,
          filterLineItemDescriptionPrefix,
          groupByFields: groupByFields.join(","),
          sortByPeriodKey,
          page: String(page),
        });
        res = await fetch(`/api/stripe-report?${qs.toString()}`, { method: "GET" });
      }
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        if (json && typeof json === "object" && "error" in json) {
          const apiError = String((json as { error?: unknown }).error || "Request failed");
          throw new Error(`HTTP ${res.status}: ${apiError}`);
        }
        const snippet = (text || "").trim().slice(0, 500);
        throw new Error(`HTTP ${res.status}: ${snippet || "Request failed (empty response body)"}`);
      }

      if (!json || typeof json !== "object") throw new Error("Invalid API response");
      const report = json as ReportResponse;
      setData(report);
      const serverPage = report.pagination?.page;
      if (typeof serverPage === "number" && Number.isFinite(serverPage) && serverPage > 0 && serverPage !== page) {
        setPage(serverPage);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [
    startDate,
    endDate,
    grain,
    filterCustomerId,
    filterLineItemDescription,
    filterLineItemDescriptionPrefix,
    groupByFields,
    sortByPeriodKey,
    page,
  ]);

  useEffect(() => {
    if (!initializedFromUrlRef.current) return;
    if (skipFirstPageResetRef.current) {
      skipFirstPageResetRef.current = false;
      return;
    }
    setPage(1);
  }, [
    startDate,
    endDate,
    grain,
    filterCustomerId,
    filterLineItemDescription,
    filterLineItemDescriptionPrefix,
    groupByFields,
    sortByPeriodKey,
  ]);

  useEffect(() => {
    if (!hasRunOnce) return;
    const t = setTimeout(() => {
      void run();
    }, 250);
    return () => clearTimeout(t);
  }, [hasRunOnce, run]);

  useEffect(() => {
    if (typeof window === "undefined" || !initializedFromUrlRef.current) return;

    const params = new URLSearchParams(window.location.search);
    for (const key of URL_PARAM_KEYS) params.delete(key);

    params.set("startDate", startDate);
    params.set("endDate", endDate);
    params.set("grain", grain);
    params.set("currencyDisplay", currencyDisplay);
    params.set("rowDensity", rowDensity);
    params.set("sortByPeriodKey", sortByPeriodKey || "none");
    params.set("page", String(Math.max(1, page)));

    if (groupByFields.length) params.set("groupByFields", groupByFields.join(","));
    if (filterCustomerId) params.set("filterCustomerId", filterCustomerId);
    if (filterLineItemDescription) params.set("filterLineItemDescription", filterLineItemDescription);
    if (filterLineItemDescriptionPrefix) {
      params.set("filterLineItemDescriptionPrefix", filterLineItemDescriptionPrefix);
    }

    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [
    startDate,
    endDate,
    grain,
    currencyDisplay,
    rowDensity,
    groupByFields,
    filterCustomerId,
    filterLineItemDescription,
    filterLineItemDescriptionPrefix,
    sortByPeriodKey,
    page,
  ]);

  const displayedRows: UiRow[] = useMemo(() => {
    if (!data) return [];
    return (data.rows || []).map((r) => ({
      customerId: r.dealId || "",
      lineItemId: r.lineItemId || "",
      lineItemDescription: r.lineItemDescription || "",
      groupValues: (r.groupValues as Partial<Record<GroupField, string>>) || {},
      valuesByPeriod: r.valuesByPeriod || {},
    }));
  }, [data]);

  const totalsByPeriodForDisplayed = useMemo(() => {
    if (!data) return [];
    return data.totalsByPeriod || [];
  }, [data]);

  const showDefaultColumns = groupByFields.length === 0;
  const groupByLabel = groupByFields.map((f) => GROUP_BY_OPTIONS.find((o) => o.key === f)?.label || f).join(" + ");

  const breakdownHeaders = [
    ...(showDefaultColumns
      ? ["Customer ID", "Line Item ID", "Line Item Description"]
      : groupByFields.map((f) => GROUP_BY_OPTIONS.find((o) => o.key === f)?.label || f)),
    ...(data?.periods.map((p) => p.label) || []),
  ];

  const leadColumnCount = showDefaultColumns ? 3 : groupByFields.length;

  const currentPage = data?.pagination?.page || page;
  const totalPages = data?.pagination?.totalPages || 0;
  const hasMorePages = !!data?.pagination?.hasMore;
  const totalRows = data?.pagination?.totalRows ?? displayedRows.length;
  const returnedRows = data?.pagination?.returnedRows || displayedRows.length;

  const pageRangeStart = totalRows > 0 ? (currentPage - 1) * FIXED_PAGE_SIZE + 1 : 0;
  const pageRangeEnd = totalRows > 0 ? Math.min(pageRangeStart + Math.max(returnedRows, 0) - 1, totalRows) : 0;
  const hasVisiblePageRows = totalRows > 0 && returnedRows > 0;

  useEffect(() => {
    setPageJumpInput(String(currentPage));
  }, [currentPage]);

  function scaleCurrency(n: number) {
    if (currencyDisplay === "thousands") return n / 1_000;
    if (currencyDisplay === "millions") return n / 1_000_000;
    return n;
  }

  async function exportBreakdownCsv() {
    setError(null);
    setExporting(true);
    try {
      const qs = new URLSearchParams({
        startDate,
        endDate,
        grain,
        filterCustomerId,
        filterLineItemDescription,
        filterLineItemDescriptionPrefix,
        groupByFields: groupByFields.join(","),
        sortByPeriodKey,
      });
      const res = await fetch(`/api/stripe-report/export?${qs.toString()}`, { method: "GET" });
      if (!res.ok) {
        const text = await res.text();
        const snippet = text.trim().slice(0, 500);
        throw new Error(`HTTP ${res.status}: ${snippet || "CSV export failed"}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const contentDisposition = res.headers.get("content-disposition") || "";
      const filenameMatch = /filename="?([^"]+)"?/i.exec(contentDisposition);
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = filenameMatch?.[1] || `stripe-arr-breakdown-full-${stamp}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "CSV export failed";
      setError(message);
    } finally {
      setExporting(false);
    }
  }

  function addGroupBy() {
    if (groupByToAdd === "none") return;
    setGroupByFields((prev) => (prev.includes(groupByToAdd) ? prev : [...prev, groupByToAdd]));
    setGroupByToAdd("none");
  }

  function removeGroupBy(field: GroupField) {
    setGroupByFields((prev) => prev.filter((f) => f !== field));
  }

  function jumpToPage() {
    const parsed = Number(pageJumpInput);
    if (!Number.isFinite(parsed)) return;
    const normalized = Math.max(1, Math.floor(parsed));
    const targetPage = totalPages > 0 ? Math.min(normalized, totalPages) : normalized;
    setPage(targetPage);
    setPageJumpInput(String(targetPage));
    if (!hasRunOnce) setHasRunOnce(true);
  }

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Revenue intelligence</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Stripe ARR Report</h1>
            <p className="stripe-ui__subtitle">
              Tracks Stripe invoice lines and annualizes each value from its billing window (`period.start` to `period.end`) with
              backend-driven pagination and full CSV export. The total amount on this page reflects self serve ARR + AI spend.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Report controls</h2>
        <p className="stripe-ui__panel-subtitle">Choose date window, grain, grouping, then run the query.</p>

        <div className="stripe-ui__control-grid">
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-start-date">
              Start date
            </label>
            <input
              id="stripe-start-date"
              className="stripe-ui__control"
              type="date"
              aria-label="Start date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-end-date">
              End date
            </label>
            <input
              id="stripe-end-date"
              className="stripe-ui__control"
              type="date"
              aria-label="End date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-grain">
              Time grain
            </label>
            <select
              id="stripe-grain"
              className="stripe-ui__control"
              aria-label="Time grain"
              value={grain}
              onChange={(e) => setGrain(e.target.value as Grain)}
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annually">Annually</option>
              <option value="daily">Daily (not recommended)</option>
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-currency-display">
              Currency display
            </label>
            <select
              id="stripe-currency-display"
              className="stripe-ui__control"
              aria-label="Currency display"
              value={currencyDisplay}
              onChange={(e) => setCurrencyDisplay(e.target.value as CurrencyDisplay)}
            >
              <option value="normal">Normal</option>
              <option value="thousands">Thousands (K)</option>
              <option value="millions">Millions (M)</option>
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-group-by">
              Group by
            </label>
            <select
              id="stripe-group-by"
              className="stripe-ui__control"
              aria-label="Group by field"
              value={groupByToAdd}
              onChange={(e) => setGroupByToAdd(e.target.value as GroupField | "none")}
            >
              <option value="none">Select field</option>
              {GROUP_BY_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-run-btn">
              Run query
            </label>
            <button id="stripe-run-btn" className="stripe-ui__btn stripe-ui__btn--primary" onClick={run} disabled={loading} aria-label="Run Stripe ARR report">
              {loading ? "Running..." : "Run Stripe ARR"}
            </button>
          </div>
        </div>

        <div className="stripe-ui__actions">
          <button
            className="stripe-ui__btn stripe-ui__btn--secondary"
            onClick={addGroupBy}
            disabled={groupByToAdd === "none"}
            aria-label="Add selected group-by field"
          >
            Add group field
          </button>
          <button
            className="stripe-ui__btn stripe-ui__btn--ghost"
            onClick={() => setGroupByFields([])}
            disabled={groupByFields.length === 0}
            aria-label="Clear grouping"
          >
            Clear grouping
          </button>
        </div>

        {groupByFields.length > 0 && (
          <div className="stripe-ui__chips">
            {groupByFields.map((field) => (
              <button key={field} className="stripe-ui__chip" onClick={() => removeGroupBy(field)} aria-label={`Remove group field ${field}`}>
                {(GROUP_BY_OPTIONS.find((opt) => opt.key === field)?.label || field) + " x"}
              </button>
            ))}
          </div>
        )}
      </section>

      {loading && !data && (
        <section className="stripe-ui__panel stripe-ui__loading-panel ui-reveal ui-reveal-2" aria-live="polite" aria-busy="true">
          <h2 className="stripe-ui__panel-title">Loading report...</h2>
          <p className="stripe-ui__panel-subtitle">Fetching data and computing period totals.</p>
          <div className="stripe-ui__skeleton-grid">
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row stripe-ui__skeleton-row--short" />
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row stripe-ui__skeleton-row--short" />
            <div className="stripe-ui__skeleton-row" />
          </div>
        </section>
      )}

      {error && (
        <div className="stripe-ui__error ui-reveal ui-reveal-1" role="alert" aria-live="assertive">
          <div>{error}</div>
          <div className="stripe-ui__error-actions">
            <button className="stripe-ui__btn stripe-ui__btn--secondary" onClick={() => void run()} disabled={loading} aria-label="Retry report request">
              Retry
            </button>
          </div>
        </div>
      )}

      {data && (
        <>
          <section className="stripe-ui__panel ui-reveal ui-reveal-2">
            <div className="stripe-ui__stats">
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Rows</p>
                <p className="stripe-ui__stat-value">{totalRows}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Current page</p>
                <p className="stripe-ui__stat-value">{totalPages ? `${currentPage} / ${totalPages}` : currentPage}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Page payload</p>
                <p className="stripe-ui__stat-value">{returnedRows}</p>
              </div>
            </div>

            <div className="stripe-ui__filter-grid">
              <div className="stripe-ui__field">
                <label className="stripe-ui__field-label" htmlFor="stripe-filter-customer-id">
                  Filter Customer ID
                </label>
                <input
                  id="stripe-filter-customer-id"
                  className="stripe-ui__control"
                  type="text"
                  aria-label="Filter by customer ID"
                  value={filterCustomerId}
                  onChange={(e) => setFilterCustomerId(e.target.value)}
                  placeholder="foo, bar, NOT baz"
                />
              </div>

              <div className="stripe-ui__field">
                <label className="stripe-ui__field-label" htmlFor="stripe-filter-line-desc">
                  Filter Line Description
                </label>
                <input
                  id="stripe-filter-line-desc"
                  className="stripe-ui__control"
                  type="text"
                  aria-label="Filter by line item description"
                  value={filterLineItemDescription}
                  onChange={(e) => setFilterLineItemDescription(e.target.value)}
                  placeholder="foo, bar, NOT baz"
                />
              </div>

              <div className="stripe-ui__field">
                <label className="stripe-ui__field-label" htmlFor="stripe-filter-line-prefix">
                  Filter Description Prefix
                </label>
                <input
                  id="stripe-filter-line-prefix"
                  className="stripe-ui__control"
                  type="text"
                  aria-label="Filter by line item description prefix"
                  value={filterLineItemDescriptionPrefix}
                  onChange={(e) => setFilterLineItemDescriptionPrefix(e.target.value)}
                  placeholder="foo, bar, NOT baz"
                />
              </div>
            </div>

            <div className={`stripe-ui__table-wrap stripe-ui__table-wrap--${rowDensity}`} style={{ marginTop: "0.9rem" }}>
              <table className="stripe-ui__table" aria-label="Totals by period table">
                <thead>
                  <tr>
                    {data.periods.map((p) => (
                      <th key={p.key} className="stripe-ui__num">
                        {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {totalsByPeriodForDisplayed.map((t) => (
                      <td
                        key={t.key}
                        className={`stripe-ui__num ${(t.total || 0) < 0 ? "stripe-ui__money--negative" : "stripe-ui__money--positive"}`}
                      >
                        {fmtMoney(scaleCurrency(t.total))}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="stripe-ui__panel ui-reveal ui-reveal-3">
            <div className="stripe-ui__section-head">
              <div>
                <h2 className="stripe-ui__panel-title">Breakdown {showDefaultColumns ? "(per line item)" : `(grouped by ${groupByLabel})`}</h2>
                <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
                  Fixed page size {FIXED_PAGE_SIZE}; totals already include all matching rows across pages.
                </p>
              </div>
            </div>

            <div className="stripe-ui__toolbar">
              <div className="stripe-ui__toolbar-group">
                <label className="stripe-ui__field-label" htmlFor="stripe-sort-period">
                  Sort rows by period
                </label>
                <select
                  id="stripe-sort-period"
                  className="stripe-ui__control"
                  aria-label="Sort rows by period"
                  value={sortByPeriodKey}
                  onChange={(e) => setSortByPeriodKey(e.target.value)}
                >
                  <option value="none">None</option>
                  {(data.periods || []).map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label} (desc)
                    </option>
                  ))}
                </select>
              </div>

              <div className="stripe-ui__toolbar-group">
                <label className="stripe-ui__field-label" htmlFor="stripe-density">
                  Density
                </label>
                <select
                  id="stripe-density"
                  className="stripe-ui__control"
                  aria-label="Table density"
                  value={rowDensity}
                  onChange={(e) => setRowDensity(e.target.value as RowDensity)}
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </div>

              <div className="stripe-ui__toolbar-group">
                <span className="stripe-ui__hint">{`Page ${currentPage}${totalPages ? ` of ${totalPages}` : ""}`}</span>
                <span className="stripe-ui__hint">
                  {hasVisiblePageRows ? `Rows ${pageRangeStart}-${pageRangeEnd} of ${totalRows}` : "Rows 0 of 0"}
                </span>
              </div>

              <div className="stripe-ui__toolbar-group">
                <button
                  className="stripe-ui__btn stripe-ui__btn--ghost"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={loading || currentPage <= 1}
                  aria-label="Go to previous page"
                >
                  Prev
                </button>
                <button
                  className="stripe-ui__btn stripe-ui__btn--ghost"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={loading || !hasMorePages}
                  aria-label="Go to next page"
                >
                  Next
                </button>
                <input
                  className="stripe-ui__control stripe-ui__page-jump"
                  type="number"
                  min={1}
                  max={totalPages > 0 ? totalPages : undefined}
                  inputMode="numeric"
                  aria-label="Jump to page"
                  value={pageJumpInput}
                  onChange={(e) => setPageJumpInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      jumpToPage();
                    }
                  }}
                />
                <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={jumpToPage} aria-label="Jump to entered page">
                  Go
                </button>
                <button
                  className="stripe-ui__btn stripe-ui__btn--secondary"
                  onClick={exportBreakdownCsv}
                  disabled={!data || exporting}
                  aria-label="Export full breakdown CSV"
                >
                  {exporting ? "Exporting full CSV..." : "Export full breakdown CSV"}
                </button>
              </div>
            </div>

            <div className="stripe-ui__export-status" aria-live="polite">
              {exporting ? "Preparing full CSV export. You can continue browsing while it downloads." : ""}
            </div>

            <div className={`stripe-ui__table-wrap stripe-ui__table-wrap--${rowDensity}`}>
              <table className="stripe-ui__table" aria-label="Stripe ARR breakdown table">
                <thead>
                  <tr>
                    {breakdownHeaders.map((h, idx) => {
                      const stickyClass = stickyClassForColumn(idx, leadColumnCount);
                      const numericClass = idx >= leadColumnCount ? "stripe-ui__num" : "";
                      const cls = [stickyClass, numericClass].filter(Boolean).join(" ");
                      return (
                        <th key={`${h}-${idx}`} className={cls}>
                          {h}
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {displayedRows.map((r, idx) => (
                    <tr key={`${r.lineItemId || "group"}-${idx}`}>
                      {showDefaultColumns ? (
                        <>
                          <td className={stickyClassForColumn(0, leadColumnCount)}>{r.customerId || "(blank)"}</td>
                          <td className={stickyClassForColumn(1, leadColumnCount)}>{r.lineItemId || "(blank)"}</td>
                          <td className={`${stickyClassForColumn(2, leadColumnCount)} stripe-ui__break-cell`}>
                            {r.lineItemDescription || "(blank)"}
                          </td>
                        </>
                      ) : (
                        groupByFields.map((field, groupIdx) => (
                          <td key={field} className={stickyClassForColumn(groupIdx, leadColumnCount)}>
                            {r.groupValues[field] || "(blank)"}
                          </td>
                        ))
                      )}

                      {data.periods.map((p) => {
                        const value = r.valuesByPeriod[p.key] || 0;
                        return (
                          <td key={p.key} className={`stripe-ui__num ${value < 0 ? "stripe-ui__money--negative" : ""}`}>
                            {fmtMoney(scaleCurrency(value))}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
