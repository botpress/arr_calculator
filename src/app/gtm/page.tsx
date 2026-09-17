"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { GtmArrBridgeRow, GtmMetric, GtmReportResponse } from "@/lib/gtmReport";
import type {
  GtmBridgeField,
  GtmBridgeSegment,
  GtmDetailColumn,
  GtmDetailPeriod,
  GtmDetailRequest,
  GtmDetailResponse,
  GtmDetailRow,
} from "@/lib/gtmDetails";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function sundayOnOrBefore(date: Date) {
  return addDays(date, -date.getUTCDay());
}

function latestClosedWeekEnd() {
  return sundayOnOrBefore(addDays(new Date(`${todayIso()}T00:00:00.000Z`), -1)).toISOString().slice(0, 10);
}

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value || 0);
}

function formatByFormat(value: number | null, format: GtmMetric["format"], currency: string) {
  if (value == null) return "—";
  if (format === "currency") return formatMoney(value, currency);
  if (format === "percent") return `${formatNumber(value * 100, 1)}%`;
  if (format === "multiple") return `${formatNumber(value, 2)}×`;
  return formatNumber(value, 0);
}

function parseJson(text: string, status: number, label: string) {
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new Error(`${label} returned a non-JSON response (${status}).`);
  }
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

type DetailModalState = {
  title: string;
  displayedValue: number | null;
  format: GtmMetric["format"];
  loading: boolean;
  error: string | null;
  data: GtmDetailResponse | null;
};

const REMOTE_DETAIL_METRICS = new Set([
  "net_new_arr",
  "selfserve_new",
  "sales_new",
  "pipeline_created",
  "open_pipeline",
  "overall_signups",
  "cs_signups",
  "business_signups",
  "mqls",
  "sqls",
  "opps_created",
  "opps_from_mql",
  "opps_from_pql",
  "sales_acv",
  "win_rate",
  "selfserve_expansion",
  "selfserve_churn",
  "sales_expansion",
  "sales_churn",
]);

const BRIDGE_FIELDS: Array<{ field: GtmBridgeField; label: string }> = [
  { field: "beginningArr", label: "Beginning ARR" },
  { field: "newArr", label: "New" },
  { field: "expansionArr", label: "Expansion" },
  { field: "contractionArr", label: "Contraction" },
  { field: "churnArr", label: "Churn" },
  { field: "transferArr", label: "Transfers" },
  { field: "endingArr", label: "Ending ARR" },
  { field: "netNewArr", label: "Net New ARR" },
];

