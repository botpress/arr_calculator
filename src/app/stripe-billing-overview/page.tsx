"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadSvgAsPng } from "@/lib/chartDownload";
import DraftInvoiceAdminControls from "./DraftInvoiceAdminControls";

type Grain = "daily" | "weekly" | "monthly" | "quarterly";
type ChartGroupBy = "none" | "product_id" | "price_id" | "subscription_item_id" | "subscription_id" | "customer_id";

const CHART_GROUP_OPTIONS: Array<{ key: ChartGroupBy; label: string }> = [
  { key: "none", label: "Overall" },
  { key: "product_id", label: "Product ID" },
  { key: "price_id", label: "Price ID" },
  { key: "subscription_item_id", label: "Subscription Item ID" },
  { key: "subscription_id", label: "Subscription ID" },
  { key: "customer_id", label: "Customer ID" },
];

const GROUP_LINE_COLORS = [
  "#4f8df9",
  "#1fc16b",
  "#f59e0b",
  "#ef4444",
  "#14b8a6",
  "#a78bfa",
  "#f97316",
  "#22c55e",
];

type OverviewPoint = {
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  mrrEnd: number;
  newMrr: number;
  reactivationMrr?: number;
  expansionMrr: number;
  contractionMrr: number;
  churnMrr: number;
  netMrrChange: number;
  mrrGrowthRatePct: number;
  arr: number;
  arrGrowth: number;
};

type OverviewCustomerArrRow = {
  customerId: string;
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  arr: number;
};

type OverviewGroupedSeries = {
  groupKey: string;
  groupLabel: string;
  historyPoints?: OverviewPoint[];
  points: OverviewPoint[];
};

type OverviewCurrentMonthProjectionPoint = {
  date: string;
  label: string;
  dayOfMonth: number;
  mrrActual: number | null;
  mrrProjected: number;
};

type OverviewCurrentMonthProjection = {
  monthStart: string;
  monthEnd: string;
  observedThrough: string;
  historicalMonthsUsed: number;
  projectedEndMrr: number;
  model: "shape";
  points: OverviewCurrentMonthProjectionPoint[];
};

type OverviewResponse = {
  startDate: string;
  endDate: string;
  grain: Grain;
  groupBy?: ChartGroupBy;
  targetCurrency: string;
  currentMrr: number;
  currentArr: number;
  historyPoints?: OverviewPoint[];
  points: OverviewPoint[];
  stripeExactHistoryPoints?: OverviewPoint[];
  stripeExactPoints?: OverviewPoint[];
  groupedSeries?: OverviewGroupedSeries[];
  customerArrRows?: OverviewCustomerArrRow[];
  currentMonthProjection?: OverviewCurrentMonthProjection | null;
};

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end.getFullYear() - 1, end.getMonth(), 1);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
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

