"use client";

import React, { useMemo, useState } from "react";

type GroupBy =
  | "none"
  | "customer_id"
  | "country"
  | "territory"
  | "product_id"
  | "price_id"
  | "subscription_id"
  | "subscription_item_id"
  | "event_type"
  | "email";
type Grain = "monthly" | "daily";

type MonthlyRow = {
  monthKey: string;
  monthLabel: string;
  monthEndMrr: number;
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnMrr: number;
  netMrrChange: number;
};

type RawDetailRow = {
  eventTimestampUtc: string;
  eventType: string;
  mrrChange: number;
  customerId: string;
  customerCountry: string;
  customerTerritory: string;
  subscriptionId: string;
  subscriptionItemId: string;
  productId: string;
  productDescription: string;
  priceId: string;
  priceDescription: string;
};

type GroupedDetailRow = {
  groupKey: string;
  groupLabel: string;
  customerCountry?: string;
  customerTerritory?: string;
  monthKey: string;
  monthLabel: string;
  eventCount: number;
  netMrrChange: number;
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnMrr: number;
  monthEndMrr: number;
  monthEndArr: number;
  associatedCustomerIds?: string[];
  associatedWorkspaceIds?: string[];
  salesAssist?: "yes" | "no";
};

type ApiResponse = {
  startDate: string;
  endDate: string;
  detailStartMonth: string;
  detailEndMonth: string;
  grain: Grain;
  groupBy: GroupBy;
  targetCurrency: string;
  totalMrr: number;
  months: MonthlyRow[];
  detailRows: Array<RawDetailRow | GroupedDetailRow>;
  detailMode: "raw" | "grouped";
  pagination: {
    page: number;
    pageSize: number;
    returnedRows: number;
    totalRows: number;
    totalPages: number;
    hasMore: boolean;
  };
};

type LongevityApiResponse = {
  startDate: string;
  endDate: string;
  createdCustomersWithSameMonthMrrCount: number;
  rows?: Array<{
    customerId: string;
    email: string;
  }>;
};

type DetailMetricKey =
  | "monthEndArr"
  | "newMrr"
  | "expansionMrr"
  | "contractionMrr"
  | "churnMrr"
  | "netMrrChange"
  | "eventCount";

type GroupedSortMode = "latest_arr_desc" | "range_arr_sum_desc";

const DETAIL_METRIC_OPTIONS: Array<{ key: DetailMetricKey; label: string }> = [
  { key: "monthEndArr", label: "ARR (month end)" },
  { key: "newMrr", label: "New" },
  { key: "expansionMrr", label: "Expansion" },
  { key: "contractionMrr", label: "Contraction" },
  { key: "churnMrr", label: "Churn" },
  { key: "netMrrChange", label: "Net change" },
  { key: "eventCount", label: "Events" },
];

const GROUP_BY_OPTIONS: Array<{ key: GroupBy; label: string }> = [
  { key: "none", label: "No grouping (line items)" },
  { key: "customer_id", label: "Customer ID" },
  { key: "country", label: "Country" },
  { key: "territory", label: "Territory" },
  { key: "email", label: "Email" },
  { key: "product_id", label: "Product ID" },
  { key: "price_id", label: "Price ID" },
  { key: "subscription_id", label: "Subscription ID" },
  { key: "subscription_item_id", label: "Subscription Item ID" },
  { key: "event_type", label: "Event Type" },
];
const GRAIN_OPTIONS: Array<{ key: Grain; label: string }> = [
  { key: "monthly", label: "Monthly" },
  { key: "daily", label: "Daily" },
];

const PAGE_SIZE = 1000;
const EXPORT_PAGE_SIZE_RAW = 20000;
const EXPORT_PAGE_SIZE_GROUPED = 20000;
const EXPORT_FETCH_CONCURRENCY_RAW = 3;
const EXPORT_FETCH_CONCURRENCY_GROUPED = 2;
const EXPORT_PAGE_SIZE_MAX = 100000;

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end.getFullYear() - 1, end.getMonth(), 1);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    startDate: toIso(start),
    endDate: toIso(end),
    startMonth: toIso(start).slice(0, 7),
    endMonth: toIso(end).slice(0, 7),
  };
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

function withDescription(id: string, description: string) {
  const cleanId = String(id || "").trim() || "(blank)";
  const cleanDescription = String(description || "").trim();
  if (!cleanDescription || cleanDescription === "(blank)" || cleanDescription === cleanId) return cleanId;
  return `${cleanId} (${cleanDescription})`;
}

function isGroupedRow(row: RawDetailRow | GroupedDetailRow): row is GroupedDetailRow {
  return "groupLabel" in row;
}

function metricValue(row: GroupedDetailRow | undefined, metric: DetailMetricKey) {
  if (!row) return 0;
  if (metric === "monthEndArr") return row.monthEndArr;
  if (metric === "newMrr") return row.newMrr;
  if (metric === "expansionMrr") return row.expansionMrr;
  if (metric === "contractionMrr") return row.contractionMrr;
  if (metric === "churnMrr") return row.churnMrr;
  if (metric === "netMrrChange") return row.netMrrChange;
  return row.eventCount;
}

function isMoneyMetric(metric: DetailMetricKey) {
  return metric !== "eventCount";
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function mergeStringLists(current: string[] | undefined, next: string[] | undefined) {
  const seen = new Set<string>();
  for (const value of current || []) {
    const normalized = String(value || "").trim();
    if (normalized) seen.add(normalized);
  }
  for (const value of next || []) {
    const normalized = String(value || "").trim();
    if (normalized) seen.add(normalized);
  }
  return Array.from(seen);
}

function parseCountryFilterRulesInput(raw: string) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).slice(0, 50);
}

function isIsoMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(String(value || ""));
}

