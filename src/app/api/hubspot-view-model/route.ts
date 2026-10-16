import { NextResponse } from "next/server";
import { generateReport } from "@/lib/report";
import { canonicalCountryKey, canonicalCountryLabel, canonicalTerritoryLabel, resolveTerritoryLabel } from "@/lib/geo";
import { getOrSetCache, readTtlMs, stableStringify } from "@/lib/serverResponseCache";
import { readPrecomputedPayload, writePrecomputedPayload } from "@/lib/precomputedPayloadStore";
import type { Grain, HubspotPlan, ReportMode, ReportResponse, ReportRow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
const CACHE_TTL_MS = readTtlMs("API_HUBSPOT_VIEW_MODEL_CACHE_TTL_MS", 24 * 60 * 60 * 1000);
const REPORT_SUBQUERY_CACHE_TTL_MS = readTtlMs("API_HUBSPOT_VIEW_MODEL_REPORT_SUBQUERY_CACHE_TTL_MS", 300_000);
const PRECOMPUTED_ENDPOINT_KEY = "hubspot-view-model";

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

type GrowthContributorRowsByPeriod = Record<string, GrowthContributorRow[]>;

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

type ChartGroupDescriptor = {
  key: string;
  label: string;
};

type RequestBody = {
  startDate?: string;
  endDate?: string;
  mode?: string;
  grain?: string;
  chartGroupBy?: string;
  groupByFields?: string[];
  filterDealName?: string;
  filterDeploymentType?: string;
  filterAccountId?: string;
  filterTerritory?: string;
  filterCountry?: string;
  filterIndustry?: string;
  filterDealType?: string;
  filterPlan?: string;
  arrDisplayScope?: string;
};

type ParsedPayload = {
  startDate: string;
  endDate: string;
  mode: ReportMode;
  grain: Grain;
  chartGroupBy: ChartGroupField;
  groupByFields: GroupField[];
  filterDealName: string;
  filterDeploymentType: string;
  filterAccountId: string;
  filterTerritory: string;
  filterCountry: string;
  filterIndustry: string;
  filterDealType: string;
  filterPlan: HubspotPlan | "all";
  arrDisplayScope: ArrDisplayScope;
};

const GROUP_LINE_COLORS = [
  "#3b7cc9",
  "#3d7a33",
  "#b45309",
  "#b42318",
  "#0f766e",
  "#7c5ce5",
  "#c2410c",
  "#15803d",
];

const ALLOWED_GROUP_BY_FIELDS = new Set<GroupField>([
  "dealName",
  "deploymentType",
  "accountId",
  "territory",
  "country",
  "industry",
  "companySegment",
  "primaryProjectType",
  "customerSupportApplication",
  "dealType",
  "plan",
]);

const ALLOWED_CHART_GROUP_BY = new Set<ChartGroupField>([
  "none",
  "deploymentType",
  "territory",
  "country",
  "industry",
  "plan",
  "companySegment",
  "primaryProjectType",
  "customerSupportApplication",
]);

function parseHubspotMultiSelectValues(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const values = raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function normalizeCaseInsensitiveValue(value: string) {
  return String(value || "").trim().toLowerCase();
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

function parseIsoDateOnly(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

function toIsoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function previousPeriodRangeForGrain(startDate: string, grain: Grain) {
  const parsed = parseIsoDateOnly(startDate);
  if (!parsed) return { startDate, endDate: startDate };

  if (grain === "daily") {
    const prevDay = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate() - 1));
    const iso = toIsoDateOnly(prevDay);
    return { startDate: iso, endDate: iso };
  }

  if (grain === "monthly") {
    const prevMonthStart = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() - 1, 1));
    const prevMonthEnd = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 0));
    return { startDate: toIsoDateOnly(prevMonthStart), endDate: toIsoDateOnly(prevMonthEnd) };
  }

  if (grain === "quarterly") {
    const qStartMonth = Math.floor(parsed.getUTCMonth() / 3) * 3;
    const prevQuarterStart = new Date(Date.UTC(parsed.getUTCFullYear(), qStartMonth - 3, 1));
    const prevQuarterEnd = new Date(Date.UTC(parsed.getUTCFullYear(), qStartMonth, 0));
    return { startDate: toIsoDateOnly(prevQuarterStart), endDate: toIsoDateOnly(prevQuarterEnd) };
  }

  const prevYear = parsed.getUTCFullYear() - 1;
  return {
    startDate: toIsoDateOnly(new Date(Date.UTC(prevYear, 0, 1))),
    endDate: toIsoDateOnly(new Date(Date.UTC(prevYear, 11, 31))),
  };
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

