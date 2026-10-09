"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadSvgAsPng } from "@/lib/chartDownload";

type CombinedGrain = "daily" | "monthly" | "quarterly";
type CacFxProvider = "frankfurter" | "currencylayer";
type CacMenuTarget = CacFxProvider | null;

type CombinedPoint = {
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  mrrEnd: number;
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnMrr: number;
  netMrrChange: number;
  mrrGrowthRatePct: number;
  ndrPct: number;
  gdrPct: number;
  arr: number;
  arrGrowth: number;
};

type LineSourcePoints = {
  hubspot: CombinedPoint[];
  selfserve: CombinedPoint[];
  salesAssist: CombinedPoint[];
  aiSpend: CombinedPoint[];
  salesled?: CombinedPoint[];
};

type AiSpendExcludedEnterprisePrepaidCustomer = {
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

type QuickBooksExpenseAccount = {
  id: string;
  name: string;
  fullyQualifiedName: string;
  accountType: string;
  subAccount: boolean;
  active: boolean;
};

type QuickBooksExpenseAccountsResponse = {
  realmId: string;
  accounts: QuickBooksExpenseAccount[];
};

type QuickBooksCacAccountDefaultResponse = {
  storage: "vercel_blob" | "local_tmp";
  selectedAccountIds: string[];
  updatedAt: number;
};

type AuthSessionResponse = {
  user?: {
    role?: string;
  };
};

type CacPoint = {
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  salesMarketingCost: number;
  newCustomerCount: number;
  cac: number;
  accountCostsByAccountId?: Record<string, number>;
};

type LtvPoint = {
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  totalArr: number;
  activeCustomers: number;
  churnedCustomers: number;
  arpuMonthly: number;
  churnRatePct: number;
  ltv: number;
};

type ArrPerEmployeePoint = {
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  arr: number;
  fullTimeEmployees: number;
  arrPerEmployee: number;
  employeeNames?: string[];
};

type SalesCyclePoint = {
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  avgSalesCycleDays: number;
  closedWonDealCount: number;
};

type CombinedLiveArrResponse = {
  generatedAtUtc: string;
  liveArr: number;
  projectedArr: number;
  projectedArrBreakdown?: {
    aiSpendMonthlyWithoutExclusions: number;
    aiSpendMonthlyWithExclusions: number;
    aiSpendAnnualizedArr: number;
    selfserveTodayArr: number;
    selfserveProjectedArr: number;
    salesledCurrentArr: number;
  };
  projectedArrEomFlatAdjusted: number;
  projectedArrEomFlatFlat: number;
};

type CombinedBillingOverviewReportResponse = {
  startDate: string;
  endDate: string;
  grain: CombinedGrain;
  targetCurrency: string;
  currentMrr: number;
  currentArr: number;
  points: CombinedPoint[];
  linePoints: CombinedPoint[];
  lineSourcePoints: LineSourcePoints;
  arrPerEmployeePoints: ArrPerEmployeePoint[];
  salesCyclePoints: SalesCyclePoint[];
  retentionPoints: RetentionSeriesPoint[];
  ltvPoints: LtvPoint[];
  ltvNotice: string | null;
  arrPerEmployeeNotice: string | null;
  salesCycleNotice: string | null;
  cacPoints: CacPoint[];
  cacCurrencyLayerPoints: CacPoint[];
  cacCadPoints: CacPoint[];
  cacNotice: string | null;
  cacCurrencyLayerNotice: string | null;
  cacCadNotice: string | null;
  cacCadCurrency: string;
  aiSpendExcludedEnterprisePrepaidCustomers?: AiSpendExcludedEnterprisePrepaidCustomer[];
  aiSpendDailyPointBreakdown?: Array<{
    key: string;
    label: string;
    periodStart: string;
    periodEnd: string;
    aiSpendWithoutExclusions: number;
    aiSpendWithExclusions: number;
    aiSpendExcluded: number;
  }>;
};

type RetentionSource = "combined" | "salesled" | "selfserve";

type RetentionSeriesPoint = {
  key: string;
  label: string;
  selfserveGdrPct: number;
  salesledGdrPct: number;
  combinedGdrPct: number;
  selfserveNdrPct: number;
  salesledNdrPct: number;
  combinedNdrPct: number;
};

type CombinedOverviewData = {
  startDate: string;
  endDate: string;
  grain: CombinedGrain;
  targetCurrency: string;
  currentMrr: number;
  currentArr: number;
  liveArr: number;
  liveArrAsOfUtc: string;
  projectedArr: number;
  projectedArrBreakdown: {
    aiSpendMonthlyWithoutExclusions: number;
    aiSpendMonthlyWithExclusions: number;
    aiSpendAnnualizedArr: number;
    selfserveTodayArr: number;
    selfserveProjectedArr: number;
    salesledCurrentArr: number;
  };
  projectedArrEomFlatAdjusted: number;
  projectedArrEomFlatFlat: number;
  points: CombinedPoint[];
  linePoints: CombinedPoint[];
  lineSourcePoints: LineSourcePoints;
  arrPerEmployeePoints: ArrPerEmployeePoint[];
  salesCyclePoints: SalesCyclePoint[];
  retentionPoints: RetentionSeriesPoint[];
  ltvPoints: LtvPoint[];
  cacPoints: CacPoint[];
  cacCurrencyLayerPoints: CacPoint[];
  cacCadPoints: CacPoint[];
  cacCadCurrency: string;
  aiSpendExcludedEnterprisePrepaidCustomers: AiSpendExcludedEnterprisePrepaidCustomer[];
  aiSpendDailyPointBreakdown: Array<{
    key: string;
    label: string;
    periodStart: string;
    periodEnd: string;
    aiSpendWithoutExclusions: number;
    aiSpendWithExclusions: number;
    aiSpendExcluded: number;
  }>;
};

type AiSpendDailyBreakdownResponse = {
  startDate: string;
  endDate: string;
  targetCurrency: string;
  rows: Array<{
    snapshotDate: string;
    snapshotTimestampUtc: string;
    customerId: string;
    customerName: string;
    annualizedArrWithoutExclusions: number;
    annualizedArr: number;
    annualizedArrExcluded: number;
    lineCount: number;
  }>;
};

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function normalizeEntityId(value: string) {
  return String(value || "").trim().replace(/\.0+$/, "");
}

function normalizeIdList(values: string[]) {
  return Array.from(new Set(values.map((value) => normalizeEntityId(value)).filter(Boolean)));
}

function conciseErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const trimmed = String(message || fallback).trim();
  if (!trimmed) return fallback;
  return trimmed.length > 220 ? `${trimmed.slice(0, 220)}...` : trimmed;
}

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

