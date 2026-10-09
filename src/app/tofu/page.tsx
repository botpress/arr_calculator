"use client";

import React, { useMemo, useRef, useState } from "react";

type CombineMode = "grouped" | "simple";
type TofuGroupBy = "month" | "plan" | "segment";
type TofuDetailMetric = "beginningArr" | "newArr" | "expansionArr" | "contractionArr" | "churnArr" | "endingArr";
type CombinedPlan = "enterprise" | "managed" | "team" | "plus" | "pay_as_you_go" | "free";
type TofuSegment = "salesled" | "selfserve" | "sales_assist";

type TofuMonthRow = {
  periodKey: string;
  periodLabel: string;
  beginningArr: number;
  newArr: number;
  expansionArr: number;
  contractionArr: number;
  churnArr: number;
  endingArr: number;
};

type TofuPlanRow = {
  periodKey: string;
  periodLabel: string;
  plan: CombinedPlan;
  beginningArr: number;
  newArr: number;
  expansionArr: number;
  contractionArr: number;
  churnArr: number;
  netPlanChangeArr: number;
  endingArr: number;
};

type TofuResponse = {
  startDate: string;
  endDate: string;
  combineMode: CombineMode;
  groupBy: TofuGroupBy;
  targetCurrency: string;
  rows: TofuMonthRow[];
  planRows?: TofuPlanRow[];
  segmentRows?: TofuSegmentRow[];
};

type TofuSegmentRow = {
  periodKey: string;
  periodLabel: string;
  segment: TofuSegment;
  beginningArr: number;
  newArr: number;
  expansionArr: number;
  contractionArr: number;
  churnArr: number;
  endingArr: number;
};

type TofuDetailRow = {
  customerId: string;
  customerLabel: string;
  source: "hubspot_account" | "stripe_only_customer";
  previousArr: number;
  currentArr: number;
  deltaArr: number;
  previousMrr: number;
  currentMrr: number;
  deltaMrr: number;
  contributionArr: number;
  contributionMrr: number;
};

type TofuDetailResponse = {
  startDate: string;
  endDate: string;
  combineMode: CombineMode;
  targetCurrency: string;
  detailGroupBy: TofuGroupBy;
  detailSegment?: TofuSegment;
  detailSegmentLabel?: string;
  detailPeriodKey: string;
  detailPeriodLabel: string;
  detailPreviousPeriodKey: string;
  detailPreviousPeriodLabel: string;
  detailMetric: TofuDetailMetric;
  rows: TofuDetailRow[];
  summary: {
    rowCount: number;
    totalArr: number;
    totalMrr: number;
  };
};

const METRIC_LABELS: Record<TofuDetailMetric, string> = {
  beginningArr: "Beginning ARR",
  newArr: "New ARR",
  expansionArr: "Expansion ARR",
  contractionArr: "Contraction ARR",
  churnArr: "Churn ARR",
  endingArr: "Ending ARR",
};

const PLAN_LABELS: Record<CombinedPlan, string> = {
  enterprise: "Enterprise",
  managed: "Managed",
  team: "Team",
  plus: "Plus",
  pay_as_you_go: "Pay as you go",
  free: "Free",
};

const PLAN_DISPLAY_ORDER: CombinedPlan[] = [
  "enterprise",
  "managed",
  "team",
  "plus",
  "pay_as_you_go",
];

const SEGMENT_LABELS: Record<TofuSegment, string> = {
  salesled: "Sales-led",
  selfserve: "Self-serve",
  sales_assist: "Sales assist",
};

