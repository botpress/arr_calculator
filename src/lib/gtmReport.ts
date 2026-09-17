import {
  queryGtmArrRows,
  queryGtmCrmMetrics,
  type GtmBigQueryArrRow,
  type GtmBigQueryCrmSnapshot,
} from "@/lib/gtmBigquery";
import { FX_TARGET_CURRENCY, round2 } from "@/lib/logic";
import {
  countBusinessDays,
  getGtmTarget,
  getGtmTargetRows,
  paceMonthlyTarget,
  type GtmTargetFormat,
} from "@/lib/gtmTargets";

export type GtmMetricStatus = "green" | "yellow" | "red" | "neutral" | "unavailable";
export type GtmMetricDirection = "higher" | "lower" | "neutral";

export type GtmMetric = {
  id: string;
  section: string;
  label: string;
  owner: string;
  format: GtmTargetFormat | "multiple";
  weekValue: number | null;
  priorWeekValue: number | null;
  weekOverWeek: number | null;
  mtdValue: number | null;
  target: number | null;
  pacedTarget: number | null;
  pacing: number | null;
  achievement: number | null;
  status: GtmMetricStatus;
  direction: GtmMetricDirection;
  source: string;
  note?: string;
};

export type GtmArrBridgeRow = {
  segment: "selfserve" | "sales_assist" | "salesled" | "total";
  label: string;
  beginningArr: number;
  newArr: number;
  expansionArr: number;
  contractionArr: number;
  churnArr: number;
  transferArr: number;
  endingArr: number;
  netNewArr: number;
};

export type GtmReportResponse = {
  monthKey: string;
  monthLabel: string;
  monthStartDate: string;
  monthEndDate: string;
  weekStartDate: string;
  weekEndDate: string;
  priorWeekStartDate: string;
  priorWeekEndDate: string;
  targetCurrency: string;
  businessDays: { elapsed: number; total: number };
  metrics: GtmMetric[];
  weekArrBridge: GtmArrBridgeRow[];
  arrBridge: GtmArrBridgeRow[];
  targetRows: ReturnType<typeof getGtmTargetRows>;
  warnings: string[];
};

function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function sundayOnOrBefore(date: Date) {
  return addDays(date, -date.getUTCDay());
}

export function latestClosedWeekEndDate(today = new Date()) {
  return isoDate(sundayOnOrBefore(addDays(today, -1)));
}

export function normalizeGtmWeekEndDate(requested?: string, today = new Date()) {
  const latestClosed = parseIsoDate(latestClosedWeekEndDate(today)) as Date;
  const parsed = requested ? parseIsoDate(requested) : null;
  const normalized = parsed ? sundayOnOrBefore(parsed) : latestClosed;
  return isoDate(normalized > latestClosed ? latestClosed : normalized);
}