function formatDays(value: number) {
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0)} days`;
}

function csvEscape(value: string | number) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const lines = rows.map((row) => row.map((cell) => csvEscape(cell)).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function tickIndices(size: number) {
  if (size <= 1) return [0];
  if (size <= 4) return Array.from({ length: size }, (_, i) => i);
  const out = new Set<number>([0, Math.floor((size - 1) / 2), size - 1]);
  return Array.from(out).sort((a, b) => a - b);
}

type LineChartPointBase = {
  key: string;
  label: string;
};

type LineChartProps<TPoint extends LineChartPointBase> = {
  title: string;
  subtitle: string;
  points: TPoint[];
  valueAccessor: (point: TPoint) => number;
  valueFormatter: (value: number) => string;
  stroke: string;
  includeZero?: boolean;
};

function LineChartCard<TPoint extends LineChartPointBase>({
  title,
  subtitle,
  points,
  valueAccessor,
  valueFormatter,
  stroke,
  includeZero = false,
}: LineChartProps<TPoint>) {
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

  const tooltipWidth = 230;
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
      await downloadSvgAsPng(chartRef.current, `combined-billing-overview-${title}`);
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
              const right = idx === points.length - 1 ? paddingLeft + plotWidth : (xAt(idx) + xAt(idx + 1)) / 2;
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

type GroupedSourceSeries = {
  id: "hubspot" | "selfserve" | "sales_assist" | "ai";
  label: string;
  color: string;
  points: CombinedPoint[];
};

type GroupedSourcePointClickPayload = {
  seriesId: GroupedSourceSeries["id"];
  seriesLabel: string;
  pointIndex: number;
  point: CombinedPoint;
};

type GroupedSourceLineChartCardProps = {
  title: string;
  subtitle: string;
  series: GroupedSourceSeries[];
  valueAccessor: (point: CombinedPoint) => number;
  valueFormatter: (value: number) => string;
  includeZero?: boolean;
  onPointClick?: (payload: GroupedSourcePointClickPayload) => void;
};

function GroupedSourceLineChartCard({
  title,
  subtitle,
  series,
  valueAccessor,
  valueFormatter,
  includeZero = false,
  onPointClick,
}: GroupedSourceLineChartCardProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const basePoints = useMemo(() => {
    let best: CombinedPoint[] = [];
    for (const item of series) {
      if ((item.points || []).length > best.length) best = item.points;
    }
    return best;
  }, [series]);

  const width = 640;
  const height = 250;
  const paddingLeft = 54;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 42;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const allValues: number[] = [];
  for (const item of series) {
    for (const point of item.points || []) {
      allValues.push(valueAccessor(point));
    }
  }
  const minRaw = allValues.length ? Math.min(...allValues) : 0;
  const maxRaw = allValues.length ? Math.max(...allValues) : 1;
  let minValue = includeZero ? Math.min(minRaw, 0) : minRaw;
  let maxValue = includeZero ? Math.max(maxRaw, 0) : maxRaw;
  if (Math.abs(maxValue - minValue) < 1e-9) {
    minValue -= 1;
    maxValue += 1;
  }

  const xAt = (idx: number) => {
    if (basePoints.length <= 1) return paddingLeft + plotWidth / 2;
    return paddingLeft + (idx / (basePoints.length - 1)) * plotWidth;
  };
  const yAt = (value: number) => paddingTop + ((maxValue - value) / (maxValue - minValue)) * plotHeight;

  const pathFor = (points: CombinedPoint[]) =>
    points.map((point, idx) => `${idx === 0 ? "M" : "L"} ${xAt(idx)} ${yAt(valueAccessor(point))}`).join(" ");

  const hoveredPoint = hoverIndex != null && hoverIndex >= 0 && hoverIndex < basePoints.length ? basePoints[hoverIndex] : null;
  const hoveredX = hoveredPoint && hoverIndex != null ? xAt(hoverIndex) : 0;
  const hoveredY = (() => {
    if (hoverIndex == null || hoverIndex < 0) return 0;
    let value = 0;
    for (const item of series) {
      const point = item.points[hoverIndex];
      if (point) {
        value = Math.max(value, valueAccessor(point));
      }
    }
    return yAt(value);
  })();
  const tooltipWidth = 250;
  const tooltipHeight = 18 + series.length * 14 + 6;
  const tooltipX = Math.max(
    paddingLeft,
    Math.min(paddingLeft + plotWidth - tooltipWidth, hoveredX - tooltipWidth / 2),
  );
  const tooltipY = Math.max(paddingTop + 4, hoveredY - tooltipHeight - 10);
  const downloadChart = useCallback(async () => {
    if (!chartRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadSvgAsPng(chartRef.current, `combined-billing-overview-${title}-by-source`);
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
            {hoveredPoint ? hoveredPoint.label : "Hover on chart for values"}
          </div>
        </div>
      </div>

      <div className="stripe-ui__hint" style={{ marginTop: "0.45rem", display: "flex", gap: "0.9rem", flexWrap: "wrap" }}>
        {series.map((item) => (
          <span key={`legend-${item.id}`} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: item.color, display: "inline-block" }} />
            {item.label}
          </span>
        ))}
      </div>

      {basePoints.length === 0 ? (
        <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.7rem", marginBottom: 0 }}>
          No data for selected range.
        </p>
      ) : (
        <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem" }}>
          <svg
            ref={chartRef}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${title} by source`}
            style={{ width: "100%", display: "block" }}
            onMouseLeave={() => setHoverIndex(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = ((e.clientX - rect.left) / rect.width) * width;
              const clamped = Math.max(paddingLeft, Math.min(paddingLeft + plotWidth, relX));
              const ratio = basePoints.length > 1 ? (clamped - paddingLeft) / plotWidth : 0;
              const idx = Math.max(0, Math.min(basePoints.length - 1, Math.round(ratio * Math.max(basePoints.length - 1, 0))));
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

            {series.map((item) => (
              <path
                key={`path-${item.id}`}
                d={pathFor(item.points || [])}
                fill="none"
                stroke={item.color}
                strokeWidth={2.2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {hoverIndex != null && basePoints[hoverIndex] && (
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
                {series.map((item, idx) => {
                  const point = item.points[hoverIndex || 0];
                  const value = point ? valueAccessor(point) : 0;
                  return (
                    <text key={`tip-${item.id}`} x={tooltipX + 10} y={tooltipY + 32 + idx * 14} fill={item.color} fontSize="11.5">
                      {item.label}: {valueFormatter(value)}
                    </text>
                  );
                })}
              </g>
            )}

            {series.map((item) =>
              (item.points || []).map((point, idx) => (
                <circle
                  key={`${item.id}-${point.key}`}
                  cx={xAt(idx)}
                  cy={yAt(valueAccessor(point))}
                  r={hoverIndex === idx ? 4 : 2.8}
                  fill={item.color}
                  onMouseEnter={() => setHoverIndex(idx)}
                  onClick={() => {
                    onPointClick?.({
                      seriesId: item.id,
                      seriesLabel: item.label,
                      pointIndex: idx,
                      point,
                    });
                  }}
                  style={{ cursor: onPointClick ? "pointer" : "default" }}
                />
              )),
            )}

            {tickIndices(basePoints.length).map((idx) => (
              <text
                key={`tick-${idx}`}
                x={xAt(idx)}
                y={height - 12}
                textAnchor={idx === 0 ? "start" : idx === basePoints.length - 1 ? "end" : "middle"}
                fill="#b7c9e6"
                fontSize="12"
              >
                {basePoints[idx]?.label || ""}
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

type LtvChartCardProps = {
  points: LtvPoint[];
  currency: string;
};

type ArrPerEmployeeChartCardProps = {
  points: ArrPerEmployeePoint[];
  currency: string;
};

function ArrPerEmployeeChartCard({ points, currency }: ArrPerEmployeeChartCardProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
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

  const values = points.map((point) => point.arrPerEmployee);
  const minRaw = values.length ? Math.min(...values) : 0;
  const maxRaw = values.length ? Math.max(...values) : 1;
  let minValue = Math.min(minRaw, 0);
  let maxValue = Math.max(maxRaw, 0);
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
    .map((point, idx) => `${idx === 0 ? "M" : "L"} ${xAt(idx)} ${yAt(point.arrPerEmployee)}`)
    .join(" ");

  const hoveredPoint =
    hoverIndex != null && hoverIndex >= 0 && hoverIndex < points.length ? points[hoverIndex] : null;
  useEffect(() => {
    if (selectedIndex == null) return;
    if (selectedIndex >= 0 && selectedIndex < points.length) return;
    setSelectedIndex(null);
  }, [points, selectedIndex]);
  const selectedPoint =
    selectedIndex != null && selectedIndex >= 0 && selectedIndex < points.length ? points[selectedIndex] : null;
  const selectedEmployeeNames = selectedPoint?.employeeNames || [];
  const hoveredX = hoveredPoint && hoverIndex != null ? xAt(hoverIndex) : 0;
  const hoveredY = hoveredPoint ? yAt(hoveredPoint.arrPerEmployee) : 0;

  const tooltipWidth = 300;
  const tooltipHeight = 72;
  const tooltipX = Math.max(
    paddingLeft,
    Math.min(paddingLeft + plotWidth - tooltipWidth, hoveredX - tooltipWidth / 2),
  );
  const tooltipY = Math.max(paddingTop + 4, hoveredY - tooltipHeight - 10);

  const downloadChart = useCallback(async () => {
    if (!chartRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadSvgAsPng(chartRef.current, "combined-billing-overview-arr-per-employee");
    } finally {
      setDownloading(false);
    }
  }, [downloading]);

  return (
    <section className="stripe-ui__panel ui-reveal ui-reveal-2">
      <div className="stripe-ui__section-head">
        <div>
          <h2 className="stripe-ui__panel-title">ARR Per Employee Over Time</h2>
          <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
            Combined ARR divided by BambooHR headcount at each period (contractors included; interns, temporary, part-time, and inactive/terminated excluded). Click a point to list employees included in that count.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => void downloadChart()} disabled={downloading}>
            {downloading ? "Downloading..." : "Download SVG"}
          </button>
          <div className="stripe-ui__hint" aria-live="polite">
            {hoveredPoint
              ? `${hoveredPoint.label}: ${formatMoney(hoveredPoint.arrPerEmployee, currency)}`
              : "Hover on chart for values"}
          </div>
        </div>
      </div>

      {points.length === 0 ? (
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
              aria-label="ARR per employee over time chart"
              style={{ width: "100%", display: "block", cursor: "pointer" }}
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
              const right = idx === points.length - 1 ? paddingLeft + plotWidth : (xAt(idx) + xAt(idx + 1)) / 2;
              return (
                <rect
                  key={`arr-per-employee-hit-${point.key}`}
                  x={left}
                  y={paddingTop}
                  width={Math.max(1, right - left)}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={() => setHoverIndex(idx)}
                  onClick={() => setSelectedIndex(idx)}
                />
              );
            })}

            <path d={pathD} fill="none" stroke="#06b6d4" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

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
                <text x={tooltipX + 10} y={tooltipY + 33} fill="#06b6d4" fontSize="12.5" fontWeight="600">
                  ARR/FTE: {formatMoney(hoveredPoint.arrPerEmployee, currency)}
                </text>
                <text x={tooltipX + 10} y={tooltipY + 50} fill="#d9e6fa" fontSize="11.5">
                  ARR: {formatMoney(hoveredPoint.arr, currency)}
                </text>
                <text x={tooltipX + 10} y={tooltipY + 65} fill="#d9e6fa" fontSize="11.5">
                  FTE: {Math.max(0, Math.round(hoveredPoint.fullTimeEmployees || 0))}
                </text>
              </g>
            )}

            {points.map((point, idx) => (
              <circle
                key={point.key}
                cx={xAt(idx)}
                cy={yAt(point.arrPerEmployee)}
                r={hoverIndex === idx ? 4.6 : 3.2}
                fill="#06b6d4"
                onMouseEnter={() => setHoverIndex(idx)}
                onClick={() => setSelectedIndex(idx)}
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
              {formatMoney(maxValue, currency)}
            </text>
            <text x={paddingLeft - 8} y={paddingTop + plotHeight} textAnchor="end" fill="#8ea7cb" fontSize="12">
              {formatMoney(minValue, currency)}
            </text>
            </svg>
          </div>

          {selectedPoint && (
            <div className="stripe-ui__panel" style={{ marginTop: "0.9rem", padding: "0.85rem" }}>
              <div className="stripe-ui__section-head" style={{ marginBottom: "0.65rem" }}>
                <div>
                  <h3 className="stripe-ui__panel-title" style={{ margin: 0, fontSize: "1rem" }}>
                    Employees Included: {selectedPoint.label}
                  </h3>
                  <p className="stripe-ui__panel-subtitle" style={{ margin: 0 }}>
                    {Math.max(0, Math.round(selectedPoint.fullTimeEmployees || 0))} FTE counted for this period.
                  </p>
                </div>
                <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => setSelectedIndex(null)}>
                  Clear
                </button>
              </div>

              {selectedEmployeeNames.length === 0 ? (
                <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.2rem", marginBottom: 0 }}>
                  No employee names available for this period.
                </p>
              ) : (
                <div className="stripe-ui__table-wrap" style={{ maxHeight: "18rem", overflow: "auto" }}>
                  <table className="stripe-ui__table" aria-label="ARR per employee names">
                    <thead>
                      <tr>
                        <th className="stripe-ui__num">#</th>
                        <th>Employee Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEmployeeNames.map((name, idx) => (
                        <tr key={`arr-per-employee-name-${selectedPoint.key}-${idx}`}>
                          <td className="stripe-ui__num">{idx + 1}</td>
                          <td>{name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function LtvChartCard({ points, currency }: LtvChartCardProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
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

  const values = points.map((point) => point.ltv);
  const minRaw = values.length ? Math.min(...values) : 0;
  const maxRaw = values.length ? Math.max(...values) : 1;
  let minValue = Math.min(minRaw, 0);
  let maxValue = Math.max(maxRaw, 0);
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
    .map((point, idx) => `${idx === 0 ? "M" : "L"} ${xAt(idx)} ${yAt(point.ltv)}`)
    .join(" ");

  const hoveredPoint =
    hoverIndex != null && hoverIndex >= 0 && hoverIndex < points.length ? points[hoverIndex] : null;
  const hoveredX = hoveredPoint && hoverIndex != null ? xAt(hoverIndex) : 0;
  const hoveredY = hoveredPoint ? yAt(hoveredPoint.ltv) : 0;

  const tooltipWidth = 300;
  const tooltipHeight = 88;
  const tooltipX = Math.max(
    paddingLeft,
    Math.min(paddingLeft + plotWidth - tooltipWidth, hoveredX - tooltipWidth / 2),
  );
  const tooltipY = Math.max(paddingTop + 4, hoveredY - tooltipHeight - 10);

  const downloadChart = useCallback(async () => {
    if (!chartRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadSvgAsPng(chartRef.current, "combined-billing-overview-ltv-over-time");
    } finally {
      setDownloading(false);
    }
  }, [downloading]);

  const exportTableCsv = () => {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const rows: Array<Array<string | number>> = [
      ["Period", "LTV", "ARR", "Churn (Users)", "Churn Rate (%)", "Total Users"],
      ...points.map((point) => [
        point.label,
        round2(point.ltv),
        round2(point.totalArr),
        Math.max(0, Math.round(point.churnedCustomers || 0)),
        round2(point.churnRatePct),
        Math.max(0, Math.round(point.activeCustomers || 0)),
      ]),
    ];
    downloadCsv(`combined-ltv-over-time-${stamp}.csv`, rows);
  };

  return (
    <section className="stripe-ui__panel ui-reveal ui-reveal-2">
      <div className="stripe-ui__section-head">
        <div>
          <h2 className="stripe-ui__panel-title">LTV Over Time</h2>
          <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
            LTV = ARPU / logo churn rate. Click the chart to open the data table.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => void downloadChart()} disabled={downloading}>
            {downloading ? "Downloading..." : "Download SVG"}
          </button>
          <div className="stripe-ui__hint" aria-live="polite">
            {hoveredPoint
              ? `${hoveredPoint.label}: LTV ${formatMoney(hoveredPoint.ltv, currency)}`
              : "Hover on chart for values"}
          </div>
        </div>
      </div>

      {points.length === 0 ? (
        <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.7rem", marginBottom: 0 }}>
          No data for selected range.
        </p>
      ) : (
        <>
          <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem", cursor: "pointer" }}>
            <svg
              ref={chartRef}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label="LTV over time chart"
              style={{ width: "100%", display: "block" }}
              onClick={() => setShowTable(true)}
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
                const right = idx === points.length - 1 ? paddingLeft + plotWidth : (xAt(idx) + xAt(idx + 1)) / 2;
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

              <path d={pathD} fill="none" stroke="#a855f7" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

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
                  <text x={tooltipX + 10} y={tooltipY + 33} fill="#a855f7" fontSize="12.5" fontWeight="600">
                    LTV: {formatMoney(hoveredPoint.ltv, currency)}
                  </text>
                  <text x={tooltipX + 10} y={tooltipY + 50} fill="#d9e6fa" fontSize="11.5">
                    ARR: {formatMoney(hoveredPoint.totalArr, currency)}
                  </text>
                  <text x={tooltipX + 10} y={tooltipY + 65} fill="#d9e6fa" fontSize="11.5">
                    Churn: {Math.max(0, Math.round(hoveredPoint.churnedCustomers || 0))} users ({formatPercent(hoveredPoint.churnRatePct)})
                  </text>
                  <text x={tooltipX + 10} y={tooltipY + 80} fill="#d9e6fa" fontSize="11.5">
                    Total Users: {Math.max(0, Math.round(hoveredPoint.activeCustomers || 0))}
                  </text>
                </g>
              )}

              {points.map((point, idx) => (
                <circle
                  key={point.key}
                  cx={xAt(idx)}
                  cy={yAt(point.ltv)}
                  r={hoverIndex === idx ? 4.6 : 3.2}
                  fill="#a855f7"
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
                {formatMoney(maxValue, currency)}
              </text>
              <text x={paddingLeft - 8} y={paddingTop + plotHeight} textAnchor="end" fill="#8ea7cb" fontSize="12">
                {formatMoney(minValue, currency)}
              </text>
            </svg>
          </div>

          {showTable && (
            <div className="stripe-ui__panel" style={{ marginTop: "0.9rem", padding: "0.85rem" }}>
              <div className="stripe-ui__section-head" style={{ marginBottom: "0.65rem" }}>
                <h3 className="stripe-ui__panel-title" style={{ margin: 0, fontSize: "1rem" }}>
                  LTV Table
                </h3>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button className="stripe-ui__btn stripe-ui__btn--secondary" onClick={exportTableCsv}>
                    Export CSV
                  </button>
                  <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => setShowTable(false)}>
                    Hide table
                  </button>
                </div>
              </div>

              <div className="stripe-ui__table-wrap">
                <table className="stripe-ui__table" aria-label="LTV table">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th className="stripe-ui__num">ARR</th>
                      <th className="stripe-ui__num">Churn (Users)</th>
                      <th className="stripe-ui__num">Churn Rate</th>
                      <th className="stripe-ui__num">Total Users</th>
                      <th className="stripe-ui__num">LTV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={`ltv-row-${point.key}`}>
                        <td>{point.label}</td>
                        <td className="stripe-ui__num">{formatMoney(point.totalArr, currency)}</td>
                        <td className="stripe-ui__num">{Math.max(0, Math.round(point.churnedCustomers || 0))}</td>
                        <td className="stripe-ui__num">{formatPercent(point.churnRatePct)}</td>
                        <td className="stripe-ui__num">{Math.max(0, Math.round(point.activeCustomers || 0))}</td>
                        <td className="stripe-ui__num">{formatMoney(point.ltv, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

type CacChartCardProps = {
  points: CacPoint[];
  currency: string;
  title?: string;
  subtitle?: string;
  accentColor?: string;
  downloadFilename?: string;
  tableTitle?: string;
  tableAriaLabel?: string;
  includeAccountBreakdownInCsv?: boolean;
  showAccountSelector?: boolean;
  expenseAccounts: QuickBooksExpenseAccount[];
  selectedAccountIds: string[];
  runLoading: boolean;
  accountMenuOpen: boolean;
  accountsLoading: boolean;
  accountsError: string;
  savingDefaultSelection: boolean;
  defaultSaveStatus: string;
  onToggleAccountMenu: () => void;
  onRefreshAccounts: () => void;
  onToggleAccountSelection: (accountId: string) => void;
  onSelectAllAccounts: () => void;
  onClearAccounts: () => void;
  onSaveDefaultSelection: () => void;
  onApplySelection: () => void;
};

function CacChartCard({
  points,
  currency,
  title = "CAC Over Time",
  subtitle = "CAC = Sales & Marketing Cost / Total Users. Click the chart to open the data table.",
  accentColor = "#e879f9",
  downloadFilename = "combined-billing-overview-cac-over-time",
  tableTitle = "CAC Table",
  tableAriaLabel = "CAC table",
  includeAccountBreakdownInCsv = false,
  showAccountSelector = true,
  expenseAccounts,
  selectedAccountIds,
  runLoading,
  accountMenuOpen,
  accountsLoading,
  accountsError,
  savingDefaultSelection,
  defaultSaveStatus,
  onToggleAccountMenu,
  onRefreshAccounts,
  onToggleAccountSelection,
  onSelectAllAccounts,
  onClearAccounts,
  onSaveDefaultSelection,
  onApplySelection,
}: CacChartCardProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
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

  const values = points.map((point) => point.cac);
  const minRaw = values.length ? Math.min(...values) : 0;
  const maxRaw = values.length ? Math.max(...values) : 1;
  let minValue = Math.min(minRaw, 0);
  let maxValue = Math.max(maxRaw, 0);
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
    .map((point, idx) => `${idx === 0 ? "M" : "L"} ${xAt(idx)} ${yAt(point.cac)}`)
    .join(" ");

  const hoveredPoint =
    hoverIndex != null && hoverIndex >= 0 && hoverIndex < points.length ? points[hoverIndex] : null;
  const hoveredX = hoveredPoint && hoverIndex != null ? xAt(hoverIndex) : 0;
  const hoveredY = hoveredPoint ? yAt(hoveredPoint.cac) : 0;

  const tooltipWidth = 280;
  const tooltipHeight = 72;
  const tooltipX = Math.max(
    paddingLeft,
    Math.min(paddingLeft + plotWidth - tooltipWidth, hoveredX - tooltipWidth / 2),
  );
  const tooltipY = Math.max(paddingTop + 4, hoveredY - tooltipHeight - 10);
  const selectedCount = selectedAccountIds.length;
  const selectedAccountIdSet = useMemo(
    () => new Set(normalizeIdList(selectedAccountIds)),
    [selectedAccountIds],
  );

  const downloadChart = useCallback(async () => {
    if (!chartRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadSvgAsPng(chartRef.current, downloadFilename);
    } finally {
      setDownloading(false);
    }
  }, [downloadFilename, downloading]);

  const exportTableCsv = () => {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const selectedAccountsForCsv = includeAccountBreakdownInCsv
      ? selectedAccountIds
          .map((id) => normalizeEntityId(String(id || "")))
          .filter(Boolean)
          .map((id) => {
            const match = expenseAccounts.find((account) => normalizeEntityId(String(account.id || "")) === id);
            return {
              id,
              label: String(match?.fullyQualifiedName || match?.name || id).trim() || id,
            };
          })
      : [];
    const rows: Array<Array<string | number>> = [
      [
        "Period",
        "CAC",
        "Sales & Marketing Cost",
        "Total Users",
        ...selectedAccountsForCsv.map((account) => account.label),
      ],
      ...points.map((point) => [
        point.label,
        round2(point.cac),
        round2(point.salesMarketingCost),
        Math.max(0, Math.round(point.newCustomerCount || 0)),
        ...selectedAccountsForCsv.map((account) =>
          round2(Number(point.accountCostsByAccountId?.[account.id] || 0)),
        ),
      ]),
    ];
    downloadCsv(`combined-cac-over-time-${stamp}.csv`, rows);
  };

  return (
    <section className="stripe-ui__panel ui-reveal ui-reveal-2">
      <div className="stripe-ui__section-head">
        <div>
          <h2 className="stripe-ui__panel-title">{title}</h2>
          <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
            {subtitle}
          </p>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            position: "relative",
          }}
        >
          {showAccountSelector ? (
            <button
              className="stripe-ui__btn stripe-ui__btn--ghost"
              onClick={onToggleAccountMenu}
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              title="Configure CAC expense accounts"
              style={{ minWidth: "2.2rem", paddingInline: "0.55rem" }}
            >
              ...
            </button>
          ) : null}
          <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => void downloadChart()} disabled={downloading}>
            {downloading ? "Downloading..." : "Download SVG"}
          </button>
          <div className="stripe-ui__hint" aria-live="polite">
            {hoveredPoint
              ? `${hoveredPoint.label}: CAC ${formatMoney(hoveredPoint.cac, currency)}`
              : "Hover on chart for values"}
          </div>

          {showAccountSelector && accountMenuOpen && (
            <div
              className="stripe-ui__panel"
              style={{
                position: "absolute",
                right: 0,
                top: "2.6rem",
                zIndex: 30,
                width: "min(460px, 92vw)",
                padding: "0.85rem",
                borderColor: "#3e5e89",
              }}
              role="menu"
            >
              <div className="stripe-ui__hint" style={{ marginBottom: "0.55rem" }}>
                Select expense accounts used for CAC Sales &amp; Marketing cost.
              </div>

              <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", marginBottom: "0.55rem" }}>
                <button className="stripe-ui__btn stripe-ui__btn--secondary" onClick={onSelectAllAccounts} disabled={accountsLoading}>
                  Select all
                </button>
                <button className="stripe-ui__btn stripe-ui__btn--secondary" onClick={onClearAccounts} disabled={accountsLoading}>
                  Clear
                </button>
                <button className="stripe-ui__btn stripe-ui__btn--primary" onClick={onApplySelection} disabled={runLoading}>
                  Apply selection
                </button>
                <button
                  className="stripe-ui__btn stripe-ui__btn--primary"
                  onClick={onSaveDefaultSelection}
                  disabled={savingDefaultSelection}
                >
                  {savingDefaultSelection ? "Saving..." : "Save as default"}
                </button>
                <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={onRefreshAccounts} disabled={accountsLoading}>
                  Refresh
                </button>
              </div>

              {defaultSaveStatus ? (
                <div className="stripe-ui__hint" style={{ marginBottom: "0.55rem" }}>
                  {defaultSaveStatus}
                </div>
              ) : null}

              {accountsError ? (
                <div className="stripe-ui__hint" style={{ color: "#f4a4b7", marginBottom: "0.55rem" }}>
                  {accountsError}
                </div>
              ) : null}

              {accountsLoading ? (
                <div className="stripe-ui__hint">Loading expense accounts...</div>
              ) : expenseAccounts.length === 0 ? (
                <div className="stripe-ui__hint">No expense accounts found or QuickBooks is not connected.</div>
              ) : (
                <div
                  className="stripe-ui__table-wrap"
                  style={{ maxHeight: "240px", overflow: "auto", padding: "0.45rem", marginBottom: "0.45rem" }}
                >
                  <div style={{ display: "grid", gap: "0.35rem" }}>
                    {expenseAccounts.map((account) => {
                      const checked = selectedAccountIdSet.has(normalizeEntityId(String(account.id || "")));
                      return (
                        <label
                          key={`cac-account-${account.id}`}
                          style={{ display: "flex", alignItems: "flex-start", gap: "0.45rem", cursor: "pointer" }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggleAccountSelection(account.id)}
                            style={{ marginTop: "0.2rem" }}
                          />
                          <span className="stripe-ui__hint">
                            {account.fullyQualifiedName || account.name}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="stripe-ui__hint">
                {selectedCount > 0
                  ? `${selectedCount} selected account${selectedCount === 1 ? "" : "s"} will be used for CAC cost.`
                  : "No accounts selected. CAC cost falls back to automatic Sales/Marketing matching."}
              </div>
            </div>
          )}
        </div>
      </div>

      {points.length === 0 ? (
        <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.7rem", marginBottom: 0 }}>
          No data for selected range.
        </p>
      ) : (
        <>
          <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem", cursor: "pointer" }}>
            <svg
              ref={chartRef}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label="CAC over time chart"
              style={{ width: "100%", display: "block" }}
              onClick={() => setShowTable(true)}
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
              <line
                x1={paddingLeft}
                y1={paddingTop}
                x2={paddingLeft}
                y2={paddingTop + plotHeight}
                stroke="#36557f"
                strokeWidth={1}
              />

              {points.map((point, idx) => {
                const left = idx === 0 ? paddingLeft : (xAt(idx - 1) + xAt(idx)) / 2;
                const right = idx === points.length - 1 ? paddingLeft + plotWidth : (xAt(idx) + xAt(idx + 1)) / 2;
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

              <path d={pathD} fill="none" stroke={accentColor} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

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
                  <text x={tooltipX + 10} y={tooltipY + 33} fill={accentColor} fontSize="12.5" fontWeight="600">
                    CAC: {formatMoney(hoveredPoint.cac, currency)}
                  </text>
                  <text x={tooltipX + 10} y={tooltipY + 50} fill="#d9e6fa" fontSize="11.5">
                    S&M Cost: {formatMoney(hoveredPoint.salesMarketingCost, currency)}
                  </text>
                  <text x={tooltipX + 10} y={tooltipY + 65} fill="#d9e6fa" fontSize="11.5">
                    Total Users: {Math.max(0, Math.round(hoveredPoint.newCustomerCount || 0))}
                  </text>
                </g>
              )}

              {points.map((point, idx) => (
                <circle
                  key={point.key}
                  cx={xAt(idx)}
                  cy={yAt(point.cac)}
                  r={hoverIndex === idx ? 4.6 : 3.2}
                  fill={accentColor}
                  data-tooltip={`${point.label}: CAC ${formatMoney(point.cac, currency)} | S&M ${formatMoney(point.salesMarketingCost, currency)} | Users ${Math.max(0, Math.round(point.newCustomerCount || 0))}`}
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
                {formatMoney(maxValue, currency)}
              </text>
              <text x={paddingLeft - 8} y={paddingTop + plotHeight} textAnchor="end" fill="#8ea7cb" fontSize="12">
                {formatMoney(minValue, currency)}
              </text>
            </svg>
          </div>

          {showTable && (
            <div className="stripe-ui__panel" style={{ marginTop: "0.9rem", padding: "0.85rem" }}>
              <div className="stripe-ui__section-head" style={{ marginBottom: "0.65rem" }}>
                <h3 className="stripe-ui__panel-title" style={{ margin: 0, fontSize: "1rem" }}>
                  {tableTitle}
                </h3>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button className="stripe-ui__btn stripe-ui__btn--secondary" onClick={exportTableCsv}>
                    Export CSV
                  </button>
                  <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => setShowTable(false)}>
                    Hide table
                  </button>
                </div>
              </div>

              <div className="stripe-ui__table-wrap">
                <table className="stripe-ui__table" aria-label={tableAriaLabel}>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th className="stripe-ui__num">CAC</th>
                      <th className="stripe-ui__num">Sales &amp; Marketing Cost</th>
                      <th className="stripe-ui__num">Total Users</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={`cac-row-${point.key}`}>
                        <td>{point.label}</td>
                        <td className="stripe-ui__num">{formatMoney(point.cac, currency)}</td>
                        <td className="stripe-ui__num">{formatMoney(point.salesMarketingCost, currency)}</td>
                        <td className="stripe-ui__num">{Math.max(0, Math.round(point.newCustomerCount || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

type RetentionRatesChartCardProps = {
  points: RetentionSeriesPoint[];
};

function RetentionRatesChartCard({ points }: RetentionRatesChartCardProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [source, setSource] = useState<RetentionSource>("combined");
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

  const sourceLabel =
    source === "salesled"
      ? "HubSpot"
      : source === "selfserve"
        ? "Self-serve (Stripe only)"
        : "Combined";
  const ndrFor = (point: RetentionSeriesPoint) =>
    source === "salesled"
      ? point.salesledNdrPct
      : source === "selfserve"
        ? point.selfserveNdrPct
        : point.combinedNdrPct;
  const gdrFor = (point: RetentionSeriesPoint) =>
    source === "salesled"
      ? point.salesledGdrPct
      : source === "selfserve"
        ? point.selfserveGdrPct
        : point.combinedGdrPct;

  const ndrValues = points.map((point) => ndrFor(point));
  const gdrValues = points.map((point) => gdrFor(point));
  const allValues = [...ndrValues, ...gdrValues];

  const minRaw = allValues.length ? Math.min(...allValues) : 0;
  const maxRaw = allValues.length ? Math.max(...allValues) : 1;
  let minValue = minRaw;
  let maxValue = maxRaw;
  if (Math.abs(maxValue - minValue) < 1e-9) {
    minValue -= 1;
    maxValue += 1;
  }

  const xAt = (idx: number) => {
    if (points.length <= 1) return paddingLeft + plotWidth / 2;
    return paddingLeft + (idx / (points.length - 1)) * plotWidth;
  };
  const yAt = (value: number) => paddingTop + ((maxValue - value) / (maxValue - minValue)) * plotHeight;

  const ndrPath = points
    .map((point, idx) => `${idx === 0 ? "M" : "L"} ${xAt(idx)} ${yAt(ndrFor(point))}`)
    .join(" ");
  const gdrPath = points
    .map((point, idx) => `${idx === 0 ? "M" : "L"} ${xAt(idx)} ${yAt(gdrFor(point))}`)
    .join(" ");

  const hoveredPoint =
    hoverIndex != null && hoverIndex >= 0 && hoverIndex < points.length ? points[hoverIndex] : null;
  const hoveredNdr = hoveredPoint ? ndrFor(hoveredPoint) : 0;
  const hoveredGdr = hoveredPoint ? gdrFor(hoveredPoint) : 0;
  const hoveredX = hoveredPoint && hoverIndex != null ? xAt(hoverIndex) : 0;
  const hoveredNdrY = hoveredPoint ? yAt(hoveredNdr) : 0;
  const hoveredGdrY = hoveredPoint ? yAt(hoveredGdr) : 0;
  const hoveredY = hoveredPoint ? Math.min(hoveredNdrY, hoveredGdrY) : 0;

  const tooltipWidth = 250;
  const tooltipHeight = 58;
  const tooltipX = Math.max(
    paddingLeft,
    Math.min(paddingLeft + plotWidth - tooltipWidth, hoveredX - tooltipWidth / 2),
  );
  const tooltipY = Math.max(paddingTop + 4, hoveredY - tooltipHeight - 10);
  const downloadChart = useCallback(async () => {
    if (!chartRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadSvgAsPng(chartRef.current, "combined-billing-overview-ndr-gdr-over-time");
    } finally {
      setDownloading(false);
    }
  }, [downloading]);

  const exportTableCsv = () => {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const tableRows: Array<[string, number[]]> = [
      ["selfserve GDR", points.map((point) => point.selfserveGdrPct)],
      ["hubspot GDR", points.map((point) => point.salesledGdrPct)],
      ["Combined GDR", points.map((point) => point.combinedGdrPct)],
      ["selfserve NDR", points.map((point) => point.selfserveNdrPct)],
      ["hubspot NDR", points.map((point) => point.salesledNdrPct)],
      ["Combined NDR", points.map((point) => point.combinedNdrPct)],
    ];
    const rows: Array<Array<string | number>> = [
      ["Metric", ...points.map((point) => point.label)],
      ...tableRows.map(([metric, values]) => [metric, ...values.map((value) => round2(value))]),
    ];
    downloadCsv(`combined-ndr-gdr-${stamp}.csv`, rows);
  };

  return (
    <section className="stripe-ui__panel ui-reveal ui-reveal-2">
      <div className="stripe-ui__section-head">
        <div>
          <h2 className="stripe-ui__panel-title">NDR / GDR Over Time</h2>
          <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
            {sourceLabel} retention rates based on prior-period MRR baseline. Click chart to open the plotted table.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => void downloadChart()} disabled={downloading}>
            {downloading ? "Downloading..." : "Download SVG"}
          </button>
          <div className="stripe-ui__hint" aria-live="polite">
            {hoveredPoint
              ? `${hoveredPoint.label}: NDR ${formatPercent(hoveredNdr)} | GDR ${formatPercent(hoveredGdr)}`
              : "Hover on chart for values"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.7rem" }}>
        <button
          className={`stripe-ui__btn ${source === "combined" ? "stripe-ui__btn--primary" : "stripe-ui__btn--secondary"}`}
          onClick={() => setSource("combined")}
        >
          Combined
        </button>
        <button
          className={`stripe-ui__btn ${source === "salesled" ? "stripe-ui__btn--primary" : "stripe-ui__btn--secondary"}`}
          onClick={() => setSource("salesled")}
        >
          HubSpot
        </button>
        <button
          className={`stripe-ui__btn ${source === "selfserve" ? "stripe-ui__btn--primary" : "stripe-ui__btn--secondary"}`}
          onClick={() => setSource("selfserve")}
        >
          Self-serve
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "0.65rem" }}>
        <span className="stripe-ui__hint" style={{ color: "#4f8df9" }}>NDR</span>
        <span className="stripe-ui__hint" style={{ color: "#ef4444" }}>GDR</span>
      </div>

      {points.length === 0 ? (
        <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.9rem", marginBottom: 0 }}>
          No data for selected range.
        </p>
      ) : (
        <>
          <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem", cursor: "pointer" }}>
            <svg
              ref={chartRef}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label="NDR and GDR over time chart"
              style={{ width: "100%", display: "block" }}
              onClick={() => setShowTable(true)}
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
              <line
                x1={paddingLeft}
                y1={paddingTop}
                x2={paddingLeft}
                y2={paddingTop + plotHeight}
                stroke="#36557f"
                strokeWidth={1}
              />

              {points.map((point, idx) => {
                const left = idx === 0 ? paddingLeft : (xAt(idx - 1) + xAt(idx)) / 2;
                const right = idx === points.length - 1 ? paddingLeft + plotWidth : (xAt(idx) + xAt(idx + 1)) / 2;
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

              <path d={ndrPath} fill="none" stroke="#4f8df9" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              <path d={gdrPath} fill="none" stroke="#ef4444" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

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
                  <text x={tooltipX + 10} y={tooltipY + 33} fill="#4f8df9" fontSize="12.5" fontWeight="600">
                    NDR: {formatPercent(hoveredNdr)}
                  </text>
                  <text x={tooltipX + 10} y={tooltipY + 50} fill="#ef4444" fontSize="12.5" fontWeight="600">
                    GDR: {formatPercent(hoveredGdr)}
                  </text>
                </g>
              )}

              {points.map((point, idx) => (
                <g key={point.key}>
                  <circle
                    cx={xAt(idx)}
                    cy={yAt(ndrFor(point))}
                    r={hoverIndex === idx ? 4.6 : 3.2}
                    fill="#4f8df9"
                    data-tooltip={`${point.label}: NDR ${formatPercent(ndrFor(point))}`}
                    onMouseEnter={() => setHoverIndex(idx)}
                  />
                  <circle
                    cx={xAt(idx)}
                    cy={yAt(gdrFor(point))}
                    r={hoverIndex === idx ? 4.6 : 3.2}
                    fill="#ef4444"
                    data-tooltip={`${point.label}: GDR ${formatPercent(gdrFor(point))}`}
                    onMouseEnter={() => setHoverIndex(idx)}
                  />
                </g>
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
                {formatPercent(maxValue)}
              </text>
              <text x={paddingLeft - 8} y={paddingTop + plotHeight} textAnchor="end" fill="#8ea7cb" fontSize="12">
                {formatPercent(minValue)}
              </text>
            </svg>
          </div>

          {showTable && (
            <div className="stripe-ui__panel" style={{ marginTop: "0.9rem", padding: "0.85rem" }}>
              <div className="stripe-ui__section-head" style={{ marginBottom: "0.65rem" }}>
                <h3 className="stripe-ui__panel-title" style={{ margin: 0, fontSize: "1rem" }}>
                  NDR / GDR Table
                </h3>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button className="stripe-ui__btn stripe-ui__btn--secondary" onClick={exportTableCsv}>
                    Export CSV
                  </button>
                  <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => setShowTable(false)}>
                    Hide table
                  </button>
                </div>
              </div>

              <div className="stripe-ui__table-wrap">
                <table className="stripe-ui__table" aria-label="NDR and GDR table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      {points.map((point) => (
                        <th key={`retention-head-${point.key}`} className="stripe-ui__num">
                          {point.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>selfserve GDR</td>
                      {points.map((point) => (
                        <td key={`row-self-gdr-${point.key}`} className="stripe-ui__num">
                          {formatPercent(point.selfserveGdrPct)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td>hubspot GDR</td>
                      {points.map((point) => (
                        <td key={`row-sales-gdr-${point.key}`} className="stripe-ui__num">
                          {formatPercent(point.salesledGdrPct)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td>Combined GDR</td>
                      {points.map((point) => (
                        <td key={`row-combined-gdr-${point.key}`} className="stripe-ui__num">
                          {formatPercent(point.combinedGdrPct)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td>selfserve NDR</td>
                      {points.map((point) => (
                        <td key={`row-self-ndr-${point.key}`} className="stripe-ui__num">
                          {formatPercent(point.selfserveNdrPct)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td>hubspot NDR</td>
                      {points.map((point) => (
                        <td key={`row-sales-ndr-${point.key}`} className="stripe-ui__num">
                          {formatPercent(point.salesledNdrPct)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td>Combined NDR</td>
                      {points.map((point) => (
                        <td key={`row-combined-ndr-${point.key}`} className="stripe-ui__num">
                          {formatPercent(point.combinedNdrPct)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

type GrowthBreakdownChartProps = {
  points: CombinedPoint[];
  currency: string;
};

function GrowthBreakdownChart({ points, currency }: GrowthBreakdownChartProps) {
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

  const bars = points.map((point) => {
    const components = [
      { key: "new", label: "New", value: point.newMrr, color: "#1fc16b" },
      { key: "expansion", label: "Expansion", value: point.expansionMrr, color: "#2698f0" },
      { key: "contraction", label: "Contraction", value: point.contractionMrr, color: "#f59e0b" },
      { key: "churn", label: "Churn", value: point.churnMrr, color: "#ef4444" },
    ] as const;

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
  const chartTitle = "Growth Breakdown";
  const downloadChart = useCallback(async () => {
    if (!chartRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadSvgAsPng(chartRef.current, "combined-billing-overview-growth-breakdown");
    } finally {
      setDownloading(false);
    }
  }, [downloading]);

  return (
    <section className="stripe-ui__panel ui-reveal ui-reveal-2">
      <div className="stripe-ui__section-head">
        <div>
          <h2 className="stripe-ui__panel-title">{chartTitle}</h2>
          <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
            Combined New, Expansion, Contraction, and Churn contributions (MRR).
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
        <span className="stripe-ui__hint" style={{ color: "#1fc16b" }}>New</span>
        <span className="stripe-ui__hint" style={{ color: "#2698f0" }}>Expansion</span>
        <span className="stripe-ui__hint" style={{ color: "#f59e0b" }}>Contraction</span>
        <span className="stripe-ui__hint" style={{ color: "#ef4444" }}>Churn</span>
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
  points: CombinedPoint[];
  valueAccessor: (point: CombinedPoint) => number;
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
      await downloadSvgAsPng(chartRef.current, `combined-billing-overview-${title}`);
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

export default function CombinedBillingOverviewPage() {
  const defaults = useMemo(() => defaultDateRange(), []);

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [grain, setGrain] = useState<CombinedGrain>("monthly");

  const [loading, setLoading] = useState(false);
  const [cacLoading, setCacLoading] = useState(false);
  const [hasRunOnce, setHasRunOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CombinedOverviewData | null>(null);
  const [lineChartMode, setLineChartMode] = useState<"combined" | "source">("combined");
  const [ltvNotice, setLtvNotice] = useState<string | null>(null);
  const [arrPerEmployeeNotice, setArrPerEmployeeNotice] = useState<string | null>(null);
  const [salesCycleNotice, setSalesCycleNotice] = useState<string | null>(null);
  const [cacNotice, setCacNotice] = useState<string | null>(null);
  const [selectedCacAccountIds, setSelectedCacAccountIds] = useState<string[]>([]);
  const [cacAccountMenuTarget, setCacAccountMenuTarget] = useState<CacMenuTarget>(null);
  const [cacExpenseAccounts, setCacExpenseAccounts] = useState<QuickBooksExpenseAccount[]>([]);
  const [cacExpenseAccountsLoaded, setCacExpenseAccountsLoaded] = useState(false);
  const [cacExpenseAccountsLoading, setCacExpenseAccountsLoading] = useState(false);
  const [cacExpenseAccountsError, setCacExpenseAccountsError] = useState("");
  const [savingCacDefaultSelection, setSavingCacDefaultSelection] = useState(false);
  const [cacDefaultSaveStatus, setCacDefaultSaveStatus] = useState("");
  const [showProjectedArrBreakdown, setShowProjectedArrBreakdown] = useState(false);
  const [selectedAiSpendExclusionPoint, setSelectedAiSpendExclusionPoint] = useState<{
    chartTitle: string;
    pointLabel: string;
    periodStart: string;
    monthKey: string;
  } | null>(null);
  const [downloadingAiSpendBreakdownCsv, setDownloadingAiSpendBreakdownCsv] = useState(false);
  const [aiSpendBreakdownCsvError, setAiSpendBreakdownCsvError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const runRequestRef = useRef(0);

  const fetchApiGetJson = useCallback(async <T,>(url: string): Promise<T> => {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
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
    return json as T;
  }, []);

  const loadCacDefaultSelection = useCallback(async () => {
    try {
      const payload = await fetchApiGetJson<QuickBooksCacAccountDefaultResponse>(
        "/api/quickbooks/cac-account-default",
      );
      const ids = Array.isArray(payload.selectedAccountIds)
        ? normalizeIdList(payload.selectedAccountIds.map((id) => String(id || "")))
        : [];
      setSelectedCacAccountIds(ids);
    } catch {
      setSelectedCacAccountIds([]);
    }
  }, [fetchApiGetJson]);

  const loadAuthRole = useCallback(async () => {
    try {
      const payload = await fetchApiGetJson<AuthSessionResponse>("/api/auth/session");
      const role = String(payload?.user?.role || "viewer").trim().toLowerCase();
      setIsAdmin(role === "admin");
    } catch {
      setIsAdmin(false);
    }
  }, [fetchApiGetJson]);

  const loadCacExpenseAccounts = useCallback(async () => {
    setCacExpenseAccountsLoading(true);
    setCacExpenseAccountsError("");
    try {
      const payload = await fetchApiGetJson<QuickBooksExpenseAccountsResponse>(
        "/api/quickbooks/expense-accounts",
      );
      const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
      const accountIdSet = new Set(
        accounts
          .map((account) => normalizeEntityId(String(account.id || "")))
          .filter(Boolean),
      );
      setCacExpenseAccounts(accounts);
      setSelectedCacAccountIds((prev) => normalizeIdList(prev).filter((id) => accountIdSet.has(id)));
      setCacExpenseAccountsLoaded(true);
    } catch (e: unknown) {
      setCacExpenseAccountsError(conciseErrorMessage(e, "Failed to load expense accounts."));
    } finally {
      setCacExpenseAccountsLoading(false);
    }
  }, [fetchApiGetJson]);

  useEffect(() => {
    void loadAuthRole();
  }, [loadAuthRole]);

  useEffect(() => {
    void loadCacDefaultSelection();
  }, [loadCacDefaultSelection]);

  const toggleCacAccountMenu = useCallback((target: CacFxProvider) => {
    if (!isAdmin) return;
    setCacAccountMenuTarget((prev) => {
      const next = prev === target ? null : target;
      if (next && !cacExpenseAccountsLoaded && !cacExpenseAccountsLoading) {
        void loadCacExpenseAccounts();
      }
      return next;
    });
    setCacDefaultSaveStatus("");
  }, [cacExpenseAccountsLoaded, cacExpenseAccountsLoading, isAdmin, loadCacExpenseAccounts]);

  const toggleCacAccountSelection = useCallback((accountId: string) => {
    const id = normalizeEntityId(String(accountId || ""));
    if (!id) return;
    setSelectedCacAccountIds((prev) => {
      const normalizedPrev = normalizeIdList(prev);
      if (normalizedPrev.includes(id)) return normalizedPrev.filter((value) => value !== id);
      return [...normalizedPrev, id];
    });
    setCacDefaultSaveStatus("");
  }, []);

  const selectAllCacAccounts = useCallback(() => {
    const ids = normalizeIdList(
      cacExpenseAccounts
        .map((account) => String(account.id || ""))
        .filter(Boolean),
    );
    setSelectedCacAccountIds(ids);
    setCacDefaultSaveStatus("");
  }, [cacExpenseAccounts]);

  const clearCacAccounts = useCallback(() => {
    setSelectedCacAccountIds([]);
    setCacDefaultSaveStatus("");
  }, []);

  const saveCacDefaultSelection = useCallback(async () => {
    if (!isAdmin) return;
    setSavingCacDefaultSelection(true);
    setCacExpenseAccountsError("");
    setCacDefaultSaveStatus("");
    try {
      const res = await fetch("/api/quickbooks/cac-account-default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds: normalizeIdList(selectedCacAccountIds) }),
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
      const payload = (json || {}) as Partial<QuickBooksCacAccountDefaultResponse>;
      const ids = Array.isArray(payload.selectedAccountIds)
        ? normalizeIdList(payload.selectedAccountIds.map((id) => String(id || "")))
        : [];
      setSelectedCacAccountIds(ids);
      setCacDefaultSaveStatus(
        ids.length > 0
          ? `Saved default selection (${ids.length} account${ids.length === 1 ? "" : "s"}).`
          : "Saved default selection (automatic matching mode).",
      );
    } catch (e: unknown) {
      setCacExpenseAccountsError(conciseErrorMessage(e, "Failed to save default selection."));
    } finally {
      setSavingCacDefaultSelection(false);
    }
  }, [isAdmin, selectedCacAccountIds]);

  async function run() {
    const requestId = runRequestRef.current + 1;
    runRequestRef.current = requestId;
    const isStale = () => runRequestRef.current !== requestId;

    setHasRunOnce(true);
    setLoading(true);
    setCacLoading(false);
    setError(null);
    setLtvNotice(null);
    setArrPerEmployeeNotice(null);
    setSalesCycleNotice(null);
    setCacNotice(null);
    setShowProjectedArrBreakdown(false);
    setSelectedAiSpendExclusionPoint(null);
    setAiSpendBreakdownCsvError("");

    try {
      const fetchJson = async <T,>(url: string, payload: unknown): Promise<T> => {
        const res = await fetch(url, {
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
        return json as T;
      };

      const normalizedSelectedCacAccountIds = normalizeIdList(selectedCacAccountIds);
      const selectedCacAccountIdSet = new Set(normalizedSelectedCacAccountIds);
      const selectedCacAccountNames = Array.from(
        new Set(
          cacExpenseAccounts
            .filter((account) => selectedCacAccountIdSet.has(normalizeEntityId(String(account.id || ""))))
            .map((account) => String(account.fullyQualifiedName || account.name || "").trim())
            .filter(Boolean),
        ),
      );
      const overviewPromise = fetchJson<CombinedBillingOverviewReportResponse>("/api/combined-billing-overview-report", {
        startDate,
        endDate,
        grain,
        accountIds: normalizedSelectedCacAccountIds,
        accountNames: selectedCacAccountNames,
        includeCac: false,
      });
      const liveArrPromise = fetchJson<CombinedLiveArrResponse>("/api/combined-live-arr", {}).catch(
        () => null as CombinedLiveArrResponse | null,
      );
      const overview = await overviewPromise;
      if (isStale()) return;

      setLtvNotice(overview.ltvNotice);
      setArrPerEmployeeNotice(overview.arrPerEmployeeNotice);
      setSalesCycleNotice(overview.salesCycleNotice);
      setCacNotice(overview.cacNotice);

      setData((prev) => ({
        startDate: overview.startDate,
        endDate: overview.endDate,
        grain: overview.grain,
        targetCurrency: String(overview.targetCurrency || "USD").toUpperCase(),
        currentMrr: round2(overview.currentMrr || 0),
        currentArr: round2(overview.currentArr || 0),
        liveArr: round2(prev?.liveArr || 0),
        liveArrAsOfUtc: String(prev?.liveArrAsOfUtc || ""),
        projectedArr: round2(prev?.projectedArr || 0),
        projectedArrBreakdown: {
          aiSpendMonthlyWithoutExclusions: round2(
            prev?.projectedArrBreakdown?.aiSpendMonthlyWithoutExclusions || 0,
          ),
          aiSpendMonthlyWithExclusions: round2(
            prev?.projectedArrBreakdown?.aiSpendMonthlyWithExclusions || 0,
          ),
          aiSpendAnnualizedArr: round2(prev?.projectedArrBreakdown?.aiSpendAnnualizedArr || 0),
          selfserveTodayArr: round2(prev?.projectedArrBreakdown?.selfserveTodayArr || 0),
          selfserveProjectedArr: round2(prev?.projectedArrBreakdown?.selfserveProjectedArr || 0),
          salesledCurrentArr: round2(prev?.projectedArrBreakdown?.salesledCurrentArr || 0),
        },
        projectedArrEomFlatAdjusted: round2(prev?.projectedArrEomFlatAdjusted || 0),
        projectedArrEomFlatFlat: round2(prev?.projectedArrEomFlatFlat || 0),
        points: overview.points || [],
        linePoints: overview.linePoints || overview.points || [],
        lineSourcePoints: {
          hubspot: overview.lineSourcePoints?.hubspot || overview.lineSourcePoints?.salesled || [],
          selfserve: overview.lineSourcePoints?.selfserve || [],
          salesAssist: overview.lineSourcePoints?.salesAssist || [],
          aiSpend: overview.lineSourcePoints?.aiSpend || [],
        },
        arrPerEmployeePoints: overview.arrPerEmployeePoints || [],
        salesCyclePoints: overview.salesCyclePoints || [],
        retentionPoints: overview.retentionPoints || [],
        ltvPoints: overview.ltvPoints || [],
        cacPoints: overview.cacPoints || [],
        cacCurrencyLayerPoints: overview.cacCurrencyLayerPoints || [],
        cacCadPoints: overview.cacCadPoints || [],
        cacCadCurrency: String(overview.cacCadCurrency || "CAD").toUpperCase(),
        aiSpendExcludedEnterprisePrepaidCustomers: overview.aiSpendExcludedEnterprisePrepaidCustomers || [],
        aiSpendDailyPointBreakdown: overview.aiSpendDailyPointBreakdown || [],
      }));

      setLoading(false);
      void (async () => {
        try {
          const liveArrData = await liveArrPromise;
          if (!liveArrData) return;
          if (isStale()) return;
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              liveArr: round2(liveArrData.liveArr || 0),
              liveArrAsOfUtc: String(liveArrData.generatedAtUtc || ""),
              projectedArr: round2(liveArrData.projectedArr || 0),
              projectedArrBreakdown: {
                aiSpendMonthlyWithoutExclusions: round2(
                  liveArrData.projectedArrBreakdown?.aiSpendMonthlyWithoutExclusions || 0,
                ),
                aiSpendMonthlyWithExclusions: round2(
                  liveArrData.projectedArrBreakdown?.aiSpendMonthlyWithExclusions || 0,
                ),
                aiSpendAnnualizedArr: round2(liveArrData.projectedArrBreakdown?.aiSpendAnnualizedArr || 0),
                selfserveTodayArr: round2(liveArrData.projectedArrBreakdown?.selfserveTodayArr || 0),
                selfserveProjectedArr: round2(liveArrData.projectedArrBreakdown?.selfserveProjectedArr || 0),
                salesledCurrentArr: round2(liveArrData.projectedArrBreakdown?.salesledCurrentArr || 0),
              },
              projectedArrEomFlatAdjusted: round2(liveArrData.projectedArrEomFlatAdjusted || 0),
              projectedArrEomFlatFlat: round2(liveArrData.projectedArrEomFlatFlat || 0),
            };
          });
        } catch {
          // Keep overview visible even if live ARR request fails.
        }
      })();

      if (grain !== "monthly") {
        setLoading(false);
        setCacLoading(false);
        return;
      }
      setLoading(false);
      setCacLoading(true);
      void (async () => {
        try {
          const overviewWithCac = await fetchJson<CombinedBillingOverviewReportResponse>(
            "/api/combined-billing-overview-report",
            {
              startDate,
              endDate,
              grain,
              accountIds: normalizedSelectedCacAccountIds,
              accountNames: selectedCacAccountNames,
              includeCac: true,
            },
          );
          if (isStale()) return;
          setCacNotice(overviewWithCac.cacNotice);
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              cacPoints: overviewWithCac.cacPoints || [],
              cacCurrencyLayerPoints: overviewWithCac.cacCurrencyLayerPoints || [],
              cacCadPoints: overviewWithCac.cacCadPoints || [],
              cacCadCurrency: String(overviewWithCac.cacCadCurrency || prev.cacCadCurrency || "CAD").toUpperCase(),
              aiSpendExcludedEnterprisePrepaidCustomers:
                overviewWithCac.aiSpendExcludedEnterprisePrepaidCustomers ||
                prev.aiSpendExcludedEnterprisePrepaidCustomers ||
                [],
              aiSpendDailyPointBreakdown:
                overviewWithCac.aiSpendDailyPointBreakdown || prev.aiSpendDailyPointBreakdown || [],
            };
          });
        } catch (e: unknown) {
          if (isStale()) return;
          const message = conciseErrorMessage(e, "Failed to load CAC details.");
          setCacNotice(`CAC unavailable: ${message}`);
        } finally {
          if (!isStale()) setCacLoading(false);
        }
      })();
    } catch (e: unknown) {
      if (isStale()) return;
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      if (!isStale()) {
        setLoading(false);
      }
    }
  }

  const points = useMemo(() => data?.points ?? [], [data]);
  const linePoints = useMemo(() => data?.linePoints ?? data?.points ?? [], [data]);
  const lineSourcePoints = useMemo<LineSourcePoints>(
    () =>
      data?.lineSourcePoints || {
        hubspot: [],
        selfserve: [],
        salesAssist: [],
        aiSpend: [],
      },
    [data],
  );
  const arrPerEmployeePoints = useMemo(() => data?.arrPerEmployeePoints ?? [], [data]);
  const salesCyclePoints = useMemo(() => data?.salesCyclePoints ?? [], [data]);
  const retentionPoints = useMemo(() => data?.retentionPoints ?? [], [data]);
  const ltvPoints = useMemo(() => data?.ltvPoints ?? [], [data]);
  const cacPoints = useMemo(() => data?.cacPoints ?? [], [data]);
  const currency = useMemo(() => data?.targetCurrency || "USD", [data]);
  const aiSpendExcludedEnterprisePrepaidCustomers = useMemo(
    () => data?.aiSpendExcludedEnterprisePrepaidCustomers ?? [],
    [data],
  );
  const aiSpendDailyPointBreakdownByKey = useMemo(() => {
    const out = new Map<
      string,
      {
        key: string;
        label: string;
        periodStart: string;
        periodEnd: string;
        aiSpendWithoutExclusions: number;
        aiSpendWithExclusions: number;
        aiSpendExcluded: number;
      }
    >();
    for (const row of data?.aiSpendDailyPointBreakdown || []) {
      const key = String(row.key || row.periodStart || "").trim();
      if (!key) continue;
      out.set(key, {
        key,
        label: String(row.label || key),
        periodStart: String(row.periodStart || key),
        periodEnd: String(row.periodEnd || key),
        aiSpendWithoutExclusions: round2(Number(row.aiSpendWithoutExclusions || 0)),
        aiSpendWithExclusions: round2(Number(row.aiSpendWithExclusions || 0)),
        aiSpendExcluded: round2(Number(row.aiSpendExcluded || 0)),
      });
    }
    return out;
  }, [data]);
  const aiSpendExcludedByMonth = useMemo(() => {
    const out = new Map<string, AiSpendExcludedEnterprisePrepaidCustomer[]>();
    for (const row of aiSpendExcludedEnterprisePrepaidCustomers) {
      const monthKey = String(row.monthKey || "").trim();
      if (!monthKey) continue;
      if (!out.has(monthKey)) out.set(monthKey, []);
      out.get(monthKey)!.push(row);
    }
    return out;
  }, [aiSpendExcludedEnterprisePrepaidCustomers]);
  const selectedAiSpendExclusions = useMemo(() => {
    if (!selectedAiSpendExclusionPoint) return [];
    return aiSpendExcludedByMonth.get(selectedAiSpendExclusionPoint.monthKey) || [];
  }, [aiSpendExcludedByMonth, selectedAiSpendExclusionPoint]);
  const selectedAiSpendPointBreakdown = useMemo(() => {
    if (!selectedAiSpendExclusionPoint) return null;
    return aiSpendDailyPointBreakdownByKey.get(selectedAiSpendExclusionPoint.periodStart) || null;
  }, [aiSpendDailyPointBreakdownByKey, selectedAiSpendExclusionPoint]);
  const handleGroupedSourcePointClick = useCallback(
    (payload: GroupedSourcePointClickPayload, chartTitle: string) => {
      if (lineChartMode !== "source" || grain !== "daily") return;
      if (payload.seriesId !== "ai") return;
      const periodStart = String(payload.point.periodStart || "").slice(0, 10);
      const monthKey = periodStart.length >= 7 ? periodStart.slice(0, 7) : "";
      if (!monthKey) return;
      setAiSpendBreakdownCsvError("");
      setSelectedAiSpendExclusionPoint({
        chartTitle,
        pointLabel: String(payload.point.label || ""),
        periodStart,
        monthKey,
      });
    },
    [grain, lineChartMode],
  );
  const downloadAiSpendBreakdownCsv = useCallback(async () => {
    if (!selectedAiSpendExclusionPoint) return;
    setDownloadingAiSpendBreakdownCsv(true);
    setAiSpendBreakdownCsvError("");
    try {
      const res = await fetch("/api/combined-billing-overview-ai-spend-daily-breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          selectedDate: selectedAiSpendExclusionPoint.periodStart,
          targetCurrency: currency,
        }),
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
      const payload = json as AiSpendDailyBreakdownResponse;
      const csvRows: Array<Array<string | number>> = [
        [
          "snapshot_date",
          "snapshot_timestamp_utc",
          "customer_id",
          "customer_name",
          "ai_spend_after_exclusions_annualized_arr",
          "ai_spend_after_exclusions_mrr",
          "ai_spend_before_exclusions_annualized_arr",
          "total_excluded_annualized_arr",
          "line_count",
          "target_currency",
          "report_start_date",
          "report_end_date",
          "selected_date",
        ],
        ...(payload.rows || []).map((row) => [
          row.snapshotDate || selectedAiSpendExclusionPoint.periodStart,
          row.snapshotTimestampUtc || "",
          row.customerId || "(blank)",
          row.customerName || "(blank)",
          round2(row.annualizedArr || 0),
          round2((row.annualizedArr || 0) / 12),
          round2(row.annualizedArrWithoutExclusions || 0),
          round2(row.annualizedArrExcluded || 0),
          Math.max(0, Math.round(row.lineCount || 0)),
          payload.targetCurrency || currency,
          startDate,
          endDate,
          selectedAiSpendExclusionPoint.periodStart,
        ]),
      ];
      downloadCsv(
        `combined-billing-overview-ai-spend-after-exclusions-${selectedAiSpendExclusionPoint.periodStart}.csv`,
        csvRows,
      );
    } catch (e: unknown) {
      setAiSpendBreakdownCsvError(conciseErrorMessage(e, "Failed to download AI spend breakdown CSV."));
    } finally {
      setDownloadingAiSpendBreakdownCsv(false);
    }
  }, [currency, endDate, selectedAiSpendExclusionPoint, startDate]);

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Revenue intelligence</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Combined Billing Overview</h1>
            <p className="stripe-ui__subtitle">
              Combined billing trends where each metric is HubSpot (contracted ARR cloud-only method) + Stripe Billing
              Overview (Stripe method) for the same period.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Controls</h2>
        <p className="stripe-ui__panel-subtitle">Choose date range and grain, then load combined metrics.</p>

        <div className="stripe-ui__control-grid">
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="combined-start-date">
              Start date
            </label>
            <input
              id="combined-start-date"
              className="stripe-ui__control"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="combined-end-date">
              End date
            </label>
            <input
              id="combined-end-date"
              className="stripe-ui__control"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="combined-grain">
              Time grain
            </label>
            <select
              id="combined-grain"
              className="stripe-ui__control"
              value={grain}
              onChange={(e) => setGrain(e.target.value as CombinedGrain)}
            >
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="combined-run">
              Load charts
            </label>
            <button id="combined-run" className="stripe-ui__btn stripe-ui__btn--primary" onClick={run} disabled={loading}>
              {loading ? "Loading..." : "Run"}
            </button>
          </div>
        </div>
      </section>

      {loading && (
        <section className="stripe-ui__panel stripe-ui__loading-panel ui-reveal ui-reveal-2" aria-live="polite" aria-busy="true">
          <h2 className="stripe-ui__panel-title">Loading charts...</h2>
          <p className="stripe-ui__panel-subtitle">Querying Stripe and HubSpot sources and combining metrics.</p>
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

      {!loading && !error && cacNotice && (
        <section className="stripe-ui__panel ui-reveal ui-reveal-2">
          <p className="stripe-ui__panel-subtitle" style={{ margin: 0 }}>
            {cacNotice}
          </p>
        </section>
      )}

      {!loading && !error && ltvNotice && (
        <section className="stripe-ui__panel ui-reveal ui-reveal-2">
          <p className="stripe-ui__panel-subtitle" style={{ margin: 0 }}>
            {ltvNotice}
          </p>
        </section>
      )}

      {!loading && !error && arrPerEmployeeNotice && (
        <section className="stripe-ui__panel ui-reveal ui-reveal-2">
          <p className="stripe-ui__panel-subtitle" style={{ margin: 0 }}>
            {arrPerEmployeeNotice}
          </p>
        </section>
      )}

      {!loading && !error && salesCycleNotice && (
        <section className="stripe-ui__panel ui-reveal ui-reveal-2">
          <p className="stripe-ui__panel-subtitle" style={{ margin: 0 }}>
            {salesCycleNotice}
          </p>
        </section>
      )}

      {!loading && !error && data && (
        <>
          <section className="stripe-ui__panel ui-reveal ui-reveal-2">
            <div className="stripe-ui__stats">
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Live ARR</p>
                <p className="stripe-ui__stat-value">{formatMoney(data.liveArr, currency)}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Live MRR</p>
                <p className="stripe-ui__stat-value">{formatMoney(round2(data.liveArr / 12), currency)}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Projected ARR (EOM)</p>
                <button
                  type="button"
                  className="stripe-ui__stat-value"
                  onClick={() => setShowProjectedArrBreakdown((prev) => !prev)}
                  title="Click to show projected ARR breakdown"
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    margin: 0,
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  {formatMoney(data.projectedArr, currency)}
                </button>
                <p className="stripe-ui__hint">
                  {showProjectedArrBreakdown ? "Click number to hide breakdown" : "Click number for breakdown"}
                </p>
                {showProjectedArrBreakdown && (
                  <div className="stripe-ui__hint" style={{ marginTop: "0.35rem", lineHeight: 1.35 }}>
                    <div>
                      AI Spend (no exclusions):{" "}
                      {formatMoney(data.projectedArrBreakdown.aiSpendMonthlyWithoutExclusions, currency)}
                    </div>
                    <div>
                      AI Spend (with exclusions):{" "}
                      {formatMoney(data.projectedArrBreakdown.aiSpendMonthlyWithExclusions, currency)}
                    </div>
                    <div>
                      AI Spend annualized: {formatMoney(data.projectedArrBreakdown.aiSpendAnnualizedArr, currency)}
                    </div>
                    <div>Self-serve today: {formatMoney(data.projectedArrBreakdown.selfserveTodayArr, currency)}</div>
                    <div>
                      Self-serve projected: {formatMoney(data.projectedArrBreakdown.selfserveProjectedArr, currency)}
                    </div>
                    <div>
                      Sales-led current C-ARR: {formatMoney(data.projectedArrBreakdown.salesledCurrentArr, currency)}
                    </div>
                  </div>
                )}
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Projected ARR EOM Flat Adjusted</p>
                <p className="stripe-ui__stat-value">{formatMoney(data.projectedArrEomFlatAdjusted, currency)}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Projected ARR EOM Flat Flat</p>
                <p className="stripe-ui__stat-value">{formatMoney(data.projectedArrEomFlatFlat, currency)}</p>
              </div>
            </div>
          </section>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
              gap: "0.95rem",
              alignItems: "start",
            }}
          >
            <section
              className="stripe-ui__panel ui-reveal ui-reveal-2"
              style={{ gridColumn: "1 / -1", padding: "0.8rem 0.95rem" }}
            >
              <div className="stripe-ui__section-head" style={{ marginBottom: 0 }}>
                <h2 className="stripe-ui__panel-title" style={{ margin: 0, fontSize: "1rem" }}>
                  Line Chart View
                </h2>
                <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                  <button
                    className={`stripe-ui__btn ${lineChartMode === "combined" ? "stripe-ui__btn--primary" : "stripe-ui__btn--secondary"}`}
                    onClick={() => setLineChartMode("combined")}
                  >
                    Combined
                  </button>
                  <button
                    className={`stripe-ui__btn ${lineChartMode === "source" ? "stripe-ui__btn--primary" : "stripe-ui__btn--secondary"}`}
                    onClick={() => setLineChartMode("source")}
                  >
                    Grouped by source
                  </button>
                </div>
              </div>
              <p className="stripe-ui__hint" style={{ marginTop: "0.45rem", marginBottom: 0 }}>
                Combined includes HubSpot + self-serve + sales assist + AI spend.
              </p>
            </section>

            {lineChartMode === "combined" ? (
              <LineChartCard
                title="MRR Over Time"
                subtitle="Combined MRR at period end (HubSpot + self-serve + sales assist + AI spend)."
                points={linePoints}
                valueAccessor={(p) => p.mrrEnd}
                valueFormatter={(v) => formatMoney(v, currency)}
                stroke="#4f8df9"
              />
            ) : (
              <GroupedSourceLineChartCard
                title="MRR Over Time"
                subtitle="MRR by source."
                series={[
                  { id: "hubspot", label: "HubSpot", color: "#4f8df9", points: lineSourcePoints.hubspot },
                  { id: "selfserve", label: "Self-serve", color: "#1fc16b", points: lineSourcePoints.selfserve },
                  { id: "sales_assist", label: "Sales assist", color: "#14b8a6", points: lineSourcePoints.salesAssist },
                  { id: "ai", label: "AI spend", color: "#f59e0b", points: lineSourcePoints.aiSpend },
                ]}
                valueAccessor={(p) => p.mrrEnd}
                valueFormatter={(v) => formatMoney(v, currency)}
                onPointClick={(payload) => handleGroupedSourcePointClick(payload, "MRR Over Time")}
              />
            )}

            {lineChartMode === "source" && grain === "daily" && (
              <section className="stripe-ui__panel ui-reveal ui-reveal-2" style={{ gridColumn: "1 / -1" }}>
                <div className="stripe-ui__section-head">
                  <div>
                    <h2 className="stripe-ui__panel-title">AI Spend Exclusions For Selected Point</h2>
                    <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
                      Click an AI spend point to view exclusions used for that day&apos;s month.
                    </p>
                  </div>
                  {selectedAiSpendExclusionPoint && (
                    <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                      <button
                        className="stripe-ui__btn stripe-ui__btn--secondary"
                        onClick={() => void downloadAiSpendBreakdownCsv()}
                        disabled={downloadingAiSpendBreakdownCsv}
                      >
                        {downloadingAiSpendBreakdownCsv ? "Preparing CSV..." : "Download CSV"}
                      </button>
                      <button
                        className="stripe-ui__btn stripe-ui__btn--ghost"
                        onClick={() => {
                          setSelectedAiSpendExclusionPoint(null);
                          setAiSpendBreakdownCsvError("");
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
                {aiSpendBreakdownCsvError ? (
                  <p className="stripe-ui__hint" style={{ marginTop: "0.45rem", color: "#fca5a5" }}>
                    {aiSpendBreakdownCsvError}
                  </p>
                ) : null}

                {!selectedAiSpendExclusionPoint ? (
                  <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.7rem", marginBottom: 0 }}>
                    No AI point selected.
                  </p>
                ) : (
                  <>
                    <div className="stripe-ui__stats" style={{ marginTop: "0.75rem" }}>
                      <div className="stripe-ui__stat">
                        <p className="stripe-ui__stat-label">AI spend without exclusions</p>
                        <p className="stripe-ui__stat-value">
                          {formatMoney(selectedAiSpendPointBreakdown?.aiSpendWithoutExclusions || 0, currency)}
                        </p>
                      </div>
                      <div className="stripe-ui__stat">
                        <p className="stripe-ui__stat-label">AI spend with exclusions</p>
                        <p className="stripe-ui__stat-value">
                          {formatMoney(selectedAiSpendPointBreakdown?.aiSpendWithExclusions || 0, currency)}
                        </p>
                      </div>
                      <div className="stripe-ui__stat">
                        <p className="stripe-ui__stat-label">Total excluded</p>
                        <p className="stripe-ui__stat-value">
                          {formatMoney(selectedAiSpendPointBreakdown?.aiSpendExcluded || 0, currency)}
                        </p>
                      </div>
                    </div>
                    <p className="stripe-ui__hint" style={{ marginTop: "0.7rem", marginBottom: "0.5rem" }}>
                      Selected from {selectedAiSpendExclusionPoint.chartTitle}: {selectedAiSpendExclusionPoint.pointLabel} (
                      {selectedAiSpendExclusionPoint.periodStart}), month key {selectedAiSpendExclusionPoint.monthKey}.
                    </p>
                    {selectedAiSpendExclusions.length === 0 ? (
                      <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.2rem", marginBottom: 0 }}>
                        No exclusions for {selectedAiSpendExclusionPoint.pointLabel} (
                        {selectedAiSpendExclusionPoint.monthKey}).
                      </p>
                    ) : (
                      <div className="stripe-ui__table-wrap" style={{ maxHeight: "20rem", overflow: "auto" }}>
                        <table className="stripe-ui__table" aria-label="AI spend exclusions for selected daily point">
                          <thead>
                            <tr>
                              <th>Customer ID</th>
                              <th>Customer Name</th>
                              <th>Email</th>
                              <th className="stripe-ui__num">Prepaid Applied</th>
                              <th className="stripe-ui__num">Available Credit</th>
                              <th>As Of Date</th>
                              <th>Accounts</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedAiSpendExclusions.map((row, idx) => (
                              <tr key={`${selectedAiSpendExclusionPoint.monthKey}-${row.customerId}-${row.asOfDate}-${idx}`}>
                                <td>{row.customerId || "(blank)"}</td>
                                <td>{row.customerName || "(blank)"}</td>
                                <td>{row.customerEmail || "(blank)"}</td>
                                <td className="stripe-ui__num">{formatMoney(row.prepaidAppliedMajor || 0, currency)}</td>
                                <td className="stripe-ui__num">{formatMoney(row.availableCreditMajor || 0, currency)}</td>
                                <td>{row.asOfDate || "(blank)"}</td>
                                <td>{(row.accountNames || []).length ? row.accountNames.join(", ") : "(none)"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            <GrowthBreakdownChart points={points} currency={currency} />

            {lineChartMode === "combined" ? (
              <LineChartCard
                title="MRR Growth Rate Over Time"
                subtitle="Period-over-period combined MRR growth rate (including AI spend)."
                points={linePoints}
                valueAccessor={(p) => p.mrrGrowthRatePct}
                valueFormatter={(v) => formatPercent(v)}
                stroke="#f59e0b"
                includeZero
              />
            ) : (
              <GroupedSourceLineChartCard
                title="MRR Growth Rate Over Time"
                subtitle="MRR growth rate by source."
                series={[
                  { id: "hubspot", label: "HubSpot", color: "#4f8df9", points: lineSourcePoints.hubspot },
                  { id: "selfserve", label: "Self-serve", color: "#1fc16b", points: lineSourcePoints.selfserve },
                  { id: "sales_assist", label: "Sales assist", color: "#14b8a6", points: lineSourcePoints.salesAssist },
                  { id: "ai", label: "AI spend", color: "#f59e0b", points: lineSourcePoints.aiSpend },
                ]}
                valueAccessor={(p) => p.mrrGrowthRatePct}
                valueFormatter={(v) => formatPercent(v)}
                includeZero
                onPointClick={(payload) => handleGroupedSourcePointClick(payload, "MRR Growth Rate Over Time")}
              />
            )}

            {lineChartMode === "combined" ? (
              <LineChartCard
                title="ARR Over Time"
                subtitle="Combined ARR at period end (HubSpot + self-serve + sales assist + AI spend)."
                points={linePoints}
                valueAccessor={(p) => p.arr}
                valueFormatter={(v) => formatMoney(v, currency)}
                stroke="#1fc16b"
              />
            ) : (
              <GroupedSourceLineChartCard
                title="ARR Over Time"
                subtitle="ARR by source."
                series={[
                  { id: "hubspot", label: "HubSpot", color: "#4f8df9", points: lineSourcePoints.hubspot },
                  { id: "selfserve", label: "Self-serve", color: "#1fc16b", points: lineSourcePoints.selfserve },
                  { id: "sales_assist", label: "Sales assist", color: "#14b8a6", points: lineSourcePoints.salesAssist },
                  { id: "ai", label: "AI spend", color: "#f59e0b", points: lineSourcePoints.aiSpend },
                ]}
                valueAccessor={(p) => p.arr}
                valueFormatter={(v) => formatMoney(v, currency)}
                onPointClick={(payload) => handleGroupedSourcePointClick(payload, "ARR Over Time")}
              />
            )}

            <ArrPerEmployeeChartCard points={arrPerEmployeePoints} currency={currency} />

            <DeltaBarChartCard
              title="ARR Growth Over Time"
              subtitle="Absolute combined ARR change per period (including AI spend)."
              points={linePoints}
              valueAccessor={(p) => p.arrGrowth}
              valueFormatter={(v) => formatMoney(v, currency)}
            />

            <LineChartCard
              title="Sales Cycle Over Time (Days)"
              subtitle="Average days between deal creation and close date for HubSpot closed-won deals in each month."
              points={salesCyclePoints}
              valueAccessor={(p) => p.avgSalesCycleDays}
              valueFormatter={(v) => formatDays(v)}
              stroke="#60a5fa"
              includeZero
            />

            <LtvChartCard points={ltvPoints} currency={currency} />

            <CacChartCard
              points={cacPoints}
              currency={currency}
              includeAccountBreakdownInCsv={true}
              showAccountSelector={isAdmin}
              expenseAccounts={cacExpenseAccounts}
              selectedAccountIds={selectedCacAccountIds}
              runLoading={loading || cacLoading}
              accountMenuOpen={cacAccountMenuTarget === "frankfurter"}
              accountsLoading={cacExpenseAccountsLoading}
              accountsError={cacExpenseAccountsError}
              savingDefaultSelection={savingCacDefaultSelection}
              defaultSaveStatus={cacDefaultSaveStatus}
              onToggleAccountMenu={() => toggleCacAccountMenu("frankfurter")}
              onRefreshAccounts={() => void loadCacExpenseAccounts()}
              onToggleAccountSelection={toggleCacAccountSelection}
              onSelectAllAccounts={selectAllCacAccounts}
              onClearAccounts={clearCacAccounts}
              onSaveDefaultSelection={() => void saveCacDefaultSelection()}
              onApplySelection={() => {
                setCacAccountMenuTarget(null);
                void run();
              }}
            />

            <RetentionRatesChartCard points={retentionPoints} />
          </div>
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
