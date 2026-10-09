"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type Grain = "daily" | "weekly" | "monthly" | "quarterly";

type AiSpendPoint = {
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  revenue: number;
  lineCount: number;
  customerCount: number;
};

type AiSpendGroupRow = {
  key: string;
  label: string;
  revenue: number;
  lineCount: number;
};

type AiSpendPriceRow = {
  priceId: string;
  priceLabel: string;
  productId: string;
  productLabel: string;
  revenue: number;
  lineCount: number;
};

type AiSpendDetailRow = {
  invoiceDate: string;
  customerId: string;
  customerName: string;
  lineItemId: string;
  lineItemDescription: string;
  priceId: string;
  priceLabel: string;
  productId: string;
  productLabel: string;
  revenue: number;
  quantity: number;
};

type ExcludedEnterprisePrepaidCustomer = {
  monthKey: string;
  monthLabel: string;
  asOfDate: string;
  customerId: string;
  customerEmail: string;
  customerName: string;
  currency: string;
  prepaidAppliedMinor: number;
  prepaidAppliedMajor: number;
  availableCreditMinor: number;
  availableCreditMajor: number;
  accountIds: string[];
  accountNames: string[];
};

type ApiResponse = {
  startDate: string;
  endDate: string;
  grain: Grain;
  targetCurrency: string;
  totalRevenue: number;
  meteredRevenueSalesled?: number;
  meteredRevenueSelfserve?: number;
  points: AiSpendPoint[];
  topCustomers: AiSpendGroupRow[];
  topProducts: AiSpendGroupRow[];
  topPrices: AiSpendPriceRow[];
  detailRows: AiSpendDetailRow[];
  reportSource?: string;
  reportTypeId?: string;
  reportRunId?: string;
  excludedEnterprisePrepaidCustomerCount?: number;
  excludedEnterprisePrepaidCustomers?: ExcludedEnterprisePrepaidCustomer[];
};

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  const toIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { startDate: toIso(start), endDate: toIso(end) };
}

function formatMoney(value: number, currency: string) {
  const normalized = String(currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: normalized,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value || 0);
  } catch {
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value || 0);
  }
}

function withLabel(id: string, label: string) {
  const cleanId = String(id || "").trim() || "(blank)";
  const cleanLabel = String(label || "").trim();
  if (!cleanLabel || cleanLabel === cleanId || cleanLabel === "(blank)") return cleanId;
  return `${cleanId} (${cleanLabel})`;
}

function csvTimestamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const escape = (value: string | number | null | undefined) => {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = rows.map((row) => row.map((cell) => escape(cell)).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AiSpendPage() {
  const defaults = useMemo(() => defaultDateRange(), []);

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [grain, setGrain] = useState<Grain>("monthly");
  const [topLimit, setTopLimit] = useState(300);
  const [detailLimit, setDetailLimit] = useState(100);

  const [hasRunOnce, setHasRunOnce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [showExclusions, setShowExclusions] = useState(false);

  const run = useCallback(async (request: {
    startDate: string;
    endDate: string;
    grain: Grain;
    topLimit: number;
    detailLimit: number;
  }) => {
    setHasRunOnce(true);
    setLoading(true);
    setError(null);
    setShowExclusions(false);
    try {
      const res = await fetch("/api/stripe-ai-spend-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        if (json && typeof json === "object" && "error" in json) {
          throw new Error(String((json as { error?: unknown }).error || "Request failed"));
        }
        throw new Error(text || `HTTP ${res.status}`);
      }

      if (!json || typeof json !== "object") throw new Error("Invalid API response");
      setData(json as ApiResponse);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run({
      startDate: defaults.startDate,
      endDate: defaults.endDate,
      grain: "monthly",
      topLimit: 300,
      detailLimit: 100,
    });
  }, [defaults.endDate, defaults.startDate, run]);

  const summaryCurrency = data?.targetCurrency || "USD";
  const points = useMemo(() => data?.points || [], [data]);
  const totalLineCount = useMemo(
    () => points.reduce((sum, point) => sum + (point.lineCount || 0), 0),
    [points],
  );
  const uniqueCustomersShown = useMemo(() => {
    const set = new Set<string>();
    for (const row of data?.detailRows || []) {
      if (row.customerId) set.add(row.customerId);
    }
    return set.size;
  }, [data]);
  const excludedCustomers = useMemo(
    () => data?.excludedEnterprisePrepaidCustomers || [],
    [data],
  );
  const excludedCustomerCount = data?.excludedEnterprisePrepaidCustomerCount || excludedCustomers.length;

  const exportCustomerBreakdownCsv = useCallback(() => {
    if (!data) return;
    const rows: Array<Array<string | number | null | undefined>> = [
      [
        "customer_id",
        "customer_name",
        "customer_display",
        "revenue",
        "line_count",
        "target_currency",
        "start_date",
        "end_date",
        "grain",
      ],
      ...(data.topCustomers || []).map((row) => [
        row.key,
        row.label,
        withLabel(row.key, row.label),
        row.revenue,
        row.lineCount,
        data.targetCurrency,
        data.startDate,
        data.endDate,
        data.grain,
      ]),
    ];

    downloadCsv(`ai-spend-customer-breakdown-${data.grain}-${csvTimestamp()}.csv`, rows);
  }, [data]);

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Revenue intelligence</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">AI spend</h1>
            <p className="stripe-ui__subtitle">
              Uses Stripe BigQuery invoice lines (metered usage, net of line-item discounts) for the selected period and
              displays totals, per-customer breakdown, and raw line items.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Report controls</h2>
        <p className="stripe-ui__panel-subtitle">
          Current month is preselected. Adjust if needed, then load Stripe BigQuery data.
        </p>

        <div className="stripe-ui__control-grid">
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="ai-spend-start-date">
              Start date
            </label>
            <input
              id="ai-spend-start-date"
              className="stripe-ui__control"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="ai-spend-end-date">
              End date
            </label>
            <input
              id="ai-spend-end-date"
              className="stripe-ui__control"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="ai-spend-grain">
              Time grain
            </label>
            <select
              id="ai-spend-grain"
              className="stripe-ui__control"
              value={grain}
              onChange={(e) => setGrain(e.target.value as Grain)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="ai-spend-top-limit">
              Customer rows
            </label>
            <input
              id="ai-spend-top-limit"
              className="stripe-ui__control"
              type="number"
              min={1}
              max={5000}
              value={topLimit}
              onChange={(e) => setTopLimit(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="ai-spend-detail-limit">
              Detail rows limit
            </label>
            <input
              id="ai-spend-detail-limit"
              className="stripe-ui__control"
              type="number"
              min={1}
              max={1000}
              value={detailLimit}
              onChange={(e) => setDetailLimit(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </div>
        </div>

        <div className="stripe-ui__actions">
          <button
            id="ai-spend-run-report"
            className="stripe-ui__btn stripe-ui__btn--primary"
            onClick={() =>
              void run({
                startDate,
                endDate,
                grain,
                topLimit,
                detailLimit,
              })
            }
          >
            {loading ? "Loading..." : "Run report"}
          </button>
        </div>
      </section>

      {error ? <section className="stripe-ui__error">{error}</section> : null}

      {loading ? (
        <section className="stripe-ui__panel stripe-ui__loading-panel">
          <div className="stripe-ui__panel-title">Loading AI spend...</div>
          <div className="stripe-ui__skeleton-grid">
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row stripe-ui__skeleton-row--short" />
          </div>
        </section>
      ) : null}

      {!loading && data ? (
        <>
          <section className="stripe-ui__panel ui-reveal ui-reveal-2">
            <h2 className="stripe-ui__panel-title">Summary</h2>
            {data.reportTypeId || data.reportRunId ? (
              <p className="stripe-ui__panel-subtitle" style={{ marginTop: "-0.25rem" }}>
                Source: Stripe Reporting API
                {data.reportTypeId ? ` | Report type: ${data.reportTypeId}` : ""}
                {data.reportRunId ? ` | Run: ${data.reportRunId}` : ""}
              </p>
            ) : null}
            <div className="stripe-ui__stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Total net metered revenue</p>
                <p className="stripe-ui__stat-value">{formatMoney(data.totalRevenue || 0, summaryCurrency)}</p>
              </article>
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Metered revenue sales-led</p>
                <p className="stripe-ui__stat-value">
                  {formatMoney(data.meteredRevenueSalesled || 0, summaryCurrency)}
                </p>
              </article>
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Metered revenue self-serve</p>
                <p className="stripe-ui__stat-value">
                  {formatMoney(data.meteredRevenueSelfserve || 0, summaryCurrency)}
                </p>
              </article>
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Periods</p>
                <p className="stripe-ui__stat-value">{points.length}</p>
              </article>
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Line items (period sum)</p>
                <p className="stripe-ui__stat-value">{totalLineCount}</p>
              </article>
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Customers in details</p>
                <p className="stripe-ui__stat-value">{uniqueCustomersShown}</p>
              </article>
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Sales-led prepaid offsets</p>
                <p className="stripe-ui__stat-value">{excludedCustomerCount}</p>
              </article>
            </div>
            <div className="stripe-ui__actions" style={{ marginTop: "0.75rem", marginBottom: "0.25rem" }}>
              <button
                className="stripe-ui__btn stripe-ui__btn--ghost"
                onClick={() => setShowExclusions((prev) => !prev)}
                disabled={excludedCustomerCount === 0}
              >
                {showExclusions ? "Hide offset list" : "Show offset list"}
              </button>
            </div>

            <div className="stripe-ui__table-wrap">
              <table className="stripe-ui__table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Period start</th>
                    <th>Period end</th>
                    <th className="stripe-ui__num">Revenue</th>
                    <th className="stripe-ui__num">Customers</th>
                    <th className="stripe-ui__num">Line items</th>
                  </tr>
                </thead>
                <tbody>
                  {points.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No metered usage revenue found for this range.</td>
                    </tr>
                  ) : (
                    points.map((point) => (
                      <tr key={point.key}>
                        <td>{point.label}</td>
                        <td>{point.periodStart}</td>
                        <td>{point.periodEnd}</td>
                        <td className="stripe-ui__num">{formatMoney(point.revenue, summaryCurrency)}</td>
                        <td className="stripe-ui__num">{point.customerCount}</td>
                        <td className="stripe-ui__num">{point.lineCount}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {showExclusions ? (
            <section className="stripe-ui__panel ui-reveal ui-reveal-2">
              <h2 className="stripe-ui__panel-title">Sales-led customer prepaid offsets</h2>
              <p className="stripe-ui__panel-subtitle">
                AI spend is reduced for these Stripe customers when they are linked to a HubSpot sales-led account and
                have prepaid balance consumption in the selected usage month window (using invoice starting/ending
                balance changes from the following invoice month). For the live current month, it falls back to the
                latest invoice ending balance credit per customer.
              </p>
              <div className="stripe-ui__table-wrap">
                <table className="stripe-ui__table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Customer</th>
                      <th>Email</th>
                      <th>Enterprise account(s)</th>
                      <th className="stripe-ui__num">Prepaid applied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {excludedCustomers.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No sales-led prepaid offsets for this run.</td>
                      </tr>
                    ) : (
                      excludedCustomers.map((row) => (
                        <tr key={`excluded-${row.monthKey}-${row.customerId}`}>
                          <td>{row.monthLabel || row.monthKey}</td>
                          <td>{withLabel(row.customerId, row.customerName)}</td>
                          <td>{row.customerEmail || "(blank)"}</td>
                          <td>
                            {row.accountNames.length
                              ? row.accountNames.join(" | ")
                              : row.accountIds.length
                                ? row.accountIds.join(" | ")
                                : "(blank)"}
                          </td>
                          <td className="stripe-ui__num">{formatMoney(row.prepaidAppliedMajor, row.currency || summaryCurrency)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="stripe-ui__panel ui-reveal ui-reveal-2">
            <h2 className="stripe-ui__panel-title">Customer breakdown</h2>
            <p className="stripe-ui__panel-subtitle">Sorted by highest to lowest net revenue.</p>
            <div className="stripe-ui__actions" style={{ marginBottom: "0.75rem" }}>
              <button
                id="ai-spend-export-customer-breakdown-csv"
                className="stripe-ui__btn stripe-ui__btn--ghost"
                onClick={() => exportCustomerBreakdownCsv()}
                disabled={(data.topCustomers || []).length === 0}
              >
                Export customer breakdown CSV
              </button>
            </div>
            <div className="stripe-ui__table-wrap">
              <table className="stripe-ui__table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className="stripe-ui__num">Revenue</th>
                    <th className="stripe-ui__num">Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.topCustomers || []).map((row) => (
                    <tr key={`customer-${row.key}`}>
                      <td>{withLabel(row.key, row.label)}</td>
                      <td className="stripe-ui__num">{formatMoney(row.revenue, summaryCurrency)}</td>
                      <td className="stripe-ui__num">{row.lineCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="stripe-ui__panel ui-reveal ui-reveal-3">
            <h2 className="stripe-ui__panel-title">Metered usage line items</h2>
            <p className="stripe-ui__panel-subtitle">
              Showing up to {detailLimit} rows sorted by highest revenue contribution first.
            </p>
            <div className="stripe-ui__table-wrap">
              <table className="stripe-ui__table">
                <thead>
                  <tr>
                    <th>Invoice date</th>
                    <th>Customer</th>
                    <th>Line item</th>
                    <th>Price</th>
                    <th>Product</th>
                    <th className="stripe-ui__num">Quantity</th>
                    <th className="stripe-ui__num">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.detailRows || []).length === 0 ? (
                    <tr>
                      <td colSpan={7}>No metered line items found for this range.</td>
                    </tr>
                  ) : (
                    (data.detailRows || []).map((row) => (
                      <tr key={`${row.lineItemId}-${row.invoiceDate}-${row.customerId}`}>
                        <td>{row.invoiceDate}</td>
                        <td>{withLabel(row.customerId, row.customerName)}</td>
                        <td className="stripe-ui__break-cell" title={row.lineItemDescription || ""}>
                          {withLabel(row.lineItemId, row.lineItemDescription)}
                        </td>
                        <td>{withLabel(row.priceId, row.priceLabel)}</td>
                        <td>{withLabel(row.productId, row.productLabel)}</td>
                        <td className="stripe-ui__num">{row.quantity}</td>
                        <td className="stripe-ui__num">{formatMoney(row.revenue, summaryCurrency)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {!loading && !data && hasRunOnce && !error ? (
        <section className="stripe-ui__panel">No results to display.</section>
      ) : null}
    </div>
  );
}
