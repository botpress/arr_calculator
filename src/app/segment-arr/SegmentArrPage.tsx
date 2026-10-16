"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SegmentKind = "salesled" | "selfserve";
type PlanGrain = "daily" | "monthly";

type CombinedAllSubsRow = {
  id: string;
  source: "hubspot_account" | "stripe_only_customer";
  customerLabel: string;
  salesAssist: "yes" | "no";
  salesAssistByPeriod?: Record<string, "yes" | "no">;
  hubspotValuesByPeriod: Record<string, number>;
  valuesByPeriod: Record<string, number>;
};

type CombinedAllSubsResponse = {
  periods: Array<{ key: string; label: string }>;
  rows: CombinedAllSubsRow[];
  targetCurrency: string;
};

type SegmentRow = {
  id: string;
  customerLabel: string;
  sourceLabel: "hubspot" | "stripe_sales_assist" | "stripe_selfserve";
  valuesByPeriod: Record<string, number>;
};

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  const toIso = (value: Date) => value.toISOString().slice(0, 10);
  return {
    startDate: toIso(start),
    endDate: toIso(end),
  };
}

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
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

function csvEscape(value: string | number | boolean | null | undefined) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | boolean | null | undefined>>) {
  const lines = rows.map((row) => row.map((cell) => csvEscape(cell)).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function parseJsonResponseText(text: string, status: number, context: string) {
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    const isHtml = /<!doctype html|<html/i.test(String(text || ""));
    const snippet = String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
    const reason = isHtml
      ? "Received HTML instead of JSON (likely auth redirect or server error page)."
      : "Received non-JSON response.";
    throw new Error(`${context} failed (${status}). ${reason}${snippet ? ` Response: ${snippet}` : ""}`);
  }
}

function isSalesAssistForPeriod(row: CombinedAllSubsRow, periodKey: string) {
  return (row.salesAssistByPeriod?.[periodKey] || row.salesAssist || "no") === "yes";
}

function computeSegmentRows(data: CombinedAllSubsResponse | null, segment: SegmentKind): SegmentRow[] {
  if (!data) return [];
  const out: SegmentRow[] = [];
  for (const row of data.rows || []) {
    const valuesByPeriod: Record<string, number> = {};
    let sourceLabel: SegmentRow["sourceLabel"] | null = null;

    for (const period of data.periods || []) {
      const periodKey = period.key;
      let value = 0;

      if (segment === "salesled") {
        if (row.source === "hubspot_account") {
          value = round2(Number(row.hubspotValuesByPeriod?.[periodKey] || 0));
          sourceLabel = "hubspot";
        } else if (row.source === "stripe_only_customer" && isSalesAssistForPeriod(row, periodKey)) {
          value = round2(Number(row.valuesByPeriod?.[periodKey] || 0));
          sourceLabel = "stripe_sales_assist";
        }
      } else {
        if (row.source === "stripe_only_customer" && !isSalesAssistForPeriod(row, periodKey)) {
          value = round2(Number(row.valuesByPeriod?.[periodKey] || 0));
          sourceLabel = "stripe_selfserve";
        }
      }

      valuesByPeriod[periodKey] = value;
    }

    if (!sourceLabel) continue;
    const hasNonZero = Object.values(valuesByPeriod).some((value) => Math.abs(value) > 1e-9);
    if (!hasNonZero) continue;
    out.push({
      id: row.id,
      customerLabel: row.customerLabel,
      sourceLabel,
      valuesByPeriod,
    });
  }
  return out.sort((a, b) => a.customerLabel.localeCompare(b.customerLabel));
}

function buildPeriodTotals(
  periods: Array<{ key: string; label: string }>,
  rows: SegmentRow[],
) {
  return periods.map((period) => ({
    key: period.key,
    label: period.label,
    total: round2(rows.reduce((sum, row) => sum + Number(row.valuesByPeriod?.[period.key] || 0), 0)),
  }));
}

export default function SegmentArrPage({
  segment,
  title,
  subtitle,
}: {
  segment: SegmentKind;
  title: string;
  subtitle: string;
}) {
  const defaults = useMemo(() => defaultDateRange(), []);
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [grain, setGrain] = useState<PlanGrain>("monthly");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CombinedAllSubsResponse | null>(null);
  const hasAutoRun = useRef(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/combined-all-subs-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          combineMode: "simple",
          displayMode: "arr",
          planGrain: grain,
        }),
      });

      const text = await res.text();
      const json = parseJsonResponseText(text, res.status, "Combined all-subs request");

      if (!res.ok) {
        if (json && typeof json === "object" && "error" in json) {
          throw new Error(String((json as { error?: unknown }).error || "Request failed"));
        }
        throw new Error(text || `HTTP ${res.status}`);
      }

      if (!json || typeof json !== "object") throw new Error("Invalid API response");
      setData(json as CombinedAllSubsResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [endDate, grain, startDate]);

  useEffect(() => {
    if (hasAutoRun.current) return;
    hasAutoRun.current = true;
    void run();
  }, [run]);

  const segmentRows = useMemo(() => computeSegmentRows(data, segment), [data, segment]);
  const currency = data?.targetCurrency || "USD";
  const periodTotals = useMemo(() => {
    const periods = data?.periods || [];
    return buildPeriodTotals(periods, segmentRows);
  }, [data, segmentRows]);
  const salesledOnlyRows = useMemo(
    () => segmentRows.filter((row) => row.sourceLabel === "hubspot"),
    [segmentRows],
  );
  const salesAssistRows = useMemo(
    () => segmentRows.filter((row) => row.sourceLabel === "stripe_sales_assist"),
    [segmentRows],
  );
  const salesledOnlyTotals = useMemo(() => {
    const periods = data?.periods || [];
    return buildPeriodTotals(periods, salesledOnlyRows);
  }, [data, salesledOnlyRows]);
  const salesAssistTotals = useMemo(() => {
    const periods = data?.periods || [];
    return buildPeriodTotals(periods, salesAssistRows);
  }, [data, salesAssistRows]);

  function exportCsv() {
    if (!data) return;
    const header = ["customer_label", "source", ...data.periods.map((period) => period.key)];
    const rows: Array<Array<string | number>> = [
      header,
      ...segmentRows.map((row) => [
        row.customerLabel,
        row.sourceLabel,
        ...data.periods.map((period) => round2(Number(row.valuesByPeriod?.[period.key] || 0))),
      ]),
      ["TOTAL", "", ...periodTotals.map((period) => period.total)],
    ];
    downloadCsv(`${segment}-arr-${grain}-${csvTimestamp()}.csv`, rows);
  }

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Revenue intelligence</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">{title}</h1>
            <p className="stripe-ui__subtitle">{subtitle}</p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Link href="/combined-all-subs" className="stripe-ui__hero-link">
              Open Combined All Subs
            </Link>
            <Link href="/hubspot" className="stripe-ui__hero-link">
              Open HubSpot
            </Link>
            <Link href="/stripe-through-mrr" className="stripe-ui__hero-link">
              Open Stripe Through MRR
            </Link>
            {segment === "salesled" ? (
              <Link href="/selfserve" className="stripe-ui__hero-link">
                Open Self Serve
              </Link>
            ) : (
              <Link href="/salesled" className="stripe-ui__hero-link">
                Open Sales-led
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Report controls</h2>
        <div className="stripe-ui__control-grid" style={{ gridTemplateColumns: "repeat(4, minmax(180px, 1fr))" }}>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor={`${segment}-start-date`}>
              Start date
            </label>
            <input
              id={`${segment}-start-date`}
              className="stripe-ui__control"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor={`${segment}-end-date`}>
              End date
            </label>
            <input
              id={`${segment}-end-date`}
              className="stripe-ui__control"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor={`${segment}-grain`}>
              Time grain
            </label>
            <select
              id={`${segment}-grain`}
              className="stripe-ui__control"
              value={grain}
              onChange={(event) => setGrain(event.target.value as PlanGrain)}
            >
              <option value="monthly">Monthly</option>
              <option value="daily">Daily</option>
            </select>
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor={`${segment}-run-btn`}>
              Run
            </label>
            <button
              id={`${segment}-run-btn`}
              className="stripe-ui__btn stripe-ui__btn--primary"
              onClick={() => void run()}
              disabled={loading}
            >
              {loading ? "Loading..." : "Run report"}
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <section className="stripe-ui__panel ui-reveal ui-reveal-2">
          <p className="stripe-ui__hint" style={{ color: "#b42318" }}>
            {error}
          </p>
        </section>
      ) : null}

      {!loading && data ? (
        <>
          <section className="stripe-ui__panel ui-reveal ui-reveal-2">
            <div className="stripe-ui__section-head">
              <div>
                <h2 className="stripe-ui__panel-title">Totals By Period</h2>
                <p className="stripe-ui__panel-subtitle">
                  {segmentRows.length} rows included.
                </p>
              </div>
              <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={exportCsv}>
                Export CSV
              </button>
            </div>
            <div className="stripe-ui__table-wrap">
              <table className="stripe-ui__table">
                <thead>
                  <tr>
                    {periodTotals.map((period) => (
                      <th key={`total-head-${period.key}`}>{period.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {periodTotals.map((period) => (
                      <td key={`total-value-${period.key}`} className="stripe-ui__num">
                        {formatMoney(period.total, currency)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {segment === "salesled" ? (
              <div style={{ marginTop: "1rem", display: "grid", gap: "1rem" }}>
                <div>
                  <h3 className="stripe-ui__panel-title" style={{ fontSize: "1rem", marginBottom: "0.4rem" }}>
                    Sales-led totals (HubSpot cloud contracted)
                  </h3>
                  <p className="stripe-ui__panel-subtitle" style={{ marginTop: 0 }}>
                    {salesledOnlyRows.length} rows.
                  </p>
                  <div className="stripe-ui__table-wrap">
                    <table className="stripe-ui__table">
                      <thead>
                        <tr>
                          {salesledOnlyTotals.map((period) => (
                            <th key={`salesled-total-head-${period.key}`}>{period.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {salesledOnlyTotals.map((period) => (
                            <td key={`salesled-total-value-${period.key}`} className="stripe-ui__num">
                              {formatMoney(period.total, currency)}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <h3 className="stripe-ui__panel-title" style={{ fontSize: "1rem", marginBottom: "0.4rem" }}>
                    Sales-assist totals (Stripe)
                  </h3>
                  <p className="stripe-ui__panel-subtitle" style={{ marginTop: 0 }}>
                    {salesAssistRows.length} rows.
                  </p>
                  <div className="stripe-ui__table-wrap">
                    <table className="stripe-ui__table">
                      <thead>
                        <tr>
                          {salesAssistTotals.map((period) => (
                            <th key={`salesassist-total-head-${period.key}`}>{period.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {salesAssistTotals.map((period) => (
                            <td key={`salesassist-total-value-${period.key}`} className="stripe-ui__num">
                              {formatMoney(period.total, currency)}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <section className="stripe-ui__panel ui-reveal ui-reveal-3">
            <h2 className="stripe-ui__panel-title">Detail rows</h2>
            <div className="stripe-ui__table-wrap">
              <table className="stripe-ui__table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Source</th>
                    {data.periods.map((period) => (
                      <th key={`detail-head-${period.key}`}>{period.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {segmentRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.customerLabel}</td>
                      <td>{row.sourceLabel}</td>
                      {data.periods.map((period) => (
                        <td key={`${row.id}-${period.key}`} className="stripe-ui__num">
                          {formatMoney(Number(row.valuesByPeriod?.[period.key] || 0), currency)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