function formatPercent(value: number) {
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0)}%`;
}

function tickIndices(size: number) {
  if (size <= 1) return [0];
  if (size <= 4) return Array.from({ length: size }, (_, i) => i);
  const out = new Set<number>([0, Math.floor((size - 1) / 2), size - 1]);
  return Array.from(out).sort((a, b) => a - b);
}

type GrowthWindowOption = {
  value: string;
  label: string;
  lookbackPeriods: number;
  subtitle: string;
};

function growthWindowOptionsForGrain(grain: Grain): GrowthWindowOption[] {
  if (grain === "daily") {
    return [
      {
        value: "daily",
        label: "Day over day (1 day)",
        lookbackPeriods: 1,
        subtitle: "Percent change in MRR versus 1 day earlier.",
      },
      {
        value: "monthly",
        label: "Trailing 30-day",
        lookbackPeriods: 30,
        subtitle: "Percent change in MRR versus 30 days earlier (trailing 30-day growth).",
      },
      {
        value: "quarterly",
        label: "Trailing 90-day",
        lookbackPeriods: 90,
        subtitle: "Percent change in MRR versus 90 days earlier (trailing quarter growth).",
      },
    ];
  }

  if (grain === "weekly") {
    return [
      {
        value: "weekly",
        label: "Week over week (1 week)",
        lookbackPeriods: 1,
        subtitle: "Percent change in MRR versus 1 week earlier.",
      },
      {
        value: "monthly",
        label: "Approx. month over month (4 weeks)",
        lookbackPeriods: 4,
        subtitle: "Percent change in MRR versus 4 weeks earlier.",
      },
      {
        value: "quarterly",
        label: "Approx. quarter over quarter (13 weeks)",
        lookbackPeriods: 13,
        subtitle: "Percent change in MRR versus 13 weeks earlier.",
      },
    ];
  }

  if (grain === "monthly") {
    return [
      {
        value: "monthly",
        label: "Month over month (1 month)",
        lookbackPeriods: 1,
        subtitle: "Percent change in MRR versus 1 month earlier.",
      },
      {
        value: "quarterly",
        label: "Quarter over quarter (3 months)",
        lookbackPeriods: 3,
        subtitle: "Percent change in MRR versus 3 months earlier.",
      },
    ];
  }

  return [
    {
      value: "quarterly",
      label: "Quarter over quarter (1 quarter)",
      lookbackPeriods: 1,
      subtitle: "Percent change in MRR versus 1 quarter earlier.",
    },
  ];
}

function defaultGrowthWindowValue(grain: Grain) {
  return growthWindowOptionsForGrain(grain)[0]?.value || "monthly";
}

function computeMrrGrowthRates(points: OverviewPoint[], lookbackPeriods: number) {
  if (lookbackPeriods <= 0) return points.map(() => 0);
  return points.map((point, idx) => {
    const previous = points[idx - lookbackPeriods];
    if (!previous) return 0;
    if (Math.abs(previous.mrrEnd) < 1e-9) return 0;
    const pct = ((point.mrrEnd - previous.mrrEnd) / Math.abs(previous.mrrEnd)) * 100;
    return Math.round(pct * 100) / 100;
  });
}

function aggregateOverviewPointsByPeriod(
  templatePoints: OverviewPoint[],
  seriesList: Array<{ points: OverviewPoint[] }>,
) {
  if (!templatePoints.length || !seriesList.length) return templatePoints;

  const pointMaps = seriesList.map((series) => {
    const byKey = new Map<string, OverviewPoint>();
    for (const point of series.points || []) {
      byKey.set(point.key, point);
    }
    return byKey;
  });

  return templatePoints.map((template) => {
    let mrrEnd = 0;
    let newMrr = 0;
    let reactivationMrr = 0;
    let expansionMrr = 0;
    let contractionMrr = 0;
    let churnMrr = 0;
    let netMrrChange = 0;
    let mrrGrowthRatePct = 0;
    let arr = 0;
    let arrGrowth = 0;

    for (const pointMap of pointMaps) {
      const point = pointMap.get(template.key);
      if (!point) continue;
      mrrEnd += point.mrrEnd || 0;
      newMrr += point.newMrr || 0;
      reactivationMrr += point.reactivationMrr || 0;
      expansionMrr += point.expansionMrr || 0;
      contractionMrr += point.contractionMrr || 0;
      churnMrr += point.churnMrr || 0;
      netMrrChange += point.netMrrChange || 0;
      mrrGrowthRatePct += point.mrrGrowthRatePct || 0;
      arr += point.arr || 0;
      arrGrowth += point.arrGrowth || 0;
    }

    return {
      ...template,
      mrrEnd: Math.round(mrrEnd * 100) / 100,
      newMrr: Math.round(newMrr * 100) / 100,
      reactivationMrr: Math.round(reactivationMrr * 100) / 100,
      expansionMrr: Math.round(expansionMrr * 100) / 100,
      contractionMrr: Math.round(contractionMrr * 100) / 100,
      churnMrr: Math.round(churnMrr * 100) / 100,
      netMrrChange: Math.round(netMrrChange * 100) / 100,
      mrrGrowthRatePct: Math.round(mrrGrowthRatePct * 100) / 100,
      arr: Math.round(arr * 100) / 100,
      arrGrowth: Math.round(arrGrowth * 100) / 100,
    };
  });
}

type LineChartProps = {
  title: string;
  subtitle: string;
  points: OverviewPoint[];
  valueAccessor: (point: OverviewPoint) => number;
  valueFormatter: (value: number) => string;
  stroke: string;
  includeZero?: boolean;
  headerControl?: React.ReactNode;
};

function LineChartCard({
  title,
  subtitle,
  points,
  valueAccessor,
  valueFormatter,
  stroke,
  includeZero = false,
  headerControl,
}: LineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [downloading, setDownloading] = useState(false);

  const width = 640;
  const height = 250;
  const paddingLeft = 54;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 42;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const values = points.map((p) => valueAccessor(p));
  const minRaw = values.length ? Math.min(...values) : 0;
  const maxRaw = values.length ? Math.max(...values) : 1;
  let minValue = includeZero ? Math.min(minRaw, 0) : minRaw;
  let maxValue = includeZero ? Math.max(maxRaw, 0) : maxRaw;
  if (Math.abs(maxValue - minValue) < 1e-9) {
    minValue -= 1;
    maxValue += 1;
  }

  const xAt = (idx: number) => {
    if (points.length <= 1) return paddingLeft + plotWidth / 2;
    return paddingLeft + (idx / (points.length - 1)) * plotWidth;
  };
  const yAt = (value: number) => paddingTop + ((maxValue - value) / (maxValue - minValue)) * plotHeight;

  const pathD = points
    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${xAt(idx)} ${yAt(valueAccessor(p))}`)
    .join(" ");

  const hoveredPoint =
    hoverIndex != null && hoverIndex >= 0 && hoverIndex < points.length ? points[hoverIndex] : null;
  const hoveredValue = hoveredPoint ? valueAccessor(hoveredPoint) : 0;
  const hoveredX = hoveredPoint && hoverIndex != null ? xAt(hoverIndex) : 0;
  const hoveredY = hoveredPoint ? yAt(hoveredValue) : 0;

  const tooltipWidth = 210;
  const tooltipHeight = 42;
  const tooltipX = Math.max(
    paddingLeft,
    Math.min(paddingLeft + plotWidth - tooltipWidth, hoveredX - tooltipWidth / 2),
  );
  const tooltipY = Math.max(paddingTop + 4, hoveredY - tooltipHeight - 10);
  const downloadChart = useCallback(async () => {
    if (!chartRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadSvgAsPng(chartRef.current, `stripe-billing-overview-${title}`);
    } finally {
      setDownloading(false);
    }
  }, [downloading, title]);

  return (
    <section className="stripe-ui__panel ui-reveal ui-reveal-2">
      <div className="stripe-ui__section-head">
        <div>
          <h2 className="stripe-ui__panel-title">{title}</h2>
          <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
            {subtitle}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => void downloadChart()} disabled={downloading}>
            {downloading ? "Downloading..." : "Download SVG"}
          </button>
          {headerControl}
          <div className="stripe-ui__hint" aria-live="polite">
            {hoveredPoint
              ? `${hoveredPoint.label}: ${valueFormatter(hoveredValue)}`
              : "Hover on chart for values"}
          </div>
        </div>
      </div>

      {points.length === 0 ? (
        <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.7rem", marginBottom: 0 }}>
          No data for selected range.
        </p>
      ) : (
        <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem" }}>
          <svg
            ref={chartRef}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={title}
            style={{ width: "100%", display: "block" }}
            onMouseLeave={() => setHoverIndex(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = ((e.clientX - rect.left) / rect.width) * width;
              const clamped = Math.max(paddingLeft, Math.min(paddingLeft + plotWidth, relX));
              const ratio = points.length > 1 ? (clamped - paddingLeft) / plotWidth : 0;
              const idx = Math.max(0, Math.min(points.length - 1, Math.round(ratio * Math.max(points.length - 1, 0))));
              setHoverIndex(idx);
            }}
          >
            <line
              x1={paddingLeft}
              y1={paddingTop + plotHeight}
              x2={paddingLeft + plotWidth}
              y2={paddingTop + plotHeight}
              stroke="#36557f"
              strokeWidth={1}
            />
            <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={paddingTop + plotHeight} stroke="#36557f" strokeWidth={1} />

            {points.map((point, idx) => {
              const left = idx === 0 ? paddingLeft : (xAt(idx - 1) + xAt(idx)) / 2;
              const right =
                idx === points.length - 1 ? paddingLeft + plotWidth : (xAt(idx) + xAt(idx + 1)) / 2;
              return (
                <rect
                  key={`hover-${point.key}`}
                  x={left}
                  y={paddingTop}
                  width={Math.max(1, right - left)}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={() => setHoverIndex(idx)}
                />
              );
            })}

            <path d={pathD} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

            {hoverIndex != null && points[hoverIndex] && (
              <line
                x1={xAt(hoverIndex)}
                y1={paddingTop}
                x2={xAt(hoverIndex)}
                y2={paddingTop + plotHeight}
                stroke="#89a9d4"
                strokeOpacity={0.5}
                strokeDasharray="4 4"
              />
            )}

            {hoveredPoint && (
              <g>
                <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx={6} fill="#0e203b" opacity={0.97} />
                <text x={tooltipX + 10} y={tooltipY + 16} fill="#d9e6fa" fontSize="11.5">
                  {hoveredPoint.label}
                </text>
                <text x={tooltipX + 10} y={tooltipY + 32} fill={stroke} fontSize="12.5" fontWeight="600">
                  {valueFormatter(hoveredValue)}
                </text>
              </g>
            )}

            {points.map((point, idx) => (
              <circle
                key={point.key}
                cx={xAt(idx)}
                cy={yAt(valueAccessor(point))}
                r={hoverIndex === idx ? 4.6 : 3.2}
                fill={stroke}
                data-tooltip={`${point.label}: ${valueFormatter(valueAccessor(point))}`}
                onMouseEnter={() => setHoverIndex(idx)}
              />
            ))}

            {tickIndices(points.length).map((idx) => (
              <text
                key={`tick-${idx}`}
                x={xAt(idx)}
                y={height - 12}
                textAnchor={idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle"}
                fill="#b7c9e6"
                fontSize="12"
              >
                {points[idx]?.label || ""}
              </text>
            ))}

            <text x={paddingLeft - 8} y={paddingTop + 10} textAnchor="end" fill="#8ea7cb" fontSize="12">
              {valueFormatter(maxValue)}
            </text>
            <text x={paddingLeft - 8} y={paddingTop + plotHeight} textAnchor="end" fill="#8ea7cb" fontSize="12">
              {valueFormatter(minValue)}
            </text>
          </svg>
        </div>
      )}
    </section>
  );
}

type OverviewGroupSeriesForChart = {
  key: string;
  label: string;
  points: OverviewPoint[];
  color: string;
};

