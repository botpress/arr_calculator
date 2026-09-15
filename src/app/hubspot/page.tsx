"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadSvgAsPng } from "@/lib/chartDownload";
import { canonicalCountryKey, canonicalCountryLabel, canonicalTerritoryLabel, resolveTerritoryLabel } from "@/lib/geo";
import type { ReportResponse, ReportRow, Grain, ReportMode, HubspotPlan } from "@/lib/types";

function fmtMoney(n: number, currencyDisplay: CurrencyDisplay) {
  const fractionDigits = currencyDisplay === "normal" ? 0 : 2;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n || 0);
}

type CurrencyDisplay = "normal" | "thousands" | "millions";
type ArrDisplayScope = "all" | "cloud";

type GroupField =
  | "dealName"
  | "deploymentType"
  | "accountId"
  | "territory"
  | "country"
  | "industry"
  | "companySegment"
  | "primaryProjectType"
  | "customerSupportApplication"
  | "dealType"
  | "plan";

type ChartGroupField =
  | "none"
  | "deploymentType"
  | "territory"
  | "country"
  | "industry"
  | "plan"
  | "companySegment"
  | "primaryProjectType"
  | "customerSupportApplication";

const GROUP_BY_OPTIONS: Array<{ key: GroupField; label: string }> = [
  { key: "dealName", label: "Deal Name" },
  { key: "deploymentType", label: "Deployment Type" },
  { key: "accountId", label: "Account ID" },
  { key: "territory", label: "Territory" },
  { key: "country", label: "Country" },
  { key: "industry", label: "Industry" },
  { key: "companySegment", label: "Company Segment" },
  { key: "primaryProjectType", label: "Primary Project Type" },
  { key: "customerSupportApplication", label: "Customer Support Application" },
  { key: "dealType", label: "Deal Type" },
  { key: "plan", label: "Plan" },
];