function previousIsoMonth(isoMonth: string) {
  if (!isIsoMonth(isoMonth)) return "";
  const [yearRaw, monthRaw] = isoMonth.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return "";
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export default function StripeThroughMrrPage() {
  const defaults = useMemo(() => defaultDateRange(), []);

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [detailStartMonth, setDetailStartMonth] = useState(defaults.startMonth);
  const [detailEndMonth, setDetailEndMonth] = useState(defaults.endMonth);
  const [grain, setGrain] = useState<Grain>("monthly");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [selectedMetrics, setSelectedMetrics] = useState<DetailMetricKey[]>(["monthEndArr"]);

  const [page, setPage] = useState(1);
  const [pageJumpInput, setPageJumpInput] = useState("1");
  const [hasRunOnce, setHasRunOnce] = useState(false);

  const [loading, setLoading] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [createdCustomersWithSameMonthMrrCount, setCreatedCustomersWithSameMonthMrrCount] = useState<number | null>(null);
  const [createdCustomersWithSameMonthMrrRows, setCreatedCustomersWithSameMonthMrrRows] = useState<Array<{ customerId: string; email: string }>>([]);
  const [createdCustomersWithSameMonthMrrRowsLoading, setCreatedCustomersWithSameMonthMrrRowsLoading] = useState(false);
  const [createdCustomersWithSameMonthMrrRowsError, setCreatedCustomersWithSameMonthMrrRowsError] = useState<string | null>(null);
  const [showCreatedCustomersWithSameMonthMrrRows, setShowCreatedCustomersWithSameMonthMrrRows] = useState(false);
  const [createdCustomersWithSameMonthMrrCountError, setCreatedCustomersWithSameMonthMrrCountError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Detail table filters
  const [filterEventType, setFilterEventType] = useState("all");
  const [filterCustomerId, setFilterCustomerId] = useState("");
  const [filterProductSearch, setFilterProductSearch] = useState("");
  const [filterGroupSearch, setFilterGroupSearch] = useState("");
  const [filterCountrySearch, setFilterCountrySearch] = useState("");
  const [filterTerritorySearch, setFilterTerritorySearch] = useState("");
  const [filterCustomerCountryRules, setFilterCustomerCountryRules] = useState("");
  const [groupedSortMode, setGroupedSortMode] = useState<GroupedSortMode>("range_arr_sum_desc");
  const countryFilterRules = useMemo(
    () => parseCountryFilterRulesInput(filterCustomerCountryRules),
    [filterCustomerCountryRules],
  );

  async function run(targetPage = 1) {
    setHasRunOnce(true);
    setLoading(true);
    setError(null);
    setCreatedCustomersWithSameMonthMrrCount(null);
    setCreatedCustomersWithSameMonthMrrRows([]);
    setCreatedCustomersWithSameMonthMrrRowsLoading(false);
    setCreatedCustomersWithSameMonthMrrRowsError(null);
    setShowCreatedCustomersWithSameMonthMrrRows(false);
    setCreatedCustomersWithSameMonthMrrCountError(null);
    try {
      const [res, longevityRes] = await Promise.all([
        fetch("/api/stripe-through-mrr-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate,
            endDate,
            detailStartMonth,
            detailEndMonth,
            grain,
            groupBy,
            countryFilters: countryFilterRules,
            page: targetPage,
            pageSize: PAGE_SIZE,
          }),
        }),
        fetch("/api/stripe-through-mrr-customer-longevity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate,
            endDate,
            includeDetails: false,
          }),
        }).catch(() => null),
      ]);

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
      const report = json as ApiResponse;
      setData(report);
      setPage(report.pagination.page);
      setPageJumpInput(String(report.pagination.page));
      setDetailStartMonth(report.detailStartMonth);
      setDetailEndMonth(report.detailEndMonth);
      setGrain(report.grain || "monthly");

      if (longevityRes && longevityRes.ok) {
        const longevityJson = (await longevityRes.json()) as Partial<LongevityApiResponse>;
        const countValue = Number(longevityJson?.createdCustomersWithSameMonthMrrCount || 0);
        if (Number.isFinite(countValue)) {
          setCreatedCustomersWithSameMonthMrrCount(Math.max(0, Math.floor(countValue)));
        }
      } else if (longevityRes) {
        const text = await longevityRes.text();
        setCreatedCustomersWithSameMonthMrrCountError(text || `HTTP ${longevityRes.status}`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleCreatedCustomersWithSameMonthMrrRows() {
    if (!showCreatedCustomersWithSameMonthMrrRows) {
      if (!createdCustomersWithSameMonthMrrRows.length && !createdCustomersWithSameMonthMrrRowsLoading) {
        setCreatedCustomersWithSameMonthMrrRowsLoading(true);
        setCreatedCustomersWithSameMonthMrrRowsError(null);
        try {
          const res = await fetch("/api/stripe-through-mrr-customer-longevity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              startDate: data?.startDate || startDate,
              endDate: data?.endDate || endDate,
              includeDetails: true,
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
            const message =
              json && typeof json === "object" && "error" in json
                ? String((json as { error?: unknown }).error || "Failed to load customer list")
                : text || `HTTP ${res.status}`;
            throw new Error(message);
          }
          const payload = (json || {}) as Partial<LongevityApiResponse>;
          const rows = Array.isArray(payload.rows) ? payload.rows : [];
          setCreatedCustomersWithSameMonthMrrRows(
            rows
              .map((row) => ({
                customerId: String(row.customerId || "").trim(),
                email: String(row.email || "").trim(),
              }))
              .filter((row) => row.customerId),
          );
        } catch (e: unknown) {
          setCreatedCustomersWithSameMonthMrrRowsError(e instanceof Error ? e.message : "Failed to load customer list");
        } finally {
          setCreatedCustomersWithSameMonthMrrRowsLoading(false);
        }
      }
    }
    setShowCreatedCustomersWithSameMonthMrrRows((value) => !value);
  }

  function runFresh() {
    setPage(1);
    setPageJumpInput("1");
    setFilterEventType("all");
    setFilterCustomerId("");
    setFilterProductSearch("");
    setFilterGroupSearch("");
    setFilterCountrySearch("");
    setFilterTerritorySearch("");
    void run(1);
  }

  function goToPage(target: number) {
    const totalPages = data?.pagination.totalPages || 1;
    const safe = Math.max(1, Math.min(totalPages, Math.floor(target)));
    setPage(safe);
    setPageJumpInput(String(safe));
    void run(safe);
  }

  const summaryCurrency = data?.targetCurrency || "USD";
  const effectiveGrain = data?.grain || grain;
  const periodLabel = effectiveGrain === "daily" ? "Day" : "Month";
  const detailMode = data?.detailMode || (groupBy === "none" ? "raw" : "grouped");
  const months = useMemo(() => data?.months || [], [data]);
  const detailRows = useMemo(() => data?.detailRows || [], [data]);
  const effectiveDetailStartMonth = data?.detailStartMonth || detailStartMonth;
  const effectiveDetailEndMonth = data?.detailEndMonth || detailEndMonth;

  const detailMonthsInRange = useMemo(() => {
    const groupedRows = detailRows.filter(isGroupedRow);
    if (groupedRows.length) {
      const byKey = new Map<string, string>();
      for (const row of groupedRows) {
        byKey.set(row.monthKey, row.monthLabel || row.monthKey);
      }
      return Array.from(byKey.entries())
        .map(([monthKey, monthLabel]) => ({ monthKey, monthLabel }))
        .filter((month) => month.monthKey >= effectiveDetailStartMonth && month.monthKey <= effectiveDetailEndMonth)
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    }
    return months.filter((month) => month.monthKey >= effectiveDetailStartMonth && month.monthKey <= effectiveDetailEndMonth);
  }, [detailRows, months, effectiveDetailStartMonth, effectiveDetailEndMonth]);

  const groupedMatrixRows = useMemo(() => {
    if (detailMode !== "grouped") return [];
    const groupedRows = detailRows.filter(isGroupedRow);
    const byGroup = new Map<
      string,
      {
        groupKey: string;
        groupLabel: string;
        customerCountry: string;
        customerTerritory: string;
        associatedCustomerIds: string[];
        associatedWorkspaceIds: string[];
        salesAssist: "yes" | "no";
        totalNet: number;
        byMonth: Map<string, GroupedDetailRow>;
      }
    >();
    for (const row of groupedRows) {
      const mapKey = `${row.groupKey}|${row.groupLabel}|${row.customerCountry || "N/A"}|${row.customerTerritory || "N/A"}`;
      if (!byGroup.has(mapKey)) {
        byGroup.set(mapKey, {
          groupKey: row.groupKey,
          groupLabel: row.groupLabel || row.groupKey || "(blank)",
          customerCountry: row.customerCountry || "N/A",
          customerTerritory: row.customerTerritory || "N/A",
          associatedCustomerIds: row.associatedCustomerIds || [],
          associatedWorkspaceIds: row.associatedWorkspaceIds || [],
          salesAssist: row.salesAssist === "yes" ? "yes" : "no",
          totalNet: 0,
          byMonth: new Map(),
        });
      }
      const entry = byGroup.get(mapKey)!;
      if ((entry.customerCountry === "N/A" || !entry.customerCountry) && row.customerCountry) {
        entry.customerCountry = row.customerCountry;
      }
      if ((entry.customerTerritory === "N/A" || !entry.customerTerritory) && row.customerTerritory) {
        entry.customerTerritory = row.customerTerritory;
      }
      entry.associatedCustomerIds = mergeStringLists(entry.associatedCustomerIds, row.associatedCustomerIds);
      entry.associatedWorkspaceIds = mergeStringLists(entry.associatedWorkspaceIds, row.associatedWorkspaceIds);
      if (row.salesAssist === "yes") entry.salesAssist = "yes";
      entry.byMonth.set(row.monthKey, row);
      entry.totalNet += row.netMrrChange;
    }
    const latestMonthKey = detailMonthsInRange.length ? detailMonthsInRange[detailMonthsInRange.length - 1].monthKey : "";
    const arrSumInRange = (entry: { byMonth: Map<string, GroupedDetailRow> }) =>
      detailMonthsInRange.reduce((sum, month) => sum + metricValue(entry.byMonth.get(month.monthKey), "monthEndArr"), 0);
    return Array.from(byGroup.values()).sort((a, b) => {
      if (groupedSortMode === "range_arr_sum_desc") {
        const aRangeArr = arrSumInRange(a);
        const bRangeArr = arrSumInRange(b);
        const rangeDiff = bRangeArr - aRangeArr;
        if (Math.abs(rangeDiff) > 1e-9) return rangeDiff;
      }
      const aLatestArr = latestMonthKey ? metricValue(a.byMonth.get(latestMonthKey), "monthEndArr") : 0;
      const bLatestArr = latestMonthKey ? metricValue(b.byMonth.get(latestMonthKey), "monthEndArr") : 0;
      const arrDiff = bLatestArr - aLatestArr;
      if (Math.abs(arrDiff) > 1e-9) return arrDiff;
      const diff = b.totalNet - a.totalNet;
      if (Math.abs(diff) > 1e-9) return diff;
      return a.groupLabel.localeCompare(b.groupLabel);
    });
  }, [detailMode, detailRows, detailMonthsInRange, groupedSortMode]);

  const eventTypeOptions = useMemo(() => {
    const types = new Set(
      (detailRows as RawDetailRow[]).filter((r) => !isGroupedRow(r as unknown as GroupedDetailRow)).map((r) => r.eventType).filter(Boolean),
    );
    return Array.from(types).sort();
  }, [detailRows]);

  const filteredRawRows = useMemo(() => {
    if (detailMode !== "raw") return detailRows as RawDetailRow[];
    const rows = detailRows as RawDetailRow[];
    const customerNeedle = filterCustomerId.trim().toLowerCase();
    const productNeedle = filterProductSearch.trim().toLowerCase();
    const countryNeedle = filterCountrySearch.trim().toLowerCase();
    const territoryNeedle = filterTerritorySearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterEventType !== "all" && r.eventType !== filterEventType) return false;
      if (customerNeedle && !String(r.customerId || "").toLowerCase().includes(customerNeedle)) return false;
      if (countryNeedle && !String(r.customerCountry || "").toLowerCase().includes(countryNeedle)) return false;
      if (territoryNeedle && !String(r.customerTerritory || "").toLowerCase().includes(territoryNeedle)) return false;
      if (productNeedle) {
        const productText = `${r.productId || ""} ${r.productDescription || ""} ${r.priceId || ""} ${r.priceDescription || ""}`.toLowerCase();
        if (!productText.includes(productNeedle)) return false;
      }
      return true;
    });
  }, [detailMode, detailRows, filterEventType, filterCustomerId, filterCountrySearch, filterTerritorySearch, filterProductSearch]);

  const filteredGroupedMatrixRows = useMemo(() => {
    const groupNeedle = filterGroupSearch.trim().toLowerCase();
    const countryNeedle = filterCountrySearch.trim().toLowerCase();
    const territoryNeedle = filterTerritorySearch.trim().toLowerCase();
    return groupedMatrixRows.filter((g) => {
      const matchesGroupNeedle = !groupNeedle ||
        String(g.groupLabel || g.groupKey || "").toLowerCase().includes(groupNeedle) ||
        String(g.customerCountry || "").toLowerCase().includes(groupNeedle) ||
        String(g.customerTerritory || "").toLowerCase().includes(groupNeedle) ||
        g.associatedCustomerIds.some((customerId) => customerId.toLowerCase().includes(groupNeedle));
      if (!matchesGroupNeedle) return false;
      if (countryNeedle && !String(g.customerCountry || "").toLowerCase().includes(countryNeedle)) return false;
      if (territoryNeedle && !String(g.customerTerritory || "").toLowerCase().includes(territoryNeedle)) return false;
      return true;
    });
  }, [groupedMatrixRows, filterGroupSearch, filterCountrySearch, filterTerritorySearch]);

  const rawNonZeroMrrRowsCount = useMemo(
    () => filteredRawRows.reduce((count, row) => count + (Math.abs(Number(row.mrrChange || 0)) > 1e-9 ? 1 : 0), 0),
    [filteredRawRows],
  );

  const groupedNonZeroCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const month of detailMonthsInRange) {
      for (const metric of selectedMetrics) {
        const key = `${month.monthKey}:${metric}`;
        let count = 0;
        for (const group of filteredGroupedMatrixRows) {
          if (Math.abs(metricValue(group.byMonth.get(month.monthKey), metric)) > 1e-9) count += 1;
        }
        out[key] = count;
      }
    }
    return out;
  }, [detailMonthsInRange, selectedMetrics, filteredGroupedMatrixRows]);

  function buildGroupMatrix(rows: GroupedDetailRow[]) {
    const byGroup = new Map<
      string,
      {
        groupKey: string;
        groupLabel: string;
        customerCountry: string;
        customerTerritory: string;
        associatedCustomerIds: string[];
        associatedWorkspaceIds: string[];
        salesAssist: "yes" | "no";
        byMonth: Map<string, GroupedDetailRow>;
      }
    >();
    for (const row of rows) {
      const mapKey = `${row.groupKey}|${row.groupLabel}|${row.customerCountry || "N/A"}|${row.customerTerritory || "N/A"}`;
      if (!byGroup.has(mapKey)) {
        byGroup.set(mapKey, {
          groupKey: row.groupKey,
          groupLabel: row.groupLabel || row.groupKey || "(blank)",
          customerCountry: row.customerCountry || "N/A",
          customerTerritory: row.customerTerritory || "N/A",
          associatedCustomerIds: row.associatedCustomerIds || [],
          associatedWorkspaceIds: row.associatedWorkspaceIds || [],
          salesAssist: row.salesAssist === "yes" ? "yes" : "no",
          byMonth: new Map(),
        });
      }
      const entry = byGroup.get(mapKey)!;
      if ((entry.customerCountry === "N/A" || !entry.customerCountry) && row.customerCountry) {
        entry.customerCountry = row.customerCountry;
      }
      if ((entry.customerTerritory === "N/A" || !entry.customerTerritory) && row.customerTerritory) {
        entry.customerTerritory = row.customerTerritory;
      }
      entry.associatedCustomerIds = mergeStringLists(entry.associatedCustomerIds, row.associatedCustomerIds);
      entry.associatedWorkspaceIds = mergeStringLists(entry.associatedWorkspaceIds, row.associatedWorkspaceIds);
      if (row.salesAssist === "yes") entry.salesAssist = "yes";
      entry.byMonth.set(row.monthKey, row);
    }
    return Array.from(byGroup.values());
  }

  function displayGroupLabel(group: { groupKey: string; groupLabel: string; customerCountry?: string }) {
    const base = group.groupLabel || group.groupKey || "(blank)";
    if (groupBy !== "customer_id") return base;
    const country = group.customerCountry || "N/A";
    return `${base} (${country})`;
  }

  function exportMonthlyCsv() {
    const headers = [periodLabel, "MRR (period end)", "New", "Expansion", "Contraction", "Churn", "Net change"];
    const rows = months.map((row) => [
      row.monthLabel,
      String(row.monthEndMrr),
      String(row.newMrr),
      String(row.expansionMrr),
      String(row.contractionMrr),
      String(row.churnMrr),
      String(row.netMrrChange),
    ]);
    downloadCsv(`stripe-through-mrr-${effectiveGrain}.csv`, headers, rows);
  }

  async function fetchDetailReportPage(
    pageNum: number,
    pageSize: number,
    skipSummary = false,
    skipCount = false,
  ): Promise<ApiResponse> {
    const maxAttempts = 8;
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const res = await fetch("/api/stripe-through-mrr-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate: data?.startDate || startDate,
            endDate: data?.endDate || endDate,
            detailStartMonth: data?.detailStartMonth || detailStartMonth,
            detailEndMonth: data?.detailEndMonth || detailEndMonth,
            grain: data?.grain || grain,
            groupBy: data?.groupBy || groupBy,
            countryFilters: countryFilterRules,
            page: pageNum,
            pageSize,
            skipSummary,
            skipCount,
          }),
        });
        const text = await res.text();
        let json: unknown = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        if (res.ok) {
          if (!json || typeof json !== "object") throw new Error("Invalid API response while exporting detail rows");
          return json as ApiResponse;
        }
        const message =
          json && typeof json === "object" && "error" in json
            ? String((json as { error?: unknown }).error || "Export page request failed")
            : text || `HTTP ${res.status}`;
        const isRateLimited =
          res.status === 429 ||
          (res.status === 403 && /rate.?limit|too many api requests|exceeded rate/i.test(message));
        const canRetry = attempt < maxAttempts && (isRateLimited || res.status >= 500);
        if (canRetry) {
          const waitMs = 500 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
          await sleep(waitMs);
          continue;
        }
        throw new Error(message || `HTTP ${res.status}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "");
        const isTransientNetwork = /failed to fetch|networkerror|load failed|network request failed/i.test(message);
        if (attempt < maxAttempts && isTransientNetwork) {
          const waitMs = 500 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
          await sleep(waitMs);
          continue;
        }
        throw new Error(message || "Export page request failed");
      }
    }
    throw new Error("Export failed after retries");
  }

  async function fetchAllDetailRowsWithPageSize(
    pageSize: number,
    concurrency: number,
  ): Promise<Array<RawDetailRow | GroupedDetailRow>> {
    const first = await fetchDetailReportPage(1, pageSize, true, true);
    const firstRows = (first.detailRows || []).filter(Boolean) as Array<RawDetailRow | GroupedDetailRow>;
    if (!first.pagination?.hasMore || firstRows.length < pageSize) return firstRows;

    const rowsByPage = new Map<number, Array<RawDetailRow | GroupedDetailRow>>([[1, firstRows]]);
    let nextBatchStartPage = 2;
    let stop = false;

    while (!stop) {
      const pages = Array.from({ length: concurrency }, (_, idx) => nextBatchStartPage + idx);
      const batch = await Promise.all(
        pages.map((pageNum) => fetchDetailReportPage(pageNum, pageSize, true, true)),
      );
      batch.sort((a, b) => (a.pagination?.page || 0) - (b.pagination?.page || 0));

      for (const report of batch) {
        const reportPage = Math.max(1, report.pagination?.page || 1);
        const pageRows = (report.detailRows || []).filter(Boolean) as Array<RawDetailRow | GroupedDetailRow>;
        rowsByPage.set(reportPage, pageRows);
        const returnedRows = Math.max(0, report.pagination?.returnedRows || pageRows.length);
        if (!report.pagination?.hasMore || returnedRows < pageSize || returnedRows === 0) {
          stop = true;
          break;
        }
      }

      nextBatchStartPage += concurrency;
    }

    const allRows: Array<RawDetailRow | GroupedDetailRow> = [];
    const maxPage = Math.max(0, ...Array.from(rowsByPage.keys()));
    for (let pageNum = 1; pageNum <= maxPage; pageNum += 1) {
      const pageRows = rowsByPage.get(pageNum) || [];
      if (pageNum > 1 && pageRows.length === 0) break;
      allRows.push(...pageRows);
    }
    return allRows;
  }

  async function fetchAllDetailRows(): Promise<Array<RawDetailRow | GroupedDetailRow>> {
    if (!data) return [];
    const isGrouped = (data?.detailMode || detailMode) === "grouped";
    const exportPageSize = isGrouped ? EXPORT_PAGE_SIZE_GROUPED : EXPORT_PAGE_SIZE_RAW;
    const exportConcurrency = isGrouped ? EXPORT_FETCH_CONCURRENCY_GROUPED : EXPORT_FETCH_CONCURRENCY_RAW;
    const candidatePageSizes = Array.from(
      new Set([
        EXPORT_PAGE_SIZE_MAX,
        exportPageSize,
        Math.max(PAGE_SIZE, Math.floor(exportPageSize / 2)),
        PAGE_SIZE,
      ]),
    ).filter((size) => size >= PAGE_SIZE);

    let lastError: unknown = null;
    for (const candidatePageSize of candidatePageSizes) {
      try {
        return await fetchAllDetailRowsWithPageSize(candidatePageSize, exportConcurrency);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Export failed");
  }

  async function exportRawDetailCsv() {
    setExportingCsv(true);
    try {
      const allRows = await fetchAllDetailRows();
      const customerNeedle = filterCustomerId.trim().toLowerCase();
      const productNeedle = filterProductSearch.trim().toLowerCase();
      const filtered = allRows
        .filter((row): row is RawDetailRow => !!row && !isGroupedRow(row))
        .filter((row) => {
          if (filterEventType !== "all" && row.eventType !== filterEventType) return false;
          if (customerNeedle && !String(row.customerId || "").toLowerCase().includes(customerNeedle)) return false;
          if (productNeedle) {
            const t = `${row.productId || ""} ${row.productDescription || ""} ${row.priceId || ""} ${row.priceDescription || ""}`.toLowerCase();
            if (!t.includes(productNeedle)) return false;
          }
          return true;
        });
      const headers = [
        "Event timestamp (UTC)",
        "Event type",
        "MRR change",
        "Customer",
        "Customer country",
        "Customer territory",
        "Product",
        "Price",
        "Subscription Item ID",
        "Subscription ID",
      ];
      const rows = filtered.map((row) => [
        row.eventTimestampUtc,
        row.eventType || "(blank)",
        String(row.mrrChange),
        row.customerId || "(blank)",
        row.customerCountry || "N/A",
        row.customerTerritory || "N/A",
        withDescription(row.productId, row.productDescription),
        withDescription(row.priceId, row.priceDescription),
        row.subscriptionItemId || "(blank)",
        row.subscriptionId || "(blank)",
      ]);
      downloadCsv("stripe-through-mrr-detail-raw.csv", headers, rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportingCsv(false);
    }
  }

  async function exportGroupedDetailCsv() {
    setExportingCsv(true);
    try {
      const allRows = await fetchAllDetailRows();
      const groupedRows = allRows.filter((row): row is GroupedDetailRow => !!row && isGroupedRow(row));
      const allMatrix = buildGroupMatrix(groupedRows);
      const latestMonthKey = detailMonthsInRange.length ? detailMonthsInRange[detailMonthsInRange.length - 1].monthKey : "";
      const arrSumInRange = (entry: { byMonth: Map<string, GroupedDetailRow> }) =>
        detailMonthsInRange.reduce((sum, month) => sum + metricValue(entry.byMonth.get(month.monthKey), "monthEndArr"), 0);
      const sortedMatrix = [...allMatrix].sort((a, b) => {
        if (groupedSortMode === "range_arr_sum_desc") {
          const aRangeArr = arrSumInRange(a);
          const bRangeArr = arrSumInRange(b);
          const rangeDiff = bRangeArr - aRangeArr;
          if (Math.abs(rangeDiff) > 1e-9) return rangeDiff;
        }
        const aLatestArr = latestMonthKey ? metricValue(a.byMonth.get(latestMonthKey), "monthEndArr") : 0;
        const bLatestArr = latestMonthKey ? metricValue(b.byMonth.get(latestMonthKey), "monthEndArr") : 0;
        const arrDiff = bLatestArr - aLatestArr;
        if (Math.abs(arrDiff) > 1e-9) return arrDiff;
        return displayGroupLabel(a).localeCompare(displayGroupLabel(b));
      });
      const needle = filterGroupSearch.trim().toLowerCase();
      const filtered = needle
        ? sortedMatrix.filter(
            (g) =>
              String(g.groupLabel || g.groupKey || "").toLowerCase().includes(needle) ||
              String(g.customerCountry || "").toLowerCase().includes(needle) ||
              String(g.customerTerritory || "").toLowerCase().includes(needle) ||
              g.associatedCustomerIds.some((customerId) => customerId.toLowerCase().includes(needle),
              ),
          )
        : sortedMatrix;
      const metricHeaders = detailMonthsInRange.flatMap((month) =>
        selectedMetrics.map((metric) => `${month.monthLabel} - ${DETAIL_METRIC_OPTIONS.find((o) => o.key === metric)?.label || metric}`),
      );
      const baseHeaders = groupBy === "email"
        ? ["Group", "Customer IDs", "Customer country", "Customer territory", "Sales assist", ...metricHeaders]
        : ["Group", ...metricHeaders];
      const csvRows = filtered.map((group) => {
        const values = detailMonthsInRange.flatMap((month) =>
          selectedMetrics.map((metric) => String(metricValue(group.byMonth.get(month.monthKey), metric))),
        );
        return groupBy === "email"
          ? [
            displayGroupLabel(group),
            group.associatedCustomerIds.join(" | "),
            group.customerCountry || "N/A",
            group.customerTerritory || "N/A",
            group.salesAssist,
            ...values,
          ]
          : [displayGroupLabel(group), ...values];
      });
      downloadCsv("stripe-through-mrr-detail-grouped.csv", baseHeaders, csvRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportingCsv(false);
    }
  }

  async function exportSalesAssistCsv() {
    setExportingCsv(true);
    try {
      const exportMonth = effectiveDetailEndMonth;
      const previousMonth = previousIsoMonth(exportMonth);
      if (!isIsoMonth(exportMonth) || !previousMonth) {
        throw new Error("Invalid detail month selected for sales-assist export");
      }
      const res = await fetch("/api/stripe-through-mrr-sales-assist-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detailMonth: exportMonth }),
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
          throw new Error(String((json as { error?: unknown }).error || "Sales assist export failed"));
        }
        throw new Error(text || `HTTP ${res.status}`);
      }
      const payload = json as { rows?: string[][] };
      const csvRows = Array.isArray(payload?.rows) ? payload.rows : [];
      downloadCsv(
        `stripe-through-mrr-sales-assist-new-customers-${exportMonth}.csv`,
        [
          "Detail month",
          "Previous month",
          "Customer ID",
          "Email group",
          "Customer country",
          "Customer territory",
          "Workspace IDs",
          "Sales assist",
          "Previous month-end MRR",
          "Current month-end MRR",
        ],
        csvRows,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sales assist export failed");
    } finally {
      setExportingCsv(false);
    }
  }

  function exportDisplayedSalesAssistCsv() {
    if (detailMode !== "grouped" || groupBy !== "email") {
      setError("Sales assist full export is available only when grouped by Email.");
      return;
    }
    const rows = filteredGroupedMatrixRows.filter((group) => group.salesAssist === "yes");
    const metricHeaders = detailMonthsInRange.flatMap((month) =>
      selectedMetrics.map((metric) => `${month.monthLabel} - ${DETAIL_METRIC_OPTIONS.find((o) => o.key === metric)?.label || metric}`),
    );
    const csvRows = rows.map((group) => {
      const values = detailMonthsInRange.flatMap((month) =>
        selectedMetrics.map((metric) => String(metricValue(group.byMonth.get(month.monthKey), metric))),
      );
      return [
        displayGroupLabel(group),
        group.associatedCustomerIds.join(" | "),
        group.customerCountry || "N/A",
        group.customerTerritory || "N/A",
        group.associatedWorkspaceIds.join(" | "),
        group.salesAssist || "no",
        ...values,
      ];
    });
    downloadCsv(
      `stripe-through-mrr-sales-assist-all-displayed-${effectiveDetailStartMonth}-to-${effectiveDetailEndMonth}.csv`,
      [
        "Group",
        "Customer IDs",
        "Customer country",
        "Customer territory",
        "Workspace IDs",
        "Sales assist",
        ...metricHeaders,
      ],
      csvRows,
    );
  }

  function toggleMetric(metric: DetailMetricKey) {
    setSelectedMetrics((prev) => {
      if (prev.includes(metric)) {
        const next = prev.filter((value) => value !== metric);
        return next.length ? next : prev;
      }
      return [...prev, metric];
    });
  }

  function exportCreatedCustomersWithSameMonthMrrRowsCsv() {
    const headers = ["Customer ID", "Email"];
    const rows = createdCustomersWithSameMonthMrrRows.map((row) => [row.customerId, row.email || ""]);
    const start = data?.startDate || startDate;
    const end = data?.endDate || endDate;
    downloadCsv(`stripe-through-mrr-created-in-range-nonzero-mrr-${start}-to-${end}.csv`, headers, rows);
  }

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Revenue intelligence</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Stripe through MRR</h1>
            <p className="stripe-ui__subtitle">
              Uses `botpress-stripe-data-pipeline.stripe.subscription_item_change_events_v2_beta` to compute monthly
              MRR, cumulative total MRR to end date, and monthly New/Expansion/Contraction/Churn. Grouped detail mode
              shows cumulative month-end ARR per selected group.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Report controls</h2>
        <p className="stripe-ui__panel-subtitle">
          Select date range, detail month range, and grouping. All heavy processing runs in backend BigQuery.
        </p>

        <div className="stripe-ui__control-grid">
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-through-mrr-start-date">
              Start date
            </label>
            <input
              id="stripe-through-mrr-start-date"
              className="stripe-ui__control"
              type="date"
              value={startDate}
              onChange={(e) => {
                const nextStart = e.target.value;
                setStartDate(nextStart);
                const nextStartMonth = nextStart.slice(0, 7);
                if (detailStartMonth < nextStartMonth) setDetailStartMonth(nextStartMonth);
                if (detailEndMonth < nextStartMonth) setDetailEndMonth(nextStartMonth);
              }}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-through-mrr-end-date">
              End date
            </label>
            <input
              id="stripe-through-mrr-end-date"
              className="stripe-ui__control"
              type="date"
              value={endDate}
              onChange={(e) => {
                const nextEnd = e.target.value;
                setEndDate(nextEnd);
                const nextEndMonth = nextEnd.slice(0, 7);
                if (detailEndMonth > nextEndMonth) setDetailEndMonth(nextEndMonth);
                if (detailStartMonth > nextEndMonth) setDetailStartMonth(nextEndMonth);
              }}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-through-mrr-grain">
              Time grain
            </label>
            <select
              id="stripe-through-mrr-grain"
              className="stripe-ui__control"
              value={grain}
              onChange={(e) => setGrain(e.target.value as Grain)}
            >
              {GRAIN_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-through-mrr-detail-start-month">
              Detail start month
            </label>
            <input
              id="stripe-through-mrr-detail-start-month"
              className="stripe-ui__control"
              type="month"
              min={startDate.slice(0, 7)}
              max={detailEndMonth || endDate.slice(0, 7)}
              value={detailStartMonth}
              onChange={(e) => setDetailStartMonth(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-through-mrr-detail-end-month">
              Detail end month
            </label>
            <input
              id="stripe-through-mrr-detail-end-month"
              className="stripe-ui__control"
              type="month"
              min={detailStartMonth || startDate.slice(0, 7)}
              max={endDate.slice(0, 7)}
              value={detailEndMonth}
              onChange={(e) => setDetailEndMonth(e.target.value)}
            />
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-through-mrr-group-by">
              Group detail rows by
            </label>
            <select
              id="stripe-through-mrr-group-by"
              className="stripe-ui__control"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            >
              {GROUP_BY_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="stripe-through-mrr-run-btn">
              Run report
            </label>
            <button
              id="stripe-through-mrr-run-btn"
              className="stripe-ui__btn stripe-ui__btn--primary"
              onClick={runFresh}
              disabled={loading}
            >
              {loading ? "Running..." : "Run"}
            </button>
          </div>
        </div>
      </section>

      {loading && (
        <section className="stripe-ui__panel stripe-ui__loading-panel ui-reveal ui-reveal-2" aria-live="polite" aria-busy="true">
          <h2 className="stripe-ui__panel-title">Loading report...</h2>
          <p className="stripe-ui__panel-subtitle">Computing {grain} MRR and loading detail rows.</p>
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
            <button className="stripe-ui__btn stripe-ui__btn--secondary" onClick={() => void run(page)} disabled={loading}>
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
                <p className="stripe-ui__stat-label">Total MRR (as of {data.endDate})</p>
                <p className="stripe-ui__stat-value">{formatMoney(data.totalMrr, summaryCurrency)}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Periods in range</p>
                <p className="stripe-ui__stat-value">{months.length}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Detail month range</p>
                <p className="stripe-ui__stat-value">{`${data.detailStartMonth} to ${data.detailEndMonth}`}</p>
              </div>
              <div className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Created in range with non-zero MRR in their creation month</p>
                <p className="stripe-ui__stat-value">
                  <button
                    type="button"
                    className="stripe-ui__btn stripe-ui__btn--ghost"
                    onClick={() => void toggleCreatedCustomersWithSameMonthMrrRows()}
                    style={{ padding: 0, fontSize: "inherit", fontWeight: 700, textDecoration: "underline" }}
                    disabled={createdCustomersWithSameMonthMrrCount == null}
                    title="Click to show included customer IDs and emails"
                  >
                    {createdCustomersWithSameMonthMrrCount == null
                      ? "—"
                      : new Intl.NumberFormat().format(createdCustomersWithSameMonthMrrCount)}
                  </button>
                </p>
                {createdCustomersWithSameMonthMrrCountError ? (
                  <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.35rem", color: "#b91c1c" }}>
                    Metric error: {createdCustomersWithSameMonthMrrCountError}
                  </p>
                ) : null}
              </div>
            </div>
            {showCreatedCustomersWithSameMonthMrrRows ? (
              <div style={{ marginTop: "0.9rem" }}>
                {createdCustomersWithSameMonthMrrRowsLoading ? (
                  <p className="stripe-ui__panel-subtitle" style={{ margin: 0 }}>Loading included customers...</p>
                ) : null}
                {createdCustomersWithSameMonthMrrRowsError ? (
                  <p className="stripe-ui__panel-subtitle" style={{ margin: 0, color: "#b91c1c" }}>
                    {createdCustomersWithSameMonthMrrRowsError}
                  </p>
                ) : null}
                {!createdCustomersWithSameMonthMrrRowsLoading && !createdCustomersWithSameMonthMrrRowsError ? (
                  <div>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.55rem" }}>
                      <button
                        type="button"
                        className="stripe-ui__btn stripe-ui__btn--ghost"
                        onClick={exportCreatedCustomersWithSameMonthMrrRowsCsv}
                        disabled={!createdCustomersWithSameMonthMrrRows.length}
                      >
                        Download CSV
                      </button>
                    </div>
                    <div className="stripe-ui__table-wrap">
                      <table className="stripe-ui__table" aria-label="Created in range with non-zero creation-month MRR">
                        <thead>
                          <tr>
                            <th>Customer ID</th>
                            <th>Email</th>
                          </tr>
                        </thead>
                        <tbody>
                          {createdCustomersWithSameMonthMrrRows.map((row) => (
                            <tr key={`${row.customerId}|${row.email}`}>
                              <td>{row.customerId}</td>
                              <td>{row.email || "(blank)"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="stripe-ui__panel ui-reveal ui-reveal-3">
            <div className="stripe-ui__section-head">
              <div>
                <h2 className="stripe-ui__panel-title">{effectiveGrain === "daily" ? "Daily MRR movement" : "Monthly MRR movement"}</h2>
                <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
                  New = `ACTIVE_START`, Expansion = `ACTIVE_UPGRADE`, Contraction = `ACTIVE_DOWNGRADE`, Churn =
                  `ACTIVE_END`.
                </p>
              </div>
              <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={exportMonthlyCsv} disabled={!months.length}>
                Export CSV
              </button>
            </div>
            <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem" }}>
              <table className="stripe-ui__table" aria-label="Stripe through MRR summary table">
                <thead>
                  <tr>
                    <th>{periodLabel}</th>
                    <th className="stripe-ui__num">MRR (period end)</th>
                    <th className="stripe-ui__num">New</th>
                    <th className="stripe-ui__num">Expansion</th>
                    <th className="stripe-ui__num">Contraction</th>
                    <th className="stripe-ui__num">Churn</th>
                    <th className="stripe-ui__num">Net change</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((row) => (
                    <tr key={row.monthKey}>
                      <td>{row.monthLabel}</td>
                      <td className={`stripe-ui__num ${row.monthEndMrr < 0 ? "stripe-ui__money--negative" : ""}`}>
                        {formatMoney(row.monthEndMrr, summaryCurrency)}
                      </td>
                      <td className={`stripe-ui__num ${row.newMrr < 0 ? "stripe-ui__money--negative" : ""}`}>
                        {formatMoney(row.newMrr, summaryCurrency)}
                      </td>
                      <td className={`stripe-ui__num ${row.expansionMrr < 0 ? "stripe-ui__money--negative" : ""}`}>
                        {formatMoney(row.expansionMrr, summaryCurrency)}
                      </td>
                      <td className={`stripe-ui__num ${row.contractionMrr < 0 ? "stripe-ui__money--negative" : ""}`}>
                        {formatMoney(row.contractionMrr, summaryCurrency)}
                      </td>
                      <td className={`stripe-ui__num ${row.churnMrr < 0 ? "stripe-ui__money--negative" : ""}`}>
                        {formatMoney(row.churnMrr, summaryCurrency)}
                      </td>
                      <td className={`stripe-ui__num ${row.netMrrChange < 0 ? "stripe-ui__money--negative" : ""}`}>
                        {formatMoney(row.netMrrChange, summaryCurrency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="stripe-ui__panel ui-reveal ui-reveal-3">
            <div className="stripe-ui__section-head">
              <div>
                <h2 className="stripe-ui__panel-title">
                  Detail rows from {data.detailStartMonth} to {data.detailEndMonth} (
                  {detailMode === "raw" ? "line items" : "grouped by month"})
                </h2>
                <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
                  Grouped mode computes cumulative ARR at each month end (all MRR changes up to that month) for each selected group.
                </p>
              </div>
              <button
                className="stripe-ui__btn stripe-ui__btn--ghost"
                onClick={() => void (detailMode === "raw" ? exportRawDetailCsv() : exportGroupedDetailCsv())}
                disabled={!detailRows.length || exportingCsv}
              >
                {exportingCsv ? "Exporting..." : "Export CSV (all pages)"}
              </button>
              <button
                className="stripe-ui__btn stripe-ui__btn--ghost"
                onClick={() => void exportSalesAssistCsv()}
                disabled={!detailRows.length || exportingCsv}
                title={`Uses detail month ${effectiveDetailEndMonth} and compares against ${previousIsoMonth(effectiveDetailEndMonth) || "previous month"}.`}
              >
                {exportingCsv ? "Exporting..." : "Download Sales Assist CSV"}
              </button>
              <button
                className="stripe-ui__btn stripe-ui__btn--ghost"
                onClick={exportDisplayedSalesAssistCsv}
                disabled={detailMode !== "grouped" || groupBy !== "email" || !filteredGroupedMatrixRows.length || exportingCsv}
                title="Exports all currently displayed sales-assist=yes grouped-email rows."
              >
                Download Sales Assist CSV (All Yes)
              </button>
            </div>

            <div className="stripe-ui__filter-grid">
              {detailMode === "raw" ? (
                <>
                  <div className="stripe-ui__field">
                    <label className="stripe-ui__field-label" htmlFor="filter-event-type">Filter Event Type</label>
                    <select
                      id="filter-event-type"
                      className="stripe-ui__control"
                      value={filterEventType}
                      onChange={(e) => setFilterEventType(e.target.value)}
                    >
                      <option value="all">All</option>
                      {eventTypeOptions.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div className="stripe-ui__field">
                    <label className="stripe-ui__field-label" htmlFor="filter-customer-id">Filter Customer ID</label>
                    <input
                      id="filter-customer-id"
                      className="stripe-ui__control"
                      type="text"
                      value={filterCustomerId}
                      onChange={(e) => setFilterCustomerId(e.target.value)}
                      placeholder="contains..."
                    />
                  </div>
                  <div className="stripe-ui__field">
                    <label className="stripe-ui__field-label" htmlFor="filter-product">Filter Product / Price</label>
                    <input
                      id="filter-product"
                      className="stripe-ui__control"
                      type="text"
                      value={filterProductSearch}
                      onChange={(e) => setFilterProductSearch(e.target.value)}
                      placeholder="contains..."
                    />
                  </div>
                  <div className="stripe-ui__field">
                    <label className="stripe-ui__field-label" htmlFor="filter-country">Filter Country</label>
                    <input
                      id="filter-country"
                      className="stripe-ui__control"
                      type="text"
                      value={filterCountrySearch}
                      onChange={(e) => setFilterCountrySearch(e.target.value)}
                      placeholder="contains..."
                    />
                  </div>
                  <div className="stripe-ui__field">
                    <label className="stripe-ui__field-label" htmlFor="filter-territory">Filter Territory</label>
                    <input
                      id="filter-territory"
                      className="stripe-ui__control"
                      type="text"
                      value={filterTerritorySearch}
                      onChange={(e) => setFilterTerritorySearch(e.target.value)}
                      placeholder="contains..."
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="stripe-ui__field">
                    <label className="stripe-ui__field-label" htmlFor="filter-group">Filter Group</label>
                    <input
                      id="filter-group"
                      className="stripe-ui__control"
                      type="text"
                      value={filterGroupSearch}
                      onChange={(e) => setFilterGroupSearch(e.target.value)}
                      placeholder="contains..."
                    />
                  </div>
                  <div className="stripe-ui__field">
                    <label className="stripe-ui__field-label" htmlFor="grouped-sort-mode">Group sort</label>
                    <select
                      id="grouped-sort-mode"
                      className="stripe-ui__control"
                      value={groupedSortMode}
                      onChange={(e) => setGroupedSortMode(e.target.value as GroupedSortMode)}
                    >
                      <option value="range_arr_sum_desc">Sum of ARR in selected range (desc)</option>
                      <option value="latest_arr_desc">Latest month ARR (desc)</option>
                    </select>
                  </div>
                  <div className="stripe-ui__field">
                    <label className="stripe-ui__field-label" htmlFor="filter-group-country">
                      Filter Country
                    </label>
                    <input
                      id="filter-group-country"
                      className="stripe-ui__control"
                      type="text"
                      value={filterCountrySearch}
                      onChange={(e) => setFilterCountrySearch(e.target.value)}
                      placeholder="contains..."
                    />
                  </div>
                  <div className="stripe-ui__field">
                    <label className="stripe-ui__field-label" htmlFor="filter-group-territory">
                      Filter Territory
                    </label>
                    <input
                      id="filter-group-territory"
                      className="stripe-ui__control"
                      type="text"
                      value={filterTerritorySearch}
                      onChange={(e) => setFilterTerritorySearch(e.target.value)}
                      placeholder="contains..."
                    />
                  </div>
                  {groupBy === "customer_id" && (
                    <div className="stripe-ui__field">
                      <label className="stripe-ui__field-label" htmlFor="filter-customer-country-rules">
                        Country filter rules
                      </label>
                      <input
                        id="filter-customer-country-rules"
                        className="stripe-ui__control"
                        type="text"
                        value={filterCustomerCountryRules}
                        onChange={(e) => setFilterCustomerCountryRules(e.target.value)}
                        placeholder="india, china, not russia"
                      />
                      <div className="stripe-ui__hint">Comma-separated. Use `not ...` for exclusions.</div>
                    </div>
                  )}
                </>
              )}
            </div>

            {detailMode === "grouped" && (
              <div className="stripe-ui__toolbar">
                <div className="stripe-ui__toolbar-group" style={{ flexWrap: "wrap", gap: "0.45rem" }}>
                  <span className="stripe-ui__hint">Displayed metrics:</span>
                  {DETAIL_METRIC_OPTIONS.map((metric) => (
                    <label key={metric.key} className="stripe-ui__hint" style={{ display: "inline-flex", gap: "0.3rem" }}>
                      <input
                        type="checkbox"
                        checked={selectedMetrics.includes(metric.key)}
                        onChange={() => toggleMetric(metric.key)}
                      />
                      {metric.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="stripe-ui__toolbar">
              <div className="stripe-ui__toolbar-group">
                <span className="stripe-ui__hint">{`Page ${data.pagination.page} of ${data.pagination.totalPages}`}</span>
                {detailMode === "raw" ? (
                  <span className="stripe-ui__hint">
                    {filteredRawRows.length !== detailRows.length
                      ? `${filteredRawRows.length} of ${data.pagination.totalRows} rows (filtered)`
                      : `${data.pagination.totalRows} rows`}
                  </span>
                ) : (
                  <span className="stripe-ui__hint">
                    {filteredGroupedMatrixRows.length !== groupedMatrixRows.length
                      ? `${filteredGroupedMatrixRows.length} of ${groupedMatrixRows.length} groups (filtered)`
                      : `${groupedMatrixRows.length} groups`}
                  </span>
                )}
              </div>

              <div className="stripe-ui__toolbar-group">
                <button
                  className="stripe-ui__btn stripe-ui__btn--ghost"
                  onClick={() => goToPage(page - 1)}
                  disabled={loading || page <= 1}
                >
                  Prev
                </button>
                <button
                  className="stripe-ui__btn stripe-ui__btn--ghost"
                  onClick={() => goToPage(page + 1)}
                  disabled={loading || page >= data.pagination.totalPages}
                >
                  Next
                </button>
                <input
                  className="stripe-ui__control stripe-ui__page-jump"
                  type="number"
                  min={1}
                  max={data.pagination.totalPages || 1}
                  value={pageJumpInput}
                  onChange={(e) => setPageJumpInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const next = Number(pageJumpInput || "1");
                    if (!Number.isFinite(next)) return;
                    goToPage(next);
                  }}
                />
                <button
                  className="stripe-ui__btn stripe-ui__btn--secondary"
                  onClick={() => {
                    const next = Number(pageJumpInput || "1");
                    if (!Number.isFinite(next)) return;
                    goToPage(next);
                  }}
                  disabled={loading}
                >
                  Jump
                </button>
              </div>
            </div>

            {detailMode === "grouped" && detailMonthsInRange.length > 0 && (
              <div className="stripe-ui__toolbar" style={{ marginTop: "0.35rem" }}>
                <div className="stripe-ui__toolbar-group" style={{ flexWrap: "wrap", gap: "0.45rem" }}>
                  <span className="stripe-ui__hint">Non-zero rows by column:</span>
                  {detailMonthsInRange.flatMap((month) =>
                    selectedMetrics.map((metric) => (
                      <span key={`nonzero-pill:${month.monthKey}:${metric}`} className="stripe-ui__hint">
                        {month.monthLabel} - {DETAIL_METRIC_OPTIONS.find((option) => option.key === metric)?.label || metric}:{" "}
                        {groupedNonZeroCounts[`${month.monthKey}:${metric}`] || 0}
                      </span>
                    )),
                  )}
                </div>
              </div>
            )}

            <div className="stripe-ui__table-wrap" style={{ marginTop: "0.9rem" }}>
              <table className="stripe-ui__table" aria-label="Stripe through MRR detail table">
                <thead>
                  {detailMode === "raw" ? (
                    <>
                      <tr>
                        <th>Event timestamp (UTC)</th>
                        <th>Event type</th>
                        <th className="stripe-ui__num">MRR change</th>
                        <th>Customer</th>
                        <th>Country</th>
                        <th>Territory</th>
                        <th>Product</th>
                        <th>Price</th>
                        <th>Subscription Item</th>
                        <th>Subscription</th>
                      </tr>
                      <tr>
                        <th>Non-zero rows</th>
                        <th>—</th>
                        <th className="stripe-ui__num">{rawNonZeroMrrRowsCount}</th>
                        <th>—</th>
                        <th>—</th>
                        <th>—</th>
                        <th>—</th>
                        <th>—</th>
                        <th>—</th>
                        <th>—</th>
                      </tr>
                    </>
                  ) : (
                    <>
                      <tr>
                        <th rowSpan={2}>Group</th>
                        {groupBy === "email" && <th rowSpan={2}>Customer IDs</th>}
                        {groupBy === "email" && <th rowSpan={2}>Country</th>}
                        {groupBy === "email" && <th rowSpan={2}>Territory</th>}
                        {groupBy === "email" && <th rowSpan={2}>Sales assist</th>}
                        {detailMonthsInRange.map((month) => (
                          <th key={month.monthKey} className="stripe-ui__num" colSpan={selectedMetrics.length}>
                            {month.monthLabel}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {detailMonthsInRange.flatMap((month) =>
                          selectedMetrics.map((metric) => (
                            <th key={`${month.monthKey}:${metric}`} className="stripe-ui__num">
                              {DETAIL_METRIC_OPTIONS.find((option) => option.key === metric)?.label || metric}
                            </th>
                          )),
                        )}
                      </tr>
                      <tr>
                        <th colSpan={groupBy === "email" ? 5 : 1}>Non-zero rows</th>
                        {detailMonthsInRange.flatMap((month) =>
                          selectedMetrics.map((metric) => (
                            <th key={`nonzero:${month.monthKey}:${metric}`} className="stripe-ui__num">
                              {groupedNonZeroCounts[`${month.monthKey}:${metric}`] || 0}
                            </th>
                          )),
                        )}
                      </tr>
                    </>
                  )}
                </thead>
                <tbody>
                  {detailMode === "raw"
                    ? filteredRawRows.map((row, idx) =>
                      <tr key={`${row.eventTimestampUtc}:${row.subscriptionItemId}:${idx}`}>
                        <td>{row.eventTimestampUtc}</td>
                        <td>{row.eventType || "(blank)"}</td>
                        <td className={`stripe-ui__num ${row.mrrChange < 0 ? "stripe-ui__money--negative" : ""}`}>
                          {formatMoney(row.mrrChange, summaryCurrency)}
                        </td>
                        <td>{row.customerId || "(blank)"}</td>
                        <td>{row.customerCountry || "N/A"}</td>
                        <td>{row.customerTerritory || "N/A"}</td>
                        <td>{withDescription(row.productId, row.productDescription)}</td>
                        <td>{withDescription(row.priceId, row.priceDescription)}</td>
                        <td>{row.subscriptionItemId || "(blank)"}</td>
                        <td>{row.subscriptionId || "(blank)"}</td>
                      </tr>
                    )
                      : filteredGroupedMatrixRows.map((group) => (
                        <tr key={`${group.groupKey}|${group.groupLabel}|${group.customerCountry || "N/A"}|${group.customerTerritory || "N/A"}`}>
                          <td>{displayGroupLabel(group)}</td>
                          {groupBy === "email" && <td>{group.associatedCustomerIds.join(", ")}</td>}
                          {groupBy === "email" && <td>{group.customerCountry || "N/A"}</td>}
                          {groupBy === "email" && <td>{group.customerTerritory || "N/A"}</td>}
                          {groupBy === "email" && <td>{group.salesAssist}</td>}
                          {detailMonthsInRange.flatMap((month) =>
                            selectedMetrics.map((metric) => {
                              const value = metricValue(group.byMonth.get(month.monthKey), metric);
                              const isMoney = isMoneyMetric(metric);
                              return (
                                <td
                                  key={`${group.groupKey}|${month.monthKey}|${metric}`}
                                  className={`stripe-ui__num ${isMoney && value < 0 ? "stripe-ui__money--negative" : ""}`}
                                >
                                  {isMoney ? formatMoney(value, summaryCurrency) : value}
                                </td>
                              );
                            }),
                          )}
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {!loading && !error && !data && hasRunOnce && (
        <section className="stripe-ui__panel ui-reveal ui-reveal-2">
          <h2 className="stripe-ui__panel-title">No data</h2>
          <p className="stripe-ui__panel-subtitle">No rows were returned for this selection.</p>
        </section>
      )}
    </div>
  );
}