function detailValueButton(args: {
  value: number | null;
  text: string;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  if (args.value == null) return <span className={args.className}>—</span>;
  return <button type="button" className={`gtm__detail-value ${args.className || ""}`} onClick={args.onClick} aria-label={`View details for ${args.label}`}>{args.text}</button>;
}

function detailCellValue(value: string | number | null, column: GtmDetailColumn, currency: string) {
  if (value == null || value === "") return "—";
  if (column.format === "currency") return formatMoney(Number(value), currency);
  if (column.format === "count") return formatNumber(Number(value));
  if (column.format === "percent") return `${formatNumber(Number(value) * 100, 1)}%`;
  if (column.format === "date") return dateLabel(String(value));
  return String(value);
}

export default function GtmPage() {
  const [weekEndDate, setWeekEndDate] = useState(latestClosedWeekEnd);
  const [data, setData] = useState<GtmReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailModalState | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const gtmResponse = await fetch("/api/gtm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekEndDate }),
      });
      const gtmText = await gtmResponse.text();
      const gtmPayload = parseJson(gtmText, gtmResponse.status, "GTM report");
      if (!gtmResponse.ok) {
        const message = gtmPayload && typeof gtmPayload === "object" && "error" in gtmPayload
          ? String((gtmPayload as { error?: unknown }).error || "GTM report failed")
          : `GTM report failed (${gtmResponse.status})`;
        throw new Error(message);
      }
      const nextData = gtmPayload as GtmReportResponse;
      setData(nextData);
      if (nextData.weekEndDate !== weekEndDate) setWeekEndDate(nextData.weekEndDate);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load GTM report");
    } finally {
      setLoading(false);
    }
  }, [weekEndDate]);

  useEffect(() => {
    void run();
  }, [run]);

  useEffect(() => {
    if (!detail) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detail]);

  const metrics = useMemo(() => data?.metrics || [], [data]);

  const sections = useMemo(() => {
    const bySection = new Map<string, GtmMetric[]>();
    for (const metric of metrics) {
      const rows = bySection.get(metric.section) || [];
      rows.push(metric);
      bySection.set(metric.section, rows);
    }
    return Array.from(bySection.entries());
  }, [metrics]);

  const headline = metrics.find((metric) => metric.id === "net_new_arr");
  const pipelineCoverage = metrics.find((metric) => metric.id === "pipeline_coverage");
  const newBusiness = data?.arrBridge.reduce((total, row) => row.segment === "total" ? total : total + row.newArr, 0) || 0;
  const endingArr = data?.arrBridge.find((row) => row.segment === "total")?.endingArr || 0;
  const statusCounts = metrics.reduce((counts, metric) => {
    counts[metric.status] = (counts[metric.status] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);

  function showLocalDetail(args: {
    title: string;
    displayedValue: number | null;
    format: GtmMetric["format"];
    aggregation?: GtmDetailResponse["aggregation"];
    columns?: GtmDetailColumn[];
    rows?: GtmDetailRow[];
    summary?: Array<{ label: string; value: string }>;
    note?: string;
    source?: string;
  }) {
    setDetail({
      title: args.title,
      displayedValue: args.displayedValue,
      format: args.format,
      loading: false,
      error: null,
      data: {
        title: args.title,
        periodLabel: data ? `${data.monthLabel} scorecard` : "GTM scorecard",
        source: args.source || "Calculated in this scorecard",
        aggregation: args.aggregation || "ratio",
        detailValue: args.displayedValue,
        columns: args.columns || [],
        rows: args.rows || [],
        summary: args.summary,
        note: args.note,
      },
    });
  }

  async function showRemoteDetail(args: {
    title: string;
    displayedValue: number | null;
    format: GtmMetric["format"];
    request: GtmDetailRequest;
  }) {
    setDetail({ title: args.title, displayedValue: args.displayedValue, format: args.format, loading: true, error: null, data: null });
    try {
      const response = await fetch("/api/gtm/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.request),
      });
      const text = await response.text();
      const payload = parseJson(text, response.status, "GTM detail");
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: unknown }).error || "GTM detail failed")
          : `GTM detail failed (${response.status})`;
        throw new Error(message);
      }
      const nextData = payload as GtmDetailResponse;
      setDetail((current) => current && current.title === args.title
        ? { ...current, loading: false, data: { ...nextData, title: args.title } }
        : current);
    } catch (requestError: unknown) {
      setDetail((current) => current && current.title === args.title
        ? { ...current, loading: false, error: requestError instanceof Error ? requestError.message : "Unable to load details" }
        : current);
    }
  }

  function metricValue(metric: GtmMetric, period: GtmDetailPeriod) {
    return period === "week" ? metric.weekValue : period === "priorWeek" ? metric.priorWeekValue : metric.mtdValue;
  }

  function periodHeading(period: GtmDetailPeriod) {
    if (!data) return "";
    if (period === "week") return `week ending ${dateLabel(data.weekEndDate)}`;
    if (period === "priorWeek") return `week ending ${dateLabel(data.priorWeekEndDate)}`;
    return `MTD through ${dateLabel(data.weekEndDate)}`;
  }

  function showMetricActual(metric: GtmMetric, period: GtmDetailPeriod) {
    if (!data) return;
    const value = metricValue(metric, period);
    const title = `${metric.label} · ${periodHeading(period)}`;
    if (REMOTE_DETAIL_METRICS.has(metric.id)) {
      void showRemoteDetail({
        title,
        displayedValue: value,
        format: metric.format,
        request: { kind: "metric", weekEndDate: data.weekEndDate, metricId: metric.id, period },
      });
      return;
    }
    if (metric.id === "pipeline_coverage") {
      const openPipeline = metrics.find((row) => row.id === "open_pipeline");
      const numerator = openPipeline ? metricValue(openPipeline, period) : null;
      const denominator = value != null && Math.abs(value) > 1e-9 && numerator != null ? numerator / value : null;
      showLocalDetail({
        title,
        displayedValue: value,
        format: metric.format,
        summary: [
          { label: "Open pipeline", value: numerator == null ? "—" : formatMoney(numerator, data.targetCurrency) },
          { label: "New-business ARR target", value: denominator == null ? "—" : formatMoney(denominator, data.targetCurrency) },
          { label: "Formula", value: "Open pipeline ÷ new-business ARR target" },
        ],
        note: "The denominator comes from the workbook Targets tab; the numerator is the reconstructed HubSpot open-pipeline snapshot.",
        source: "HubSpot replica · BigQuery + Targets tab",
      });
      return;
    }
    const numeratorMetric = metric.id === "mql_to_sql"
      ? metrics.find((row) => row.id === "sqls")
      : metric.id === "sql_to_opp"
        ? metrics.find((row) => row.id === "opps_created")
        : null;
    const denominatorMetric = metric.id === "mql_to_sql"
      ? metrics.find((row) => row.id === "mqls")
      : metric.id === "sql_to_opp"
        ? metrics.find((row) => row.id === "sqls")
        : null;
    if (numeratorMetric && denominatorMetric) {
      const numerator = metricValue(numeratorMetric, period);
      const denominator = metricValue(denominatorMetric, period);
      showLocalDetail({
        title,
        displayedValue: value,
        format: metric.format,
        summary: [
          { label: numeratorMetric.label, value: numerator == null ? "—" : formatNumber(numerator) },
          { label: denominatorMetric.label, value: denominator == null ? "—" : formatNumber(denominator) },
          { label: "Formula", value: `${numeratorMetric.label} ÷ ${denominatorMetric.label}` },
        ],
        note: metric.note,
        source: metric.source,
      });
    }
  }

  function showMetricCalculation(metric: GtmMetric, calculation: "wow" | "paced" | "target" | "pacing" | "achievement") {
    if (!data) return;
    if (calculation === "wow") {
      showLocalDetail({
        title: `${metric.label} · change vs last week`,
        displayedValue: metric.weekOverWeek,
        format: "percent",
        summary: [
          { label: `Week ending ${dateLabel(data.weekEndDate)}`, value: formatByFormat(metric.weekValue, metric.format, data.targetCurrency) },
          { label: `Week ending ${dateLabel(data.priorWeekEndDate)}`, value: formatByFormat(metric.priorWeekValue, metric.format, data.targetCurrency) },
          { label: "Formula", value: "(Current week − prior week) ÷ prior week" },
        ],
      });
      return;
    }
    if (calculation === "target") {
      showLocalDetail({
        title: `${metric.label} · monthly target`,
        displayedValue: metric.target,
        format: metric.format,
        summary: [{ label: "Target month", value: data.monthLabel }, { label: "Source", value: "GTM workbook Targets tab" }],
        source: "Targets tab",
        note: "Targets are read only from the Targets tab source of truth; weekly-tab targets are not used.",
      });
      return;
    }
    if (calculation === "paced") {
      showLocalDetail({
        title: `${metric.label} · paced target`,
        displayedValue: metric.pacedTarget,
        format: metric.format,
        summary: [
          { label: "Monthly target", value: formatByFormat(metric.target, metric.format, data.targetCurrency) },
          { label: "Business days elapsed", value: `${data.businessDays.elapsed} of ${data.businessDays.total}` },
          { label: "Formula", value: metric.format === "percent" || metric.format === "multiple" ? "Monthly target (not prorated)" : "Monthly target × elapsed business days ÷ total business days" },
        ],
        source: "Targets tab + scorecard pacing",
      });
      return;
    }
    const denominator = calculation === "pacing" ? metric.pacedTarget : metric.target;
    const displayedValue = calculation === "pacing" ? metric.pacing : metric.achievement;
    showLocalDetail({
      title: `${metric.label} · ${calculation === "pacing" ? "pacing" : "achievement"}`,
      displayedValue,
      format: "percent",
      summary: [
        { label: "Actual MTD", value: formatByFormat(metric.mtdValue, metric.format, data.targetCurrency) },
        { label: calculation === "pacing" ? "Paced target" : "Monthly target", value: formatByFormat(denominator, metric.format, data.targetCurrency) },
        { label: "Formula", value: `Actual MTD ÷ ${calculation === "pacing" ? "paced target" : "monthly target"}` },
      ],
    });
  }

  function showBridgeDetail(segment: GtmBridgeSegment, label: string, field: GtmBridgeField, value: number, period: "week" | "mtd" = "mtd") {
    if (!data) return;
    void showRemoteDetail({
      title: `${label} · ${BRIDGE_FIELDS.find((item) => item.field === field)?.label || field} · ${period === "week" ? `week ending ${dateLabel(data.weekEndDate)}` : `MTD through ${dateLabel(data.weekEndDate)}`}`,
      displayedValue: value,
      format: "currency",
      request: { kind: "bridge", weekEndDate: data.weekEndDate, segment, field, period },
    });
  }

  function renderArrBridge(rows: GtmArrBridgeRow[], period: "week" | "mtd") {
    if (!data) return null;
    return (
      <div className="stripe-ui__table-wrap">
        <table className="stripe-ui__table gtm__table">
          <thead><tr><th>Motion</th>{BRIDGE_FIELDS.map((item) => <th key={item.field} className="stripe-ui__num">{item.label}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.segment} className={row.segment === "total" ? "gtm__total-row" : ""}><td>{row.label}</td>{BRIDGE_FIELDS.map(({ field }) => {
            const value = row[field];
            return <td key={field} className="stripe-ui__num">{detailValueButton({ value, text: formatMoney(value, data.targetCurrency), label: `${row.label} ${field}`, onClick: () => showBridgeDetail(row.segment, row.label, field, value, period) })}</td>;
          })}</tr>)}</tbody>
        </table>
      </div>
    );
  }

  function renderMetricActual(metric: GtmMetric, period: GtmDetailPeriod) {
    if (!data) return "—";
    const value = metricValue(metric, period);
    const supportsDetail = REMOTE_DETAIL_METRICS.has(metric.id) || ["pipeline_coverage", "mql_to_sql", "sql_to_opp"].includes(metric.id);
    if (!supportsDetail) return formatByFormat(value, metric.format, data.targetCurrency);
    return detailValueButton({
      value,
      text: formatByFormat(value, metric.format, data.targetCurrency),
      label: `${metric.label} ${periodHeading(period)}`,
      onClick: () => showMetricActual(metric, period),
    });
  }

  function renderMetricCalculation(metric: GtmMetric, calculation: "wow" | "paced" | "target" | "pacing" | "achievement") {
    if (!data) return "—";
    const value = calculation === "wow" ? metric.weekOverWeek
      : calculation === "paced" ? metric.pacedTarget
        : calculation === "target" ? metric.target
          : calculation === "pacing" ? metric.pacing
            : metric.achievement;
    const text = calculation === "paced" || calculation === "target"
      ? formatByFormat(value, metric.format, data.targetCurrency)
      : value == null ? "—" : `${formatNumber(value * 100, 1)}%`;
    return detailValueButton({
      value,
      text,
      label: `${metric.label} ${calculation}`,
      onClick: () => showMetricCalculation(metric, calculation),
    });
  }

  function downloadCsv() {
    if (!data) return;
    const header = ["Section", "Metric", "Owner", `Week ending ${data.weekEndDate}`, `Week ending ${data.priorWeekEndDate}`, "vs last week", "Actual MTD", "Paced target", "Monthly target", "Pacing / to target", "% achievement", "Status", "Source", "Note"];
    const rows = metrics.map((metric) => [
      metric.section,
      metric.label,
      metric.owner,
      metric.weekValue ?? "",
      metric.priorWeekValue ?? "",
      metric.weekOverWeek ?? "",
      metric.mtdValue ?? "",
      metric.pacedTarget ?? "",
      metric.target ?? "",
      metric.pacing ?? "",
      metric.achievement ?? "",
      metric.status,
      metric.source,
      metric.note || "",
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `gtm-scorecard-week-ending-${data.weekEndDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stripe-ui gtm">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Go-to-market operating system</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">GTM</h1>
            <p className="stripe-ui__subtitle">
              Automated scorecard using the HubSpot and Stripe data replicated in BigQuery, plus the FY27 Targets tab.
            </p>
          </div>
          <div className="gtm__hero-links">
            <button className="stripe-ui__hero-link gtm__link-button" type="button" onClick={downloadCsv} disabled={!data}>Download CSV</button>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <div className="stripe-ui__section-head">
          <div>
            <h2 className="stripe-ui__panel-title">Reporting period</h2>
            <p className="stripe-ui__panel-subtitle">Select a completed week ending Sunday. Targets come only from the workbook’s Targets tab.</p>
          </div>
        </div>
        <div className="stripe-ui__control-grid gtm__controls">
          <label className="stripe-ui__field">
            <span className="stripe-ui__field-label">Week ending (Sunday)</span>
            <input className="stripe-ui__control" type="date" min="2026-04-05" max={latestClosedWeekEnd()} step="7" value={weekEndDate} onChange={(event) => setWeekEndDate(event.target.value)} />
          </label>
          <div className="stripe-ui__actions gtm__load-action">
            <button type="button" className="stripe-ui__btn stripe-ui__btn--primary" onClick={() => void run()} disabled={loading}>{loading ? "Loading…" : "Refresh scorecard"}</button>
          </div>
        </div>
        {data ? <p className="gtm__pacing-note">Showing {data.weekStartDate} through {data.weekEndDate}, compared with {data.priorWeekStartDate} through {data.priorWeekEndDate}. MTD runs through the selected Sunday; monthly targets are paced to {data.businessDays.elapsed} of {data.businessDays.total} business days.</p> : null}
      </section>

      {error ? <section className="stripe-ui__panel"><div className="stripe-ui__error">{error}</div></section> : null}
      {loading && !data ? <section className="stripe-ui__panel stripe-ui__loading-panel" aria-busy="true">Building the GTM scorecard…</section> : null}

      {data ? (
        <>
          <section className="gtm__summary ui-reveal ui-reveal-2">
            <article className="gtm__summary-card gtm__summary-card--primary">
              <span>Net New ARR MTD</span>
              <strong>{headline ? detailValueButton({ value: headline.mtdValue, text: formatByFormat(headline.mtdValue, headline.format, data.targetCurrency), label: "Net New ARR MTD", onClick: () => showMetricActual(headline, "mtd"), className: "gtm__detail-value--inverse" }) : "—"}</strong>
              <small>{headline?.target != null ? `${formatNumber((headline.achievement || 0) * 100, 1)}% of ${formatMoney(headline.target, data.targetCurrency)} target · ${formatByFormat(headline.weekValue, headline.format, data.targetCurrency)} this week` : "No target"}</small>
            </article>
            <article className="gtm__summary-card">
              <span>New business ARR MTD</span><strong>{detailValueButton({ value: newBusiness, text: formatMoney(newBusiness, data.targetCurrency), label: "New business ARR MTD", onClick: () => showBridgeDetail("total", "Total", "newArr", newBusiness) })}</strong><small>All live motions through {dateLabel(data.weekEndDate)}</small>
            </article>
            <article className="gtm__summary-card">
              <span>Ending ARR</span><strong>{detailValueButton({ value: endingArr, text: formatMoney(endingArr, data.targetCurrency), label: "Ending ARR", onClick: () => showBridgeDetail("total", "Total", "endingArr", endingArr) })}</strong><small>Week ending {dateLabel(data.weekEndDate)}</small>
            </article>
            <article className="gtm__summary-card">
              <span>Pipeline coverage</span><strong>{pipelineCoverage ? detailValueButton({ value: pipelineCoverage.mtdValue, text: formatByFormat(pipelineCoverage.mtdValue, pipelineCoverage.format, data.targetCurrency), label: "Pipeline coverage", onClick: () => showMetricActual(pipelineCoverage, "mtd") }) : "—"}</strong><small>Week-end snapshot · Targets-tab required: {pipelineCoverage?.target != null ? `${formatNumber(pipelineCoverage.target, 2)}×` : "—"}</small>
            </article>
            <article className="gtm__summary-card">
              <span>RAG summary</span><strong><button type="button" className="gtm__detail-value" onClick={() => showLocalDetail({
                title: "RAG status details",
                displayedValue: null,
                format: "count",
                aggregation: "count",
                columns: [{ key: "metric", label: "Metric" }, { key: "status", label: "Status" }, { key: "actual", label: "Actual MTD" }],
                rows: metrics.map((metric) => ({ metric: metric.label, status: metric.status, actual: formatByFormat(metric.mtdValue, metric.format, data.targetCurrency) })),
                summary: [
                  { label: "Green", value: String(statusCounts.green || 0) },
                  { label: "Yellow", value: String(statusCounts.yellow || 0) },
                  { label: "Red", value: String(statusCounts.red || 0) },
                  { label: "Unavailable", value: String(statusCounts.unavailable || 0) },
                ],
              })}>{statusCounts.green || 0} green · {statusCounts.yellow || 0} yellow · {statusCounts.red || 0} red</button></strong><small>{statusCounts.unavailable || 0} source gaps shown below</small>
            </article>
          </section>

          <section className="stripe-ui__panel ui-reveal ui-reveal-2">
            <h2 className="stripe-ui__panel-title">ARR by motion — week ending {dateLabel(data.weekEndDate)}</h2>
            <p className="stripe-ui__panel-subtitle">The weekly bridge covers {dateLabel(data.weekStartDate)} through {dateLabel(data.weekEndDate)} using the same combined CARR-by-motion model and legacy non-cloud HubSpot ARR as the MTD view.</p>
            {renderArrBridge(data.weekArrBridge, "week")}
          </section>

          <section className="stripe-ui__panel ui-reveal ui-reveal-2">
            <h2 className="stripe-ui__panel-title">ARR by motion — MTD through {dateLabel(data.weekEndDate)}</h2>
            <p className="stripe-ui__panel-subtitle">The bridge aggregates Sunday-ending weekly rows from the combined CARR-by-motion model plus legacy HubSpot ARR (deployment type is not Cloud) in BigQuery. No live HubSpot API call is made.</p>
            {renderArrBridge(data.arrBridge, "mtd")}
          </section>

          <section className="stripe-ui__panel ui-reveal ui-reveal-3">
            <h2 className="stripe-ui__panel-title">Scorecard</h2>
            <p className="stripe-ui__panel-subtitle">Unavailable rows stay visible so missing integrations are obvious; no workbook actual is used as a live fallback.</p>
            <div className="stripe-ui__table-wrap">
              <table className="stripe-ui__table gtm__table gtm__scorecard">
                <thead><tr><th>Metric</th><th>Owner</th><th className="stripe-ui__num">Ending {dateLabel(data.weekEndDate)}</th><th className="stripe-ui__num">Ending {dateLabel(data.priorWeekEndDate)}</th><th className="stripe-ui__num">vs LW</th><th className="stripe-ui__num">Actual MTD</th><th className="stripe-ui__num">Paced target</th><th className="stripe-ui__num">Monthly target</th><th className="stripe-ui__num">Pacing / to target</th><th className="stripe-ui__num">% achievement</th><th>Status</th><th>Source / note</th></tr></thead>
                <tbody>{sections.map(([section, rows]) => <React.Fragment key={section}>
                  <tr className="gtm__section-row"><td colSpan={12}>{section}</td></tr>
                  {rows.map((metric) => <tr key={metric.id}>
                    <td>{metric.label}</td>
                    <td>{metric.owner}</td>
                    <td className="stripe-ui__num">{renderMetricActual(metric, "week")}</td>
                    <td className="stripe-ui__num">{renderMetricActual(metric, "priorWeek")}</td>
                    <td className="stripe-ui__num">{renderMetricCalculation(metric, "wow")}</td>
                    <td className="stripe-ui__num">{renderMetricActual(metric, "mtd")}</td>
                    <td className="stripe-ui__num">{renderMetricCalculation(metric, "paced")}</td>
                    <td className="stripe-ui__num">{renderMetricCalculation(metric, "target")}</td>
                    <td className="stripe-ui__num">{renderMetricCalculation(metric, "pacing")}</td>
                    <td className="stripe-ui__num">{renderMetricCalculation(metric, "achievement")}</td>
                    <td><span className={`gtm__status gtm__status--${metric.status}`}>{metric.status === "unavailable" ? "Unavailable" : metric.status === "neutral" ? "No target" : metric.status}</span></td>
                    <td><strong>{metric.source}</strong>{metric.note ? <small className="gtm__source-note">{metric.note}</small> : null}</td>
                  </tr>)}
                </React.Fragment>)}</tbody>
              </table>
            </div>
          </section>

          <section className="stripe-ui__panel ui-reveal ui-reveal-4">
            <details className="gtm__details">
              <summary>View all Targets-tab values for {data.monthLabel}</summary>
              <p className="stripe-ui__panel-subtitle">Monthly and FY27 targets transcribed from the workbook’s Targets tab. Dashes remain blank.</p>
              <div className="stripe-ui__table-wrap"><table className="stripe-ui__table gtm__table"><thead><tr><th>Target section</th><th>Metric</th><th className="stripe-ui__num">{data.monthLabel}</th><th className="stripe-ui__num">FY27</th></tr></thead><tbody>{data.targetRows.map((row) => <tr key={row.id}><td>{row.section}</td><td>{row.label}</td><td className="stripe-ui__num">{detailValueButton({ value: row.value, text: formatByFormat(row.value, row.format, data.targetCurrency), label: `${row.label} ${data.monthLabel} target`, onClick: () => showLocalDetail({ title: `${row.label} · ${data.monthLabel} target`, displayedValue: row.value, format: row.format, summary: [{ label: "Target section", value: row.section }, { label: "Source", value: "GTM workbook Targets tab" }], source: "Targets tab" }) })}</td><td className="stripe-ui__num">{detailValueButton({ value: row.fy27, text: formatByFormat(row.fy27, row.format, data.targetCurrency), label: `${row.label} FY27 target`, onClick: () => showLocalDetail({ title: `${row.label} · FY27 target`, displayedValue: row.fy27, format: row.format, summary: [{ label: "Target section", value: row.section }, { label: "Source", value: "GTM workbook Targets tab" }], source: "Targets tab" }) })}</td></tr>)}</tbody></table></div>
            </details>
          </section>

          {data.warnings.length ? <section className="stripe-ui__panel"><h2 className="stripe-ui__panel-title">Data-source warnings</h2><ul className="gtm__warnings">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : null}
        </>
      ) : null}

      {detail ? <div className="gtm__modal-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setDetail(null);
      }}>
        <section className="gtm__modal" role="dialog" aria-modal="true" aria-labelledby="gtm-detail-title">
          <div className="gtm__modal-head">
            <div>
              <div className="stripe-ui__eyebrow">Metric detail</div>
              <h2 id="gtm-detail-title" className="gtm__modal-title">{detail.title}</h2>
              {detail.data ? <p className="gtm__modal-period">{detail.data.periodLabel} · {detail.data.source}</p> : null}
            </div>
            <button type="button" className="gtm__modal-close" onClick={() => setDetail(null)} aria-label="Close metric details">×</button>
          </div>

          {detail.loading ? <div className="gtm__modal-loading" aria-busy="true">Loading contributing records…</div> : null}
          {detail.error ? <div className="stripe-ui__error">{detail.error}</div> : null}

          {detail.data ? <>
            <div className="gtm__detail-summary">
              {detail.displayedValue != null ? <div><span>Displayed value</span><strong>{formatByFormat(detail.displayedValue, detail.format, data?.targetCurrency || "USD")}</strong></div> : null}
              {detail.data.detailValue != null ? <div><span>{detail.data.aggregation === "count" ? "Detail count" : detail.data.aggregation === "average" ? "Detail average" : detail.data.aggregation === "ratio" ? "Calculated ratio" : detail.data.aggregation === "snapshot" ? "Detail snapshot" : "Detail total"}</span><strong>{formatByFormat(detail.data.detailValue, detail.format, data?.targetCurrency || "USD")}</strong></div> : null}
              <div><span>Records</span><strong>{formatNumber(detail.data.rows.length)}</strong></div>
              {detail.data.summary?.map((item) => <div key={`${item.label}-${item.value}`}><span>{item.label}</span><strong>{item.value}</strong></div>)}
            </div>
            {detail.data.note ? <p className="gtm__detail-note">{detail.data.note}</p> : null}
            {detail.data.columns.length ? <div className="stripe-ui__table-wrap gtm__detail-table-wrap">
              <table className="stripe-ui__table gtm__table gtm__detail-table">
                <thead><tr>{detail.data.columns.map((column) => <th key={column.key} className={column.format === "currency" || column.format === "count" || column.format === "percent" ? "stripe-ui__num" : undefined}>{column.label}</th>)}</tr></thead>
                <tbody>{detail.data.rows.length ? detail.data.rows.map((row, rowIndex) => <tr key={`${String(row.dealId || row.contactId || row.customerId || row.date || "row")}-${rowIndex}`}>
                  {detail.data?.columns.map((column) => {
                    const content = detailCellValue(row[column.key], column, data?.targetCurrency || "USD");
                    const link = column.linkKey ? row[column.linkKey] : null;
                    return <td key={column.key} className={column.format === "currency" || column.format === "count" || column.format === "percent" ? "stripe-ui__num" : undefined}>{link ? <a href={String(link)} target="_blank" rel="noreferrer">{content}</a> : content}</td>;
                  })}
                </tr>) : <tr><td colSpan={detail.data.columns.length} className="gtm__detail-empty">No contributing records were found for this value.</td></tr>}</tbody>
              </table>
            </div> : null}
          </> : null}
        </section>
      </div> : null}
    </div>
  );
}