const SEGMENT_BRIDGE_METRICS: Array<{
  key: keyof Pick<
    TofuSegmentRow,
    "beginningArr" | "newArr" | "expansionArr" | "contractionArr" | "churnArr" | "endingArr"
  >;
  label: string;
}> = [
  { key: "beginningArr", label: "Beginning ARR" },
  { key: "newArr", label: "New ARR" },
  { key: "expansionArr", label: "Expansion ARR" },
  { key: "contractionArr", label: "Contraction ARR" },
  { key: "churnArr", label: "Churn ARR" },
  { key: "endingArr", label: "Ending ARR" },
];

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end.getFullYear() - 1, end.getMonth(), 1);
  const toIso = (value: Date) => value.toISOString().slice(0, 10);
  return {
    startDate: toIso(start),
    endDate: toIso(end),
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

function sumField(rows: TofuMonthRow[], key: keyof TofuMonthRow) {
  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
}

function sumPlanField(rows: TofuPlanRow[], key: keyof TofuPlanRow) {
  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
}

function sumSegmentField(rows: TofuSegmentRow[], key: keyof TofuSegmentRow) {
  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
}

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function csvCell(value: unknown) {
  const raw = value == null ? "" : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, "\"\"")}"`;
  return raw;
}

function downloadCsv(filename: string, header: string[], rows: Array<Array<unknown>>) {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  const csv = `${lines.join("\n")}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function parseApiResponse(res: Response) {
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
  return json;
}

export default function TofuPage() {
  const defaults = useMemo(() => defaultDateRange(), []);

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [combineMode, setCombineMode] = useState<CombineMode>("grouped");
  const [groupBy, setGroupBy] = useState<TofuGroupBy>("month");

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TofuResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<TofuDetailResponse | null>(null);
  const detailCacheRef = useRef<Map<string, TofuDetailResponse>>(new Map());

  async function run() {
    setLoading(true);
    setError(null);
    setDetailData(null);
    setDetailError(null);

    try {
      const res = await fetch("/api/tofu-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, combineMode, groupBy }),
      });
      const json = await parseApiResponse(res);
      setData(json as TofuResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(periodKey: string, metric: TofuDetailMetric, segment?: TofuSegment) {
    const detailKey = JSON.stringify({
      startDate,
      endDate,
      combineMode: effectiveCombineMode,
      groupBy: effectiveGroupBy,
      detailPeriodKey: periodKey,
      detailMetric: metric,
      detailSegment: segment || "",
    });
    const cached = detailCacheRef.current.get(detailKey);
    if (cached) {
      setDetailError(null);
      setDetailData(cached);
      return;
    }

    setDetailLoading(true);
    setDetailError(null);
    setDetailData(null);

    try {
      const res = await fetch("/api/tofu-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          combineMode: effectiveCombineMode,
          groupBy: effectiveGroupBy,
          detailPeriodKey: periodKey,
          detailMetric: metric,
          detailSegment: segment || "",
        }),
      });
      const json = await parseApiResponse(res);
      const payload = json as TofuDetailResponse;
      detailCacheRef.current.set(detailKey, payload);
      setDetailData(payload);
    } catch (err: unknown) {
      setDetailData(null);
      setDetailError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setDetailLoading(false);
    }
  }

  const currency = data?.targetCurrency || "USD";
  const effectiveCombineMode = data?.combineMode || combineMode;
  const effectiveGroupBy = data?.groupBy || groupBy;
  const rows = useMemo(() => data?.rows || [], [data?.rows]);
  const planRows = useMemo(() => data?.planRows || [], [data?.planRows]);
  const segmentRows = useMemo(() => data?.segmentRows || [], [data?.segmentRows]);
  const planTableRows = useMemo(
    () => planRows
      .filter((row) => PLAN_DISPLAY_ORDER.includes(row.plan))
      .sort((a, b) => {
        const planDiff = PLAN_DISPLAY_ORDER.indexOf(a.plan) - PLAN_DISPLAY_ORDER.indexOf(b.plan);
        if (planDiff !== 0) return planDiff;
        return a.periodKey.localeCompare(b.periodKey);
      }),
    [planRows],
  );
  const segmentPeriodOrder = useMemo(
    () =>
      Array.from(
        new Map(
          segmentRows.map((row) => [row.periodKey, row.periodLabel]),
        ).entries(),
      ).map(([key, label]) => ({ key, label })),
    [segmentRows],
  );

  const segmentBridgeRows = useMemo(() => {
    const segmentBridgeTotals = new Map<string, number>();
    for (const row of segmentRows) {
      for (const metric of SEGMENT_BRIDGE_METRICS) {
        const key = `${row.segment}::${metric.key}::${row.periodKey}`;
        segmentBridgeTotals.set(
          key,
          round2((segmentBridgeTotals.get(key) || 0) + Number(row[metric.key] || 0)),
        );
      }
    }
    return (["salesled", "selfserve", "sales_assist"] as TofuSegment[])
      .flatMap((segment) =>
        SEGMENT_BRIDGE_METRICS.map((metric) => ({
          segment,
          metric: metric.label,
          metricKey: metric.key,
          valuesByPeriod: Object.fromEntries(
            segmentPeriodOrder.map((period) => [
              period.key,
              round2(segmentBridgeTotals.get(`${segment}::${metric.key}::${period.key}`) || 0),
            ]),
          ) as Record<string, number>,
        })),
      )
      .filter((row) =>
        segmentPeriodOrder.some((period) => Math.abs(Number(row.valuesByPeriod[period.key] || 0)) > 1e-9),
      );
  }, [segmentRows, segmentPeriodOrder]);

  const latestEndingArr = useMemo(() => {
    if (effectiveGroupBy === "plan") {
      if (!planRows.length) return 0;
      const latestKey = planRows[planRows.length - 1].periodKey;
      return round2(
        planRows
          .filter((row) => row.periodKey === latestKey)
          .reduce((sum, row) => sum + Number(row.endingArr || 0), 0),
      );
    }
    if (effectiveGroupBy === "segment") {
      if (!segmentRows.length) return 0;
      const latestKey = segmentRows[segmentRows.length - 1].periodKey;
      return round2(
        segmentRows
          .filter((row) => row.periodKey === latestKey)
          .reduce((sum, row) => sum + Number(row.endingArr || 0), 0),
      );
    }
    return rows.length ? rows[rows.length - 1].endingArr : 0;
  }, [effectiveGroupBy, planRows, segmentRows, rows]);

  function exportDetailCsv(payload: TofuDetailResponse) {
    const filename = `tofu-detail-${payload.detailMetric}-${payload.detailPeriodKey}-${payload.combineMode}.csv`;
    const header = [
      "group_by",
      "segment",
      "period_key",
      "period_label",
      "previous_period_key",
      "previous_period_label",
      "metric",
      "customer_id",
      "customer_label",
      "source",
      "previous_arr",
      "current_arr",
      "delta_arr",
      "contribution_arr",
      "previous_mrr",
      "current_mrr",
      "delta_mrr",
      "contribution_mrr",
    ];
    const csvRows = payload.rows.map((row) => [
      payload.detailGroupBy || "month",
      payload.detailSegmentLabel || "",
      payload.detailPeriodKey,
      payload.detailPeriodLabel,
      payload.detailPreviousPeriodKey,
      payload.detailPreviousPeriodLabel,
      payload.detailMetric,
      row.customerId,
      row.customerLabel,
      row.source === "hubspot_account" ? "hubspot_account" : "stripe_only_customer",
      row.previousArr,
      row.currentArr,
      row.deltaArr,
      row.contributionArr,
      row.previousMrr,
      row.currentMrr,
      row.deltaMrr,
      row.contributionMrr,
    ]);
    downloadCsv(filename, header, csvRows);
  }

  function exportMainTableCsv() {
    if (!data) return;

    if (effectiveGroupBy === "plan") {
      const header = [
        "plan",
        "month",
        "beginning_arr",
        "new_arr",
        "expansion_arr",
        "contraction_arr",
        "churn_arr",
        "ending_arr",
      ];
      const csvRows = planTableRows.map((row) => [
        PLAN_LABELS[row.plan] || row.plan,
        row.periodKey,
        Number(row.beginningArr || 0),
        Number(row.newArr || 0),
        Number(row.expansionArr || 0),
        Number(row.contractionArr || 0),
        Number(row.churnArr || 0),
        Number(row.endingArr || 0),
      ]);
      downloadCsv(
        `tofu-plan-table-${effectiveCombineMode}-${csvTimestamp()}.csv`,
        header,
        csvRows,
      );
      return;
    }

    if (effectiveGroupBy === "segment") {
      const header = ["segment", "bridge_metric", ...segmentPeriodOrder.map((period) => period.key)];
      const csvRows = segmentBridgeRows.map((row) => [
        SEGMENT_LABELS[row.segment] || row.segment,
        row.metric,
        ...segmentPeriodOrder.map((period) => Number(row.valuesByPeriod[period.key] || 0)),
      ]);
      downloadCsv(
        `tofu-segment-bridge-${effectiveCombineMode}-${csvTimestamp()}.csv`,
        header,
        csvRows,
      );
      return;
    }

    const header = [
      "period_key",
      "period_label",
      "beginning_arr",
      "new_arr",
      "expansion_arr",
      "contraction_arr",
      "churn_arr",
      "ending_arr",
    ];
    const csvRows = rows.map((row) => [
      row.periodKey,
      row.periodLabel,
      row.beginningArr,
      row.newArr,
      row.expansionArr,
      row.contractionArr,
      row.churnArr,
      row.endingArr,
    ]);
    downloadCsv(
      `tofu-monthly-bridge-${effectiveCombineMode}-${csvTimestamp()}.csv`,
      header,
      csvRows,
    );
  }

  function renderDrillCell(row: TofuMonthRow, metric: TofuDetailMetric, value: number) {
    return (
      <button
        type="button"
        className="stripe-ui__btn stripe-ui__btn--ghost"
        style={{ minHeight: 0, height: "auto", padding: 0, width: "100%", justifyContent: "flex-end" }}
        onClick={() => void openDetail(row.periodKey, metric)}
        disabled={detailLoading}
        title={`Show ${METRIC_LABELS[metric]} contributors for ${row.periodLabel}`}
      >
        {formatMoney(value, currency)}
      </button>
    );
  }

  function renderSegmentDrillCell(
    segment: TofuSegment,
    periodKey: string,
    periodLabel: string,
    metric: TofuDetailMetric,
    value: number,
  ) {
    return (
      <button
        type="button"
        className="stripe-ui__btn stripe-ui__btn--ghost"
        style={{ minHeight: 0, height: "auto", padding: 0, width: "100%", justifyContent: "flex-end" }}
        onClick={() => void openDetail(periodKey, metric, segment)}
        disabled={detailLoading}
        title={`Show ${METRIC_LABELS[metric]} contributors for ${SEGMENT_LABELS[segment]} in ${periodLabel}`}
      >
        {formatMoney(value, currency)}
      </button>
    );
  }

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Revenue intelligence</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">TOFU</h1>
            <p className="stripe-ui__subtitle">
              Monthly ARR bridge based on Combined All Subs. Choose Grouped mode to use contact-based matching, or
              Simple mode to use the non-grouped HubSpot+Stripe table. Group by Plan adds plan-level bridge lines,
              and Group by Segment splits into sales-led, self-serve, and sales assist.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Report controls</h2>
        <p className="stripe-ui__panel-subtitle">Select date range and mode, then run TOFU ARR breakdown.</p>
        <div className="stripe-ui__control-grid" style={{ gridTemplateColumns: "repeat(5, minmax(180px, 1fr))" }}>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="tofu-start-date">
              Start date
            </label>
            <input
              id="tofu-start-date"
              className="stripe-ui__control"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="tofu-end-date">
              End date
            </label>
            <input
              id="tofu-end-date"
              className="stripe-ui__control"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="tofu-combine-mode">
              Combine mode
            </label>
            <select
              id="tofu-combine-mode"
              className="stripe-ui__control"
              value={combineMode}
              onChange={(e) => setCombineMode(e.target.value as CombineMode)}
            >
              <option value="grouped">Grouped (contact matching)</option>
              <option value="simple">Simple (non-grouped append)</option>
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="tofu-run-btn">
              Run report
            </label>
            <button
              id="tofu-run-btn"
              className="stripe-ui__btn stripe-ui__btn--primary"
              onClick={() => void run()}
              disabled={loading}
            >
              {loading ? "Running..." : "Run"}
            </button>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="tofu-group-by">
              Group by
            </label>
            <select
              id="tofu-group-by"
              className="stripe-ui__control"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as TofuGroupBy)}
            >
              <option value="month">Month</option>
              <option value="plan">Plan</option>
              <option value="segment">Segment (sales-led / self-serve / sales assist)</option>
            </select>
          </div>
        </div>
      </section>

      {loading && (
        <section className="stripe-ui__panel stripe-ui__loading-panel ui-reveal ui-reveal-2" aria-live="polite" aria-busy="true">
          <h2 className="stripe-ui__panel-title">Loading report...</h2>
          <p className="stripe-ui__panel-subtitle">
            Computing {groupBy === "plan" ? "plan-level" : groupBy === "segment" ? "segment-level" : "monthly"} TOFU bridge from Combined All Subs.
          </p>
          <div className="stripe-ui__skeleton-grid">
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row stripe-ui__skeleton-row--short" />
          </div>
        </section>
      )}

      {error && (
        <div className="stripe-ui__error ui-reveal ui-reveal-1" role="alert" aria-live="assertive">
          <div>{error}</div>
          <div className="stripe-ui__error-actions">
            <button className="stripe-ui__btn stripe-ui__btn--secondary" onClick={() => void run()} disabled={loading}>
              Retry
            </button>
          </div>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <section className="stripe-ui__panel ui-reveal ui-reveal-2">
            <div className="stripe-ui__stats">
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">
                  {effectiveGroupBy === "plan" ? "Plan rows" : effectiveGroupBy === "segment" ? "Segment rows" : "Months"}
                </p>
                <p className="stripe-ui__stat-value">
                  {effectiveGroupBy === "plan" ? planRows.length : effectiveGroupBy === "segment" ? segmentRows.length : rows.length}
                </p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Mode</p>
                <p className="stripe-ui__stat-value">
                  {effectiveCombineMode === "grouped" ? "Grouped" : "Simple"} / {
                    effectiveGroupBy === "plan" ? "Plan" : effectiveGroupBy === "segment" ? "Segment" : "Month"
                  }
                </p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Total New ARR</p>
                <p className="stripe-ui__stat-value">
                  {formatMoney(
                    effectiveGroupBy === "plan"
                      ? sumPlanField(planRows, "newArr")
                      : effectiveGroupBy === "segment"
                        ? sumSegmentField(segmentRows, "newArr")
                        : sumField(rows, "newArr"),
                    currency,
                  )}
                </p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Total Churn ARR</p>
                <p className="stripe-ui__stat-value">
                  {formatMoney(
                    effectiveGroupBy === "plan"
                      ? sumPlanField(planRows, "churnArr")
                      : effectiveGroupBy === "segment"
                        ? sumSegmentField(segmentRows, "churnArr")
                        : sumField(rows, "churnArr"),
                    currency,
                  )}
                </p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Latest Ending ARR</p>
                <p className="stripe-ui__stat-value">{formatMoney(latestEndingArr, currency)}</p>
              </div>
            </div>
          </section>

          <section className="stripe-ui__panel ui-reveal ui-reveal-3">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <h2 className="stripe-ui__panel-title" style={{ marginBottom: 0 }}>
                {effectiveGroupBy === "plan"
                  ? "TOFU ARR bridge by plan"
                  : effectiveGroupBy === "segment"
                    ? "TOFU ARR bridge by segment"
                    : "Monthly TOFU ARR bridge"}
              </h2>
              <button
                type="button"
                className="stripe-ui__btn stripe-ui__btn--secondary"
                onClick={exportMainTableCsv}
                disabled={
                  effectiveGroupBy === "plan"
                    ? planTableRows.length === 0
                    : effectiveGroupBy === "segment"
                      ? segmentBridgeRows.length === 0
                      : rows.length === 0
                }
              >
                Export table CSV
              </button>
            </div>
            {effectiveGroupBy === "plan" ? (
              <p className="stripe-ui__panel-subtitle">
                Paid-plan view with Enterprise, Managed, Team, Plus, and Pay as you go. Each plan shows Beginning,
                New, Expansion, Contraction, Churn, and Ending ARR.
              </p>
            ) : effectiveGroupBy === "segment" ? (
              <p className="stripe-ui__panel-subtitle">
                Sales assist is monthly-evolving. When customers move between segments, ARR is removed from the
                previous segment as Churn and added to the new segment as Expansion.
              </p>
            ) : (
              <>
                <p className="stripe-ui__panel-subtitle">
                  Contraction and Churn are shown as negative ARR movement so each month follows:
                  Ending = Beginning + New + Expansion + Contraction + Churn.
                </p>
                <p className="stripe-ui__panel-subtitle" style={{ marginTop: "-0.2rem" }}>
                  Click any ARR value to see the customer rows used for that month/metric, including previous and current MRR.
                </p>
              </>
            )}

            {effectiveGroupBy === "plan" ? (
              <>
                <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem" }}>
                  <table className="stripe-ui__table" aria-label="TOFU ARR table by plan and month">
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th>Month</th>
                        <th className="stripe-ui__num">Beginning ARR</th>
                        <th className="stripe-ui__num">New ARR</th>
                        <th className="stripe-ui__num">Expansion ARR</th>
                        <th className="stripe-ui__num">Contraction ARR</th>
                        <th className="stripe-ui__num">Churn ARR</th>
                        <th className="stripe-ui__num">Ending ARR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planTableRows.map((row) => (
                        <tr key={`plan:${row.plan}:${row.periodKey}`}>
                          <td>{PLAN_LABELS[row.plan] || row.plan}</td>
                          <td>{row.periodLabel}</td>
                          <td className="stripe-ui__num">{formatMoney(Number(row.beginningArr || 0), currency)}</td>
                          <td className="stripe-ui__num">{formatMoney(Number(row.newArr || 0), currency)}</td>
                          <td className="stripe-ui__num">{formatMoney(Number(row.expansionArr || 0), currency)}</td>
                          <td className={`stripe-ui__num ${Number(row.contractionArr || 0) < 0 ? "stripe-ui__money--negative" : ""}`}>
                            {formatMoney(Number(row.contractionArr || 0), currency)}
                          </td>
                          <td className={`stripe-ui__num ${Number(row.churnArr || 0) < 0 ? "stripe-ui__money--negative" : ""}`}>
                            {formatMoney(Number(row.churnArr || 0), currency)}
                          </td>
                          <td className="stripe-ui__num">{formatMoney(Number(row.endingArr || 0), currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : effectiveGroupBy === "segment" ? (
              <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem" }}>
                <table className="stripe-ui__table" aria-label="TOFU ARR bridge by segment across months">
                  <thead>
                    <tr>
                      <th>Segment</th>
                      <th>Bridge Metric</th>
                      {segmentPeriodOrder.map((period) => (
                        <th key={`segment-bridge-head:${period.key}`} className="stripe-ui__num">
                          {period.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {segmentBridgeRows.map((row) => {
                      const metricIdx = SEGMENT_BRIDGE_METRICS.findIndex((metric) => metric.key === row.metricKey);
                      return (
                        <tr key={`segment-bridge:${row.segment}:${row.metricKey}`}>
                          {metricIdx === 0 ? (
                            <td rowSpan={SEGMENT_BRIDGE_METRICS.length}>{SEGMENT_LABELS[row.segment] || row.segment}</td>
                          ) : null}
                          <td>{row.metric}</td>
                          {segmentPeriodOrder.map((period) => (
                            <td
                              key={`segment-bridge:${row.segment}:${row.metricKey}:${period.key}`}
                              className={`stripe-ui__num ${
                                Number(row.valuesByPeriod[period.key] || 0) < 0 ? "stripe-ui__money--negative" : ""
                              }`}
                            >
                              {renderSegmentDrillCell(
                                row.segment,
                                period.key,
                                period.label,
                                row.metricKey as TofuDetailMetric,
                                Number(row.valuesByPeriod[period.key] || 0),
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem" }}>
                <table className="stripe-ui__table" aria-label="TOFU monthly ARR bridge table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="stripe-ui__num">Beginning ARR</th>
                      <th className="stripe-ui__num">New ARR</th>
                      <th className="stripe-ui__num">Expansion ARR</th>
                      <th className="stripe-ui__num">Contraction ARR</th>
                      <th className="stripe-ui__num">Churn ARR</th>
                      <th className="stripe-ui__num">Ending ARR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.periodKey}>
                        <td>{row.periodLabel}</td>
                        <td className="stripe-ui__num">{renderDrillCell(row, "beginningArr", row.beginningArr)}</td>
                        <td className="stripe-ui__num">{renderDrillCell(row, "newArr", row.newArr)}</td>
                        <td className="stripe-ui__num">{renderDrillCell(row, "expansionArr", row.expansionArr)}</td>
                        <td className={`stripe-ui__num ${row.contractionArr < 0 ? "stripe-ui__money--negative" : ""}`}>
                          {renderDrillCell(row, "contractionArr", row.contractionArr)}
                        </td>
                        <td className={`stripe-ui__num ${row.churnArr < 0 ? "stripe-ui__money--negative" : ""}`}>
                          {renderDrillCell(row, "churnArr", row.churnArr)}
                        </td>
                        <td className="stripe-ui__num">{renderDrillCell(row, "endingArr", row.endingArr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(effectiveGroupBy === "month" || effectiveGroupBy === "segment") && detailLoading && (
              <div style={{ marginTop: "0.8rem" }} className="stripe-ui__panel-subtitle">
                Loading detail rows...
              </div>
            )}

            {(effectiveGroupBy === "month" || effectiveGroupBy === "segment") && detailError && (
              <div className="stripe-ui__error" style={{ marginTop: "0.8rem" }} role="alert" aria-live="assertive">
                {detailError}
              </div>
            )}

            {(effectiveGroupBy === "month" || effectiveGroupBy === "segment") && detailData && !detailLoading && !detailError && (
              <div style={{ marginTop: "1rem" }}>
                <h3 className="stripe-ui__panel-title" style={{ fontSize: "1rem" }}>
                  {METRIC_LABELS[detailData.detailMetric]} detail - {detailData.detailPeriodLabel}
                  {detailData.detailGroupBy === "segment" && detailData.detailSegmentLabel
                    ? ` (${detailData.detailSegmentLabel})`
                    : ""}
                </h3>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.5rem" }}>
                  <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
                    {detailData.summary.rowCount} rows. Total {METRIC_LABELS[detailData.detailMetric]}:{" "}
                    {formatMoney(detailData.summary.totalArr, currency)} ({formatMoney(detailData.summary.totalMrr, currency)} MRR)
                  </p>
                  <button
                    type="button"
                    className="stripe-ui__btn stripe-ui__btn--secondary"
                    onClick={() => exportDetailCsv(detailData)}
                  >
                    Download detail CSV
                  </button>
                </div>
                <div className="stripe-ui__table-wrap">
                  <table className="stripe-ui__table" aria-label="TOFU metric detail table">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Source</th>
                        <th className="stripe-ui__num">
                          Previous MRR ({detailData.detailPreviousPeriodLabel || "N/A"})
                        </th>
                        <th className="stripe-ui__num">Current MRR ({detailData.detailPeriodLabel})</th>
                        <th className="stripe-ui__num">Delta MRR</th>
                        <th className="stripe-ui__num">Contribution MRR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailData.rows.map((row) => (
                        <tr key={`${detailData.detailMetric}:${detailData.detailPeriodKey}:${row.customerId}`}>
                          <td>{row.customerLabel}</td>
                          <td>{row.source === "hubspot_account" ? "HubSpot account" : "Stripe only"}</td>
                          <td className="stripe-ui__num">{formatMoney(row.previousMrr, currency)}</td>
                          <td className="stripe-ui__num">{formatMoney(row.currentMrr, currency)}</td>
                          <td className={`stripe-ui__num ${row.deltaMrr < 0 ? "stripe-ui__money--negative" : ""}`}>
                            {formatMoney(row.deltaMrr, currency)}
                          </td>
                          <td className={`stripe-ui__num ${row.contributionMrr < 0 ? "stripe-ui__money--negative" : ""}`}>
                            {formatMoney(row.contributionMrr, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