function monthLabel(monthKey: string) {
  const date = new Date(`${monthKey}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function sum(values: Array<number | null | undefined>) {
  return round2(values.reduce<number>((total, value) => total + Number(value || 0), 0));
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function roundMetricValue(value: number, format: GtmMetric["format"]) {
  return format === "percent" || format === "multiple" ? roundTo(value, 6) : round2(value);
}

function emptyBridge(segment: GtmArrBridgeRow["segment"], label: string): GtmArrBridgeRow {
  return {
    segment,
    label,
    beginningArr: 0,
    newArr: 0,
    expansionArr: 0,
    contractionArr: 0,
    churnArr: 0,
    transferArr: 0,
    endingArr: 0,
    netNewArr: 0,
  };
}

function bridgeFromBigQueryRows(
  rows: GtmBigQueryArrRow[],
  segment: GtmBigQueryArrRow["segment"],
  label: string,
): GtmArrBridgeRow {
  const matching = rows.filter((row) => row.segment === segment).sort((a, b) => a.weekEndDate.localeCompare(b.weekEndDate));
  if (!matching.length) return emptyBridge(segment, label);
  const first = matching[0];
  const last = matching[matching.length - 1];
  return {
    segment,
    label,
    beginningArr: round2(first.beginningArr),
    newArr: sum(matching.map((row) => row.newArr)),
    expansionArr: sum(matching.map((row) => row.expansionArr)),
    contractionArr: sum(matching.map((row) => row.contractionArr)),
    churnArr: sum(matching.map((row) => row.churnArr)),
    transferArr: sum(matching.map((row) => row.transferArr)),
    endingArr: round2(last.endingArr),
    netNewArr: round2(last.endingArr - first.beginningArr),
  };
}

function bridgeSet(rows: GtmBigQueryArrRow[]) {
  const segments = [
    bridgeFromBigQueryRows(rows, "selfserve", "Self-serve"),
    bridgeFromBigQueryRows(rows, "sales_assist", "Sales Assist"),
    bridgeFromBigQueryRows(rows, "salesled", "Sales-led"),
  ];
  return [...segments, totalBridge(segments)];
}

function totalBridge(rows: GtmArrBridgeRow[]): GtmArrBridgeRow {
  const total = emptyBridge("total", "Total");
  for (const row of rows) {
    total.beginningArr = sum([total.beginningArr, row.beginningArr]);
    total.newArr = sum([total.newArr, row.newArr]);
    total.expansionArr = sum([total.expansionArr, row.expansionArr]);
    total.contractionArr = sum([total.contractionArr, row.contractionArr]);
    total.churnArr = sum([total.churnArr, row.churnArr]);
    total.transferArr = sum([total.transferArr, row.transferArr]);
    total.endingArr = sum([total.endingArr, row.endingArr]);
  }
  total.netNewArr = round2(total.endingArr - total.beginningArr);
  return total;
}

function targetStatus(value: number | null, pacedTarget: number | null, direction: GtmMetricDirection): GtmMetricStatus {
  if (value == null) return "unavailable";
  if (pacedTarget == null || Math.abs(pacedTarget) < 1e-9 || direction === "neutral") return "neutral";
  if (direction === "lower") {
    const ratio = Math.abs(value) / Math.abs(pacedTarget);
    if (ratio <= 1.05) return "green";
    if (ratio <= 1.2) return "yellow";
    return "red";
  }
  const ratio = value / pacedTarget;
  if (ratio >= 0.95) return "green";
  if (ratio >= 0.8) return "yellow";
  return "red";
}

function ratio(numerator: number | null, denominator: number | null) {
  return numerator != null && denominator != null && Math.abs(denominator) > 1e-9 ? roundTo(numerator / denominator, 6) : null;
}

function buildMetric(args: {
  id: string;
  section: string;
  label: string;
  owner: string;
  format: GtmMetric["format"];
  weekValue: number | null;
  priorWeekValue?: number | null;
  mtdValue: number | null;
  target?: number | null;
  elapsedBusinessDays: number;
  totalBusinessDays: number;
  direction?: GtmMetricDirection;
  source: string;
  note?: string;
}): GtmMetric {
  const direction = args.direction || "higher";
  const target = args.target ?? null;
  const weekValue = args.weekValue == null ? null : roundMetricValue(args.weekValue, args.format);
  const priorWeekValue = args.priorWeekValue == null ? null : roundMetricValue(args.priorWeekValue, args.format);
  const mtdValue = args.mtdValue == null ? null : roundMetricValue(args.mtdValue, args.format);
  const pacedTarget = args.format === "percent" || args.format === "multiple"
    ? target
    : paceMonthlyTarget(target, args.elapsedBusinessDays, args.totalBusinessDays);
  return {
    id: args.id,
    section: args.section,
    label: args.label,
    owner: args.owner,
    format: args.format,
    weekValue,
    priorWeekValue,
    weekOverWeek: ratio(weekValue == null || priorWeekValue == null ? null : weekValue - priorWeekValue, priorWeekValue),
    mtdValue,
    target,
    pacedTarget,
    pacing: ratio(mtdValue, pacedTarget),
    achievement: ratio(mtdValue, target),
    status: targetStatus(mtdValue, pacedTarget, direction),
    direction,
    source: args.source,
    note: args.note,
  };
}

function crmRatio(snapshot: GtmBigQueryCrmSnapshot, numerator: keyof GtmBigQueryCrmSnapshot, denominator: keyof GtmBigQueryCrmSnapshot) {
  return ratio(snapshot[numerator] as number | null, snapshot[denominator] as number | null);
}

export async function generateGtmReport(input: { weekEndDate?: string }): Promise<GtmReportResponse> {
  const weekEndDate = normalizeGtmWeekEndDate(input.weekEndDate);
  const weekEnd = parseIsoDate(weekEndDate) as Date;
  const weekStartDate = isoDate(addDays(weekEnd, -6));
  const priorWeekEndDate = isoDate(addDays(weekEnd, -7));
  const priorWeekStartDate = isoDate(addDays(weekEnd, -13));
  const monthKey = weekEndDate.slice(0, 7);
  const monthStartDate = `${monthKey}-01`;
  const monthEndDate = isoDate(new Date(Date.UTC(weekEnd.getUTCFullYear(), weekEnd.getUTCMonth() + 1, 0)));
  const elapsedBusinessDays = countBusinessDays(monthStartDate, weekEndDate);
  const totalBusinessDays = countBusinessDays(monthStartDate, monthEndDate);
  const firstRequiredWeekEndDate = priorWeekEndDate < monthStartDate ? priorWeekEndDate : monthStartDate;
  const warnings: string[] = [];

  const [arrPeriodRows, crm] = await Promise.all([
    queryGtmArrRows({ startWeekEndDate: firstRequiredWeekEndDate, endWeekEndDate: weekEndDate }),
    queryGtmCrmMetrics({ weekStartDate, weekEndDate, priorWeekStartDate, priorWeekEndDate, monthStartDate, monthEndDate }),
  ]);
  warnings.push(...crm.warnings);

  const currentRows = arrPeriodRows.filter((row) => row.weekEndDate === weekEndDate);
  const priorRows = arrPeriodRows.filter((row) => row.weekEndDate === priorWeekEndDate);
  const mtdRows = arrPeriodRows.filter((row) => row.weekEndDate >= monthStartDate && row.weekEndDate <= weekEndDate);
  if (!currentRows.length) warnings.push(`No weekly combined CARR rows were available in BigQuery for the week ending ${weekEndDate}.`);

  const currentBridge = bridgeSet(currentRows);
  const priorBridge = bridgeSet(priorRows);
  const arrBridge = bridgeSet(mtdRows);
  const currentSelfserve = currentBridge[0];
  const currentSales = totalBridge([currentBridge[1], currentBridge[2]]);
  const currentTotal = currentBridge[3];
  const priorSelfserve = priorBridge[0];
  const priorSales = totalBridge([priorBridge[1], priorBridge[2]]);
  const priorTotal = priorBridge[3];
  const mtdSelfserve = arrBridge[0];
  const mtdSales = totalBridge([arrBridge[1], arrBridge[2]]);
  const mtdTotal = arrBridge[3];
  const current = crm.currentWeek;
  const prior = crm.priorWeek;
  const mtd = crm.monthToDate;
  const target = (id: string) => getGtmTarget(monthKey, id);
  const metricBase = { elapsedBusinessDays, totalBusinessDays };

  const metrics: GtmMetric[] = [
    buildMetric({ ...metricBase, id: "net_new_arr", section: "Headline", label: "Net New ARR", owner: "Frank Jessop", format: "currency", weekValue: currentTotal.netNewArr, priorWeekValue: priorTotal.netNewArr, mtdValue: mtdTotal.netNewArr, target: target("net_new_arr"), source: "Weekly combined + legacy CARR model · BigQuery", note: "Current week and prior week use Sunday-ending CARR snapshots; MTD runs from the first week ending in the month through the selected week. Legacy HubSpot ARR includes closed-won deals whose deployment type is not Cloud." }),
    buildMetric({ ...metricBase, id: "selfserve_new", section: "ARR by motion", label: "PLG / self-serve ARR — new", owner: "Frank Jessop", format: "currency", weekValue: currentSelfserve.newArr, priorWeekValue: priorSelfserve.newArr, mtdValue: mtdSelfserve.newArr, target: target("new_arr_selfserve"), source: "Weekly combined + legacy CARR model · BigQuery", note: "Includes reactivation, matching the workbook bridge." }),
    buildMetric({ ...metricBase, id: "sales_new", section: "ARR by motion", label: "Sales ARR — new (Sales Assist + Sales-led)", owner: "Frank Jessop", format: "currency", weekValue: currentSales.newArr, priorWeekValue: priorSales.newArr, mtdValue: mtdSales.newArr, target: sum([target("new_arr_sales_assist"), target("new_arr_sales_led"), target("new_arr_outbound")]), source: "Weekly combined + legacy CARR model · BigQuery", note: "Includes reactivation and non-cloud HubSpot ARR. Outbound remains in the Targets-tab target but is part of sales-led actual because the BigQuery CARR model has no separate outbound motion." }),
    buildMetric({ ...metricBase, id: "pipeline_created", section: "Pipeline", label: "Pipeline $ created — new business", owner: "Eva / Sarah", format: "currency", weekValue: current.pipelineCreated, priorWeekValue: prior.pipelineCreated, mtdValue: mtd.pipelineCreated, target: target("pipeline_total"), source: "HubSpot replica · BigQuery", note: mtd.pipelineCreatedAllTypes == null ? undefined : `All deal types created MTD in the Sales Default and Transactional pipelines: ${round2(mtd.pipelineCreatedAllTypes)}.` }),
    buildMetric({ ...metricBase, id: "open_pipeline", section: "Pipeline", label: "Open pipeline closing this month", owner: "Eva / Sarah", format: "currency", weekValue: current.openPipeline, priorWeekValue: prior.openPipeline, mtdValue: mtd.openPipeline, target: target("pipeline_total"), source: "HubSpot replica · BigQuery", note: mtd.openPipelineDealCount == null ? undefined : `${mtd.openPipelineDealCount} open new-business deals at the selected week end. This is a point-in-time stock, so MTD equals the latest week-end snapshot.` }),
    buildMetric({ ...metricBase, id: "pipeline_coverage", section: "Pipeline", label: "Pipeline coverage", owner: "Eva / Sarah", format: "multiple", weekValue: ratio(current.openPipeline, target("new_arr_total")), priorWeekValue: ratio(prior.openPipeline, target("new_arr_total")), mtdValue: ratio(mtd.openPipeline, target("new_arr_total")), target: ratio(target("pipeline_total"), target("new_arr_total")), source: "HubSpot replica · BigQuery + Targets tab", note: "Open new-business pipeline divided by the Targets-tab new-business ARR target." }),
    buildMetric({ ...metricBase, id: "overall_signups", section: "Pipeline", label: "Overall sign-ups", owner: "Eva", format: "count", weekValue: current.overallSignups, priorWeekValue: prior.overallSignups, mtdValue: mtd.overallSignups, source: "Marketing funnel · BigQuery" }),
    buildMetric({ ...metricBase, id: "cs_signups", section: "Pipeline", label: "CS sign-ups", owner: "Eva", format: "count", weekValue: current.csSignups, priorWeekValue: prior.csSignups, mtdValue: mtd.csSignups, source: "Marketing CS vertical · BigQuery" }),
    buildMetric({ ...metricBase, id: "business_signups", section: "Pipeline", label: "Business sign-ups (non-CS)", owner: "Eva", format: "count", weekValue: current.businessSignups, priorWeekValue: prior.businessSignups, mtdValue: mtd.businessSignups, source: "Marketing funnel · BigQuery", note: "Overall sign-ups less sign-ups classified in the CS vertical." }),
    buildMetric({ ...metricBase, id: "mqls", section: "Pipeline", label: "MQLs", owner: "Eva", format: "count", weekValue: current.mqls, priorWeekValue: prior.mqls, mtdValue: mtd.mqls, source: "HubSpot contacts replica · BigQuery" }),
    buildMetric({ ...metricBase, id: "sqls", section: "Sales funnel", label: "SQLs", owner: "Sarah", format: "count", weekValue: current.sqls, priorWeekValue: prior.sqls, mtdValue: mtd.sqls, source: "HubSpot contacts replica · BigQuery" }),
    buildMetric({ ...metricBase, id: "mql_to_sql", section: "Sales funnel", label: "MQL → SQL conversion (directional)", owner: "Eva / Sarah", format: "percent", weekValue: crmRatio(current, "sqls", "mqls"), priorWeekValue: crmRatio(prior, "sqls", "mqls"), mtdValue: crmRatio(mtd, "sqls", "mqls"), source: "HubSpot contacts replica · BigQuery", note: "Directional period ratio, not a matured-contact cohort conversion." }),
    buildMetric({ ...metricBase, id: "opps_created", section: "Sales funnel", label: "New-business opps created", owner: "Sarah", format: "count", weekValue: current.oppsCreated, priorWeekValue: prior.oppsCreated, mtdValue: mtd.oppsCreated, source: "HubSpot deals replica · BigQuery" }),
    buildMetric({ ...metricBase, id: "opps_from_mql", section: "Sales funnel", label: "Opps from MQLs (pipeline proxy)", owner: "Sarah", format: "count", weekValue: current.oppsFromMqlProxy, priorWeekValue: prior.oppsFromMqlProxy, mtdValue: mtd.oppsFromMqlProxy, source: "HubSpot deals replica · BigQuery", note: "Sales Default pipeline proxy, matching the workbook appendix caveat." }),
    buildMetric({ ...metricBase, id: "opps_from_pql", section: "Sales funnel", label: "Opps from PQLs (pipeline proxy)", owner: "Sarah", format: "count", weekValue: current.oppsFromPqlProxy, priorWeekValue: prior.oppsFromPqlProxy, mtdValue: mtd.oppsFromPqlProxy, source: "HubSpot deals replica · BigQuery", note: "Transactional pipeline proxy, matching the workbook appendix caveat." }),
    buildMetric({ ...metricBase, id: "sql_to_opp", section: "Sales funnel", label: "SQL → Opp conversion (directional)", owner: "Sarah", format: "percent", weekValue: crmRatio(current, "oppsCreated", "sqls"), priorWeekValue: crmRatio(prior, "oppsCreated", "sqls"), mtdValue: crmRatio(mtd, "oppsCreated", "sqls"), source: "HubSpot replica · BigQuery", note: "Directional period ratio, not a matured cohort conversion." }),
    buildMetric({ ...metricBase, id: "sales_acv", section: "Sales funnel", label: "ACV (sales-led, trailing 90 days)", owner: "Sarah", format: "currency", weekValue: current.salesLedAcv, priorWeekValue: prior.salesLedAcv, mtdValue: mtd.salesLedAcv, source: "HubSpot deals replica · BigQuery", note: "The current and prior columns compare trailing-90-day ACV as of each week end." }),
    buildMetric({ ...metricBase, id: "win_rate", section: "Sales funnel", label: "Win / close rate", owner: "Sarah", format: "percent", weekValue: current.winRate, priorWeekValue: prior.winRate, mtdValue: mtd.winRate, source: "HubSpot deals replica · BigQuery", note: "Closed won divided by closed won plus closed lost in each displayed period." }),
    buildMetric({ ...metricBase, id: "held_show_rate", section: "Sales funnel", label: "Held / show rate", owner: "Sarah", format: "percent", weekValue: current.heldShowRate, priorWeekValue: prior.heldShowRate, mtdValue: mtd.heldShowRate, source: "HubSpot meetings · not in BigQuery", note: "Unavailable until meeting engagements are added to the HubSpot BigQuery replication." }),
    buildMetric({ ...metricBase, id: "signup_to_pql", section: "PLG funnel", label: "Sign-up → PQL", owner: "Mathieu", format: "percent", weekValue: null, mtdValue: null, source: "Product analytics", note: "Source not connected to this website." }),
    buildMetric({ ...metricBase, id: "pql_to_opp", section: "PLG funnel", label: "PQL → Opp", owner: "Mathieu", format: "percent", weekValue: null, mtdValue: null, source: "Product analytics", note: "Source not connected to this website." }),
    buildMetric({ ...metricBase, id: "signup_to_paid", section: "PLG funnel", label: "Sign-up → paid (CS specific)", owner: "Mathieu", format: "percent", weekValue: null, mtdValue: null, source: "Product analytics", note: "Source not connected to this website." }),
    buildMetric({ ...metricBase, id: "selfserve_acv", section: "PLG funnel", label: "ACV (self-serve / PLG)", owner: "Mathieu", format: "currency", weekValue: null, mtdValue: null, source: "Product analytics", note: "Source not connected to this website." }),
    buildMetric({ ...metricBase, id: "four_active_days", section: "PLG funnel", label: "Signup → 4 active days in first 14 days", owner: "Mathieu", format: "percent", weekValue: null, mtdValue: null, source: "Product analytics", note: "Source not connected to this website." }),
    buildMetric({ ...metricBase, id: "one_meaningful_action", section: "PLG funnel", label: "Signup → 1 meaningful action in first 14 days", owner: "Mathieu", format: "percent", weekValue: null, mtdValue: null, source: "Product analytics", note: "Source not connected to this website." }),
    buildMetric({ ...metricBase, id: "five_meaningful_actions", section: "PLG funnel", label: "Signup → 5 meaningful actions in first 14 days", owner: "Mathieu", format: "percent", weekValue: null, mtdValue: null, source: "Product analytics", note: "Source not connected to this website." }),
    buildMetric({ ...metricBase, id: "selfserve_expansion", section: "Post-sales", label: "Self-serve expansion", owner: "Frank Jessop", format: "currency", weekValue: currentSelfserve.expansionArr, priorWeekValue: priorSelfserve.expansionArr, mtdValue: mtdSelfserve.expansionArr, target: target("expansion_selfserve"), source: "Weekly combined + legacy CARR model · BigQuery" }),
    buildMetric({ ...metricBase, id: "selfserve_churn", section: "Post-sales", label: "Self-serve churn + contraction", owner: "Frank Jessop", format: "currency", weekValue: sum([currentSelfserve.churnArr, currentSelfserve.contractionArr]), priorWeekValue: sum([priorSelfserve.churnArr, priorSelfserve.contractionArr]), mtdValue: sum([mtdSelfserve.churnArr, mtdSelfserve.contractionArr]), target: sum([target("selfserve_churn"), target("selfserve_contraction")]), direction: "lower", source: "Weekly combined + legacy CARR model · BigQuery" }),
    buildMetric({ ...metricBase, id: "sales_expansion", section: "Post-sales", label: "Sales expansion", owner: "Frank Jessop", format: "currency", weekValue: currentSales.expansionArr, priorWeekValue: priorSales.expansionArr, mtdValue: mtdSales.expansionArr, target: target("expansion_assigned_total"), source: "Weekly combined + legacy CARR model · BigQuery" }),
    buildMetric({ ...metricBase, id: "sales_churn", section: "Post-sales", label: "Sales churn + contraction", owner: "Frank Jessop", format: "currency", weekValue: sum([currentSales.churnArr, currentSales.contractionArr]), priorWeekValue: sum([priorSales.churnArr, priorSales.contractionArr]), mtdValue: sum([mtdSales.churnArr, mtdSales.contractionArr]), target: sum([target("sales_assist_churn"), target("sales_assist_contraction"), target("sales_led_churn"), target("sales_led_contraction")]), direction: "lower", source: "Weekly combined + legacy CARR model · BigQuery" }),
  ];

  return {
    monthKey,
    monthLabel: monthLabel(monthKey),
    monthStartDate,
    monthEndDate,
    weekStartDate,
    weekEndDate,
    priorWeekStartDate,
    priorWeekEndDate,
    targetCurrency: String(FX_TARGET_CURRENCY || "USD").toUpperCase(),
    businessDays: { elapsed: elapsedBusinessDays, total: totalBusinessDays },
    metrics,
    weekArrBridge: currentBridge,
    arrBridge,
    targetRows: getGtmTargetRows(monthKey),
    warnings,
  };
}