function accountDisplayWithDetails(row: UiRow) {
  const accountId = String(row.accountId || "").trim();
  const accountName = String(row.accountName || "").trim();
  const parts: string[] = [];
  if (accountName && accountId) parts.push(`${accountName} (${accountId})`);
  else if (accountName) parts.push(accountName);
  else if (accountId) parts.push(accountId);
  const workspaceId = String(row.workspaceId || "").trim();
  const deliveryStage = String(row.deliveryStage || "").trim();
  if (workspaceId) parts.push(`Workspace ID: ${workspaceId}`);
  if (deliveryStage) parts.push(`Delivery Stage: ${deliveryStage}`);
  return parts.length ? parts.join(" | ") : "(blank)";
}

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

function buildGrowthContributorMetaByAccount(rows: UiRow[]) {
  const byAccount = new Map<string, { accountLabel: string; dealNames: Set<string> }>();
  for (const row of rows) {
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
    if ((!currentLabel || currentLabel === "(blank)") && candidateLabel && candidateLabel !== "(blank)") {
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
}

function buildGrowthContributorRowsByPeriod(
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

function serializeGrowthContributorRowsByPeriod(rowsByPeriod: Map<string, GrowthContributorRow[]>) {
  const out: GrowthContributorRowsByPeriod = {};
  for (const [periodKey, rows] of rowsByPeriod.entries()) {
    out[periodKey] = rows;
  }
  return out;
}

function toUiRows(sourceData: ReportResponse | null): UiRow[] {
  if (!sourceData) return [];
  return (sourceData.rows || []).map((r: ReportRow) => ({
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
}

function computeForPayload(
  payload: ParsedPayload,
  data: ReportResponse,
  chartData: ReportResponse,
  chartBaselineData: ReportResponse,
) {
  const buildFilteredLineItemRows = (
    sourceData: ReportResponse | null,
    options?: { forceCloudOnly?: boolean },
  ) => {
    if (!sourceData) return [] as UiRow[];

    const baseRows = toUiRows(sourceData);

    const dealNameNeedle = payload.filterDealName.trim().toLowerCase();
    const accountIdNeedle = payload.filterAccountId.trim().toLowerCase();

    const applyInteractiveFilters = options?.forceCloudOnly !== true;
    const filteredBaseRows = baseRows.filter((r) => {
      const forceCloudOnly = options?.forceCloudOnly === true;
      const displayScopeOk = forceCloudOnly
        ? isCloudDeploymentType(r.deploymentType || "")
        : payload.arrDisplayScope === "all" || isCloudDeploymentType(r.deploymentType || "");
      if (!displayScopeOk) return false;

      const planOk = payload.filterPlan === "all" || (r.plan || "other") === payload.filterPlan;
      if (!planOk) return false;

      if (!applyInteractiveFilters) return true;

      const dealNameOk = !dealNameNeedle || (r.dealName || "").toLowerCase().includes(dealNameNeedle);
      const deploymentTypeOk =
        payload.filterDeploymentType === "all" || (r.deploymentType || "") === payload.filterDeploymentType;
      const accountIdOk = !accountIdNeedle || (r.accountId || "").toLowerCase().includes(accountIdNeedle);
      const territoryOk =
        payload.filterTerritory === "all" ||
        canonicalTerritoryLabel(r.territory || "") === canonicalTerritoryLabel(payload.filterTerritory);
      const countryOk =
        payload.filterCountry === "all" ||
        canonicalCountryKey(r.country || "") === canonicalCountryKey(payload.filterCountry);
      const industryOk = payload.filterIndustry === "all" || (r.industry || "") === payload.filterIndustry;
      const dealTypeOk = payload.filterDealType === "all" || (r.dealType || "") === payload.filterDealType;
      return dealNameOk && deploymentTypeOk && accountIdOk && territoryOk && countryOk && industryOk && dealTypeOk;
    });

    return filteredBaseRows.filter((r) => hasAnyNonZeroValue(r.valuesByPeriod));
  };

  const deploymentTypeOptions = (() => {
    const values = new Set<string>();
    for (const r of data.rows || []) {
      const value = String(r.deploymentType || "").trim();
      if (value) values.add(value);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  })();

  const territoryOptions = (() => {
    const values = new Set<string>();
    for (const r of data.rows || []) {
      const value = canonicalTerritoryLabel(String(r.territory || "").trim());
      if (value) values.add(value);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  })();

  const countryOptions = (() => {
    const valuesByNormalized = new Map<string, string>();
    for (const r of data.rows || []) {
      const value = String(r.country || "").trim();
      if (!value) continue;
      const normalized = canonicalCountryKey(value);
      if (!valuesByNormalized.has(normalized)) valuesByNormalized.set(normalized, canonicalCountryLabel(value));
    }
    return Array.from(valuesByNormalized.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  })();

  const industryOptions = (() => {
    const values = new Set<string>();
    for (const r of data.rows || []) {
      const value = String(r.industry || "").trim();
      if (value) values.add(value);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  })();

  const dealTypeOptions = (() => {
    const values = new Set<string>();
    for (const r of data.rows || []) {
      const value = String(r.dealType || "").trim();
      if (value) values.add(value);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  })();

  const planOptions = (() => {
    const order: HubspotPlan[] = ["enterprise", "managed", "team", "other"];
    const present = new Set<HubspotPlan>();
    for (const r of data.rows || []) {
      const value = String(r.plan || "").trim().toLowerCase();
      if (value === "enterprise" || value === "managed" || value === "team" || value === "other") {
        present.add(value);
      }
    }
    return order.filter((value) => present.has(value));
  })();

  const filteredLineItemRows: UiRow[] = buildFilteredLineItemRows(data);
  const filteredChartLineItemRows: UiRow[] = buildFilteredLineItemRows(chartData, { forceCloudOnly: true });
  const filteredBaselineChartRows: UiRow[] = buildFilteredLineItemRows(chartBaselineData, { forceCloudOnly: true });

  const displayedRows: UiRow[] = (() => {
    if (payload.groupByFields.length === 0) return filteredLineItemRows;

    const map = new Map<string, UiRow>();

    for (const r of filteredLineItemRows) {
      const descriptors = groupDescriptorsForRow(r, payload.groupByFields);
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
  })();

  const totalsByPeriodForDisplayed = data.periods.map((p) => {
    const total = displayedRows.reduce((acc, r) => acc + (r.valuesByPeriod[p.key] || 0), 0);
    return { key: p.key, label: p.label, total: round2(total) };
  });

  const chartPeriodOrder: PeriodRef[] = (chartData?.periods || []) as PeriodRef[];
  const accountArrByPeriod = (() => {
    const grouped = new Map<string, Record<string, number>>();
    if (!chartPeriodOrder.length) return grouped;

    for (const row of filteredChartLineItemRows) {
      const key = accountGroupingKey(row);
      if (!key) continue;
      addAccountPeriodValues(grouped, key, row.valuesByPeriod || {}, chartPeriodOrder);
    }

    return grouped;
  })();

  const baselineAccountArrByAccount = (() => {
    const baseline = new Map<string, number>();
    const baselinePeriodKeys = (chartBaselineData?.periods || []).map((period) => period.key);
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
  })();

  const chartAccountMetaByKey = buildGrowthContributorMetaByAccount(filteredChartLineItemRows);

  const chartPoints: TrendPoint[] = buildTrendPointsFromAccounts(
    chartPeriodOrder,
    accountArrByPeriod,
    baselineAccountArrByAccount,
  );
  const growthContributorRowsByPeriod: GrowthContributorRowsByPeriod = serializeGrowthContributorRowsByPeriod(
    buildGrowthContributorRowsByPeriod(
      chartPeriodOrder,
      accountArrByPeriod,
      baselineAccountArrByAccount,
      chartAccountMetaByKey,
    ),
  );

  const groupedAccountArrByPeriod = (() => {
    const grouped = new Map<string, { label: string; accounts: Map<string, Record<string, number>> }>();
    if (!chartPeriodOrder.length) return grouped;

    for (const row of filteredChartLineItemRows) {
      const accountKey = accountGroupingKey(row);
      if (!accountKey) continue;
      for (const descriptor of chartGroupDescriptorsForRow(row, payload.chartGroupBy)) {
        if (!grouped.has(descriptor.key)) {
          grouped.set(descriptor.key, { label: descriptor.label, accounts: new Map() });
        }
        addAccountPeriodValues(grouped.get(descriptor.key)!.accounts, accountKey, row.valuesByPeriod || {}, chartPeriodOrder);
      }
    }

    return grouped;
  })();

  const groupedBaselineAccountArrByAccount = (() => {
    const grouped = new Map<string, Map<string, number>>();
    const baselinePeriodKeys = (chartBaselineData?.periods || []).map((period) => period.key);
    if (!baselinePeriodKeys.length) return grouped;

    for (const row of filteredBaselineChartRows) {
      const accountKey = accountGroupingKey(row);
      if (!accountKey) continue;
      const rowBaselineArr = round2(
        baselinePeriodKeys.reduce((acc, periodKey) => acc + (row.valuesByPeriod[periodKey] || 0), 0),
      );
      if (Math.abs(rowBaselineArr) < 1e-9) continue;
      for (const descriptor of chartGroupDescriptorsForRow(row, payload.chartGroupBy)) {
        if (!grouped.has(descriptor.key)) grouped.set(descriptor.key, new Map());
        const bucket = grouped.get(descriptor.key)!;
        bucket.set(accountKey, round2((bucket.get(accountKey) || 0) + rowBaselineArr));
      }
    }

    return grouped;
  })();

  const groupedChartData = (() => {
    if (payload.chartGroupBy === "none" || !chartPeriodOrder.length) {
      return {
        series: [] as GroupTrendSeries[],
        contributorsByGroup: {} as Record<string, GrowthContributorRowsByPeriod>,
      };
    }

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

    const contributorsByGroup: Record<string, GrowthContributorRowsByPeriod> = {};
    for (const group of finalized) {
      contributorsByGroup[group.key] = serializeGrowthContributorRowsByPeriod(
        buildGrowthContributorRowsByPeriod(
          chartPeriodOrder,
          group.accounts,
          group.baseline,
          chartAccountMetaByKey,
        ),
      );
    }

    return {
      series: finalized.map((group, idx) => ({
        key: group.key,
        label: group.label,
        points: group.points,
        color: GROUP_LINE_COLORS[idx % GROUP_LINE_COLORS.length],
      })),
      contributorsByGroup,
    };
  })();
  const groupedChartSeries = groupedChartData.series;
  const groupedGrowthContributorRowsByPeriod = groupedChartData.contributorsByGroup;

  return {
    periods: (data.periods || []).map((period) => ({ key: String(period.key || ""), label: String(period.label || period.key || "") })),
    displayedRows,
    totalsByPeriodForDisplayed,
    chartPoints,
    growthContributorRowsByPeriod,
    groupedChartSeries,
    groupedGrowthContributorRowsByPeriod,
    deploymentTypeOptions,
    territoryOptions,
    countryOptions,
    industryOptions,
    dealTypeOptions,
    planOptions,
  };
}

function parsePayload(body: Partial<RequestBody>): ParsedPayload {
  const startDate = String(body.startDate || "").trim();
  const endDate = String(body.endDate || "").trim();
  if (!parseIsoDateOnly(startDate) || !parseIsoDateOnly(endDate)) {
    throw new Error("Invalid startDate/endDate");
  }

  const modeRaw = String(body.mode || "arr").trim().toLowerCase();
  const mode: ReportMode = modeRaw === "contracted" ? "contracted" : "arr";

  const grainRaw = String(body.grain || "monthly").trim().toLowerCase();
  const grain: Grain =
    grainRaw === "daily" || grainRaw === "monthly" || grainRaw === "quarterly" || grainRaw === "annually"
      ? grainRaw
      : "monthly";

  const chartGroupByRaw = String(body.chartGroupBy || "none").trim() as ChartGroupField;
  const chartGroupBy = ALLOWED_CHART_GROUP_BY.has(chartGroupByRaw) ? chartGroupByRaw : "none";

  const groupByFields = Array.isArray(body.groupByFields)
    ? body.groupByFields.filter((value): value is GroupField => ALLOWED_GROUP_BY_FIELDS.has(value as GroupField))
    : [];

  const filterPlanRaw = String(body.filterPlan || "all").trim().toLowerCase();
  const filterPlan: HubspotPlan | "all" =
    filterPlanRaw === "enterprise" ||
    filterPlanRaw === "managed" ||
    filterPlanRaw === "team" ||
    filterPlanRaw === "other"
      ? filterPlanRaw
      : "all";

  const arrDisplayScopeRaw = String(body.arrDisplayScope || "all").trim().toLowerCase();
  const arrDisplayScope: ArrDisplayScope = arrDisplayScopeRaw === "cloud" ? "cloud" : "all";

  return {
    startDate,
    endDate,
    mode,
    grain,
    chartGroupBy,
    groupByFields,
    filterDealName: String(body.filterDealName || ""),
    filterDeploymentType: String(body.filterDeploymentType || "all"),
    filterAccountId: String(body.filterAccountId || ""),
    filterTerritory: String(body.filterTerritory || "all"),
    filterCountry: String(body.filterCountry || "all"),
    filterIndustry: String(body.filterIndustry || "all"),
    filterDealType: String(body.filterDealType || "all"),
    filterPlan,
    arrDisplayScope,
  };
}

async function buildViewModel(payload: ParsedPayload) {
  const reportPayload = {
    startDate: payload.startDate,
    endDate: payload.endDate,
    mode: payload.mode,
    grain: payload.grain,
  } as const;

  const chartPayload = {
    startDate: payload.startDate,
    endDate: payload.endDate,
    mode: "contracted" as const,
    grain: payload.grain,
  };

  const previousRange = previousPeriodRangeForGrain(payload.startDate, payload.grain);
  const chartBaselinePayload = {
    ...chartPayload,
    startDate: previousRange.startDate,
    endDate: previousRange.endDate,
  };

  const cachedReport = (request: Parameters<typeof generateReport>[0]) =>
    getOrSetCache(
      `api:hubspot-view-model:report:${stableStringify(request)}`,
      REPORT_SUBQUERY_CACHE_TTL_MS,
      () => generateReport(request),
    );

  const [mainReport, chartMainReport, baselineReport] = await Promise.all([
    cachedReport(reportPayload),
    cachedReport(chartPayload),
    cachedReport(chartBaselinePayload),
  ]);

  return computeForPayload(payload, mainReport, chartMainReport, baselineReport);
}

async function validateAndRun(body: Partial<RequestBody>) {
  const payload = parsePayload(body);
  const key = `api:hubspot-view-model:${stableStringify(payload)}`;
  return getOrSetCache(key, CACHE_TTL_MS, async () => {
    const precomputed = await readPrecomputedPayload<ReturnType<typeof computeForPayload>>(
      PRECOMPUTED_ENDPOINT_KEY,
      key,
    ).catch(() => null);
    if (precomputed) return precomputed;
    const built = await buildViewModel(payload);
    await writePrecomputedPayload({
      endpoint_key: PRECOMPUTED_ENDPOINT_KEY,
      cache_key: key,
      start_date: payload.startDate,
      end_date: payload.endDate,
      grain: payload.grain,
      payload_json: JSON.stringify(built),
    }).catch(() => null);
    return built;
  });
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const body = (raw ? JSON.parse(raw) : {}) as Partial<RequestBody>;
    const report = await validateAndRun(body);
    return NextResponse.json(report);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status =
      message.includes("Invalid startDate/endDate") ||
      message.includes("endDate must be >= startDate")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
