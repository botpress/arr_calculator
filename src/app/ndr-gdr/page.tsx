"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CombineMode = "grouped" | "simple";
type MetricMode = "ndr" | "gdr";
type MatrixGroupBy = "overall" | "source" | "plan";

type NdrGdrResponse = {
  startDate: string;
  endDate: string;
  combineMode: CombineMode;
  groupBy?: MatrixGroupBy;
  targetCurrency: string;
  warnings?: string[];
  periods: Array<{ key: string; label: string }>;
  cohorts: Array<{
    cohortKey: string;
    cohortLabel: string;
    cohortCustomerCount: number;
    cohortArr: number;
    ndrByPeriod: Record<string, number | null>;
    gdrByPeriod: Record<string, number | null>;
  }>;
  segments?: Array<{
    segmentKey: string;
    segmentLabel: string;
    cohorts: Array<{
      cohortKey: string;
      cohortLabel: string;
      cohortCustomerCount: number;
      cohortArr: number;
      ndrByPeriod: Record<string, number | null>;
      gdrByPeriod: Record<string, number | null>;
    }>;
  }>;
};

function defaultDateRange() {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1, 0, 0, 0, 0));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end,
  };
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

function formatPct(value: number | null) {
  if (value == null) return "—";
  return `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}%`;
}

export default function NdrGdrPage() {
  const defaults = useMemo(() => defaultDateRange(), []);
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [combineMode, setCombineMode] = useState<CombineMode>("grouped");
  const [groupBy, setGroupBy] = useState<MatrixGroupBy>("overall");
  const [metricMode, setMetricMode] = useState<MetricMode>("ndr");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<NdrGdrResponse | null>(null);
  const autoRunDone = useRef(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ndr-gdr-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, combineMode, groupBy }),
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
      setData(json as NdrGdrResponse);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [combineMode, endDate, groupBy, startDate]);

  useEffect(() => {
    if (autoRunDone.current) return;
    autoRunDone.current = true;
    void run();
  }, [run]);

  const periods = data?.periods || [];
  const segments =
    data?.segments && data.segments.length
      ? data.segments
      : [
          {
            segmentKey: "overall",
            segmentLabel: "Overall",
            cohorts: data?.cohorts || [],
          },
        ];
  const currency = data?.targetCurrency || "USD";

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Revenue intelligence</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">NDR/GDR</h1>
            <p className="stripe-ui__subtitle">
              Cohort retention matrix by month. Rows are cohort start month; columns are observed month.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Report controls</h2>
        <p className="stripe-ui__panel-subtitle">
          NDR uses current ARR over cohort ARR. GDR caps each customer at cohort ARR (excludes expansion).
        </p>

        <div className="stripe-ui__control-grid">
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="ndr-gdr-start-date">
              Start date
            </label>
            <input
              id="ndr-gdr-start-date"
              className="stripe-ui__control"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="ndr-gdr-end-date">
              End date
            </label>
            <input
              id="ndr-gdr-end-date"
              className="stripe-ui__control"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="ndr-gdr-combine-mode">
              Match mode
            </label>
            <select
              id="ndr-gdr-combine-mode"
              className="stripe-ui__control"
              value={combineMode}
              onChange={(e) => setCombineMode((e.target.value === "simple" ? "simple" : "grouped") as CombineMode)}
            >
              <option value="grouped">Grouped</option>
              <option value="simple">Simple</option>
            </select>
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="ndr-gdr-metric">
              Metric
            </label>
            <select
              id="ndr-gdr-metric"
              className="stripe-ui__control"
              value={metricMode}
              onChange={(e) => setMetricMode((e.target.value === "gdr" ? "gdr" : "ndr") as MetricMode)}
            >
              <option value="ndr">NDR</option>
              <option value="gdr">GDR</option>
            </select>
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="ndr-gdr-group-by">
              Group by
            </label>
            <select
              id="ndr-gdr-group-by"
              className="stripe-ui__control"
              value={groupBy}
              onChange={(e) => setGroupBy((["source", "plan"].includes(e.target.value) ? e.target.value : "overall") as MatrixGroupBy)}
            >
              <option value="overall">Overall</option>
              <option value="source">Source (Sales-led vs Self-serve)</option>
              <option value="plan">Plan</option>
            </select>
          </div>
          <div className="stripe-ui__field" style={{ alignSelf: "end" }}>
            <button id="ndr-gdr-run" className="stripe-ui__btn stripe-ui__btn--primary" onClick={() => void run()} disabled={loading}>
              {loading ? "Loading..." : "Load Matrix"}
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <section className="stripe-ui__panel ui-reveal ui-reveal-2">
          <h2 className="stripe-ui__panel-title">Error</h2>
          <p className="stripe-ui__panel-subtitle" style={{ color: "#fecaca" }}>
            {error}
          </p>
        </section>
      ) : null}

      {!loading && data && (
        <section className="stripe-ui__panel ui-reveal ui-reveal-2">
          <div className="stripe-ui__section-head">
            <div>
              <h2 className="stripe-ui__panel-title">{metricMode === "ndr" ? "NDR Matrix" : "GDR Matrix"}</h2>
              <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
                Cohort ARR baseline and retention percentages for {periods.length} months.
              </p>
            </div>
          </div>

          {(data.warnings || []).length ? (
            <div style={{ marginTop: "0.7rem" }}>
              {data.warnings?.map((warning, idx) => (
                <p key={`warning-${idx}`} className="stripe-ui__hint" style={{ color: "#fbbf24", marginBottom: "0.25rem" }}>
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          {periods.length === 0 || segments.every((segment) => (segment.cohorts || []).length === 0) ? (
            <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
              No monthly data found for this range.
            </p>
          ) : (
            <div style={{ marginTop: "0.85rem", display: "grid", gap: "1rem" }}>
              {segments.map((segment) => {
                const cohorts = segment.cohorts || [];
                return (
                  <div key={`segment-${segment.segmentKey}`}>
                    {segments.length > 1 ? (
                      <h3 className="stripe-ui__panel-title" style={{ fontSize: "1rem", marginBottom: "0.55rem" }}>
                        {segment.segmentLabel}
                      </h3>
                    ) : null}
                    <div className="stripe-ui__table-wrap">
                      <table className="stripe-ui__table">
                        <thead>
                          <tr>
                            <th>Cohort Month</th>
                            <th className="stripe-ui__num">Customers</th>
                            <th className="stripe-ui__num">Cohort ARR</th>
                            {periods.map((period) => (
                              <th key={`col-${segment.segmentKey}-${period.key}`} className="stripe-ui__num">
                                {period.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {cohorts.length ? (
                            cohorts.map((cohort) => (
                              <tr key={`row-${segment.segmentKey}-${cohort.cohortKey}`}>
                                <td>{cohort.cohortLabel}</td>
                                <td className="stripe-ui__num">{cohort.cohortCustomerCount}</td>
                                <td className="stripe-ui__num">{formatMoney(cohort.cohortArr, currency)}</td>
                                {periods.map((period) => {
                                  const value =
                                    metricMode === "ndr" ? cohort.ndrByPeriod?.[period.key] ?? null : cohort.gdrByPeriod?.[period.key] ?? null;
                                  return (
                                    <td key={`cell-${segment.segmentKey}-${cohort.cohortKey}-${period.key}`} className="stripe-ui__num">
                                      {formatPct(value)}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={3 + periods.length}>No cohort data for this segment.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
