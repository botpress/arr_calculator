"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MigrationCustomerExportRow, MigrationReportResponse, MigrationSource } from "@/lib/migrationReport";

const MIN_MIGRATION_DATE = "2026-04-01";

function todayInToronto() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  } catch {
    return Number(value || 0).toFixed(0);
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function formatNumber(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(Number(value || 0));
}

function formatSignedMoney(value: number, currency: string) {
  const numeric = Number(value || 0);
  return numeric > 0 ? `+${formatMoney(numeric, currency)}` : formatMoney(numeric, currency);
}

function formatCompactMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(Number(value || 0));
  } catch {
    return formatNumber(value, 0);
  }
}

function progressWidth(percent: number) {
  return `${Math.max(0, Math.min(100, Number(percent || 0)))}%`;
}

function csvValue(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCustomerCsv(filename: string, rows: MigrationCustomerExportRow[], currency: string) {
  if (!rows.length) return;
  const isMigrationList = rows.some((row) => Boolean(row.migratedAt));
  const headers = [
    "Customer name",
    "Email",
    "Customer ID",
    "Workspace ID",
    "Source",
    isMigrationList ? `ARR migrated before migration (${currency})` : `ARR in population (${currency})`,
    `ARR after migration (${currency})`,
    `Resulting expansion (${currency})`,
    "Migration date",
    "Previous plan",
    "Plan at range end",
    "Record URL",
  ];
  const orderedRows = rows.slice().sort(
    (a, b) => a.customerName.localeCompare(b.customerName) || a.customerId.localeCompare(b.customerId),
  );
  const lines = [
    headers.map(csvValue).join(","),
    ...orderedRows.map((row) => [
      row.customerName,
      row.customerEmail,
      row.customerId,
      row.workspaceId,
      row.source === "stripe" ? "Stripe / BigQuery" : "HubSpot",
      row.arr,
      row.arrAfterMigration,
      row.resultingExpansion,
      row.migratedAt,
      row.previousPlan,
      row.currentPlan,
      row.recordUrl,
    ].map(csvValue).join(",")),
  ];
  const blob = new Blob([`\ufeff${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").toLowerCase();
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function migrationRowsBetween(
  data: MigrationReportResponse,
  startDate: string,
  endDate: string,
  source?: MigrationSource,
) {
  return data.customerLists.migrations.filter((row) => (
    row.migratedAt >= startDate &&
    row.migratedAt <= endDate &&
    (!source || row.source === source)
  ));
}

export default function MigrationPage() {
  const [data, setData] = useState<MigrationReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [startDate, setStartDate] = useState(MIN_MIGRATION_DATE);
  const [endDate, setEndDate] = useState(() => todayInToronto());
  const [appliedStartDate, setAppliedStartDate] = useState(MIN_MIGRATION_DATE);
  const [appliedEndDate, setAppliedEndDate] = useState(() => todayInToronto());
  const maximumDate = todayInToronto();

  const load = useCallback(async (nextStartDate: string, nextEndDate: string) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ startDate: nextStartDate, endDate: nextEndDate });
      const response = await fetch(`/api/migration?${query.toString()}`, { cache: "no-store" });
      const text = await response.text();
      const payload = text ? (JSON.parse(text) as MigrationReportResponse & { error?: string }) : null;
      if (!response.ok) throw new Error(payload?.error || text || `HTTP ${response.status}`);
      if (!payload) throw new Error("Empty migration response");
      setData(payload);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load migration report");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialEndDate = todayInToronto();
    void load(MIN_MIGRATION_DATE, initialEndDate);
  }, [load]);

  function applyDateRange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (startDate < MIN_MIGRATION_DATE) {
      setError(`Start date cannot be before ${MIN_MIGRATION_DATE}.`);
      return;
    }
    if (endDate < startDate) {
      setError("End date must be on or after the start date.");
      return;
    }
    if (endDate > maximumDate) {
      setError("End date cannot be after today.");
      return;
    }
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
    void load(startDate, endDate);
  }

  const monthlyChart = useMemo(() => {
    const months = data?.months || [];
    const width = 1_000;
    const height = 360;
    const left = 88;
    const right = 28;
    const top = 28;
    const bottom = 58;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const values = months.flatMap((month) => [
      Math.max(0, month.arrMigrated),
      Math.max(0, month.arrMigrated + month.resultingExpansion),
    ]);
    const maximumValue = Math.max(1, ...values);
    const axisMaximum = maximumValue * 1.1;
    const pointFor = (value: number, index: number) => ({
      x: months.length === 1
        ? left + plotWidth / 2
        : left + (index / Math.max(1, months.length - 1)) * plotWidth,
      y: top + plotHeight - (Math.max(0, value) / axisMaximum) * plotHeight,
    });
    const basePoints = months.map((month, index) => pointFor(month.arrMigrated, index));
    const postMigrationPoints = months.map((month, index) => pointFor(
      month.arrMigrated + month.resultingExpansion,
      index,
    ));
    return {
      width,
      height,
      left,
      right,
      top,
      plotHeight,
      axisMaximum,
      basePoints,
      postMigrationPoints,
    };
  }, [data]);
  const customerGroups = useMemo(() => {
    if (!data) return null;
    return {
      openingLegacy: data.customerLists.openingLegacy,
      currentLegacy: data.customerLists.currentLegacy,
      fiscalYearMigrations: migrationRowsBetween(data, data.fiscalYearStart, data.rangeEnd),
      selectedRangeMigrations: migrationRowsBetween(data, data.rangeStart, data.rangeEnd),
    };
  }, [data]);

  function downloadCustomers(slug: string, rows: MigrationCustomerExportRow[]) {
    if (!data) return;
    downloadCustomerCsv(
      `migration-${slug}-${data.rangeStart}-to-${data.rangeEnd}.csv`,
      rows,
      data.targetCurrency,
    );
  }

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Pricing migration</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Migration</h1>
            <p className="stripe-ui__subtitle">
              Customers and ARR migrated from V2/V3 to V4 plans since April 2026, combining Stripe BigQuery and closed-won HubSpot Sales Default Pipeline deals.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel migration__filters-panel ui-reveal ui-reveal-1">
        <div>
          <h2 className="stripe-ui__panel-title">Reporting range</h2>
          <p className="stripe-ui__panel-subtitle">
            Defaults to the fiscal-year start through today. Dates can begin on or after April 1, 2026. Click any customer-backed total to download its CSV.
          </p>
        </div>
        <form className="migration__filters" onSubmit={applyDateRange}>
          <label className="migration__filter-field">
            <span>Start date</span>
            <input
              className="stripe-ui__control"
              type="date"
              value={startDate}
              min={MIN_MIGRATION_DATE}
              max={endDate || maximumDate}
              onChange={(event) => setStartDate(event.target.value)}
              required
            />
          </label>
          <label className="migration__filter-field">
            <span>End date</span>
            <input
              className="stripe-ui__control"
              type="date"
              value={endDate}
              min={startDate || MIN_MIGRATION_DATE}
              max={maximumDate}
              onChange={(event) => setEndDate(event.target.value)}
              required
            />
          </label>
          <button className="stripe-ui__btn stripe-ui__btn--primary" type="submit" disabled={loading}>
            {loading ? "Loading…" : "Apply range"}
          </button>
        </form>
      </section>

      {loading ? (
        <section className="stripe-ui__panel ui-reveal ui-reveal-1">
          <h2 className="stripe-ui__panel-title">Loading V2/V3 → V4 migrations</h2>
          <p className="stripe-ui__panel-subtitle">Reading Stripe plan-change history and HubSpot closed-won plan line items.</p>
          <div className="stripe-ui__skeleton-grid" aria-label="Loading migration report">
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row stripe-ui__skeleton-row--short" />
          </div>
        </section>
      ) : null}

      {error ? (
        <section className="stripe-ui__panel ui-reveal ui-reveal-1">
          <div className="stripe-ui__error migration__error">
            <span>{error}</span>
            <button className="stripe-ui__btn stripe-ui__btn--secondary" type="button" onClick={() => void load(appliedStartDate, appliedEndDate)}>
              Retry
            </button>
          </div>
        </section>
      ) : null}

      {!loading && data ? (
        <>
          <section className="stripe-ui__panel migration__goal ui-reveal ui-reveal-1">
            <div className="stripe-ui__section-head">
              <div>
                <h2 className="stripe-ui__panel-title">70% fiscal-year migration goal</h2>
                <p className="stripe-ui__panel-subtitle">
                  Targeting 70% of the V2/V3 customers active at the start of {formatDate(data.fiscalYearStart)}, by {formatDate(data.fiscalYearEnd)}.
                </p>
              </div>
              <span className="migration__as-of">Range ends {formatDate(data.rangeEnd)}</span>
            </div>

            <div className="stripe-ui__stats migration__goal-stats">
              <button
                className="stripe-ui__stat migration__goal-stat migration__goal-stat--current migration__download-card"
                type="button"
                disabled={!customerGroups?.currentLegacy.length}
                onClick={() => downloadCustomers("v2-v3-at-range-end", customerGroups?.currentLegacy || [])}
                title="Download the customers behind this total"
              >
                <p className="stripe-ui__stat-label">On V2/V3 at range end</p>
                <p className="stripe-ui__stat-value">{formatNumber(data.goal.currentLegacyCustomers, 0)}</p>
                <p className="migration__stat-note">{formatMoney(data.goal.currentLegacyArr, data.targetCurrency)} base-plan ARR</p>
              </button>
              <button
                className="stripe-ui__stat migration__goal-stat migration__download-card"
                type="button"
                disabled={!customerGroups?.openingLegacy.length}
                onClick={() => downloadCustomers("opening-v2-v3-customers", customerGroups?.openingLegacy || [])}
                title="Download the customers behind this total"
              >
                <p className="stripe-ui__stat-label">Opening V2/V3 customers</p>
                <p className="stripe-ui__stat-value">{formatNumber(data.goal.openingLegacyCustomers, 0)}</p>
                <p className="migration__stat-note">Baseline at fiscal-year start</p>
              </button>
              <article className="stripe-ui__stat migration__goal-stat">
                <p className="stripe-ui__stat-label">70% customer goal</p>
                <p className="stripe-ui__stat-value">{formatNumber(data.goal.fiscalYearCustomerTarget, 0)}</p>
                <p className="migration__stat-note">Rounded up to a whole customer</p>
              </article>
              <article className="stripe-ui__stat migration__goal-stat">
                <p className="stripe-ui__stat-label">Opening average plan ARR</p>
                <p className="stripe-ui__stat-value">{formatMoney(data.goal.openingAverageArr, data.targetCurrency)}</p>
                <p className="migration__stat-note">Excludes add-ons and AI tokens</p>
              </article>
              <article className="stripe-ui__stat migration__goal-stat migration__goal-stat--monthly">
                <p className="stripe-ui__stat-label">Monthly customer target</p>
                <p className="stripe-ui__stat-value">{formatNumber(data.goal.monthlyCustomerTarget)}</p>
                <p className="migration__stat-note">Evenly divided across 12 months</p>
              </article>
              <article className="stripe-ui__stat migration__goal-stat migration__goal-stat--monthly">
                <p className="stripe-ui__stat-label">Monthly ARR target</p>
                <p className="stripe-ui__stat-value">{formatMoney(data.goal.monthlyArrTarget, data.targetCurrency)}</p>
                <p className="migration__stat-note">FY target {formatMoney(data.goal.fiscalYearArrTarget, data.targetCurrency)}</p>
              </article>
            </div>

            <div className="migration__goal-progress-grid">
              <article className="migration__goal-progress">
                <div className="migration__goal-progress-head">
                  <span>Progress toward customer goal</span>
                  <button
                    className="migration__download-inline"
                    type="button"
                    disabled={!customerGroups?.fiscalYearMigrations.length}
                    onClick={() => downloadCustomers("fiscal-year-migrated-customers", customerGroups?.fiscalYearMigrations || [])}
                    title="Download the migrated customers in the numerator"
                  >
                    {data.fiscalYear.logosMigrated} / {data.goal.fiscalYearCustomerTarget}
                  </button>
                </div>
                <div className="migration__goal-track"><div style={{ width: progressWidth(data.goal.fiscalYearCustomerProgressPct) }} /></div>
                <p>{formatNumber(data.goal.fiscalYearCustomerProgressPct, 1)}% of the 70% goal</p>
              </article>
              <article className="migration__goal-progress">
                <div className="migration__goal-progress-head">
                  <span>Progress toward ARR goal</span>
                  <button
                    className="migration__download-inline"
                    type="button"
                    disabled={!customerGroups?.fiscalYearMigrations.length}
                    onClick={() => downloadCustomers("fiscal-year-migrated-arr-customers", customerGroups?.fiscalYearMigrations || [])}
                    title="Download the customers behind the migrated ARR"
                  >
                    {formatMoney(data.fiscalYear.arrMigrated, data.targetCurrency)} / {formatMoney(data.goal.fiscalYearArrTarget, data.targetCurrency)}
                  </button>
                </div>
                <div className="migration__goal-track"><div style={{ width: progressWidth(data.goal.fiscalYearArrProgressPct) }} /></div>
                <p>
                  {formatNumber(data.goal.fiscalYearArrProgressPct, 1)}% of ARR goal · {formatSignedMoney(data.fiscalYear.resultingExpansion, data.targetCurrency)} resulting expansion
                </p>
              </article>
            </div>
          </section>

          <section className="stripe-ui__panel migration__summary ui-reveal ui-reveal-1">
            <div className="stripe-ui__section-head">
              <div>
                <h2 className="stripe-ui__panel-title">Migration totals</h2>
                <p className="stripe-ui__panel-subtitle">
                  Selected range from {formatDate(data.rangeStart)} through {formatDate(data.rangeEnd)}. ARR migrated is the V2/V3 ARR immediately before migration; resulting expansion is V4 ARR minus that amount.
                </p>
              </div>
              <span className="migration__as-of">{formatDate(data.rangeStart)} – {formatDate(data.rangeEnd)}</span>
            </div>
            <div className="stripe-ui__stats migration__headline-stats">
              <button
                className="stripe-ui__stat migration__headline-stat migration__download-card"
                type="button"
                disabled={!customerGroups?.selectedRangeMigrations.length}
                onClick={() => downloadCustomers("selected-range-migrated-arr-customers", customerGroups?.selectedRangeMigrations || [])}
                title="Download the customers behind this ARR"
              >
                <p className="stripe-ui__stat-label">Selected-range ARR migrated before migration</p>
                <p className="stripe-ui__stat-value">{formatMoney(data.selectedRange.arrMigrated, data.targetCurrency)}</p>
              </button>
              <button
                className="stripe-ui__stat migration__headline-stat migration__headline-stat--expansion migration__download-card"
                type="button"
                disabled={!customerGroups?.selectedRangeMigrations.length}
                onClick={() => downloadCustomers("selected-range-resulting-expansion-customers", customerGroups?.selectedRangeMigrations || [])}
                title="Download the customers behind this expansion"
              >
                <p className="stripe-ui__stat-label">Selected-range resulting expansion</p>
                <p className="stripe-ui__stat-value">{formatSignedMoney(data.selectedRange.resultingExpansion, data.targetCurrency)}</p>
              </button>
              <button
                className="stripe-ui__stat migration__headline-stat migration__download-card"
                type="button"
                disabled={!customerGroups?.selectedRangeMigrations.length}
                onClick={() => downloadCustomers("selected-range-migrated-customers", customerGroups?.selectedRangeMigrations || [])}
                title="Download the customers behind this total"
              >
                <p className="stripe-ui__stat-label">Selected-range logos migrated</p>
                <p className="stripe-ui__stat-value">{data.selectedRange.logosMigrated}</p>
              </button>
            </div>
            {data.warnings.length ? (
              <div className="commissions-warning">
                {data.warnings.map((warning) => <div key={warning}>{warning}</div>)}
              </div>
            ) : null}
          </section>

          <section className="stripe-ui__panel migration__performance ui-reveal">
            <div className="stripe-ui__section-head">
              <div>
                <h2 className="stripe-ui__panel-title">Month-by-month migration performance</h2>
                <p className="stripe-ui__panel-subtitle">
                  Base revenue migrated is the V2/V3 ARR immediately before migration. ARR after migration adds the resulting expansion or contraction.
                </p>
              </div>
              <div className="migration__chart-legend" aria-label="Chart legend">
                <span><i className="migration__chart-key migration__chart-key--base" />Base revenue migrated</span>
                <span><i className="migration__chart-key migration__chart-key--after" />ARR after migration</span>
              </div>
            </div>
            <div className="migration__chart-wrap">
              <svg
                className="migration__chart"
                viewBox={`0 0 ${monthlyChart.width} ${monthlyChart.height}`}
                role="img"
                aria-labelledby="migration-performance-title migration-performance-description"
              >
                <title id="migration-performance-title">Monthly pre-migration and post-migration ARR</title>
                <desc id="migration-performance-description">
                  Two lines compare V2/V3 ARR immediately before migration with V4 ARR immediately after migration for each month in the selected range.
                </desc>
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                  const y = monthlyChart.top + monthlyChart.plotHeight - (ratio * monthlyChart.plotHeight);
                  return (
                    <g key={ratio}>
                      <line
                        className="migration__chart-grid-line"
                        x1={monthlyChart.left}
                        x2={monthlyChart.width - monthlyChart.right}
                        y1={y}
                        y2={y}
                      />
                      <text className="migration__chart-axis-label" x={monthlyChart.left - 14} y={y + 4} textAnchor="end">
                        {formatCompactMoney(monthlyChart.axisMaximum * ratio, data.targetCurrency)}
                      </text>
                    </g>
                  );
                })}
                {data.months.map((month, index) => {
                  const point = monthlyChart.basePoints[index];
                  return (
                    <g key={month.monthKey}>
                      <line
                        className="migration__chart-month-line"
                        x1={point.x}
                        x2={point.x}
                        y1={monthlyChart.top}
                        y2={monthlyChart.top + monthlyChart.plotHeight}
                      />
                      <text
                        className="migration__chart-month-label"
                        x={point.x}
                        y={monthlyChart.height - 20}
                        textAnchor="middle"
                      >
                        {month.monthLabel}
                      </text>
                    </g>
                  );
                })}
                <polyline
                  className="migration__chart-line migration__chart-line--base"
                  points={monthlyChart.basePoints.map((point) => `${point.x},${point.y}`).join(" ")}
                />
                <polyline
                  className="migration__chart-line migration__chart-line--after"
                  points={monthlyChart.postMigrationPoints.map((point) => `${point.x},${point.y}`).join(" ")}
                />
                {data.months.map((month, index) => (
                  <g key={`${month.monthKey}-points`}>
                    <circle
                      className="migration__chart-point migration__chart-point--base"
                      cx={monthlyChart.basePoints[index].x}
                      cy={monthlyChart.basePoints[index].y}
                      r="5"
                    >
                      <title>{`${month.monthLabel}: ${formatMoney(month.arrMigrated, data.targetCurrency)} base revenue migrated`}</title>
                    </circle>
                    <circle
                      className="migration__chart-point migration__chart-point--after"
                      cx={monthlyChart.postMigrationPoints[index].x}
                      cy={monthlyChart.postMigrationPoints[index].y}
                      r="5"
                    >
                      <title>{`${month.monthLabel}: ${formatMoney(month.arrMigrated + month.resultingExpansion, data.targetCurrency)} ARR after migration`}</title>
                    </circle>
                  </g>
                ))}
              </svg>
            </div>
            <div className="migration__chart-values">
              {data.months.map((month) => (
                <button
                  className="migration__chart-value migration__download-row"
                  type="button"
                  key={month.monthKey}
                  disabled={!customerGroups?.selectedRangeMigrations.some((row) => row.migratedAt.slice(0, 7) === month.monthKey)}
                  onClick={() => downloadCustomers(
                    `${month.monthKey}-migrated-customers`,
                    (customerGroups?.selectedRangeMigrations || []).filter((row) => row.migratedAt.slice(0, 7) === month.monthKey),
                  )}
                  title="Download the customers behind this month"
                >
                  <strong>{month.monthLabel}</strong>
                  <span>{formatMoney(month.arrMigrated, data.targetCurrency)} base</span>
                  <span>{formatMoney(month.arrMigrated + month.resultingExpansion, data.targetCurrency)} after migration</span>
                  <small>{month.logosMigrated} logo{month.logosMigrated === 1 ? "" : "s"}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="stripe-ui__panel ui-reveal">
            <div className="stripe-ui__section-head">
              <div>
                <h2 className="stripe-ui__panel-title">Migrated customers</h2>
                <p className="stripe-ui__panel-subtitle">Each customer appears once at their first qualifying V4 plan activation within the selected range.</p>
              </div>
              <button
                className="migration__as-of migration__download-inline"
                type="button"
                disabled={!customerGroups?.selectedRangeMigrations.length}
                onClick={() => downloadCustomers("selected-range-migrated-customers", customerGroups?.selectedRangeMigrations || [])}
              >
                {data.migrations.length} total
              </button>
            </div>
            <div className="stripe-ui__table-wrap">
              <table className="stripe-ui__table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Source</th>
                    <th>Migration date</th>
                    <th>Workspace</th>
                    <th>Previous plan</th>
                    <th>Plan at range end</th>
                    <th>ARR migrated before migration</th>
                    <th>V4 ARR after migration</th>
                    <th>Resulting expansion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.migrations.length ? data.migrations.map((migration) => (
                    <tr key={migration.migrationKey}>
                      <td>
                        <a href={migration.recordUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
                          {migration.customerName}
                        </a>
                        <div className="account-management__muted">{migration.customerId}</div>
                      </td>
                      <td>{migration.source === "stripe" ? "Stripe / BigQuery" : "HubSpot"}</td>
                      <td>{formatDate(migration.migratedAt)}</td>
                      <td>{migration.workspaceId || "—"}</td>
                      <td>{migration.previousPlan || "—"}</td>
                      <td>{migration.currentPlan || "—"}</td>
                      <td>{formatMoney(migration.priorLegacyArr, data.targetCurrency)}</td>
                      <td>{formatMoney(migration.migratedV4Arr, data.targetCurrency)}</td>
                      <td>{formatSignedMoney(migration.resultingExpansion, data.targetCurrency)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={9}>No qualifying V2/V3-to-V4 migrations were found in this range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="stripe-ui__panel ui-reveal">
            <h2 className="stripe-ui__panel-title">Methodology</h2>
            <div className="account-management__methodology">
              {data.methodology.map((line) => <p key={line}>{line}</p>)}
            </div>
          </section>

          <section className="stripe-ui__panel ui-reveal ui-reveal-2">
            <h2 className="stripe-ui__panel-title">By source</h2>
            <p className="stripe-ui__panel-subtitle">Stripe / BigQuery and HubSpot Sales Default Pipeline customers are counted independently.</p>
            <div className="migration__source-grid">
              {data.sourceBreakdown.map((source) => {
                const population = data.goal.sourcePopulations.find((item) => item.source === source.source);
                const sourceOpeningRows = (customerGroups?.openingLegacy || []).filter((row) => row.source === source.source);
                const sourceCurrentRows = (customerGroups?.currentLegacy || []).filter((row) => row.source === source.source);
                const sourceSelectedRows = (customerGroups?.selectedRangeMigrations || []).filter((row) => row.source === source.source);
                return (
                  <article className="migration__source-card" key={source.source}>
                    <h3>{source.sourceLabel}</h3>
                    <button className="migration__source-download" type="button" disabled={!sourceOpeningRows.length} onClick={() => downloadCustomers(`${source.source}-opening-v2-v3-customers`, sourceOpeningRows)}>
                      <span>Opening V2/V3 customers</span><strong>{population?.opening.customers || 0}</strong>
                    </button>
                    <button className="migration__source-download" type="button" disabled={!sourceCurrentRows.length} onClick={() => downloadCustomers(`${source.source}-v2-v3-at-range-end`, sourceCurrentRows)}>
                      <span>V2/V3 customers at range end</span><strong>{population?.current.customers || 0}</strong>
                    </button>
                    <button className="migration__source-download" type="button" disabled={!sourceSelectedRows.length} onClick={() => downloadCustomers(`${source.source}-selected-range-migrated-arr-customers`, sourceSelectedRows)}>
                      <span>Selected-range ARR migrated before migration</span><strong>{formatMoney(source.selectedRange.arrMigrated, data.targetCurrency)}</strong>
                    </button>
                    <button className="migration__source-download" type="button" disabled={!sourceSelectedRows.length} onClick={() => downloadCustomers(`${source.source}-selected-range-resulting-expansion-customers`, sourceSelectedRows)}>
                      <span>Selected-range resulting expansion</span><strong>{formatSignedMoney(source.selectedRange.resultingExpansion, data.targetCurrency)}</strong>
                    </button>
                    <button className="migration__source-download" type="button" disabled={!sourceSelectedRows.length} onClick={() => downloadCustomers(`${source.source}-selected-range-migrated-customers`, sourceSelectedRows)}>
                      <span>Selected-range logos migrated</span><strong>{source.selectedRange.logosMigrated}</strong>
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