type MultiLineChartProps = {
  title: string;
  subtitle: string;
  periods: Array<{ key: string; label: string }>;
  series: OverviewGroupSeriesForChart[];
  valueAccessor: (point: OverviewPoint) => number;
  valueFormatter: (value: number) => string;
  includeZero?: boolean;
  headerControl?: React.ReactNode;
};

function MultiLineChartCard({
  title,
  subtitle,
  periods,
  series,
  valueAccessor,
  valueFormatter,
  includeZero = false,
  headerControl,
}: MultiLineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [downloading, setDownloading] = useState(false);

  const width = 640;
  const height = 250;
  const paddingLeft = 116;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 42;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const values = series.flatMap((group) => group.points.map((point) => valueAccessor(point)));
  const minRaw = values.length ? Math.min(...values) : 0;
  const maxRaw = values.length ? Math.max(...values) : 1;
  let minValue = includeZero ? Math.min(minRaw, 0) : minRaw;
  let maxValue = includeZero ? Math.max(maxRaw, 0) : maxRaw;
  if (Math.abs(maxValue - minValue) < 1e-9) {
    minValue -= 1;
    maxValue += 1;
  }

  const xAt = (idx: number) => {
    if (periods.length <= 1) return paddingLeft + plotWidth / 2;
    return paddingLeft + (idx / (periods.length - 1)) * plotWidth;
  };
  const yAt = (value: number) => paddingTop + ((maxValue - value) / (maxValue - minValue)) * plotHeight;

  const hoveredPeriod = hoverIndex != null && hoverIndex >= 0 && hoverIndex < periods.length ? periods[hoverIndex] : null;
  const downloadChart = useCallback(async () => {
    if (!chartRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadSvgAsPng(chartRef.current, `stripe-billing-overview-${title}`);
    } finally {
      setDownloading(false);
    }
  }, [downloading, title]);

  return (
    <section className="stripe-ui__panel ui-reveal ui-reveal-2">
      <div className="stripe-ui__section-head">
        <div>
          <h2 className="stripe-ui__panel-title">{title}</h2>
          <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
            {subtitle}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => void downloadChart()} disabled={downloading}>
            {downloading ? "Downloading..." : "Download SVG"}
          </button>
          {headerControl}
          <div className="stripe-ui__hint" aria-live="polite">
            {hoveredPeriod ? hoveredPeriod.label : "Hover on chart for values"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.7rem" }}>
        {series.map((group) => (
          <span key={`legend-${group.key}`} className="stripe-ui__hint" style={{ color: group.color }}>
            {group.label}
          </span>
        ))}
      </div>

      {periods.length === 0 || series.length === 0 ? (
        <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.7rem", marginBottom: 0 }}>
          No data for selected range.
        </p>
      ) : (
        <>
          <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem" }}>
            <svg
              ref={chartRef}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={title}
              style={{ width: "100%", display: "block" }}
              onMouseLeave={() => setHoverIndex(null)}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const relX = ((e.clientX - rect.left) / rect.width) * width;
                const clamped = Math.max(paddingLeft, Math.min(paddingLeft + plotWidth, relX));
                const ratio = periods.length > 1 ? (clamped - paddingLeft) / plotWidth : 0;
                const idx = Math.max(0, Math.min(periods.length - 1, Math.round(ratio * Math.max(periods.length - 1, 0))));
                setHoverIndex(idx);
              }}
            >
              <line
                x1={paddingLeft}
                y1={paddingTop + plotHeight}
                x2={paddingLeft + plotWidth}
                y2={paddingTop + plotHeight}
                stroke="#36557f"
                strokeWidth={1}
              />
              <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={paddingTop + plotHeight} stroke="#36557f" strokeWidth={1} />

              {periods.map((period, idx) => {
                const left = idx === 0 ? paddingLeft : (xAt(idx - 1) + xAt(idx)) / 2;
                const right = idx === periods.length - 1 ? paddingLeft + plotWidth : (xAt(idx) + xAt(idx + 1)) / 2;
                return (
                  <rect
                    key={`hover-${period.key}`}
                    x={left}
                    y={paddingTop}
                    width={Math.max(1, right - left)}
                    height={plotHeight}
                    fill="transparent"
                    onMouseEnter={() => setHoverIndex(idx)}
                  />
                );
              })}

              {series.map((group) => {
                const pathD = group.points
                  .map((point, idx) => `${idx === 0 ? "M" : "L"} ${xAt(idx)} ${yAt(valueAccessor(point))}`)
                  .join(" ");
                return (
                  <path
                    key={`path-${group.key}`}
                    d={pathD}
                    fill="none"
                    stroke={group.color}
                    strokeWidth={2.3}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                );
              })}

              {hoverIndex != null && periods[hoverIndex] && (
                <line
                  x1={xAt(hoverIndex)}
                  y1={paddingTop}
                  x2={xAt(hoverIndex)}
                  y2={paddingTop + plotHeight}
                  stroke="#89a9d4"
                  strokeOpacity={0.5}
                  strokeDasharray="4 4"
                />
              )}

              {series.map((group) =>
                group.points.map((point, idx) => (
                  <circle
                    key={`${group.key}:${point.key}`}
                    cx={xAt(idx)}
                    cy={yAt(valueAccessor(point))}
                    r={hoverIndex === idx ? 3.8 : 2.6}
                    fill={group.color}
                    data-tooltip={`${periods[idx]?.label || point.label}: ${group.label}: ${valueFormatter(valueAccessor(point))}`}
                    onMouseEnter={() => setHoverIndex(idx)}
                  />
                )),
              )}

              {tickIndices(periods.length).map((idx) => (
                <text
                  key={`tick-${idx}`}
                  x={xAt(idx)}
                  y={height - 12}
                  textAnchor={idx === 0 ? "start" : idx === periods.length - 1 ? "end" : "middle"}
                  fill="#b7c9e6"
                  fontSize="12"
                >
                  {periods[idx]?.label || ""}
                </text>
              ))}

              <text x={paddingLeft - 8} y={paddingTop + 10} textAnchor="end" fill="#8ea7cb" fontSize="12">
                {valueFormatter(maxValue)}
              </text>
              <text x={paddingLeft - 8} y={paddingTop + plotHeight} textAnchor="end" fill="#8ea7cb" fontSize="12">
                {valueFormatter(minValue)}
              </text>
            </svg>
          </div>

          {hoveredPeriod && hoverIndex != null && (
            <div className="stripe-ui__panel" style={{ marginTop: "0.8rem", padding: "0.75rem" }}>
              <div className="stripe-ui__hint" style={{ marginBottom: "0.35rem" }}>
                {hoveredPeriod.label}
              </div>
              {series.map((group) => {
                const point = group.points[hoverIndex];
                const value = point ? valueAccessor(point) : 0;
                return (
                  <div key={`hover-value-${group.key}`} className="stripe-ui__hint" style={{ color: group.color }}>
                    {group.label}: {valueFormatter(value)}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

type GrowthBreakdownChartProps = {
  points: OverviewPoint[];
  currency: string;
  title?: string;
  subtitle?: string;
  includeReactivation?: boolean;
};

function GrowthBreakdownChart({
  points,
  currency,
  title = "Growth Breakdown",
  subtitle = "Stacked contributions for New, Expansion, Contraction, and Churn by period.",
  includeReactivation = false,
}: GrowthBreakdownChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [downloading, setDownloading] = useState(false);

  const width = 640;
  const height = 280;
  const paddingLeft = 54;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 44;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const componentDefs = [
    { key: "new", label: "New", color: "#1fc16b", valueAccessor: (point: OverviewPoint) => point.newMrr },
    ...(includeReactivation
      ? [
          {
            key: "reactivation",
            label: "Reactivation",
            color: "#22d3ee",
            valueAccessor: (point: OverviewPoint) => point.reactivationMrr || 0,
          },
        ]
      : []),
    { key: "expansion", label: "Expansion", color: "#2698f0", valueAccessor: (point: OverviewPoint) => point.expansionMrr },
    { key: "contraction", label: "Contraction", color: "#f59e0b", valueAccessor: (point: OverviewPoint) => point.contractionMrr },
    { key: "churn", label: "Churn", color: "#ef4444", valueAccessor: (point: OverviewPoint) => point.churnMrr },
  ];

  const bars = points.map((point) => {
    const components = componentDefs.map((component) => ({
      key: component.key,
      label: component.label,
      value: component.valueAccessor(point),
      color: component.color,
    }));

    const positiveTotal = components.reduce((sum, component) => sum + Math.max(component.value, 0), 0);
    const negativeTotal = components.reduce((sum, component) => sum + Math.min(component.value, 0), 0);

    return {
      point,
      components,
      positiveTotal,
      negativeTotal,
    };
  });

  const maxPositive = bars.length ? Math.max(...bars.map((b) => b.positiveTotal), 0) : 0;
  const minNegative = bars.length ? Math.min(...bars.map((b) => b.negativeTotal), 0) : 0;
  let minValue = minNegative;
  let maxValue = maxPositive;
  if (Math.abs(maxValue - minValue) < 1e-9) {
    minValue -= 1;
    maxValue += 1;
  }

  const xAt = (idx: number) => {
    if (points.length <= 1) return paddingLeft + plotWidth / 2;
    return paddingLeft + (idx / (points.length - 1)) * plotWidth;
  };
  const yAt = (value: number) => paddingTop + ((maxValue - value) / (maxValue - minValue)) * plotHeight;
  const zeroY = yAt(0);

  const barWidth = points.length > 0 ? Math.max(8, Math.min(28, (plotWidth / Math.max(points.length, 1)) * 0.62)) : 14;
  const hovered = hoverIndex != null && hoverIndex >= 0 && hoverIndex < bars.length ? bars[hoverIndex] : null;
  const downloadChart = useCallback(async () => {
    if (!chartRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadSvgAsPng(chartRef.current, `stripe-billing-overview-${title}`);
    } finally {
      setDownloading(false);
    }
  }, [downloading, title]);

  return (
    <section className="stripe-ui__panel ui-reveal ui-reveal-2">
      <div className="stripe-ui__section-head">
        <div>
          <h2 className="stripe-ui__panel-title">{title}</h2>
          <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
            {subtitle}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => void downloadChart()} disabled={downloading}>
            {downloading ? "Downloading..." : "Download SVG"}
          </button>
          <div className="stripe-ui__hint" aria-live="polite">
            {hovered
              ? `${hovered.point.label}: Net ${formatMoney(hovered.point.netMrrChange, currency)}`
              : "Hover on bars for values"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "0.7rem" }}>
        {componentDefs.map((component) => (
          <span key={component.key} className="stripe-ui__hint" style={{ color: component.color }}>
            {component.label}
          </span>
        ))}
      </div>

      {points.length === 0 ? (
        <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.9rem", marginBottom: 0 }}>
          No data for selected range.
        </p>
      ) : (
        <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem" }}>
          <svg
            ref={chartRef}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Growth breakdown chart"
            style={{ width: "100%", display: "block" }}
            onMouseLeave={() => setHoverIndex(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = ((e.clientX - rect.left) / rect.width) * width;
              const clamped = Math.max(paddingLeft, Math.min(paddingLeft + plotWidth, relX));
              const ratio = points.length > 1 ? (clamped - paddingLeft) / plotWidth : 0;
              const idx = Math.max(0, Math.min(points.length - 1, Math.round(ratio * Math.max(points.length - 1, 0))));
              setHoverIndex(idx);
            }}
          >
            <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={paddingTop + plotHeight} stroke="#36557f" strokeWidth={1} />
            <line x1={paddingLeft} y1={zeroY} x2={paddingLeft + plotWidth} y2={zeroY} stroke="#5073a3" strokeWidth={1.2} />

            {bars.map((bar, idx) => {
              const left = idx === 0 ? paddingLeft : (xAt(idx - 1) + xAt(idx)) / 2;
              const right = idx === bars.length - 1 ? paddingLeft + plotWidth : (xAt(idx) + xAt(idx + 1)) / 2;
              return (
                <rect
                  key={`hover-zone-${bar.point.key}`}
                  x={left}
                  y={paddingTop}
                  width={Math.max(1, right - left)}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={() => setHoverIndex(idx)}
                />
              );
            })}

            {bars.map((bar, idx) => {
              const centerX = xAt(idx);
              let positiveCursor = 0;
              let negativeCursor = 0;

              return (
                <g key={bar.point.key}>
                  {bar.components.map((component) => {
                    const value = component.value;
                    if (Math.abs(value) < 1e-9) return null;

                    if (value >= 0) {
                      const yTop = yAt(positiveCursor + value);
                      const yBottom = yAt(positiveCursor);
                      const h = Math.max(1.2, yBottom - yTop);
                      positiveCursor += value;
                      return (
                        <rect
                          key={`${bar.point.key}-${component.key}`}
                          x={centerX - barWidth / 2}
                          y={yTop}
                          width={barWidth}
                          height={h}
                          fill={component.color}
                          rx={1.2}
                          data-tooltip={`${bar.point.label}: ${component.label}: ${formatMoney(value, currency)}`}
                          onMouseEnter={() => setHoverIndex(idx)}
                        />
                      );
                    }

                    const yTop = yAt(negativeCursor);
                    const yBottom = yAt(negativeCursor + value);
                    const h = Math.max(1.2, yBottom - yTop);
                    negativeCursor += value;
                    return (
                      <rect
                        key={`${bar.point.key}-${component.key}`}
                        x={centerX - barWidth / 2}
                        y={yTop}
                        width={barWidth}
                        height={h}
                        fill={component.color}
                        rx={1.2}
                        data-tooltip={`${bar.point.label}: ${component.label}: ${formatMoney(value, currency)}`}
                        onMouseEnter={() => setHoverIndex(idx)}
                      />
                    );
                  })}
                </g>
              );
            })}

            {tickIndices(points.length).map((idx) => (
              <text
                key={`tick-${idx}`}
                x={xAt(idx)}
                y={height - 12}
                textAnchor={idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle"}
                fill="#b7c9e6"
                fontSize="12"
              >
                {points[idx]?.label || ""}
              </text>
            ))}

            <text x={paddingLeft - 8} y={paddingTop + 10} textAnchor="end" fill="#8ea7cb" fontSize="12">
              {formatMoney(maxValue, currency)}
            </text>
            <text x={paddingLeft - 8} y={paddingTop + plotHeight} textAnchor="end" fill="#8ea7cb" fontSize="12">
              {formatMoney(minValue, currency)}
            </text>
          </svg>

          {hovered && (
            <div className="stripe-ui__panel" style={{ marginTop: "0.8rem", padding: "0.75rem" }}>
              <div className="stripe-ui__hint" style={{ marginBottom: "0.35rem" }}>
                {hovered.point.label}
              </div>
              <div className="stripe-ui__hint">New: {formatMoney(hovered.point.newMrr, currency)}</div>
              {includeReactivation && (
                <div className="stripe-ui__hint">Reactivation: {formatMoney(hovered.point.reactivationMrr || 0, currency)}</div>
              )}
              <div className="stripe-ui__hint">Expansion: {formatMoney(hovered.point.expansionMrr, currency)}</div>
              <div className="stripe-ui__hint">Contraction: {formatMoney(hovered.point.contractionMrr, currency)}</div>
              <div className="stripe-ui__hint">Churn: {formatMoney(hovered.point.churnMrr, currency)}</div>
              <div className="stripe-ui__hint">Net: {formatMoney(hovered.point.netMrrChange, currency)}</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type DeltaBarChartProps = {
  title: string;
  subtitle: string;
  points: OverviewPoint[];
  valueAccessor: (point: OverviewPoint) => number;
  valueFormatter: (value: number) => string;
};

function DeltaBarChartCard({ title, subtitle, points, valueAccessor, valueFormatter }: DeltaBarChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [downloading, setDownloading] = useState(false);

  const width = 640;
  const height = 280;
  const paddingLeft = 54;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 44;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const values = points.map(valueAccessor);
  const maxPositive = values.length ? Math.max(0, ...values) : 0;
  const minNegative = values.length ? Math.min(0, ...values) : 0;
  let minValue = minNegative;
  let maxValue = maxPositive;
  if (Math.abs(maxValue - minValue) < 1e-9) {
    minValue -= 1;
    maxValue += 1;
  }

  const xAt = (idx: number) => {
    if (points.length <= 1) return paddingLeft + plotWidth / 2;
    return paddingLeft + (idx / (points.length - 1)) * plotWidth;
  };
  const yAt = (value: number) => paddingTop + ((maxValue - value) / (maxValue - minValue)) * plotHeight;
  const zeroY = yAt(0);

  const barWidth = points.length > 0 ? Math.max(8, Math.min(28, (plotWidth / Math.max(points.length, 1)) * 0.62)) : 14;
  const hovered =
    hoverIndex != null && hoverIndex >= 0 && hoverIndex < points.length
      ? points[hoverIndex]
      : null;
  const downloadChart = useCallback(async () => {
    if (!chartRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadSvgAsPng(chartRef.current, `stripe-billing-overview-${title}`);
    } finally {
      setDownloading(false);
    }
  }, [downloading, title]);

  return (
    <section className="stripe-ui__panel ui-reveal ui-reveal-2">
      <div className="stripe-ui__section-head">
        <div>
          <h2 className="stripe-ui__panel-title">{title}</h2>
          <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
            {subtitle}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => void downloadChart()} disabled={downloading}>
            {downloading ? "Downloading..." : "Download SVG"}
          </button>
          <div className="stripe-ui__hint" aria-live="polite">
            {hovered
              ? `${hovered.label}: ${valueFormatter(valueAccessor(hovered))}`
              : "Hover on bars for values"}
          </div>
        </div>
      </div>

      {points.length === 0 ? (
        <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.9rem", marginBottom: 0 }}>
          No data for selected range.
        </p>
      ) : (
        <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem" }}>
          <svg
            ref={chartRef}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={title}
            style={{ width: "100%", display: "block" }}
            onMouseLeave={() => setHoverIndex(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = ((e.clientX - rect.left) / rect.width) * width;
              const clamped = Math.max(paddingLeft, Math.min(paddingLeft + plotWidth, relX));
              const ratio = points.length > 1 ? (clamped - paddingLeft) / plotWidth : 0;
              const idx = Math.max(0, Math.min(points.length - 1, Math.round(ratio * Math.max(points.length - 1, 0))));
              setHoverIndex(idx);
            }}
          >
            <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={paddingTop + plotHeight} stroke="#36557f" strokeWidth={1} />
            <line x1={paddingLeft} y1={zeroY} x2={paddingLeft + plotWidth} y2={zeroY} stroke="#5073a3" strokeWidth={1.2} />

            {points.map((point, idx) => {
              const left = idx === 0 ? paddingLeft : (xAt(idx - 1) + xAt(idx)) / 2;
              const right = idx === points.length - 1 ? paddingLeft + plotWidth : (xAt(idx) + xAt(idx + 1)) / 2;
              const value = valueAccessor(point);
              const yVal = yAt(value);
              const y0 = yAt(0);
              const y = Math.min(yVal, y0);
              const h = Math.max(1.2, Math.abs(yVal - y0));
              const fill = value >= 0 ? "#1fc16b" : "#ef4444";
              return (
                <g key={point.key}>
                  <rect
                    x={left}
                    y={paddingTop}
                    width={Math.max(1, right - left)}
                    height={plotHeight}
                    fill="transparent"
                    onMouseEnter={() => setHoverIndex(idx)}
                  />
                  <rect
                    x={xAt(idx) - barWidth / 2}
                    y={y}
                    width={barWidth}
                    height={h}
                    fill={fill}
                    rx={1.2}
                    data-tooltip={`${point.label}: ${valueFormatter(value)}`}
                    onMouseEnter={() => setHoverIndex(idx)}
                  />
                </g>
              );
            })}

            {tickIndices(points.length).map((idx) => (
              <text
                key={`tick-${idx}`}
                x={xAt(idx)}
                y={height - 12}
                textAnchor={idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle"}
                fill="#b7c9e6"
                fontSize="12"
              >
                {points[idx]?.label || ""}
              </text>
            ))}

            <text x={paddingLeft - 8} y={paddingTop + 10} textAnchor="end" fill="#8ea7cb" fontSize="12">
              {valueFormatter(maxValue)}
            </text>
            <text x={paddingLeft - 8} y={paddingTop + plotHeight} textAnchor="end" fill="#8ea7cb" fontSize="12">
              {valueFormatter(minValue)}
            </text>
          </svg>
        </div>
      )}
    </section>
  );
}

export default function StripeBillingOverviewPage() {
  const customerPageSize = 100;
  const defaults = useMemo(() => defaultDateRange(), []);

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [grain, setGrain] = useState<Grain>("monthly");
  const [chartGroupBy, setChartGroupBy] = useState<ChartGroupBy>("none");
  const [selectedBarGroupKeys, setSelectedBarGroupKeys] = useState<string[]>([]);
  const [mrrGrowthWindow, setMrrGrowthWindow] = useState<string>(defaultGrowthWindowValue("monthly"));

  const [loading, setLoading] = useState(false);
  const [deferredSectionsLoading, setDeferredSectionsLoading] = useState(false);
  const [hasRunOnce, setHasRunOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [customerPage, setCustomerPage] = useState(1);
  const runRequestRef = useRef(0);

  async function run() {
    const requestId = runRequestRef.current + 1;
    runRequestRef.current = requestId;
    const isStale = () => runRequestRef.current !== requestId;

    setHasRunOnce(true);
    setLoading(true);
    setDeferredSectionsLoading(false);
    setError(null);
    setCustomerPage(1);

    try {
      const fetchJson = async (payload: {
        startDate: string;
        endDate: string;
        grain: Grain;
        groupBy: ChartGroupBy;
        includeCustomerArrRows: boolean;
        includeCurrentMonthProjection: boolean;
      }) => {
        const res = await fetch("/api/stripe-billing-overview-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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
        return json as OverviewResponse;
      };

      const basePromise = fetchJson({
        startDate,
        endDate,
        grain,
        groupBy: chartGroupBy,
        includeCustomerArrRows: false,
        includeCurrentMonthProjection: false,
      });
      const deferredPromise = fetchJson({
        startDate,
        endDate,
        grain,
        groupBy: chartGroupBy,
        includeCustomerArrRows: true,
        includeCurrentMonthProjection: true,
      }).catch(() => null as OverviewResponse | null);

      const baseData = await basePromise;
      if (isStale()) return;
      setData(baseData);
      setLoading(false);
      setDeferredSectionsLoading(true);

      void (async () => {
        try {
          const deferredData = await deferredPromise;
          if (!deferredData) return;
          if (isStale()) return;
          setData((prev) => {
            if (!prev) return deferredData;
            return {
              ...prev,
              customerArrRows: deferredData.customerArrRows,
              currentMonthProjection: deferredData.currentMonthProjection,
            };
          });
        } catch {
          // Keep already loaded base metrics visible if deferred sections fail.
        } finally {
          if (!isStale()) setDeferredSectionsLoading(false);
        }
      })();
    } catch (e: unknown) {
      if (!isStale()) setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      if (!isStale()) setLoading(false);
    }
  }

  const hasStripeExactSeries = data?.stripeExactPoints !== undefined || data?.stripeExactHistoryPoints !== undefined;
  const points = useMemo(
    () => (hasStripeExactSeries ? data?.stripeExactPoints ?? [] : data?.points ?? []),
    [data, hasStripeExactSeries],
  );
  const historyPoints = useMemo(
    () => (hasStripeExactSeries ? data?.stripeExactHistoryPoints ?? [] : data?.historyPoints ?? []),
    [data, hasStripeExactSeries],
  );
  const customerArrRows = useMemo(() => data?.customerArrRows ?? [], [data]);
  const currency = useMemo(() => data?.targetCurrency || "USD", [data]);
  const growthInputPoints = useMemo(() => [...historyPoints, ...points], [historyPoints, points]);
  const currentMrr = useMemo(() => (points.length ? points[points.length - 1].mrrEnd : 0), [points]);
  const currentArr = useMemo(() => Math.round(currentMrr * 12 * 100) / 100, [currentMrr]);
  const customerPeriodColumns = useMemo(
    () => points.map((point) => ({ key: point.key, label: point.label })),
    [points],
  );
  const growthWindowOptions = useMemo(() => growthWindowOptionsForGrain(grain), [grain]);
  const selectedGrowthWindow = useMemo(
    () => growthWindowOptions.find((option) => option.value === mrrGrowthWindow) || growthWindowOptions[0],
    [growthWindowOptions, mrrGrowthWindow],
  );
  const selectedGrowthLookback = selectedGrowthWindow?.lookbackPeriods || 1;
  const mrrGrowthSeries = useMemo(
    () => computeMrrGrowthRates(growthInputPoints, selectedGrowthLookback),
    [growthInputPoints, selectedGrowthLookback],
  );
  const mrrGrowthByKey = useMemo(() => {
    const out = new Map<string, number>();
    growthInputPoints.forEach((point, idx) => out.set(point.key, mrrGrowthSeries[idx] || 0));
    return out;
  }, [growthInputPoints, mrrGrowthSeries]);
  const groupedSeries = useMemo(() => data?.groupedSeries ?? [], [data]);
  const groupedLineSeries = useMemo(
    () =>
      groupedSeries.map((series, idx) => ({
        key: series.groupKey,
        label: series.groupLabel,
        points: series.points || [],
        color: GROUP_LINE_COLORS[idx % GROUP_LINE_COLORS.length],
      })),
    [groupedSeries],
  );
  const groupedGrowthLineSeries = useMemo(
    () =>
      groupedSeries.map((series, idx) => {
        const history = series.historyPoints || [];
        const periodPoints = series.points || [];
        const input = [...history, ...periodPoints];
        const growthRates = computeMrrGrowthRates(input, selectedGrowthLookback);
        const growthByKey = new Map<string, number>();
        input.forEach((point, pointIdx) => growthByKey.set(point.key, growthRates[pointIdx] || 0));
        return {
          key: series.groupKey,
          label: series.groupLabel,
          points: periodPoints.map((point) => ({ ...point, mrrGrowthRatePct: growthByKey.get(point.key) || 0 })),
          color: GROUP_LINE_COLORS[idx % GROUP_LINE_COLORS.length],
        };
      }),
    [groupedSeries, selectedGrowthLookback],
  );
  const chartGroupingEnabled = chartGroupBy !== "none" && groupedLineSeries.length > 0;
  const selectedBarSeriesList = useMemo(() => {
    if (!chartGroupingEnabled) return [] as typeof groupedLineSeries;
    const selected = groupedLineSeries.filter((series) => selectedBarGroupKeys.includes(series.key));
    return selected.length ? selected : groupedLineSeries.slice(0, 1);
  }, [chartGroupingEnabled, groupedLineSeries, selectedBarGroupKeys]);
  const selectedBarSeriesLabel = useMemo(() => {
    if (!chartGroupingEnabled) return "selected groups";
    if (selectedBarSeriesList.length === 1) return selectedBarSeriesList[0].label;
    if (selectedBarSeriesList.length === groupedLineSeries.length) return `all ${groupedLineSeries.length} groups`;
    return `${selectedBarSeriesList.length} selected groups`;
  }, [chartGroupingEnabled, selectedBarSeriesList, groupedLineSeries.length]);
  const barChartPoints = useMemo(() => {
    if (!chartGroupingEnabled) return points;
    return aggregateOverviewPointsByPeriod(points, selectedBarSeriesList);
  }, [chartGroupingEnabled, points, selectedBarSeriesList]);
  const chartGroupingLabel = CHART_GROUP_OPTIONS.find((option) => option.key === chartGroupBy)?.label || "Overall";
  const chartPeriods = useMemo(
    () => points.map((point) => ({ key: point.key, label: point.label })),
    [points],
  );
  const currentMonthProjection = useMemo(() => data?.currentMonthProjection || null, [data]);
  const currentMonthProjectionChartPoints = useMemo(() => {
    if (!currentMonthProjection?.points?.length) return [] as OverviewPoint[];
    return currentMonthProjection.points.map((point) => ({
      key: point.date,
      label: point.label,
      periodStart: point.date,
      periodEnd: point.date,
      mrrEnd: point.mrrProjected,
      newMrr: 0,
      reactivationMrr: 0,
      expansionMrr: 0,
      contractionMrr: 0,
      churnMrr: 0,
      netMrrChange: 0,
      mrrGrowthRatePct: 0,
      arr: point.mrrProjected * 12,
      arrGrowth: 0,
    }));
  }, [currentMonthProjection]);
  useEffect(() => {
    if (!chartGroupingEnabled) {
      if (selectedBarGroupKeys.length > 0) setSelectedBarGroupKeys([]);
      return;
    }
    const availableKeys = new Set(groupedLineSeries.map((series) => series.key));
    const validSelected = selectedBarGroupKeys.filter((key) => availableKeys.has(key));
    if (validSelected.length === 0) {
      const first = groupedLineSeries[0]?.key;
      setSelectedBarGroupKeys(first ? [first] : []);
      return;
    }
    if (validSelected.length !== selectedBarGroupKeys.length) {
      setSelectedBarGroupKeys(validSelected);
    }
  }, [chartGroupingEnabled, groupedLineSeries, selectedBarGroupKeys]);
  const customerArrMatrixRows = useMemo(() => {
    const snapshotsByCustomer = new Map<string, Map<string, number>>();
    const periodKeys = new Set(customerPeriodColumns.map((column) => column.key));

    for (const row of customerArrRows) {
      if (!periodKeys.has(row.periodKey)) continue;
      const customerId = row.customerId || "(blank)";
      const existing = snapshotsByCustomer.get(customerId) || new Map<string, number>();
      existing.set(row.periodKey, row.arr);
      snapshotsByCustomer.set(customerId, existing);
    }

    const latestPeriodKey = customerPeriodColumns[customerPeriodColumns.length - 1]?.key || "";
    return Array.from(snapshotsByCustomer.entries())
      .map(([customerId, snapshotsByPeriod]) => {
        const valuesByPeriod = new Map<string, number>();
        let currentArr = 0;
        for (const column of customerPeriodColumns) {
          if (snapshotsByPeriod.has(column.key)) {
            currentArr = snapshotsByPeriod.get(column.key) || 0;
          }
          valuesByPeriod.set(column.key, currentArr);
        }
        const latestArr = latestPeriodKey ? valuesByPeriod.get(latestPeriodKey) || 0 : 0;
        const totalArr = customerPeriodColumns.reduce((sum, column) => sum + (valuesByPeriod.get(column.key) || 0), 0);
        return {
          customerId,
          valuesByPeriod,
          latestArr,
          totalArr,
        };
      })
      .sort((a, b) => {
        if (Math.abs(b.latestArr - a.latestArr) > 1e-9) return b.latestArr - a.latestArr;
        if (Math.abs(b.totalArr - a.totalArr) > 1e-9) return b.totalArr - a.totalArr;
        return a.customerId.localeCompare(b.customerId);
      });
  }, [customerArrRows, customerPeriodColumns]);
  const totalCustomerPages = Math.max(1, Math.ceil(customerArrMatrixRows.length / customerPageSize));
  const clampedCustomerPage = Math.min(customerPage, totalCustomerPages);
  const customerRowsOnPage = useMemo(() => {
    const start = (clampedCustomerPage - 1) * customerPageSize;
    return customerArrMatrixRows.slice(start, start + customerPageSize);
  }, [clampedCustomerPage, customerArrMatrixRows, customerPageSize]);

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Revenue intelligence</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Stripe Billing Overview</h1>
            <p className="stripe-ui__subtitle">
              Trend dashboard for MRR, growth components, MRR growth rate, ARR, and ARR growth using customer-level
              MRR transitions from Stripe MRR change events.
            </p>
          </div>
        </div>
      </section>

      <DraftInvoiceAdminControls />

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Controls</h2>
        <p className="stripe-ui__panel-subtitle">Choose date range and time grain, then load charted metrics.</p>

        <div className="stripe-ui__control-grid">
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-billing-start-date">
              Start date
            </label>
            <input
              id="stripe-billing-start-date"
              className="stripe-ui__control"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-billing-end-date">
              End date
            </label>
            <input
              id="stripe-billing-end-date"
              className="stripe-ui__control"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-billing-grain">
              Time grain
            </label>
            <select
              id="stripe-billing-grain"
              className="stripe-ui__control"
              value={grain}
              onChange={(e) => {
                const next = e.target.value as Grain;
                setGrain(next);
                setMrrGrowthWindow(defaultGrowthWindowValue(next));
              }}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-billing-chart-group">
              Chart grouping
            </label>
            <select
              id="stripe-billing-chart-group"
              className="stripe-ui__control"
              value={chartGroupBy}
              onChange={(e) => setChartGroupBy(e.target.value as ChartGroupBy)}
            >
              {CHART_GROUP_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-billing-run">
              Load charts
            </label>
            <button id="stripe-billing-run" className="stripe-ui__btn stripe-ui__btn--primary" onClick={run} disabled={loading}>
              {loading ? "Loading..." : "Run"}
            </button>
          </div>
        </div>
      </section>

      {loading && (
        <section className="stripe-ui__panel stripe-ui__loading-panel ui-reveal ui-reveal-2" aria-live="polite" aria-busy="true">
          <h2 className="stripe-ui__panel-title">Loading charts...</h2>
          <p className="stripe-ui__panel-subtitle">Querying Stripe MRR change series and rendering visuals.</p>
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
                <p className="stripe-ui__stat-label">Current MRR</p>
                <p className="stripe-ui__stat-value">{formatMoney(currentMrr, currency)}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Current ARR</p>
                <p className="stripe-ui__stat-value">{formatMoney(currentArr, currency)}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Points</p>
                <p className="stripe-ui__stat-value">{points.length}</p>
              </div>
            </div>
          </section>

          {chartGroupingEnabled && (
            <section className="stripe-ui__panel ui-reveal ui-reveal-2">
              <div className="stripe-ui__section-head">
                <div>
                  <h2 className="stripe-ui__panel-title">Grouped Charts</h2>
                  <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
                    Line charts are split by {chartGroupingLabel.toLowerCase()}. Bar charts sum selected groups.
                  </p>
                </div>
                <div className="stripe-ui__hint">{`${groupedLineSeries.length} groups shown`}</div>
              </div>

              <div className="stripe-ui__control-grid" style={{ marginTop: "0.8rem" }}>
                <div className="stripe-ui__field" style={{ gridColumn: "1 / -1" }}>
                  <label className="stripe-ui__field-label" htmlFor="stripe-billing-bar-group-list">
                    Bar chart groups
                  </label>
                  <div id="stripe-billing-bar-group-list" className="stripe-ui__chips">
                    {groupedLineSeries.map((series) => (
                      <button
                        key={series.key}
                        type="button"
                        className="stripe-ui__chip"
                        style={{
                          borderColor: selectedBarGroupKeys.includes(series.key) ? series.color : undefined,
                          color: selectedBarGroupKeys.includes(series.key) ? "#dbe7fb" : undefined,
                          boxShadow: selectedBarGroupKeys.includes(series.key)
                            ? `inset 0 0 0 1px ${series.color}`
                            : undefined,
                        }}
                        onClick={() =>
                          setSelectedBarGroupKeys((prev) => {
                            if (prev.includes(series.key)) {
                              if (prev.length <= 1) return prev;
                              return prev.filter((key) => key !== series.key);
                            }
                            return [...prev, series.key];
                          })
                        }
                      >
                        {series.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.55rem", flexWrap: "wrap" }}>
                    <button
                      className="stripe-ui__btn stripe-ui__btn--ghost"
                      type="button"
                      onClick={() => setSelectedBarGroupKeys(groupedLineSeries.map((series) => series.key))}
                    >
                      Select all
                    </button>
                    <span className="stripe-ui__hint">{`${selectedBarSeriesList.length} selected`}</span>
                  </div>
                </div>
              </div>
            </section>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
              gap: "0.95rem",
              alignItems: "start",
            }}
          >
            {chartGroupingEnabled ? (
              <MultiLineChartCard
                title="MRR Over Time"
                subtitle={`MRR at the end of each period, split by ${chartGroupingLabel.toLowerCase()}.`}
                periods={chartPeriods}
                series={groupedLineSeries}
                valueAccessor={(p) => p.mrrEnd}
                valueFormatter={(v) => formatMoney(v, currency)}
              />
            ) : (
              <LineChartCard
                title="MRR Over Time"
                subtitle="MRR at the end of each selected period."
                points={points}
                valueAccessor={(p) => p.mrrEnd}
                valueFormatter={(v) => formatMoney(v, currency)}
                stroke="#4f8df9"
              />
            )}

            {currentMonthProjection && currentMonthProjectionChartPoints.length > 0 ? (
              <LineChartCard
                title="Projected MRR in current month"
                subtitle={`Observed through ${currentMonthProjection.observedThrough}. Projected month-end MRR: ${formatMoney(
                  currentMonthProjection.projectedEndMrr,
                  currency,
                )} (${currentMonthProjection.historicalMonthsUsed} historical month${
                  currentMonthProjection.historicalMonthsUsed === 1 ? "" : "s"
                } used).`}
                points={currentMonthProjectionChartPoints}
                valueAccessor={(p) => p.mrrEnd}
                valueFormatter={(v) => formatMoney(v, currency)}
                stroke="#22c55e"
              />
            ) : (
              <section className="stripe-ui__panel ui-reveal ui-reveal-2">
                <h2 className="stripe-ui__panel-title">Projected MRR in current month</h2>
                <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
                  {deferredSectionsLoading
                    ? "Loading projected MRR model..."
                    : "No current-month projection available for the selected range."}
                </p>
              </section>
            )}

            <GrowthBreakdownChart
              points={barChartPoints}
              currency={currency}
              subtitle={
                hasStripeExactSeries
                  ? chartGroupingEnabled
                    ? `Stacked contributions for ${selectedBarSeriesLabel} (includes Reactivation).`
                    : "Stacked contributions for New, Reactivation, Expansion, Contraction, and Churn by period."
                  : "Stacked contributions for New, Expansion, Contraction, and Churn by period."
              }
              includeReactivation={hasStripeExactSeries}
            />

            {chartGroupingEnabled ? (
              <MultiLineChartCard
                title="MRR Growth Rate Over Time"
                subtitle={`Period-over-period MRR growth rate, split by ${chartGroupingLabel.toLowerCase()}.`}
                periods={chartPeriods}
                series={groupedGrowthLineSeries}
                valueAccessor={(p) => p.mrrGrowthRatePct}
                valueFormatter={(v) => formatPercent(v)}
                includeZero
                headerControl={
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                    <label htmlFor="mrr-growth-window" className="stripe-ui__hint">
                      Growth window
                    </label>
                    <select
                      id="mrr-growth-window"
                      className="stripe-ui__control"
                      value={selectedGrowthWindow?.value || ""}
                      onChange={(e) => setMrrGrowthWindow(e.target.value)}
                      style={{ minWidth: "220px" }}
                    >
                      {growthWindowOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                }
              />
            ) : (
              <LineChartCard
                title="MRR Growth Rate Over Time"
                subtitle={selectedGrowthWindow?.subtitle || "Period-over-period MRR growth rate."}
                points={points}
                valueAccessor={(p) => mrrGrowthByKey.get(p.key) || 0}
                valueFormatter={(v) => formatPercent(v)}
                stroke="#f59e0b"
                includeZero
                headerControl={
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                    <label htmlFor="mrr-growth-window" className="stripe-ui__hint">
                      Growth window
                    </label>
                    <select
                      id="mrr-growth-window"
                      className="stripe-ui__control"
                      value={selectedGrowthWindow?.value || ""}
                      onChange={(e) => setMrrGrowthWindow(e.target.value)}
                      style={{ minWidth: "220px" }}
                    >
                      {growthWindowOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                }
              />
            )}

            {chartGroupingEnabled ? (
              <MultiLineChartCard
                title="ARR Over Time"
                subtitle={`ARR = MRR x 12, split by ${chartGroupingLabel.toLowerCase()}.`}
                periods={chartPeriods}
                series={groupedLineSeries}
                valueAccessor={(p) => p.arr}
                valueFormatter={(v) => formatMoney(v, currency)}
              />
            ) : (
              <LineChartCard
                title="ARR Over Time"
                subtitle="ARR = MRR x 12 at period end."
                points={points}
                valueAccessor={(p) => p.arr}
                valueFormatter={(v) => formatMoney(v, currency)}
                stroke="#1fc16b"
              />
            )}

            <DeltaBarChartCard
              title="ARR Growth Over Time"
              subtitle={
                chartGroupingEnabled
                  ? `Absolute ARR change for ${selectedBarSeriesLabel} per period.`
                  : "Absolute ARR change per period."
              }
              points={barChartPoints}
              valueAccessor={(p) => p.arrGrowth}
              valueFormatter={(v) => formatMoney(v, currency)}
            />
          </div>

          <section className="stripe-ui__panel ui-reveal ui-reveal-3">
            <div className="stripe-ui__section-head">
              <div>
                <h2 className="stripe-ui__panel-title">Customer ARR by Period</h2>
                <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
                  ARR per customer at each period end (ARR = customer MRR x 12).
                </p>
              </div>
              <div className="stripe-ui__hint">{`${customerArrMatrixRows.length} customers`}</div>
            </div>

            {customerPeriodColumns.length === 0 || customerArrMatrixRows.length === 0 ? (
              <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.9rem", marginBottom: 0 }}>
                {deferredSectionsLoading
                  ? "Loading customer ARR rows..."
                  : "No customer ARR rows for selected range."}
              </p>
            ) : (
              <>
                <div className="stripe-ui__toolbar">
                  <div className="stripe-ui__toolbar-group">
                    <span className="stripe-ui__hint">{`Page ${clampedCustomerPage} of ${totalCustomerPages}`}</span>
                    <span className="stripe-ui__hint">{`${customerArrMatrixRows.length} rows`}</span>
                  </div>
                  <div className="stripe-ui__toolbar-group">
                    <button
                      className="stripe-ui__btn stripe-ui__btn--ghost"
                      onClick={() => setCustomerPage((prev) => Math.max(1, prev - 1))}
                      disabled={clampedCustomerPage <= 1}
                    >
                      Prev
                    </button>
                    <button
                      className="stripe-ui__btn stripe-ui__btn--ghost"
                      onClick={() => setCustomerPage((prev) => Math.min(totalCustomerPages, prev + 1))}
                      disabled={clampedCustomerPage >= totalCustomerPages}
                    >
                      Next
                    </button>
                  </div>
                </div>

                <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem" }}>
                <table className="stripe-ui__table" aria-label="Customer ARR by period table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      {customerPeriodColumns.map((column) => (
                        <th key={column.key} className="stripe-ui__num">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {customerRowsOnPage.map((row) => (
                      <tr key={row.customerId}>
                        <td>{row.customerId || "(blank)"}</td>
                        {customerPeriodColumns.map((column) => {
                          const value = row.valuesByPeriod.get(column.key) || 0;
                          return (
                            <td
                              key={`${row.customerId}:${column.key}`}
                              className={`stripe-ui__num ${value < 0 ? "stripe-ui__money--negative" : ""}`}
                            >
                              {formatMoney(value, currency)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {!loading && !error && !data && hasRunOnce && (
        <section className="stripe-ui__panel ui-reveal ui-reveal-2">
          <h2 className="stripe-ui__panel-title">No data</h2>
          <p className="stripe-ui__panel-subtitle">No points were returned for this selection.</p>
        </section>
      )}
    </div>
  );
}