const CHART_GROUP_OPTIONS: Array<{ key: ChartGroupField; label: string }> = [
  { key: "none", label: "Overall" },
  { key: "country", label: "Country" },
  { key: "territory", label: "Territory" },
  { key: "industry", label: "Industry" },
  { key: "deploymentType", label: "Deployment Type" },
  { key: "plan", label: "Plan" },
  { key: "companySegment", label: "Company Segment" },
  { key: "primaryProjectType", label: "Primary Project Type" },
  { key: "customerSupportApplication", label: "Customer Support Application" },
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

const MULTI_SELECT_GROUP_FIELDS = new Set<GroupField>(["primaryProjectType", "customerSupportApplication"]);

function parseHubspotMultiSelectValues(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const values = raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

type UiRow = {
  dealName: string;
  dealId: string;
  companyCountry?: string;
  deploymentType?: string;
  accountId?: string;
  accountName?: string;
  workspaceId?: string;
  deliveryStage?: string;
  territory?: string;
  country?: string;
  industry?: string;
  companySegment?: string;
  primaryProjectType?: string;
  customerSupportApplication?: string;
  dealType?: string;
  plan?: HubspotPlan;
  groupValues: Partial<Record<GroupField, string>>;
  valuesByPeriod: Record<string, number>;
};

function groupValueForRow(r: UiRow, field: GroupField) {
  if (field === "primaryProjectType") {
    const values = parseHubspotMultiSelectValues(String(r.primaryProjectType || "").trim());
    return values.length ? values.join(" | ") : "(blank)";
  }
  if (field === "customerSupportApplication") {
    const values = parseHubspotMultiSelectValues(String(r.customerSupportApplication || "").trim());
    return values.length ? values.join(" | ") : "(blank)";
  }
  if (field === "dealName") return r.dealName || "(blank)";
  if (field === "deploymentType") return r.deploymentType || "(blank)";
  if (field === "territory") {
    const territory = canonicalTerritoryLabel(String(r.territory || "").trim());
    return territory || "(blank)";
  }
  if (field === "country") {
    const country = String(r.country || "").trim();
    return country ? canonicalCountryLabel(country) : "(blank)";
  }
  if (field === "industry") return r.industry || "(blank)";
  if (field === "companySegment") return r.companySegment || "(blank)";
  if (field === "dealType") return r.dealType || "(blank)";
  if (field === "plan") return r.plan || "(blank)";
  const accountId = String(r.accountId || "").trim();
  const accountName = String(r.accountName || "").trim();
  if (accountName && accountId) return `${accountName} (${accountId})`;
  if (accountName) return accountName;
  if (accountId) return accountId;
  return "(blank)";
}

function accountDetailParts(r: UiRow) {
  const parts: string[] = [];
  const workspaceId = String(r.workspaceId || "").trim();
  const deliveryStage = String(r.deliveryStage || "").trim();
  if (workspaceId) parts.push(`Workspace ID: ${workspaceId}`);
  if (deliveryStage) parts.push(`Delivery Stage: ${deliveryStage}`);
  return parts;
}

function accountDisplayWithDetails(r: UiRow) {
  const account = groupValueForRow(r, "accountId");
  const details = accountDetailParts(r);
  if (details.length === 0) return account;
  if (account && account !== "(blank)") return `${account} | ${details.join(" | ")}`;
  return details.join(" | ");
}

function normalizeCaseInsensitiveValue(value: string) {
  return String(value || "").trim().toLowerCase();
}

function groupValuesForRow(r: UiRow, field: GroupField) {
  if (field === "primaryProjectType") {
    const values = parseHubspotMultiSelectValues(String(r.primaryProjectType || "").trim());
    return values.length ? values : ["(blank)"];
  }
  if (field === "customerSupportApplication") {
    const values = parseHubspotMultiSelectValues(String(r.customerSupportApplication || "").trim());
    return values.length ? values : ["(blank)"];
  }
  return [groupValueForRow(r, field)];
}

function normalizeGroupKeyValue(field: GroupField, value: string) {
  if (field === "country") return canonicalCountryKey(value);
  if (field === "territory") return normalizeCaseInsensitiveValue(canonicalTerritoryLabel(value));
  if (field === "companySegment") return normalizeCaseInsensitiveValue(value);
  if (field === "primaryProjectType") return normalizeCaseInsensitiveValue(value);
  if (field === "customerSupportApplication") return normalizeCaseInsensitiveValue(value);
  if (field === "plan") return normalizeCaseInsensitiveValue(value);
  return String(value || "").trim();
}

function groupDescriptorsForRow(row: UiRow, fields: GroupField[]) {
  let combos: Array<{ keyParts: string[]; groupValues: Partial<Record<GroupField, string>> }> = [
    { keyParts: [], groupValues: {} },
  ];

  for (const field of fields) {
    const values = groupValuesForRow(row, field);
    const normalized = new Map<string, string>();
    for (const value of values) {
      const label = String(value || "").trim() || "(blank)";
      const key = normalizeGroupKeyValue(field, label) || "(blank)";
      if (!normalized.has(key)) normalized.set(key, label);
    }
    if (normalized.size === 0) normalized.set("(blank)", "(blank)");

    const next: Array<{ keyParts: string[]; groupValues: Partial<Record<GroupField, string>> }> = [];
    for (const combo of combos) {
      for (const [normalizedKey, label] of normalized.entries()) {
        next.push({
          keyParts: [...combo.keyParts, `${field}:${normalizedKey}`],
          groupValues: { ...combo.groupValues, [field]: label },
        });
      }
    }
    combos = next;
  }

  return combos.map((combo) => ({
    key: combo.keyParts.join("|"),
    groupValues: combo.groupValues,
  }));
}

function isCloudDeploymentType(value: string) {
  return normalizeCaseInsensitiveValue(value) === "cloud";
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function hasAnyNonZeroValue(valuesByPeriod: Record<string, number>) {
  return Object.values(valuesByPeriod || {}).some((value) => Math.abs(Number(value) || 0) > 1e-9);
}

function accountGroupingKey(row: UiRow) {
  const raw = String(row.accountId || "").trim();
  if (raw) {
    const numericToken =
      raw
        .split(/[,\s;|]+/)
        .map((part) => part.trim())
        .find((part) => /^\d+$/.test(part)) || "";
    if (numericToken) return numericToken;
    return raw.toLowerCase();
  }
  return "";
}

function fmtPercent(n: number) {
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0)}%`;
}

function tickIndices(size: number) {
  if (size <= 1) return [0];
  if (size <= 4) return Array.from({ length: size }, (_, i) => i);
  const out = new Set<number>([0, Math.floor((size - 1) / 2), size - 1]);
  return Array.from(out).sort((a, b) => a - b);
}

type TrendPoint = {
  key: string;
  label: string;
  mrr: number;
  arr: number;
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnMrr: number;
  netMrrChange: number;
  mrrGrowthRatePct: number;
  arrGrowth: number;
};

type GrowthContributorCategory = "new" | "expansion" | "contraction" | "churn";

type GrowthContributorMeta = {
  accountLabel: string;
  dealNames: string[];
};

type GrowthContributorRow = {
  category: GrowthContributorCategory;
  accountKey: string;
  accountLabel: string;
  dealNames: string[];
  prevArr: number;
  currArr: number;
  deltaArr: number;
  mrrImpact: number;
};

type GroupTrendSeries = {
  key: string;
  label: string;
  points: TrendPoint[];
  color: string;
};

type PeriodRef = {
  key: string;
  label: string;
};

type HubspotViewModelResponse = {
  periods: PeriodRef[];
  displayedRows: UiRow[];
  totalsByPeriodForDisplayed: Array<{ key: string; label: string; total: number }>;
  chartPoints: TrendPoint[];
  growthContributorRowsByPeriod?: Record<string, GrowthContributorRow[]>;
  groupedChartSeries: GroupTrendSeries[];
  groupedGrowthContributorRowsByPeriod?: Record<string, Record<string, GrowthContributorRow[]>>;
  deploymentTypeOptions: string[];
  territoryOptions: string[];
  countryOptions: string[];
  industryOptions: string[];
  dealTypeOptions: string[];
  planOptions: HubspotPlan[];
};

type WeeklyPipelineRow = {
  weekStart: string;
  weekEnd: string;
  dealCount: number;
  pipelineValue: number;
  pipelineValueArr: number;
  enterpriseDealCount: number;
  managedDealCount: number;
  teamDealCount: number;
  plusDealCount: number;
  deskDealCount: number;
  otherDealCount: number;
  otherDeals: Array<{
    dealId: string;
    dealName: string;
    createdDate: string;
    pipelineValue: number;
  }>;
};

type WeeklyPipelineResponse = {
  startDate: string;
  endDate: string;
  chunkDays: number;
  totalPipelineValue: number;
  totalPipelineValueArr: number;
  totalDeals: number;
  rows: WeeklyPipelineRow[];
};

type ChartGroupDescriptor = {
  key: string;
  label: string;
};

function chartGroupDescriptorForRow(row: UiRow, field: ChartGroupField): ChartGroupDescriptor {
  if (field === "none") return { key: "__all__", label: "Overall" };
  if (field === "country") {
    const raw = String(row.country || "").trim();
    if (!raw) return { key: "(blank)", label: "(blank)" };
    return { key: canonicalCountryKey(raw) || "(blank)", label: canonicalCountryLabel(raw) || "(blank)" };
  }
  if (field === "territory") {
    const raw = canonicalTerritoryLabel(String(row.territory || "").trim());
    return { key: normalizeCaseInsensitiveValue(raw) || "(blank)", label: raw || "(blank)" };
  }
  if (field === "plan") {
    const raw = String(row.plan || "").trim();
    return { key: normalizeCaseInsensitiveValue(raw) || "(blank)", label: raw || "(blank)" };
  }
  if (field === "companySegment") {
    const raw = String(row.companySegment || "").trim();
    return { key: normalizeCaseInsensitiveValue(raw) || "(blank)", label: raw || "(blank)" };
  }
  if (field === "industry") {
    const raw = String(row.industry || "").trim();
    return { key: normalizeCaseInsensitiveValue(raw) || "(blank)", label: raw || "(blank)" };
  }
  if (field === "primaryProjectType") {
    const raw = String(row.primaryProjectType || "").trim();
    return { key: normalizeCaseInsensitiveValue(raw) || "(blank)", label: raw || "(blank)" };
  }
  if (field === "customerSupportApplication") {
    const raw = String(row.customerSupportApplication || "").trim();
    return { key: normalizeCaseInsensitiveValue(raw) || "(blank)", label: raw || "(blank)" };
  }
  const raw = String(row.deploymentType || "").trim();
  return { key: normalizeCaseInsensitiveValue(raw) || "(blank)", label: raw || "(blank)" };
}

function chartGroupDescriptorsForRow(row: UiRow, field: ChartGroupField) {
  if (field === "primaryProjectType") {
    const values = parseHubspotMultiSelectValues(String(row.primaryProjectType || "").trim());
    if (!values.length) return [{ key: "(blank)", label: "(blank)" }];
    return values.map((value) => ({
      key: normalizeCaseInsensitiveValue(value) || "(blank)",
      label: value || "(blank)",
    }));
  }
  if (field === "customerSupportApplication") {
    const values = parseHubspotMultiSelectValues(String(row.customerSupportApplication || "").trim());
    if (!values.length) return [{ key: "(blank)", label: "(blank)" }];
    return values.map((value) => ({
      key: normalizeCaseInsensitiveValue(value) || "(blank)",
      label: value || "(blank)",
    }));
  }
  return [chartGroupDescriptorForRow(row, field)];
}

function addAccountPeriodValues(
  accountMap: Map<string, Record<string, number>>,
  accountKey: string,
  valuesByPeriod: Record<string, number>,
  periodOrder: PeriodRef[],
) {
  if (!accountMap.has(accountKey)) accountMap.set(accountKey, {});
  const bucket = accountMap.get(accountKey)!;
  for (const period of periodOrder) {
    bucket[period.key] = round2((bucket[period.key] || 0) + (valuesByPeriod[period.key] || 0));
  }
}

function buildTrendPointsFromAccounts(
  periodOrder: PeriodRef[],
  accountArrByPeriod: Map<string, Record<string, number>>,
  baselineAccountArrByAccount: Map<string, number>,
): TrendPoint[] {
  const totalByPeriodSelected = new Map<string, number>();
  for (const accountTotals of accountArrByPeriod.values()) {
    for (const [periodKey, value] of Object.entries(accountTotals)) {
      totalByPeriodSelected.set(periodKey, round2((totalByPeriodSelected.get(periodKey) || 0) + (value || 0)));
    }
  }

  const baselineArrTotal = round2(
    Array.from(baselineAccountArrByAccount.values()).reduce((acc, value) => acc + value, 0),
  );
  const allAccountKeys = new Set<string>([
    ...Array.from(accountArrByPeriod.keys()),
    ...Array.from(baselineAccountArrByAccount.keys()),
  ]);

  return periodOrder.map((period, idx) => {
    const prevPeriodKey = idx > 0 ? periodOrder[idx - 1].key : "";
    const arr = round2(totalByPeriodSelected.get(period.key) || 0);
    const mrr = round2(arr / 12);
    const prevArr = round2(
      idx === 0
        ? baselineArrTotal
        : prevPeriodKey
          ? totalByPeriodSelected.get(prevPeriodKey) || 0
          : 0,
    );
    const prevMrr = round2(prevArr / 12);
    const arrGrowth = round2(arr - prevArr);
    const mrrGrowthRatePct =
      Math.abs(prevMrr) > 1e-9
        ? round2(((mrr - prevMrr) / Math.abs(prevMrr)) * 100)
        : 0;

    let newMrr = 0;
    let expansionMrr = 0;
    let contractionMrr = 0;
    let churnMrr = 0;

    for (const accountKey of allAccountKeys) {
      const accountTotals = accountArrByPeriod.get(accountKey) || {};
      const currArr = round2(accountTotals[period.key] || 0);
      const prevAccountArr = round2(
        idx === 0
          ? baselineAccountArrByAccount.get(accountKey) || 0
          : prevPeriodKey
            ? accountTotals[prevPeriodKey] || 0
            : 0,
      );
      const diffArr = round2(currArr - prevAccountArr);

      const currHas = Math.abs(currArr) > 1e-9;
      const prevHas = Math.abs(prevAccountArr) > 1e-9;
      if (!currHas && !prevHas) continue;

      if (!prevHas && currHas) {
        newMrr = round2(newMrr + currArr / 12);
        continue;
      }

      if (prevHas && !currHas) {
        churnMrr = round2(churnMrr - prevAccountArr / 12);
        continue;
      }

      if (diffArr > 1e-9) {
        expansionMrr = round2(expansionMrr + diffArr / 12);
      } else if (diffArr < -1e-9) {
        contractionMrr = round2(contractionMrr + diffArr / 12);
      }
    }

    const netMrrChange = round2(newMrr + expansionMrr + contractionMrr + churnMrr);

    return {
      key: period.key,
      label: period.label,
      mrr,
      arr,
      newMrr,
      expansionMrr,
      contractionMrr,
      churnMrr,
      netMrrChange,
      mrrGrowthRatePct,
      arrGrowth,
    };
  });
}

function buildGrowthContributorsByPeriod(
  periodOrder: PeriodRef[],
  accountArrByPeriod: Map<string, Record<string, number>>,
  baselineAccountArrByAccount: Map<string, number>,
  accountMetaByKey: Map<string, GrowthContributorMeta>,
) {
  const rowsByPeriod = new Map<string, GrowthContributorRow[]>();
  const allAccountKeys = new Set<string>([
    ...Array.from(accountArrByPeriod.keys()),
    ...Array.from(baselineAccountArrByAccount.keys()),
  ]);

  for (let idx = 0; idx < periodOrder.length; idx += 1) {
    const period = periodOrder[idx];
    const prevPeriodKey = idx > 0 ? periodOrder[idx - 1].key : "";
    const rows: GrowthContributorRow[] = [];

    for (const accountKey of allAccountKeys) {
      const accountTotals = accountArrByPeriod.get(accountKey) || {};
      const currArr = round2(accountTotals[period.key] || 0);
      const prevArr = round2(
        idx === 0
          ? baselineAccountArrByAccount.get(accountKey) || 0
          : prevPeriodKey
            ? accountTotals[prevPeriodKey] || 0
            : 0,
      );
      const currHas = Math.abs(currArr) > 1e-9;
      const prevHas = Math.abs(prevArr) > 1e-9;
      if (!currHas && !prevHas) continue;

      const deltaArr = round2(currArr - prevArr);
      let category: GrowthContributorCategory | null = null;
      let mrrImpact = 0;

      if (!prevHas && currHas) {
        category = "new";
        mrrImpact = round2(currArr / 12);
      } else if (prevHas && !currHas) {
        category = "churn";
        mrrImpact = round2(-prevArr / 12);
      } else if (deltaArr > 1e-9) {
        category = "expansion";
        mrrImpact = round2(deltaArr / 12);
      } else if (deltaArr < -1e-9) {
        category = "contraction";
        mrrImpact = round2(deltaArr / 12);
      }

      if (!category || Math.abs(mrrImpact) < 1e-9) continue;
      const meta = accountMetaByKey.get(accountKey);
      rows.push({
        category,
        accountKey,
        accountLabel: meta?.accountLabel || accountKey,
        dealNames: meta?.dealNames || [],
        prevArr,
        currArr,
        deltaArr,
        mrrImpact,
      });
    }

    rows.sort((a, b) => {
      const absDiff = Math.abs(b.mrrImpact) - Math.abs(a.mrrImpact);
      if (Math.abs(absDiff) > 1e-9) return absDiff;
      return a.accountLabel.localeCompare(b.accountLabel);
    });
    rowsByPeriod.set(period.key, rows);
  }

  return rowsByPeriod;
}

function aggregateTrendPointsByPeriod(
  templatePoints: TrendPoint[],
  seriesList: Array<{ points: TrendPoint[] }>,
) {
  if (!templatePoints.length || !seriesList.length) return templatePoints;

  const pointMaps = seriesList.map((series) => {
    const byKey = new Map<string, TrendPoint>();
    for (const point of series.points || []) {
      byKey.set(point.key, point);
    }
    return byKey;
  });

  return templatePoints.map((template) => {
    let mrr = 0;
    let arr = 0;
    let newMrr = 0;
    let expansionMrr = 0;
    let contractionMrr = 0;
    let churnMrr = 0;
    let netMrrChange = 0;
    let mrrGrowthRatePct = 0;
    let arrGrowth = 0;

    for (const pointMap of pointMaps) {
      const point = pointMap.get(template.key);
      if (!point) continue;
      mrr += point.mrr || 0;
      arr += point.arr || 0;
      newMrr += point.newMrr || 0;
      expansionMrr += point.expansionMrr || 0;
      contractionMrr += point.contractionMrr || 0;
      churnMrr += point.churnMrr || 0;
      netMrrChange += point.netMrrChange || 0;
      mrrGrowthRatePct += point.mrrGrowthRatePct || 0;
      arrGrowth += point.arrGrowth || 0;
    }

    return {
      ...template,
      mrr: round2(mrr),
      arr: round2(arr),
      newMrr: round2(newMrr),
      expansionMrr: round2(expansionMrr),
      contractionMrr: round2(contractionMrr),
      churnMrr: round2(churnMrr),
      netMrrChange: round2(netMrrChange),
      mrrGrowthRatePct: round2(mrrGrowthRatePct),
      arrGrowth: round2(arrGrowth),
    };
  });
}

type LineChartProps = {
  title: string;
  subtitle: string;
  points: TrendPoint[];
  valueAccessor: (point: TrendPoint) => number;
  valueFormatter: (value: number) => string;
  stroke: string;
  includeZero?: boolean;
};

function LineChartCard({
  title,
  subtitle,
  points,
  valueAccessor,
  valueFormatter,
  stroke,
  includeZero = false,
}: LineChartProps) {
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
      await downloadSvgAsPng(chartRef.current, `hubspot-${title}`);
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
            {hoveredPoint ? `${hoveredPoint.label}: ${valueFormatter(hoveredValue)}` : "Hover on chart for values"}
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

type MultiLineChartProps = {
  title: string;
  subtitle: string;
  periods: PeriodRef[];
  series: GroupTrendSeries[];
  valueAccessor: (point: TrendPoint) => number;
  valueFormatter: (value: number) => string;
  includeZero?: boolean;
};

function MultiLineChartCard({
  title,
  subtitle,
  periods,
  series,
  valueAccessor,
  valueFormatter,
  includeZero = false,
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
      await downloadSvgAsPng(chartRef.current, `hubspot-${title}`);
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
  points: TrendPoint[];
  contributorRowsByPeriod: Map<string, GrowthContributorRow[]>;
};

function GrowthBreakdownChart({ points, contributorRowsByPeriod }: GrowthBreakdownChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const categoryLabel: Record<GrowthContributorCategory, string> = {
    new: "New",
    expansion: "Expansion",
    contraction: "Contraction",
    churn: "Churn",
  };
  const categoryColor: Record<GrowthContributorCategory, string> = {
    new: "#1fc16b",
    expansion: "#2698f0",
    contraction: "#f59e0b",
    churn: "#ef4444",
  };

  const width = 640;
  const height = 280;
  const paddingLeft = 116;
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

    return { point, components, positiveTotal, negativeTotal };
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
  useEffect(() => {
    if (!selectedPeriodKey) return;
    if (points.some((point) => point.key === selectedPeriodKey)) return;
    setSelectedPeriodKey(null);
  }, [points, selectedPeriodKey]);

  const selectedPeriod = selectedPeriodKey ? points.find((point) => point.key === selectedPeriodKey) || null : null;
  const selectedPeriodIndex = selectedPeriod
    ? points.findIndex((point) => point.key === selectedPeriod.key)
    : -1;
  const previousPeriodLabel =
    selectedPeriodIndex > 0 ? points[selectedPeriodIndex - 1].label : "baseline";
  const selectedRows = selectedPeriod ? contributorRowsByPeriod.get(selectedPeriod.key) || [] : [];
  const selectedRowsByCategory = new Map<GrowthContributorCategory, GrowthContributorRow[]>();
  for (const category of ["new", "expansion", "contraction", "churn"] as GrowthContributorCategory[]) {
    selectedRowsByCategory.set(
      category,
      selectedRows.filter((row) => row.category === category),
    );
  }

  const chartTitle = "Growth Breakdown";
  const downloadChart = useCallback(async () => {
    if (!chartRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadSvgAsPng(chartRef.current, `hubspot-${chartTitle}`);
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
            Account-level movement split into New, Expansion, Contraction, and Churn (MRR) for the selected chart scope.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => void downloadChart()} disabled={downloading}>
            {downloading ? "Downloading..." : "Download SVG"}
          </button>
          <div className="stripe-ui__hint" aria-live="polite">
            {hovered
              ? `${hovered.point.label}: Net ${fmtMoney(hovered.point.netMrrChange, "normal")}`
              : "Hover for values, click a bar for contributors"}
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
                  onClick={() => setSelectedPeriodKey(bar.point.key)}
                  style={{ cursor: "pointer" }}
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
                          data-tooltip={`${bar.point.label}: ${component.label}: ${fmtMoney(value, "normal")}`}
                          onMouseEnter={() => setHoverIndex(idx)}
                          onClick={() => setSelectedPeriodKey(bar.point.key)}
                          style={{ cursor: "pointer" }}
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
                        data-tooltip={`${bar.point.label}: ${component.label}: ${fmtMoney(value, "normal")}`}
                        onMouseEnter={() => setHoverIndex(idx)}
                        onClick={() => setSelectedPeriodKey(bar.point.key)}
                        style={{ cursor: "pointer" }}
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
              {fmtMoney(maxValue, "normal")}
            </text>
            <text x={paddingLeft - 8} y={paddingTop + plotHeight} textAnchor="end" fill="#8ea7cb" fontSize="12">
              {fmtMoney(minValue, "normal")}
            </text>
          </svg>

          {hovered && (
            <div className="stripe-ui__panel" style={{ marginTop: "0.8rem", padding: "0.75rem" }}>
              <div className="stripe-ui__hint" style={{ marginBottom: "0.35rem" }}>
                {hovered.point.label}
              </div>
              <div className="stripe-ui__hint">New: {fmtMoney(hovered.point.newMrr, "normal")}</div>
              <div className="stripe-ui__hint">Expansion: {fmtMoney(hovered.point.expansionMrr, "normal")}</div>
              <div className="stripe-ui__hint">Contraction: {fmtMoney(hovered.point.contractionMrr, "normal")}</div>
              <div className="stripe-ui__hint">Churn: {fmtMoney(hovered.point.churnMrr, "normal")}</div>
              <div className="stripe-ui__hint">Net: {fmtMoney(hovered.point.netMrrChange, "normal")}</div>
            </div>
          )}

          {selectedPeriod && (
            <div className="stripe-ui__panel" style={{ marginTop: "0.8rem", padding: "0.75rem" }}>
              <div className="stripe-ui__section-head">
                <div>
                  <h3 className="stripe-ui__panel-title" style={{ marginBottom: "0.15rem" }}>
                    Contributors: {selectedPeriod.label} (vs {previousPeriodLabel})
                  </h3>
                  <p className="stripe-ui__panel-subtitle" style={{ margin: 0 }}>
                    Account transitions that make up this period&apos;s New, Expansion, Contraction, and Churn bars.
                  </p>
                </div>
                <button
                  className="stripe-ui__btn stripe-ui__btn--ghost"
                  type="button"
                  onClick={() => setSelectedPeriodKey(null)}
                >
                  Clear
                </button>
              </div>

              {selectedRows.length === 0 ? (
                <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.6rem", marginBottom: 0 }}>
                  No contributors for this period.
                </p>
              ) : (
                <div className="stripe-ui__table-wrap" style={{ marginTop: "0.6rem" }}>
                  <table className="stripe-ui__table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Account</th>
                        <th>Deals</th>
                        <th style={{ textAlign: "right" }}>Prev ARR</th>
                        <th style={{ textAlign: "right" }}>Curr ARR</th>
                        <th style={{ textAlign: "right" }}>Delta ARR</th>
                        <th style={{ textAlign: "right" }}>MRR Impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(["new", "expansion", "contraction", "churn"] as GrowthContributorCategory[]).map((category) => {
                        const categoryRows = selectedRowsByCategory.get(category) || [];
                        return categoryRows.map((row) => {
                          const dealPreview =
                            row.dealNames.length <= 3
                              ? row.dealNames.join(", ")
                              : `${row.dealNames.slice(0, 3).join(", ")} (+${row.dealNames.length - 3} more)`;
                          return (
                            <tr key={`${selectedPeriod.key}-${category}-${row.accountKey}`}>
                              <td style={{ color: categoryColor[category] }}>{categoryLabel[category]}</td>
                              <td>{row.accountLabel}</td>
                              <td>{dealPreview || "(n/a)"}</td>
                              <td style={{ textAlign: "right" }}>{fmtMoney(row.prevArr, "normal")}</td>
                              <td style={{ textAlign: "right" }}>{fmtMoney(row.currArr, "normal")}</td>
                              <td style={{ textAlign: "right" }}>{fmtMoney(row.deltaArr, "normal")}</td>
                              <td style={{ textAlign: "right" }}>{fmtMoney(row.mrrImpact, "normal")}</td>
                            </tr>
                          );
                        });
                      })}
                    </tbody>
                  </table>
                </div>
              )}
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
  points: TrendPoint[];
  valueAccessor: (point: TrendPoint) => number;
  valueFormatter: (value: number) => string;
};

function DeltaBarChartCard({ title, subtitle, points, valueAccessor, valueFormatter }: DeltaBarChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [downloading, setDownloading] = useState(false);

  const width = 640;
  const height = 280;
  const paddingLeft = 116;
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
  const hovered = hoverIndex != null && hoverIndex >= 0 && hoverIndex < points.length ? points[hoverIndex] : null;
  const downloadChart = useCallback(async () => {
    if (!chartRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadSvgAsPng(chartRef.current, `hubspot-${title}`);
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
            {hovered ? `${hovered.label}: ${valueFormatter(valueAccessor(hovered))}` : "Hover on bars for values"}
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

export default function Home() {
  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate] = useState("2025-12-31");
  const [mode, setMode] = useState<ReportMode>("contracted");
  const [grain, setGrain] = useState<Grain>("monthly");
  const [chartGroupBy, setChartGroupBy] = useState<ChartGroupField>("none");
  const [selectedBarGroupKeys, setSelectedBarGroupKeys] = useState<string[]>([]);

  const [groupByFields, setGroupByFields] = useState<GroupField[]>([]);
  const [groupByToAdd, setGroupByToAdd] = useState<GroupField | "none">("none");

  const [filterDealName, setFilterDealName] = useState("");
  const [filterDeploymentType, setFilterDeploymentType] = useState("all");
  const [filterAccountId, setFilterAccountId] = useState("");
  const [filterTerritory, setFilterTerritory] = useState("all");
  const [filterCountry, setFilterCountry] = useState("all");
  const [filterIndustry, setFilterIndustry] = useState("all");
  const [filterDealType, setFilterDealType] = useState("all");
  const [filterPlan, setFilterPlan] = useState<HubspotPlan | "all">("all");
  const [currencyDisplay, setCurrencyDisplay] = useState<CurrencyDisplay>("normal");
  const [arrDisplayScope, setArrDisplayScope] = useState<ArrDisplayScope>("cloud");

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [chartData, setChartData] = useState<ReportResponse | null>(null);
  const [chartBaselineData, setChartBaselineData] = useState<ReportResponse | null>(null);
  const [hubspotVm, setHubspotVm] = useState<HubspotViewModelResponse | null>(null);
  const [weeklyPipeline, setWeeklyPipeline] = useState<WeeklyPipelineResponse | null>(null);
  const [selectedOtherWeekKey, setSelectedOtherWeekKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setData(null);
    setChartData(null);
    setChartBaselineData(null);
    setHubspotVm(null);
    setWeeklyPipeline(null);
    setSelectedOtherWeekKey(null);

    try {
      const [viewModelRes, weeklyPipelineRes] = await Promise.all([
        fetch("/api/hubspot-view-model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate,
            endDate,
            mode,
            grain,
            chartGroupBy,
            groupByFields,
            filterDealName,
            filterDeploymentType,
            filterAccountId,
            filterTerritory,
            filterCountry,
            filterIndustry,
            filterDealType,
            filterPlan,
            arrDisplayScope,
          }),
        }),
        fetch("/api/hubspot-created-pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate,
            endDate,
          }),
        }),
      ]);

      const parseResponseOrThrow = async (res: Response) => {
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
          throw new Error(text || "Request failed");
        }
        if (!json || typeof json !== "object") throw new Error("Invalid API response");
        return json;
      };

      const [viewModelJson, weeklyPipelineJson] = await Promise.all([
        parseResponseOrThrow(viewModelRes),
        parseResponseOrThrow(weeklyPipelineRes),
      ]);

      setHubspotVm(viewModelJson as HubspotViewModelResponse);
      setWeeklyPipeline(weeklyPipelineJson as WeeklyPipelineResponse);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const deploymentTypeOptions = useMemo(() => {
    if (hubspotVm) return hubspotVm.deploymentTypeOptions || [];
    if (!data) return [];
    const values = new Set<string>();
    for (const r of data.rows || []) {
      const value = String(r.deploymentType || "").trim();
      if (value) values.add(value);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [hubspotVm, data]);

  const territoryOptions = useMemo(() => {
    if (hubspotVm) return hubspotVm.territoryOptions || [];
    if (!data) return [];
    const values = new Set<string>();
    for (const r of data.rows || []) {
      const value = canonicalTerritoryLabel(String(r.territory || "").trim());
      if (value) values.add(value);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [hubspotVm, data]);

  const countryOptions = useMemo(() => {
    if (hubspotVm) return hubspotVm.countryOptions || [];
    if (!data) return [];
    const valuesByNormalized = new Map<string, string>();
    for (const r of data.rows || []) {
      const value = String(r.country || "").trim();
      if (!value) continue;
      const normalized = canonicalCountryKey(value);
      if (!valuesByNormalized.has(normalized)) valuesByNormalized.set(normalized, canonicalCountryLabel(value));
    }
    return Array.from(valuesByNormalized.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [hubspotVm, data]);

  const industryOptions = useMemo(() => {
    if (hubspotVm) return hubspotVm.industryOptions || [];
    if (!data) return [];
    const values = new Set<string>();
    for (const r of data.rows || []) {
      const value = String(r.industry || "").trim();
      if (value) values.add(value);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [hubspotVm, data]);

  const dealTypeOptions = useMemo(() => {
    if (hubspotVm) return hubspotVm.dealTypeOptions || [];
    if (!data) return [];
    const values = new Set<string>();
    for (const r of data.rows || []) {
      const value = String(r.dealType || "").trim();
      if (value) values.add(value);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [hubspotVm, data]);

  const planOptions = useMemo(() => {
    if (hubspotVm) return hubspotVm.planOptions || [];
    const order: HubspotPlan[] = ["enterprise", "managed", "team", "other"];
    if (!data) return order;
    const present = new Set<HubspotPlan>();
    for (const r of data.rows || []) {
      const value = String(r.plan || "").trim().toLowerCase();
      if (value === "enterprise" || value === "managed" || value === "team" || value === "other") {
        present.add(value);
      }
    }
    return order.filter((value) => present.has(value));
  }, [hubspotVm, data]);

  const buildFilteredLineItemRows = useCallback((
    sourceData: ReportResponse | null,
    options?: { forceCloudOnly?: boolean },
  ) => {
    if (!sourceData) return [] as UiRow[];

    const baseRows: UiRow[] = (sourceData.rows || []).map((r: ReportRow) => ({
      dealName: r.dealName || "",
      dealId: r.dealId || "",
      companyCountry: r.companyCountry || "",
      deploymentType: r.deploymentType || "",
      accountId: r.accountId || "",
      accountName: r.accountName || "",
      country: canonicalCountryLabel(r.country || "") || "",
      territory: resolveTerritoryLabel(r.territory || "", r.country || ""),
      workspaceId: r.workspaceId || "",
      deliveryStage: r.deliveryStage || "",
      industry: r.industry || "",
      companySegment: r.companySegment || "",
      primaryProjectType: r.primaryProjectType || "",
      customerSupportApplication: r.customerSupportApplication || "",
      dealType: r.dealType || "",
      plan: r.plan || "other",
      groupValues: {},
      valuesByPeriod: r.valuesByPeriod || {},
    }));

    const dealNameNeedle = filterDealName.trim().toLowerCase();
    const accountIdNeedle = filterAccountId.trim().toLowerCase();

    const applyInteractiveFilters = options?.forceCloudOnly !== true;
    const filteredBaseRows = baseRows.filter((r) => {
      const forceCloudOnly = options?.forceCloudOnly === true;
      const displayScopeOk = forceCloudOnly
        ? isCloudDeploymentType(r.deploymentType || "")
        : arrDisplayScope === "all" || isCloudDeploymentType(r.deploymentType || "");
      if (!displayScopeOk) return false;

      const planOk = filterPlan === "all" || (r.plan || "other") === filterPlan;
      if (!planOk) return false;

      if (!applyInteractiveFilters) return true;

      const dealNameOk = !dealNameNeedle || (r.dealName || "").toLowerCase().includes(dealNameNeedle);
      const deploymentTypeOk = filterDeploymentType === "all" || (r.deploymentType || "") === filterDeploymentType;
      const accountIdOk = !accountIdNeedle || (r.accountId || "").toLowerCase().includes(accountIdNeedle);
      const territoryOk =
        filterTerritory === "all" ||
        canonicalTerritoryLabel(r.territory || "") === canonicalTerritoryLabel(filterTerritory);
      const countryOk =
        filterCountry === "all" ||
        canonicalCountryKey(r.country || "") === canonicalCountryKey(filterCountry);
      const industryOk = filterIndustry === "all" || (r.industry || "") === filterIndustry;
      const dealTypeOk = filterDealType === "all" || (r.dealType || "") === filterDealType;
      return dealNameOk && deploymentTypeOk && accountIdOk && territoryOk && countryOk && industryOk && dealTypeOk;
    });

    return filteredBaseRows.filter((r) => hasAnyNonZeroValue(r.valuesByPeriod));
  }, [
    filterDealName,
    filterDeploymentType,
    filterAccountId,
    filterTerritory,
    filterCountry,
    filterIndustry,
    filterDealType,
    filterPlan,
    arrDisplayScope,
  ]);

  const filteredLineItemRows: UiRow[] = useMemo(() => buildFilteredLineItemRows(data), [
    buildFilteredLineItemRows,
    data,
  ]);

  const chartDisplayData = chartData || data;
  const filteredChartLineItemRows: UiRow[] = useMemo(() => buildFilteredLineItemRows(chartDisplayData, { forceCloudOnly: true }), [
    buildFilteredLineItemRows,
    chartDisplayData,
  ]);
  const filteredBaselineChartRows: UiRow[] = useMemo(() => buildFilteredLineItemRows(chartBaselineData, { forceCloudOnly: true }), [
    buildFilteredLineItemRows,
    chartBaselineData,
  ]);

  const displayedRows: UiRow[] = useMemo(() => {
    if (hubspotVm) return hubspotVm.displayedRows || [];
    if (groupByFields.length === 0) return filteredLineItemRows;

    const map = new Map<string, UiRow>();

    for (const r of filteredLineItemRows) {
      const descriptors = groupDescriptorsForRow(r, groupByFields);
      for (const descriptor of descriptors) {
        if (!map.has(descriptor.key)) {
          map.set(descriptor.key, {
            dealName: r.dealName,
            dealId: r.dealId,
            companyCountry: r.companyCountry,
            deploymentType: r.deploymentType,
            accountId: r.accountId,
            accountName: r.accountName,
            workspaceId: r.workspaceId,
            deliveryStage: r.deliveryStage,
            territory: r.territory,
            country: r.country,
            industry: r.industry,
            companySegment: r.companySegment,
            primaryProjectType: r.primaryProjectType,
            customerSupportApplication: r.customerSupportApplication,
            dealType: r.dealType,
            plan: r.plan,
            groupValues: descriptor.groupValues,
            valuesByPeriod: { ...r.valuesByPeriod },
          });
        } else {
          const agg = map.get(descriptor.key)!;
          for (const p of Object.keys(r.valuesByPeriod || {})) {
            agg.valuesByPeriod[p] = (agg.valuesByPeriod[p] || 0) + (r.valuesByPeriod[p] || 0);
          }
        }
      }
    }

    for (const agg of map.values()) {
      for (const p of Object.keys(agg.valuesByPeriod)) {
        agg.valuesByPeriod[p] = round2(agg.valuesByPeriod[p] || 0);
      }
    }

    return Array.from(map.values()).filter((r) => hasAnyNonZeroValue(r.valuesByPeriod));
  }, [
    hubspotVm,
    filteredLineItemRows,
    groupByFields,
  ]);

  const totalsByPeriodForDisplayed = useMemo(() => {
    if (hubspotVm) return hubspotVm.totalsByPeriodForDisplayed || [];
    if (!data) return [];
    return data.periods.map((p) => {
      const total = displayedRows.reduce((acc, r) => acc + (r.valuesByPeriod[p.key] || 0), 0);
      return { key: p.key, label: p.label, total: round2(total) };
    });
  }, [hubspotVm, data, displayedRows]);

  const periodRefs = useMemo(
    () => (hubspotVm?.periods || data?.periods || []) as PeriodRef[],
    [hubspotVm, data],
  );

  const chartPeriodOrder = useMemo(
    () => (hubspotVm?.periods || chartDisplayData?.periods || []) as PeriodRef[],
    [hubspotVm, chartDisplayData],
  );

  const accountArrByPeriod = useMemo(() => {
    const grouped = new Map<string, Record<string, number>>();
    if (!chartPeriodOrder.length) return grouped;

    for (const row of filteredChartLineItemRows) {
      const key = accountGroupingKey(row);
      if (!key) continue;
      addAccountPeriodValues(grouped, key, row.valuesByPeriod || {}, chartPeriodOrder);
    }

    return grouped;
  }, [chartPeriodOrder, filteredChartLineItemRows]);

  const chartAccountMetaByAccount = useMemo(() => {
    const byAccount = new Map<string, { accountLabel: string; dealNames: Set<string> }>();
    for (const row of filteredChartLineItemRows) {
      const key = accountGroupingKey(row);
      if (!key) continue;
      if (!byAccount.has(key)) {
        byAccount.set(key, {
          accountLabel: accountDisplayWithDetails(row),
          dealNames: new Set<string>(),
        });
      }
      const entry = byAccount.get(key)!;
      const candidateLabel = accountDisplayWithDetails(row);
      const currentLabel = String(entry.accountLabel || "").trim();
      if (
        (!currentLabel || currentLabel === "(blank)") &&
        candidateLabel &&
        candidateLabel !== "(blank)"
      ) {
        entry.accountLabel = candidateLabel;
      }
      const dealName = String(row.dealName || "").trim();
      if (dealName) entry.dealNames.add(dealName);
    }

    const out = new Map<string, GrowthContributorMeta>();
    for (const [accountKey, value] of byAccount.entries()) {
      out.set(accountKey, {
        accountLabel: value.accountLabel || accountKey,
        dealNames: Array.from(value.dealNames).sort((a, b) => a.localeCompare(b)),
      });
    }
    return out;
  }, [filteredChartLineItemRows]);

  const baselineAccountArrByAccount = useMemo(() => {
    const baseline = new Map<string, number>();
    if (!chartBaselineData) return baseline;
    const baselinePeriodKeys = (chartBaselineData.periods || []).map((period) => period.key);
    if (!baselinePeriodKeys.length) return baseline;

    for (const row of filteredBaselineChartRows) {
      const key = accountGroupingKey(row);
      if (!key) continue;
      const rowBaselineArr = round2(
        baselinePeriodKeys.reduce((acc, periodKey) => acc + (row.valuesByPeriod[periodKey] || 0), 0),
      );
      if (Math.abs(rowBaselineArr) < 1e-9) continue;
      baseline.set(key, round2((baseline.get(key) || 0) + rowBaselineArr));
    }

    return baseline;
  }, [chartBaselineData, filteredBaselineChartRows]);

  const chartPoints: TrendPoint[] = useMemo(
    () => (hubspotVm?.chartPoints || buildTrendPointsFromAccounts(chartPeriodOrder, accountArrByPeriod, baselineAccountArrByAccount)),
    [hubspotVm, chartPeriodOrder, accountArrByPeriod, baselineAccountArrByAccount],
  );

  const groupedAccountArrByPeriod = useMemo(() => {
    const grouped = new Map<string, { label: string; accounts: Map<string, Record<string, number>> }>();
    if (!chartPeriodOrder.length) return grouped;

    for (const row of filteredChartLineItemRows) {
      const accountKey = accountGroupingKey(row);
      if (!accountKey) continue;
      for (const descriptor of chartGroupDescriptorsForRow(row, chartGroupBy)) {
        if (!grouped.has(descriptor.key)) {
          grouped.set(descriptor.key, { label: descriptor.label, accounts: new Map() });
        }
        addAccountPeriodValues(grouped.get(descriptor.key)!.accounts, accountKey, row.valuesByPeriod || {}, chartPeriodOrder);
      }
    }

    return grouped;
  }, [chartGroupBy, chartPeriodOrder, filteredChartLineItemRows]);

  const groupedBaselineAccountArrByAccount = useMemo(() => {
    const grouped = new Map<string, Map<string, number>>();
    if (!chartBaselineData) return grouped;
    const baselinePeriodKeys = (chartBaselineData.periods || []).map((period) => period.key);
    if (!baselinePeriodKeys.length) return grouped;

    for (const row of filteredBaselineChartRows) {
      const accountKey = accountGroupingKey(row);
      if (!accountKey) continue;
      const rowBaselineArr = round2(
        baselinePeriodKeys.reduce((acc, periodKey) => acc + (row.valuesByPeriod[periodKey] || 0), 0),
      );
      if (Math.abs(rowBaselineArr) < 1e-9) continue;
      for (const descriptor of chartGroupDescriptorsForRow(row, chartGroupBy)) {
        if (!grouped.has(descriptor.key)) grouped.set(descriptor.key, new Map());
        const bucket = grouped.get(descriptor.key)!;
        bucket.set(accountKey, round2((bucket.get(accountKey) || 0) + rowBaselineArr));
      }
    }

    return grouped;
  }, [chartBaselineData, chartGroupBy, filteredBaselineChartRows]);

  const groupedChartSeries = useMemo(() => {
    if (hubspotVm) return hubspotVm.groupedChartSeries || [];
    if (chartGroupBy === "none" || !chartPeriodOrder.length) return [] as GroupTrendSeries[];

    const raw = Array.from(groupedAccountArrByPeriod.entries())
      .map(([groupKey, groupData]) => {
        const baseline = groupedBaselineAccountArrByAccount.get(groupKey) || new Map<string, number>();
        const points = buildTrendPointsFromAccounts(chartPeriodOrder, groupData.accounts, baseline);
        const latestArr = points.length ? points[points.length - 1].arr : 0;
        return {
          key: groupKey,
          label: groupData.label,
          accounts: groupData.accounts,
          baseline,
          points,
          latestArr,
        };
      })
      .filter((group) => group.points.some((point) => Math.abs(point.arr) > 1e-9 || Math.abs(point.arrGrowth) > 1e-9))
      .sort((a, b) => b.latestArr - a.latestArr || a.label.localeCompare(b.label));

    const maxSeries = 6;
    const top = raw.slice(0, maxSeries);
    const rest = raw.slice(maxSeries);

    const finalized = [...top];
    if (rest.length > 0) {
      const otherAccounts = new Map<string, Record<string, number>>();
      const otherBaseline = new Map<string, number>();

      for (const group of rest) {
        for (const [accountKey, valuesByPeriod] of group.accounts.entries()) {
          addAccountPeriodValues(otherAccounts, accountKey, valuesByPeriod, chartPeriodOrder);
        }
        for (const [accountKey, value] of group.baseline.entries()) {
          otherBaseline.set(accountKey, round2((otherBaseline.get(accountKey) || 0) + value));
        }
      }

      const otherPoints = buildTrendPointsFromAccounts(chartPeriodOrder, otherAccounts, otherBaseline);
      finalized.push({
        key: "__other__",
        label: `Other (${rest.length})`,
        accounts: otherAccounts,
        baseline: otherBaseline,
        points: otherPoints,
        latestArr: otherPoints.length ? otherPoints[otherPoints.length - 1].arr : 0,
      });
    }

    return finalized.map((group, idx) => ({
      key: group.key,
      label: group.label,
      points: group.points,
      color: GROUP_LINE_COLORS[idx % GROUP_LINE_COLORS.length],
    }));
  }, [hubspotVm, chartGroupBy, chartPeriodOrder, groupedAccountArrByPeriod, groupedBaselineAccountArrByAccount]);


  useEffect(() => {
    if (chartGroupBy === "none") {
      if (selectedBarGroupKeys.length > 0) setSelectedBarGroupKeys([]);
      return;
    }
    if (groupedChartSeries.length === 0) {
      if (selectedBarGroupKeys.length > 0) setSelectedBarGroupKeys([]);
      return;
    }
    const availableKeys = new Set(groupedChartSeries.map((series) => series.key));
    const validSelected = selectedBarGroupKeys.filter((key) => availableKeys.has(key));
    if (validSelected.length === 0) {
      const first = groupedChartSeries[0]?.key;
      setSelectedBarGroupKeys(first ? [first] : []);
      return;
    }
    if (validSelected.length !== selectedBarGroupKeys.length) {
      setSelectedBarGroupKeys(validSelected);
    }
  }, [chartGroupBy, groupedChartSeries, selectedBarGroupKeys]);

  const selectedBarSeriesList = useMemo(() => {
    if (chartGroupBy === "none") return [] as GroupTrendSeries[];
    const selected = groupedChartSeries.filter((series) => selectedBarGroupKeys.includes(series.key));
    return selected.length ? selected : groupedChartSeries.slice(0, 1);
  }, [chartGroupBy, groupedChartSeries, selectedBarGroupKeys]);

  const selectedBarSeriesLabel = useMemo(() => {
    if (chartGroupBy === "none") return "selected groups";
    if (selectedBarSeriesList.length === 1) return selectedBarSeriesList[0].label;
    if (selectedBarSeriesList.length === groupedChartSeries.length) return `all ${groupedChartSeries.length} groups`;
    return `${selectedBarSeriesList.length} selected groups`;
  }, [chartGroupBy, selectedBarSeriesList, groupedChartSeries.length]);

  const barChartPoints = useMemo(() => {
    if (chartGroupBy === "none") return chartPoints;
    return aggregateTrendPointsByPeriod(chartPoints, selectedBarSeriesList);
  }, [chartGroupBy, chartPoints, selectedBarSeriesList]);
  const selectedBarAccountArrByPeriod = useMemo(() => {
    if (chartGroupBy === "none") return accountArrByPeriod;
    const selectedKeys = new Set(selectedBarSeriesList.map((series) => series.key));
    if (!selectedKeys.size) return new Map<string, Record<string, number>>();

    const grouped = new Map<string, Record<string, number>>();
    const explicitDisplayedGroupKeys = new Set(
      groupedChartSeries
        .map((series) => series.key)
        .filter((key) => key && key !== "__other__"),
    );

    for (const key of selectedKeys) {
      if (key === "__other__") {
        for (const [groupKey, groupData] of groupedAccountArrByPeriod.entries()) {
          if (explicitDisplayedGroupKeys.has(groupKey)) continue;
          for (const [accountKey, valuesByPeriod] of groupData.accounts.entries()) {
            addAccountPeriodValues(grouped, accountKey, valuesByPeriod, chartPeriodOrder);
          }
        }
        continue;
      }

      const groupData = groupedAccountArrByPeriod.get(key);
      if (!groupData) continue;
      for (const [accountKey, valuesByPeriod] of groupData.accounts.entries()) {
        addAccountPeriodValues(grouped, accountKey, valuesByPeriod, chartPeriodOrder);
      }
    }

    return grouped;
  }, [
    chartGroupBy,
    accountArrByPeriod,
    selectedBarSeriesList,
    groupedChartSeries,
    groupedAccountArrByPeriod,
    chartPeriodOrder,
  ]);

  const selectedBarBaselineAccountArrByAccount = useMemo(() => {
    if (chartGroupBy === "none") return baselineAccountArrByAccount;
    const selectedKeys = new Set(selectedBarSeriesList.map((series) => series.key));
    if (!selectedKeys.size) return new Map<string, number>();

    const grouped = new Map<string, number>();
    const explicitDisplayedGroupKeys = new Set(
      groupedChartSeries
        .map((series) => series.key)
        .filter((key) => key && key !== "__other__"),
    );

    for (const key of selectedKeys) {
      if (key === "__other__") {
        for (const [groupKey, baseline] of groupedBaselineAccountArrByAccount.entries()) {
          if (explicitDisplayedGroupKeys.has(groupKey)) continue;
          for (const [accountKey, value] of baseline.entries()) {
            grouped.set(accountKey, round2((grouped.get(accountKey) || 0) + value));
          }
        }
        continue;
      }

      const baseline = groupedBaselineAccountArrByAccount.get(key);
      if (!baseline) continue;
      for (const [accountKey, value] of baseline.entries()) {
        grouped.set(accountKey, round2((grouped.get(accountKey) || 0) + value));
      }
    }

    return grouped;
  }, [
    chartGroupBy,
    baselineAccountArrByAccount,
    selectedBarSeriesList,
    groupedChartSeries,
    groupedBaselineAccountArrByAccount,
  ]);

  const growthContributorRowsByPeriod = useMemo(() => {
    const sortRows = (rows: GrowthContributorRow[]) =>
      [...rows].sort((a, b) => {
        const absDiff = Math.abs(b.mrrImpact) - Math.abs(a.mrrImpact);
        if (Math.abs(absDiff) > 1e-9) return absDiff;
        return a.accountLabel.localeCompare(b.accountLabel);
      });

    if (hubspotVm) {
      if (chartGroupBy === "none") {
        const out = new Map<string, GrowthContributorRow[]>();
        const record = hubspotVm.growthContributorRowsByPeriod || {};
        for (const point of barChartPoints) {
          out.set(point.key, sortRows(record[point.key] || []));
        }
        return out;
      }

      const selectedKeys = selectedBarSeriesList.map((series) => series.key);
      const groupedRecord = hubspotVm.groupedGrowthContributorRowsByPeriod || {};
      const out = new Map<string, GrowthContributorRow[]>();
      for (const point of barChartPoints) {
        const combined: GrowthContributorRow[] = [];
        for (const groupKey of selectedKeys) {
          combined.push(...(groupedRecord[groupKey]?.[point.key] || []));
        }
        out.set(point.key, sortRows(combined));
      }
      return out;
    }

    return buildGrowthContributorsByPeriod(
      chartPeriodOrder,
      selectedBarAccountArrByPeriod,
      selectedBarBaselineAccountArrByAccount,
      chartAccountMetaByAccount,
    );
  }, [
    hubspotVm,
    chartGroupBy,
    barChartPoints,
    selectedBarSeriesList,
    chartPeriodOrder,
    selectedBarAccountArrByPeriod,
    selectedBarBaselineAccountArrByAccount,
    chartAccountMetaByAccount,
  ]);
  const chartGroupingLabel = CHART_GROUP_OPTIONS.find((opt) => opt.key === chartGroupBy)?.label || "Overall";
  const chartGroupingEnabled = chartGroupBy !== "none" && groupedChartSeries.length > 0;
  const multiSelectChartGroupingEnabled =
    chartGroupBy === "primaryProjectType" || chartGroupBy === "customerSupportApplication";
  const multiSelectBreakdownGroupingEnabled = groupByFields.some((field) => MULTI_SELECT_GROUP_FIELDS.has(field));

  const showDealIdColumn = groupByFields.length === 0;
  const groupByLabel = groupByFields
    .map((field) => GROUP_BY_OPTIONS.find((opt) => opt.key === field)?.label || field)
    .join(" + ");
  const breakdownHeaders = [
    ...(groupByFields.length === 0
      ? ["Deal name"]
      : groupByFields.map((field) => GROUP_BY_OPTIONS.find((opt) => opt.key === field)?.label || field)),
    ...(showDealIdColumn ? ["Deal ID"] : []),
    ...(showDealIdColumn ? ["Plan"] : []),
    ...(showDealIdColumn ? ["Account (Workspace ID, Delivery Stage)"] : []),
    ...(showDealIdColumn ? ["Territory"] : []),
    ...(showDealIdColumn ? ["Company Country"] : []),
    ...periodRefs.map((p) => p.label),
  ];

  function scaleCurrency(n: number) {
    if (currencyDisplay === "thousands") return n / 1_000;
    if (currencyDisplay === "millions") return n / 1_000_000;
    return n;
  }

  function currencySuffix() {
    if (currencyDisplay === "thousands") return " (K)";
    if (currencyDisplay === "millions") return " (M)";
    return "";
  }

  function escapeCsvCell(value: string | number) {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
      return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
  }

  function exportBreakdownCsv() {
    if (!periodRefs.length) return;

    const csvHeaders = breakdownHeaders.map((h) =>
      h !== "Deal name" &&
      h !== "Deal ID" &&
      h !== "Plan" &&
      h !== "Account (Workspace ID, Delivery Stage)" &&
      h !== "Territory" &&
      h !== "Company Country" &&
      h !== "Email"
        ? `${h}${currencySuffix()}`
        : h,
    );
    const lines: string[] = [csvHeaders.map(escapeCsvCell).join(",")];

    for (const r of displayedRows) {
      const leadingColumns =
        groupByFields.length === 0
          ? [r.dealName]
          : groupByFields.map((field) => (field === "accountId" ? accountDisplayWithDetails(r) : r.groupValues[field] || "(blank)"));
      const dealIdCol = showDealIdColumn ? [r.dealId] : [];
      const planCol = showDealIdColumn ? [r.plan || "other"] : [];
      const accountCol = showDealIdColumn ? [accountDisplayWithDetails(r)] : [];
      const territoryCol = showDealIdColumn ? [r.territory || "(blank)"] : [];
      const companyCountryCol = showDealIdColumn ? [r.companyCountry || "(blank)"] : [];
      const valueCols = periodRefs.map((p) => round2(scaleCurrency(r.valuesByPeriod[p.key] || 0)));
      const row = [
        ...leadingColumns,
        ...dealIdCol,
        ...planCol,
        ...accountCol,
        ...territoryCol,
        ...companyCountryCol,
        ...valueCols,
      ];
      lines.push(row.map(escapeCsvCell).join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `arr-breakdown-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportWeeklyCreatedPipelineCsv() {
    if (!weeklyPipeline || weeklyPipeline.rows.length === 0) return;

    const headers = [
      "Week start",
      "Week end",
      "Deals created",
      "Enterprise",
      "Managed",
      "Team",
      "Plus",
      "Desk",
      "Other",
      `Pipeline value (ARR)${currencySuffix()}`,
      `Pipeline value${currencySuffix()}`,
    ];
    const lines: string[] = [headers.map(escapeCsvCell).join(",")];

    for (const row of weeklyPipeline.rows) {
      const record = [
        row.weekStart,
        row.weekEnd,
        row.dealCount,
        row.enterpriseDealCount,
        row.managedDealCount,
        row.teamDealCount,
        row.plusDealCount,
        row.deskDealCount,
        row.otherDealCount,
        round2(scaleCurrency(row.pipelineValueArr)),
        round2(scaleCurrency(row.pipelineValue)),
      ];
      lines.push(record.map(escapeCsvCell).join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `hubspot-created-pipeline-weekly-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function addGroupBy() {
    if (groupByToAdd === "none") return;
    setGroupByFields((prev) => (prev.includes(groupByToAdd) ? prev : [...prev, groupByToAdd]));
    setGroupByToAdd("none");
  }

  function removeGroupBy(field: GroupField) {
    setGroupByFields((prev) => prev.filter((f) => f !== field));
  }

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Revenue intelligence</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">HubSpot ARR Report</h1>
            <p className="stripe-ui__subtitle">
              Select a date range and mode to analyze ARR, MRR, growth breakdown, and period trends from HubSpot data.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Controls</h2>
        <p className="stripe-ui__panel-subtitle">Set date range, mode, grain, and grouping, then run the report.</p>

        <div className="stripe-ui__control-grid">
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="hubspot-start-date">
              Start date
            </label>
            <input
              id="hubspot-start-date"
              className="stripe-ui__control"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="hubspot-end-date">
              End date
            </label>
            <input
              id="hubspot-end-date"
              className="stripe-ui__control"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="hubspot-mode">
              Mode
            </label>
            <select
              id="hubspot-mode"
              className="stripe-ui__control"
              value={mode}
              onChange={(e) => setMode(e.target.value as ReportMode)}
            >
              <option value="arr">ARR</option>
              <option value="contracted">Contracted ARR</option>
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="hubspot-grain">
              Time grain
            </label>
            <select
              id="hubspot-grain"
              className="stripe-ui__control"
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
            <label className="stripe-ui__field-label" htmlFor="hubspot-currency-display">
              Currency display
            </label>
            <select
              id="hubspot-currency-display"
              className="stripe-ui__control"
              value={currencyDisplay}
              onChange={(e) => setCurrencyDisplay(e.target.value as CurrencyDisplay)}
            >
              <option value="normal">Normal</option>
              <option value="thousands">Thousands (K)</option>
              <option value="millions">Millions (M)</option>
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="hubspot-arr-display">
              ARR display
            </label>
            <select
              id="hubspot-arr-display"
              className="stripe-ui__control"
              value={arrDisplayScope}
              onChange={(e) => setArrDisplayScope(e.target.value as ArrDisplayScope)}
            >
              <option value="all">All</option>
              <option value="cloud">Cloud</option>
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="hubspot-chart-group-by">
              Chart grouping
            </label>
            <select
              id="hubspot-chart-group-by"
              className="stripe-ui__control"
              value={chartGroupBy}
              onChange={(e) => setChartGroupBy(e.target.value as ChartGroupField)}
            >
              {CHART_GROUP_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="hubspot-group-by">
              Group by field
            </label>
            <select
              id="hubspot-group-by"
              className="stripe-ui__control"
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
            <label className="stripe-ui__field-label" htmlFor="hubspot-add-group">
              Add group
            </label>
            <button
              id="hubspot-add-group"
              className="stripe-ui__btn stripe-ui__btn--secondary"
              onClick={addGroupBy}
              disabled={groupByToAdd === "none"}
            >
              Add
            </button>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="hubspot-clear-groups">
              Clear groups
            </label>
            <button
              id="hubspot-clear-groups"
              className="stripe-ui__btn stripe-ui__btn--ghost"
              onClick={() => setGroupByFields([])}
              disabled={groupByFields.length === 0}
            >
              Clear
            </button>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="hubspot-run-report">
              Run report
            </label>
            <button
              id="hubspot-run-report"
              className="stripe-ui__btn stripe-ui__btn--primary"
              onClick={run}
              disabled={loading}
            >
              {loading ? "Running..." : "Run"}
            </button>
          </div>
        </div>

        {groupByFields.length > 0 && (
          <div className="stripe-ui__chips">
            {groupByFields.map((field) => (
              <button
                key={field}
                className="stripe-ui__chip"
                onClick={() => removeGroupBy(field)}
                type="button"
              >
                {(GROUP_BY_OPTIONS.find((opt) => opt.key === field)?.label || field) + " x"}
              </button>
            ))}
          </div>
        )}
        {multiSelectBreakdownGroupingEnabled && (
          <p className="stripe-ui__hint" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            Multi-select group fields split each row into each selected value, so grouped totals can exceed overall totals.
          </p>
        )}
      </section>

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

      {loading && (
        <section className="stripe-ui__panel stripe-ui__loading-panel ui-reveal ui-reveal-2" aria-live="polite" aria-busy="true">
          <h2 className="stripe-ui__panel-title">Running report...</h2>
          <p className="stripe-ui__panel-subtitle">Loading HubSpot data and calculating chart metrics.</p>
          <div className="stripe-ui__skeleton-grid">
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row stripe-ui__skeleton-row--short" />
          </div>
        </section>
      )}

      {!loading && (hubspotVm || data || weeklyPipeline) && (
        <>
          {weeklyPipeline && (
            <section className="stripe-ui__panel ui-reveal ui-reveal-2">
              <div className="stripe-ui__section-head">
                <div>
                  <h2 className="stripe-ui__panel-title">Created Pipeline (7-Day Buckets)</h2>
                  <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
                    Sales + Transactional pipeline deals only, grouped into 7-day chunks starting from {weeklyPipeline.startDate}.
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    className="stripe-ui__btn stripe-ui__btn--secondary"
                    type="button"
                    onClick={exportWeeklyCreatedPipelineCsv}
                    disabled={weeklyPipeline.rows.length === 0}
                  >
                    Export weekly CSV
                  </button>
                  <div className="stripe-ui__hint">
                    {`Deals: ${weeklyPipeline.totalDeals} | Total ARR: ${fmtMoney(scaleCurrency(weeklyPipeline.totalPipelineValueArr), currencyDisplay)} | Total Amount: ${fmtMoney(scaleCurrency(weeklyPipeline.totalPipelineValue), currencyDisplay)}`}
                  </div>
                </div>
              </div>

              <div className="stripe-ui__table-wrap" style={{ marginTop: "0.85rem" }}>
                <table className="stripe-ui__table">
                  <thead>
                    <tr>
                      <th>Week start</th>
                      <th>Week end</th>
                      <th className="stripe-ui__num">Deals created</th>
                      <th className="stripe-ui__num">Enterprise</th>
                      <th className="stripe-ui__num">Managed</th>
                      <th className="stripe-ui__num">Team</th>
                      <th className="stripe-ui__num">Plus</th>
                      <th className="stripe-ui__num">Desk</th>
                      <th className="stripe-ui__num">Other</th>
                      <th className="stripe-ui__num">{`Pipeline value (ARR)${currencySuffix()}`}</th>
                      <th className="stripe-ui__num">{`Pipeline value${currencySuffix()}`}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyPipeline.rows.map((row) => {
                      const rowKey = `${row.weekStart}:${row.weekEnd}`;
                      const isOpen = selectedOtherWeekKey === rowKey;
                      const otherDeals = Array.isArray(row.otherDeals) ? row.otherDeals : [];
                      return (
                        <React.Fragment key={rowKey}>
                          <tr>
                            <td>{row.weekStart}</td>
                            <td>{row.weekEnd}</td>
                            <td className="stripe-ui__num">{row.dealCount}</td>
                            <td className="stripe-ui__num">{row.enterpriseDealCount}</td>
                            <td className="stripe-ui__num">{row.managedDealCount}</td>
                            <td className="stripe-ui__num">{row.teamDealCount}</td>
                            <td className="stripe-ui__num">{row.plusDealCount}</td>
                            <td className="stripe-ui__num">{row.deskDealCount}</td>
                            <td className="stripe-ui__num">
                              {row.otherDealCount > 0 ? (
                                <button
                                  type="button"
                                  className="stripe-ui__btn stripe-ui__btn--ghost"
                                  style={{ padding: "0.1rem 0.35rem", minHeight: "1.7rem" }}
                                  onClick={() => setSelectedOtherWeekKey((prev) => (prev === rowKey ? null : rowKey))}
                                >
                                  {row.otherDealCount}
                                </button>
                              ) : (
                                0
                              )}
                            </td>
                            <td className="stripe-ui__num">{fmtMoney(scaleCurrency(row.pipelineValueArr), currencyDisplay)}</td>
                            <td className="stripe-ui__num">{fmtMoney(scaleCurrency(row.pipelineValue), currencyDisplay)}</td>
                          </tr>

                          {isOpen && (
                            <tr>
                              <td colSpan={11} style={{ padding: 0 }}>
                                <div className="stripe-ui__panel" style={{ margin: "0.55rem", padding: "0.75rem" }}>
                                  <div className="stripe-ui__section-head">
                                    <div>
                                      <h3 className="stripe-ui__panel-title" style={{ marginBottom: "0.15rem" }}>
                                        {`Other deals: ${row.weekStart} to ${row.weekEnd}`}
                                      </h3>
                                      <p className="stripe-ui__panel-subtitle" style={{ margin: 0 }}>
                                        Deals classified as other for this 7-day bucket.
                                      </p>
                                    </div>
                                    <button
                                      className="stripe-ui__btn stripe-ui__btn--ghost"
                                      type="button"
                                      onClick={() => setSelectedOtherWeekKey(null)}
                                    >
                                      Close
                                    </button>
                                  </div>

                                  <div className="stripe-ui__table-wrap" style={{ marginTop: "0.6rem" }}>
                                    <table className="stripe-ui__table">
                                      <thead>
                                        <tr>
                                          <th>Deal name</th>
                                          <th>Deal ID</th>
                                          <th>Created date</th>
                                          <th className="stripe-ui__num">{`Amount${currencySuffix()}`}</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {otherDeals.length > 0 ? (
                                          otherDeals.map((deal) => (
                                            <tr key={`${deal.dealId}:${deal.createdDate}:${deal.dealName}`}>
                                              <td>{deal.dealName}</td>
                                              <td>{deal.dealId}</td>
                                              <td>{deal.createdDate}</td>
                                              <td className="stripe-ui__num">
                                                {fmtMoney(scaleCurrency(deal.pipelineValue), currencyDisplay)}
                                              </td>
                                            </tr>
                                          ))
                                        ) : (
                                          <tr>
                                            <td colSpan={4} className="stripe-ui__hint">
                                              No other deals in this week.
                                            </td>
                                          </tr>
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {chartGroupingEnabled && (
            <section className="stripe-ui__panel ui-reveal ui-reveal-2">
              <div className="stripe-ui__section-head">
                <div>
                  <h2 className="stripe-ui__panel-title">Grouped Charts</h2>
                  <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
                    Line charts are split by {chartGroupingLabel.toLowerCase()}. Bar charts sum selected groups.
                    {multiSelectChartGroupingEnabled
                      ? " Multi-select values are split into separate groups."
                      : ""}
                  </p>
                </div>
                <div className="stripe-ui__hint">{`${groupedChartSeries.length} groups shown`}</div>
              </div>

              <div className="stripe-ui__control-grid" style={{ marginTop: "0.8rem" }}>
                <div className="stripe-ui__field" style={{ gridColumn: "1 / -1" }}>
                  <label className="stripe-ui__field-label" htmlFor="hubspot-bar-group-list">
                    Bar chart groups
                  </label>
                  <div id="hubspot-bar-group-list" className="stripe-ui__chips">
                    {groupedChartSeries.map((series) => (
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
                      onClick={() => setSelectedBarGroupKeys(groupedChartSeries.map((series) => series.key))}
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
                subtitle={`MRR derived from Contracted ARR / 12, split by ${chartGroupingLabel.toLowerCase()}.`}
                periods={chartPeriodOrder}
                series={groupedChartSeries}
                valueAccessor={(p) => p.mrr}
                valueFormatter={(v) => fmtMoney(v, "normal")}
              />
            ) : (
              <LineChartCard
                title="MRR Over Time"
                subtitle="MRR derived from Contracted ARR / 12."
                points={chartPoints}
                valueAccessor={(p) => p.mrr}
                valueFormatter={(v) => fmtMoney(v, "normal")}
                stroke="#4f8df9"
              />
            )}

            <GrowthBreakdownChart
              points={barChartPoints}
              contributorRowsByPeriod={growthContributorRowsByPeriod}
            />

            {chartGroupingEnabled ? (
              <MultiLineChartCard
                title="MRR Growth Rate Over Time"
                subtitle={`Period-over-period MRR growth rate, split by ${chartGroupingLabel.toLowerCase()}.`}
                periods={chartPeriodOrder}
                series={groupedChartSeries}
                valueAccessor={(p) => p.mrrGrowthRatePct}
                valueFormatter={(v) => fmtPercent(v)}
                includeZero
              />
            ) : (
              <LineChartCard
                title="MRR Growth Rate Over Time"
                subtitle="Period-over-period MRR growth rate using prior-period baseline."
                points={chartPoints}
                valueAccessor={(p) => p.mrrGrowthRatePct}
                valueFormatter={(v) => fmtPercent(v)}
                stroke="#f59e0b"
                includeZero
              />
            )}

            {chartGroupingEnabled ? (
              <MultiLineChartCard
                title="ARR Over Time"
                subtitle={`Contracted ARR at period end, split by ${chartGroupingLabel.toLowerCase()}.`}
                periods={chartPeriodOrder}
                series={groupedChartSeries}
                valueAccessor={(p) => p.arr}
                valueFormatter={(v) => fmtMoney(v, "normal")}
              />
            ) : (
              <LineChartCard
                title="ARR Over Time"
                subtitle="Contracted ARR at the end of each period."
                points={chartPoints}
                valueAccessor={(p) => p.arr}
                valueFormatter={(v) => fmtMoney(v, "normal")}
                stroke="#1fc16b"
              />
            )}

            {chartGroupingEnabled ? (
              <MultiLineChartCard
                title="Churn Over Time"
                subtitle={`Period churn (MRR), split by ${chartGroupingLabel.toLowerCase()}.`}
                periods={chartPeriodOrder}
                series={groupedChartSeries}
                valueAccessor={(p) => p.churnMrr}
                valueFormatter={(v) => fmtMoney(v, "normal")}
                includeZero
              />
            ) : (
              <LineChartCard
                title="Churn Over Time"
                subtitle="Period churn represented as MRR."
                points={chartPoints}
                valueAccessor={(p) => p.churnMrr}
                valueFormatter={(v) => fmtMoney(v, "normal")}
                stroke="#ef4444"
                includeZero
              />
            )}

            <DeltaBarChartCard
              title="ARR Growth Over Time"
              subtitle={
                chartGroupingEnabled
                  ? `Absolute Contracted ARR change for ${selectedBarSeriesLabel} per period.`
                  : "Absolute Contracted ARR change per period."
              }
              points={barChartPoints}
              valueAccessor={(p) => p.arrGrowth}
              valueFormatter={(v) => fmtMoney(v, "normal")}
            />
          </div>

          <section className="stripe-ui__panel ui-reveal ui-reveal-2">
            <div className="stripe-ui__section-head">
              <div>
                <h2 className="stripe-ui__panel-title">Filters & Totals</h2>
                <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
                  Apply filters to rows. Charts are always Contracted ARR + Cloud-only and can be split by chart grouping. Plan filter applies to charts too.
                </p>
              </div>
              <div className="stripe-ui__hint">
                Rows ({groupByFields.length === 0 ? "line items" : `groups: ${groupByLabel}`}): {displayedRows.length}
              </div>
            </div>

            <div className="stripe-ui__filter-grid">
              <div className="stripe-ui__field">
                <label className="stripe-ui__field-label" htmlFor="filter-deal-name">
                  Filter Deal Name
                </label>
                <input
                  id="filter-deal-name"
                  className="stripe-ui__control"
                  type="text"
                  value={filterDealName}
                  onChange={(e) => setFilterDealName(e.target.value)}
                  placeholder="contains..."
                />
              </div>

              <div className="stripe-ui__field">
                <label className="stripe-ui__field-label" htmlFor="filter-deployment-type">
                  Filter Deployment Type
                </label>
                <select
                  id="filter-deployment-type"
                  className="stripe-ui__control"
                  value={filterDeploymentType}
                  onChange={(e) => setFilterDeploymentType(e.target.value)}
                >
                  <option value="all">All</option>
                  {deploymentTypeOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stripe-ui__field">
                <label className="stripe-ui__field-label" htmlFor="filter-plan">
                  Filter Plan
                </label>
                <select
                  id="filter-plan"
                  className="stripe-ui__control"
                  value={filterPlan}
                  onChange={(e) => setFilterPlan(e.target.value as HubspotPlan | "all")}
                >
                  <option value="all">All</option>
                  {planOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stripe-ui__field">
                <label className="stripe-ui__field-label" htmlFor="filter-account-id">
                  Filter Account ID
                </label>
                <input
                  id="filter-account-id"
                  className="stripe-ui__control"
                  type="text"
                  value={filterAccountId}
                  onChange={(e) => setFilterAccountId(e.target.value)}
                  placeholder="contains..."
                />
              </div>

              <div className="stripe-ui__field">
                <label className="stripe-ui__field-label" htmlFor="filter-territory">
                  Filter Territory
                </label>
                <select
                  id="filter-territory"
                  className="stripe-ui__control"
                  value={filterTerritory}
                  onChange={(e) => setFilterTerritory(e.target.value)}
                >
                  <option value="all">All</option>
                  {territoryOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stripe-ui__field">
                <label className="stripe-ui__field-label" htmlFor="filter-country">
                  Filter Country
                </label>
                <select
                  id="filter-country"
                  className="stripe-ui__control"
                  value={filterCountry}
                  onChange={(e) => setFilterCountry(e.target.value)}
                >
                  <option value="all">All</option>
                  {countryOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stripe-ui__field">
                <label className="stripe-ui__field-label" htmlFor="filter-industry">
                  Filter Industry
                </label>
                <select
                  id="filter-industry"
                  className="stripe-ui__control"
                  value={filterIndustry}
                  onChange={(e) => setFilterIndustry(e.target.value)}
                >
                  <option value="all">All</option>
                  {industryOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stripe-ui__field">
                <label className="stripe-ui__field-label" htmlFor="filter-deal-type">
                  Filter Deal Type
                </label>
                <select
                  id="filter-deal-type"
                  className="stripe-ui__control"
                  value={filterDealType}
                  onChange={(e) => setFilterDealType(e.target.value)}
                >
                  <option value="all">All</option>
                  {dealTypeOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="stripe-ui__table-wrap" style={{ marginTop: "0.85rem" }}>
              <table className="stripe-ui__table">
                <thead>
                  <tr>
                    {periodRefs.map((p) => (
                      <th key={p.key} className="stripe-ui__num">
                        {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {totalsByPeriodForDisplayed.map((t) => (
                      <td key={t.key} className="stripe-ui__num">
                        {fmtMoney(scaleCurrency(t.total), currencyDisplay)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="stripe-ui__panel ui-reveal ui-reveal-2">
            <div className="stripe-ui__toolbar">
              <div>
                <h2 className="stripe-ui__panel-title">
                  Breakdown {groupByFields.length === 0 ? "(per line item)" : `(grouped by ${groupByLabel})`}
                </h2>
              </div>
              <div className="stripe-ui__toolbar-group">
                <button className="stripe-ui__btn stripe-ui__btn--secondary" onClick={exportBreakdownCsv}>
                  Export breakdown CSV
                </button>
              </div>
            </div>

            <div className="stripe-ui__table-wrap">
              <table className="stripe-ui__table">
                <thead>
                  <tr>
                    {breakdownHeaders.map((h) => (
                      <th key={h} className={periodRefs.some((p) => p.label === h) ? "stripe-ui__num" : ""}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {displayedRows.map((r, idx) => (
                    <tr key={`${r.dealId || r.dealName}-${idx}`}>
                      {groupByFields.length === 0 ? (
                        <td>{r.dealName}</td>
                      ) : (
                        groupByFields.map((field) => (
                          <td key={field}>{field === "accountId" ? accountDisplayWithDetails(r) : r.groupValues[field] || "(blank)"}</td>
                        ))
                      )}
                      {showDealIdColumn && <td>{r.dealId}</td>}
                      {showDealIdColumn && <td>{r.plan || "other"}</td>}
                      {showDealIdColumn && <td>{accountDisplayWithDetails(r)}</td>}
                      {showDealIdColumn && <td>{r.territory || "(blank)"}</td>}
                      {showDealIdColumn && <td>{r.companyCountry || "(blank)"}</td>}

                      {periodRefs.map((p) => (
                        <td key={p.key} className="stripe-ui__num">
                          {fmtMoney(scaleCurrency(r.valuesByPeriod[p.key] || 0), currencyDisplay)}
                        </td>
                      ))}
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
