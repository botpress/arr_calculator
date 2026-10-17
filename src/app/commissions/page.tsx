"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CommissionDealRow,
  CommissionReportResponse,
  CommissionWatchStatus,
} from "@/lib/commissionsReport";
import type { CommissionFlagType } from "@/lib/commissionFlags";
import type { SalesQuotaProgress, TeamSalesQuotaProgress } from "@/lib/salesQuotaRules";
import type { SalesQuotaReportResponse } from "@/lib/salesQuotaReport";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  } catch {
    return Number(value || 0).toFixed(2);
  }
}

function formatCompactMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(Number(value || 0));
  } catch {
    return Number(value || 0).toFixed(0);
  }
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00.000Z`),
  );
}

function quotaPeriodLabel(quota: SalesQuotaProgress) {
  const start = formatDate(quota.periodStart, { month: "short", day: "numeric" });
  const end = formatDate(quota.periodEnd, { month: "short", day: "numeric", year: "numeric" });
  return `${quota.cadence === "quarterly" ? "Quarterly" : "Monthly"} · ${start}–${end}`;
}

type QuotaChartRow = SalesQuotaProgress | TeamSalesQuotaProgress;

const FLAG_LABELS: Record<CommissionFlagType, string> = {
  duplicate: "Duplicate (not paid)",
  no_increase: "No increase (not paid)",
  billing_not_updated: "Billing not updated",
  possible_duplicate: "Possible duplicate",
  price_mismatch: "Price mismatch",
  cancellation_untrackable: "Cancellation untrackable",
  owner_unknown: "Owner unknown",
};

const FLAG_ORDER: CommissionFlagType[] = [
  "duplicate",
  "no_increase",
  "billing_not_updated",
  "possible_duplicate",
  "price_mismatch",
  "cancellation_untrackable",
  "owner_unknown",
];

function flagColors(type: CommissionFlagType) {
  return type === "duplicate" || type === "no_increase"
    ? { color: "#b42318", background: "#f8e3df", borderColor: "#e8b4aa" }
    : { color: "#8b4804", background: "#f6ebdc", borderColor: "#e0dbd2" };
}

const WATCH_LABELS: Record<CommissionWatchStatus, string> = {
  paying: "Paying",
  cancelled_clawback: "Cancelled → clawback",
  plan_changed_clawback: "Plan changed → clawback",
  untrackable: "Can't track",
};

function watchColor(status: CommissionWatchStatus) {
  if (status === "paying") return "#3d7a33";
  if (status === "untrackable") return "#8b4804";
  return "#b42318";
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
}

function statusLabel(row: CommissionDealRow) {
  if (row.status === "duplicate") return `Duplicate of ${row.duplicateOfDealName || `#${row.duplicateOfDealId}`}`;
  if (row.status === "clawback") {
    const label = row.clawbackType === "upgrade" ? "Upgrade" : row.clawbackType === "downgrade" ? "Downgrade" : "Churn";
    return `${label} clawback`;
  }
  if (row.status === "protected") return "3-month payment cleared";
  if (row.status === "unmapped") return "Stripe mapping missing · can't track cancellation";
  if (row.status === "ineligible") return row.grossCommission === 0 && row.initialGrossCommission > 0 ? "Not commissionable" : "Frequency ineligible";
  return "Monitoring first 3 months";
}

function statusColor(row: CommissionDealRow) {
  if (row.status === "clawback" || row.status === "duplicate") return "#b42318";
  if (row.status === "protected") return "#3d7a33";
  if (row.status === "unmapped" || row.status === "ineligible") return "#8b4804";
  return "#2863b0";
}

export default function CommissionsPage() {
  const initialMonth = useMemo(currentMonth, []);
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<CommissionReportResponse | null>(null);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [quotaData, setQuotaData] = useState<SalesQuotaReportResponse | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [quotaError, setQuotaError] = useState("");
  const [showUnmappedDeals, setShowUnmappedDeals] = useState(false);
  const [flagFilter, setFlagFilter] = useState<"" | "any" | CommissionFlagType>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState("");

  const loadQuota = useCallback(async () => {
    setQuotaLoading(true);
    setQuotaError("");
    try {
      const response = await fetch("/api/commissions/quota", { cache: "no-store" });
      const text = await response.text();
      const payload = text ? (JSON.parse(text) as SalesQuotaReportResponse & { error?: string }) : null;
      if (!response.ok) throw new Error(payload?.error || text || `HTTP ${response.status}`);
      if (!payload) throw new Error("Empty sales quota response");
      setQuotaData(payload);
    } catch (requestError: unknown) {
      setQuotaError(requestError instanceof Error ? requestError.message : "Unable to load sales quotas");
      setQuotaData(null);
    } finally {
      setQuotaLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  const run = useCallback(async () => {
    setLoading(true);
    setError("");
    setShowUnmappedDeals(false);
    try {
      const response = await fetch("/api/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, targetCurrency: "USD" }),
      });
      const text = await response.text();
      const payload = text ? (JSON.parse(text) as CommissionReportResponse & { error?: string }) : null;
      if (!response.ok) throw new Error(payload?.error || text || `HTTP ${response.status}`);
      if (!payload) throw new Error("Empty commissions response");
      setData(payload);
      setOwnerFilter("");
      setFlagFilter("");
      setLockError("");
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load commissions");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [month]);

  const changeLock = useCallback(async (action: "lock" | "unlock") => {
    if (!data) return;
    const prompt = action === "lock"
      ? `Lock ${data.monthLabel}? This saves the current report as the paid snapshot. Later changes will appear as adjustments in the next open month.`
      : `Unlock ${data.monthLabel}? The month will be recomputed from live data. The lock history is kept.`;
    if (!window.confirm(prompt)) return;
    setLockBusy(true);
    setLockError("");
    try {
      const response = await fetch("/api/commissions/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: data.month, action, targetCurrency: data.targetCurrency }),
      });
      const text = await response.text();
      const payload = text ? (JSON.parse(text) as { error?: string; report?: CommissionReportResponse }) : null;
      if (!response.ok) throw new Error(payload?.error || text || `HTTP ${response.status}`);
      if (action === "lock" && payload?.report) setData(payload.report);
      else await run();
    } catch (requestError: unknown) {
      setLockError(requestError instanceof Error ? requestError.message : "Unable to update the month lock");
    } finally {
      setLockBusy(false);
    }
  }, [data, run]);

  const currency = data?.targetCurrency || "USD";
  const filteredOwners = useMemo(() => {
    if (!data) return [];
    const owners = ownerFilter
      ? data.owners.filter((owner) => (owner.ownerId || "unassigned") === ownerFilter)
      : data.owners;
    if (!flagFilter) return owners;
    return owners
      .map((owner) => ({
        ...owner,
        deals: owner.deals.filter((deal) =>
          flagFilter === "any" ? (deal.flags || []).length > 0 : (deal.flags || []).some((flag) => flag.type === flagFilter),
        ),
      }))
      .filter((owner) => owner.deals.length > 0);
  }, [data, ownerFilter, flagFilter]);
  const flaggedRowCount = useMemo(
    () => (data?.owners || []).reduce((count, owner) => count + owner.deals.filter((deal) => (deal.flags || []).length).length, 0),
    [data],
  );
  const filteredTotals = useMemo(() => {
    if (!data || !ownerFilter) return data?.totals;
    return data.owners.filter((owner) => (owner.ownerId || "unassigned") === ownerFilter).reduce(
      (totals, owner) => ({
        ownerCount: totals.ownerCount + 1,
        dealCount: totals.dealCount + owner.dealCount,
        dealAmount: totals.dealAmount + owner.dealAmount,
        grossCommission: totals.grossCommission + owner.grossCommission,
        clawback: totals.clawback + owner.clawback,
        adjustment: totals.adjustment + (owner.adjustment || 0),
        netCommission: totals.netCommission + owner.netCommission,
      }),
      { ownerCount: 0, dealCount: 0, dealAmount: 0, grossCommission: 0, clawback: 0, adjustment: 0, netCommission: 0 },
    );
  }, [data, ownerFilter]);

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Sales compensation</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Commissions</h1>
            <p className="stripe-ui__subtitle">
              Closed-won New Business and approved-rep Existing Business by deal owner, with Stripe payment-based
              churn and downgrade clawbacks plus deal-backed plan replacements.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel commissions-quota ui-reveal ui-reveal-1">
        <div className="commissions-quota__heading">
          <div>
            <h2 className="stripe-ui__panel-title">Sales vs quota</h2>
            <p className="stripe-ui__panel-subtitle">
              Closed-won HubSpot deal amount in USD. The marker shows the prorated pace expected by today.
            </p>
          </div>
          {quotaData ? (
            <div className="commissions-quota__as-of">
              As of {formatDate(quotaData.asOfDate, { month: "long", day: "numeric", year: "numeric" })}
            </div>
          ) : null}
        </div>

        <div className="commissions-quota__legend" aria-label="Chart legend">
          <span><i className="commissions-quota__legend-sold" /> Sold</span>
          <span><i className="commissions-quota__legend-expected" /> Expected by today</span>
        </div>

        {quotaLoading ? (
          <div className="stripe-ui__skeleton-grid" aria-label="Loading sales quotas">
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row stripe-ui__skeleton-row--short" />
          </div>
        ) : null}

        {quotaError ? (
          <div className="stripe-ui__error commissions-quota__error">
            <span>{quotaError}</span>
            <button className="stripe-ui__btn stripe-ui__btn--secondary" type="button" onClick={() => void loadQuota()}>
              Retry
            </button>
          </div>
        ) : null}

        {quotaData ? (
          <div className="commissions-quota__list">
            {[
              {
                quota: quotaData.teamQuota,
                periodLabel: quotaPeriodLabel(quotaData.teamQuota).replace("Monthly ·", "Monthly team total ·"),
                isTeam: true,
              },
              ...quotaData.quotas.map((quota) => ({ quota, periodLabel: quotaPeriodLabel(quota), isTeam: false })),
            ].map(({ quota, periodLabel, isTeam }: { quota: QuotaChartRow; periodLabel: string; isTeam: boolean }) => {
              const fillPct = Math.min(100, Math.max(0, quota.attainmentPct));
              const expectedPct = Math.min(100, Math.max(0, quota.expectedPct));
              return (
                <article
                  className={isTeam ? "commissions-quota__row commissions-quota__row--team" : "commissions-quota__row"}
                  key={quota.ownerKey}
                >
                  <div className="commissions-quota__row-heading">
                    <div>
                      <div className="commissions-quota__owner">{quota.ownerName}</div>
                      <div className="commissions-quota__period">{periodLabel}</div>
                    </div>
                    <div className="commissions-quota__attainment">
                      <strong>{quota.attainmentPct.toFixed(1)}%</strong>
                      <span className="commissions-quota__expected-pct">
                        Should be {quota.expectedPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div
                    className="commissions-quota__track"
                    role="img"
                    aria-label={`${quota.ownerName} has sold ${formatMoney(quota.soldAmount, quotaData.targetCurrency)} of a ${formatMoney(quota.quotaAmount, quotaData.targetCurrency)} quota; expected by today is ${formatMoney(quota.expectedAmount, quotaData.targetCurrency)}`}
                  >
                    <div
                      className={isTeam ? "commissions-quota__fill commissions-quota__fill--team" : "commissions-quota__fill"}
                      style={{ width: `${fillPct}%` }}
                    />
                    <div className="commissions-quota__marker" style={{ left: `${expectedPct}%` }} />
                  </div>
                  <div className="commissions-quota__details">
                    <span className="commissions-quota__sold-detail">
                      <span>Sold <strong>{formatCompactMoney(quota.soldAmount, quotaData.targetCurrency)}</strong></span>
                      <small>{quota.dealCount} closed-won deal{quota.dealCount === 1 ? "" : "s"}</small>
                    </span>
                    <span>Expected <strong>{formatCompactMoney(quota.expectedAmount, quotaData.targetCurrency)}</strong></span>
                    <span>Quota <strong>{formatCompactMoney(quota.quotaAmount, quotaData.targetCurrency)}</strong></span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        {quotaData?.warnings.length ? (
          <div className="commissions-quota__warnings">
            {quotaData.warnings.map((warning) => <div key={warning}>{warning}</div>)}
          </div>
        ) : null}
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-2">
        <h2 className="stripe-ui__panel-title">Report month</h2>
        <p className="stripe-ui__panel-subtitle">
          Gross commissions are booked in the deal close month. Clawbacks appear in the Stripe churn or downgrade
          month, or alongside a qualifying HubSpot plan-replacement deal, including adjustments to earlier deals.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div className="stripe-ui__field" style={{ minWidth: 220 }}>
            <label className="stripe-ui__field-label" htmlFor="commissions-month">
              Month
            </label>
            <input
              id="commissions-month"
              className="stripe-ui__control"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </div>
          <div className="stripe-ui__field" style={{ minWidth: 220 }}>
            <label className="stripe-ui__field-label" htmlFor="commissions-owner">
              Deal owner
            </label>
            <select
              id="commissions-owner"
              className="stripe-ui__control"
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
              disabled={!data?.owners.length}
            >
              <option value="">All deal owners</option>
              {(data?.owners || []).map((owner) => (
                <option key={owner.ownerId || "unassigned"} value={owner.ownerId || "unassigned"}>
                  {owner.ownerName}
                </option>
              ))}
            </select>
          </div>
          <button className="stripe-ui__btn stripe-ui__btn--primary" type="button" onClick={() => void run()} disabled={loading || !month}>
            {loading ? "Calculating…" : "Load commissions"}
          </button>
        </div>
        {error ? (
          <p style={{ color: "#b42318", background: "#f8e3df", border: "1px solid #e8b4aa", borderRadius: 8, padding: "10px 12px" }}>
            {error}
          </p>
        ) : null}
      </section>

      {data && filteredTotals ? (
        <>
          <section className="stripe-ui__panel ui-reveal ui-reveal-2">
            <div className="stripe-ui__hero-row" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h2 className="stripe-ui__panel-title">{data.monthLabel} summary</h2>
              {data.canManageLocks ? (
                data.lock?.locked ? (
                  <button className="stripe-ui__btn stripe-ui__btn--secondary" type="button" onClick={() => void changeLock("unlock")} disabled={lockBusy}>
                    {lockBusy ? "Unlocking…" : "Unlock month"}
                  </button>
                ) : (
                  <button className="stripe-ui__btn stripe-ui__btn--primary" type="button" onClick={() => void changeLock("lock")} disabled={lockBusy}>
                    {lockBusy ? "Locking…" : "Lock month"}
                  </button>
                )
              ) : null}
            </div>
            {data.lock?.locked ? (
              <p style={{ color: "#3d7a33", background: "#f8f7f4", border: "1px solid #e0dbd2", borderRadius: 8, padding: "10px 12px", fontWeight: 700 }}>
                Locked on {formatTimestamp(data.lock.lockedAt)} by {data.lock.lockedByName || data.lock.lockedByEmail}. This is the saved snapshot; later changes appear as adjustments in the next open month.
              </p>
            ) : (
              <p style={{ color: "#625d54", marginTop: 0 }}>
                Open month: computed from live data{data.adjustments?.length ? ", including adjustments for earlier locked months" : ""}.
              </p>
            )}
            {lockError ? (
              <p style={{ color: "#b42318", background: "#f8e3df", border: "1px solid #e8b4aa", borderRadius: 8, padding: "10px 12px" }}>
                {lockError}
              </p>
            ) : null}
            <div className="stripe-ui__stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Deal owners</p>
                <p className="stripe-ui__stat-value">{filteredTotals.ownerCount}</p>
              </article>
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Commissioned deals</p>
                <p className="stripe-ui__stat-value">{filteredTotals.dealCount}</p>
              </article>
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Commissioned deal amount</p>
                <p className="stripe-ui__stat-value">{formatMoney(filteredTotals.dealAmount, currency)}</p>
              </article>
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Gross commission</p>
                <p className="stripe-ui__stat-value">{formatMoney(filteredTotals.grossCommission, currency)}</p>
              </article>
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Clawbacks</p>
                <p className="stripe-ui__stat-value" style={{ color: filteredTotals.clawback > 0 ? "#b42318" : undefined }}>
                  {formatMoney(filteredTotals.clawback, currency)}
                </p>
              </article>
              {filteredTotals.adjustment ? (
                <article className="stripe-ui__stat">
                  <p className="stripe-ui__stat-label">Adjustments (locked months)</p>
                  <p className="stripe-ui__stat-value" style={{ color: filteredTotals.adjustment < 0 ? "#b42318" : undefined }}>
                    {formatMoney(filteredTotals.adjustment, currency)}
                  </p>
                </article>
              ) : null}
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Net commission</p>
                <p className="stripe-ui__stat-value">{formatMoney(filteredTotals.netCommission, currency)}</p>
              </article>
            </div>
            {data.flagSummary ? (
              <div style={{ marginTop: 16 }}>
                <div style={{ color: "#625d54", fontSize: 13 }}>
                  {flaggedRowCount} flagged row{flaggedRowCount === 1 ? "" : "s"} to review before paying. Click a flag to show only those rows.
                </div>
                <div className="stripe-ui__chips">
                  <button
                    type="button"
                    className="stripe-ui__chip"
                    aria-pressed={flagFilter === "any"}
                    onClick={() => setFlagFilter((current) => (current === "any" ? "" : "any"))}
                    style={{ cursor: "pointer", fontWeight: flagFilter === "any" ? 700 : 400 }}
                  >
                    All flagged ({flaggedRowCount})
                  </button>
                  {FLAG_ORDER.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="stripe-ui__chip"
                      aria-pressed={flagFilter === type}
                      disabled={!data.flagSummary[type]}
                      onClick={() => setFlagFilter((current) => (current === type ? "" : type))}
                      style={{
                        cursor: data.flagSummary[type] ? "pointer" : "default",
                        fontWeight: flagFilter === type ? 700 : 400,
                        ...(data.flagSummary[type] ? flagColors(type) : { color: "#625d54" }),
                      }}
                    >
                      {FLAG_LABELS[type]} ({data.flagSummary[type] || 0})
                    </button>
                  ))}
                  {flagFilter ? (
                    <button type="button" className="stripe-ui__chip" onClick={() => setFlagFilter("")} style={{ cursor: "pointer" }}>
                      Clear filter
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {data.warnings.length ? (
              <div className="commissions-warning">
                {data.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                {data.warningDetails.unmappedStripeCustomerDeals.length ? (
                  <>
                    <button
                      className="commissions-warning__toggle"
                      type="button"
                      aria-expanded={showUnmappedDeals}
                      aria-controls="unmapped-stripe-deals"
                      onClick={() => setShowUnmappedDeals((visible) => !visible)}
                    >
                      {showUnmappedDeals ? "Hide list" : "See list"} ({data.warningDetails.unmappedStripeCustomerDeals.length})
                    </button>
                    {showUnmappedDeals ? (
                      <div className="commissions-warning__deal-list" id="unmapped-stripe-deals">
                        {data.warningDetails.unmappedStripeCustomerDeals.map((deal) => (
                          <div className="commissions-warning__deal" key={deal.dealId}>
                            <a href={deal.hubspotUrl} target="_blank" rel="noreferrer">{deal.dealName}</a>
                            <span>
                              {deal.ownerName} · Closed {deal.closeDate} · Workspace {deal.workspaceId}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </section>

          {filteredOwners.length ? filteredOwners.map((owner) => (
            <section className="stripe-ui__panel ui-reveal" key={owner.ownerId || "unassigned"}>
              <div className="stripe-ui__hero-row" style={{ alignItems: "end" }}>
                <div>
                  <h2 className="stripe-ui__panel-title">{owner.ownerName}</h2>
                  <p className="stripe-ui__panel-subtitle">
                    {owner.dealCount} commissioned deal{owner.dealCount === 1 ? "" : "s"} · Net {formatMoney(owner.netCommission, currency)}
                  </p>
                </div>
                <div style={{ color: "#625d54", textAlign: "right" }}>
                  Gross {formatMoney(owner.grossCommission, currency)} · Clawback {formatMoney(owner.clawback, currency)}
                  {owner.adjustment ? <> · Adjustments {formatMoney(owner.adjustment, currency)}</> : null}
                </div>
              </div>
              <div className="stripe-ui__table-wrap">
                <table className="stripe-ui__table">
                  <thead>
                    <tr>
                      <th>Deal</th>
                      <th>Close / pipeline</th>
                      <th>Workspace</th>
                      <th>Frequency</th>
                      <th>Deal amount</th>
                      <th>Gross</th>
                      <th>Stripe plan paid (net)</th>
                      <th>Clawback</th>
                      <th>Net</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {owner.deals.map((deal) => (
                      <tr key={deal.dealId}>
                        <td>
                          <a href={deal.hubspotUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
                            {deal.dealName}
                          </a>
                          <div style={{ color: "#625d54", fontSize: 12 }}>#{deal.dealId}</div>
                          {(deal.flags || []).length ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                              {deal.flags.map((flag) => (
                                <span
                                  key={flag.type}
                                  title={flag.message}
                                  style={{ ...flagColors(flag.type), border: "1px solid", fontSize: 11, fontWeight: 700, padding: "1px 6px" }}
                                >
                                  {FLAG_LABELS[flag.type]}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {(deal.flags || []).map((flag) => (
                            <div key={flag.type} style={{ color: flagColors(flag.type).color, fontSize: 12, maxWidth: 280 }}>
                              {flag.message}
                            </div>
                          ))}
                        </td>
                        <td>
                          <div>{deal.closeDate}</div>
                          <div style={{ color: "#625d54", fontSize: 12 }}>{deal.pipelineName}</div>
                          <div style={{ color: "#625d54", fontSize: 12 }}>{deal.dealType}</div>
                        </td>
                        <td style={{ maxWidth: 210, overflowWrap: "anywhere" }}>
                          {deal.workspaceId || "—"}
                          {deal.stripeCustomerIds.length ? (
                            <div style={{ color: "#625d54", fontSize: 12 }}>{deal.stripeCustomerIds.join(", ")}</div>
                          ) : null}
                        </td>
                        <td>
                          <div style={{ textTransform: "capitalize" }}>{deal.paymentFrequency}</div>
                          <div style={{ color: "#625d54", fontSize: 12 }}>{deal.commissionRatePct}% · {deal.termMonths} mo.</div>
                        </td>
                        <td>
                          {formatMoney(deal.dealAmount, currency)}
                          {deal.dealCurrency !== currency ? (
                            <div style={{ color: "#625d54", fontSize: 12 }}>
                              {formatMoney(deal.dealAmountOriginal, deal.dealCurrency)} source
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {formatMoney(deal.grossCommission, currency)}
                          {deal.clawback > 0 ? (
                            <div style={{ color: "#625d54", fontSize: 12 }}>
                              Original commission {formatMoney(deal.initialGrossCommission, currency)}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {formatMoney(deal.paidAmount, currency)}
                          <div style={{ color: "#625d54", fontSize: 12 }}>
                            3-mo target {formatMoney(deal.protectedAmount, currency)}
                          </div>
                          {deal.proratedOpeningPaymentAmount > 0 ? (
                            <div style={{ color: "#8b4804", fontSize: 12 }}>
                              Opening proration {formatMoney(deal.proratedOpeningPaymentAmount, currency)} excluded from target · Clock starts {deal.monitoringStart}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ color: deal.clawback > 0 ? "#b42318" : undefined }}>
                          {formatMoney(deal.clawback, currency)}
                          {deal.clawbackEventDate ? (
                            <div style={{ fontSize: 12 }}>{deal.clawbackEventDate}</div>
                          ) : null}
                        </td>
                        <td style={{ fontWeight: 700 }}>{formatMoney(deal.netCommission, currency)}</td>
                        <td style={{ minWidth: 170 }}>
                          <span style={{ color: statusColor(deal), fontWeight: 700 }}>{statusLabel(deal)}</span>
                          {deal.fullyProtectedAt ? (
                            <div style={{ color: "#625d54", fontSize: 12 }}>Paid through {deal.fullyProtectedAt}</div>
                          ) : null}
                          {deal.notes.map((note) => (
                            <div key={note} style={{ color: "#8b4804", fontSize: 12 }}>{note}</div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!flagFilter && owner.adjustments?.length ? (
                <div className="stripe-ui__table-wrap" style={{ marginTop: 12 }}>
                  <table className="stripe-ui__table">
                    <thead>
                      <tr>
                        <th>Adjustment</th>
                        <th>Deal</th>
                        <th>Previously paid</th>
                        <th>Now due</th>
                        <th>Adjustment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {owner.adjustments.map((adjustment) => (
                        <tr key={`${adjustment.forMonth}|${adjustment.dealId}|${adjustment.kind}`}>
                          <td style={{ maxWidth: 360 }}>
                            <strong>Adjustment for {adjustment.forMonth}:</strong> {adjustment.reason}
                            <div style={{ color: "#625d54", fontSize: 12, textTransform: "capitalize" }}>{adjustment.kind}</div>
                          </td>
                          <td>
                            {adjustment.hubspotUrl ? (
                              <a href={adjustment.hubspotUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>{adjustment.dealName}</a>
                            ) : adjustment.dealName}
                            <div style={{ color: "#625d54", fontSize: 12 }}>#{adjustment.dealId}</div>
                          </td>
                          <td>{formatMoney(adjustment.previousAmount, currency)}</td>
                          <td>{formatMoney(adjustment.currentAmount, currency)}</td>
                          <td style={{ fontWeight: 700, color: adjustment.amount < 0 ? "#b42318" : undefined }}>
                            {formatMoney(adjustment.amount, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          )) : (
            <section className="stripe-ui__panel ui-reveal">
              <h2 className="stripe-ui__panel-title">{flagFilter ? "No flagged rows" : "No commission activity"}</h2>
              <p className="stripe-ui__panel-subtitle">
                {flagFilter
                  ? "No rows match the selected flag."
                  : `No new commissions or one-time clawbacks were found for ${data.monthLabel}.`}
              </p>
            </section>
          )}

          {data.clawbackWatchList ? (
            <section className="stripe-ui__panel ui-reveal">
              <h2 className="stripe-ui__panel-title">Clawback watch list</h2>
              <p className="stripe-ui__panel-subtitle">
                Commissioned deals still inside their 3-month clawback window at the end of {data.monthLabel}, plus deals clawed back this month.
              </p>
              {data.clawbackWatchList.length ? (
                <div className="stripe-ui__table-wrap">
                  <table className="stripe-ui__table">
                    <thead>
                      <tr>
                        <th>Deal</th>
                        <th>Owner</th>
                        <th>Closed</th>
                        <th>Commission at risk</th>
                        <th>Window ends</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.clawbackWatchList
                        .filter((row) => !ownerFilter || (row.ownerId || "unassigned") === ownerFilter)
                        .map((row) => (
                          <tr key={row.dealId}>
                            <td>
                              <a href={row.hubspotUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>{row.dealName}</a>
                              <div style={{ color: "#625d54", fontSize: 12 }}>#{row.dealId}</div>
                            </td>
                            <td>{row.ownerName}</td>
                            <td>{row.closeDate}</td>
                            <td>
                              {formatMoney(row.commissionAtRisk, currency)}
                              <div style={{ color: "#625d54", fontSize: 12 }}>
                                of {formatMoney(row.grossCommission, currency)} · plan paid {formatMoney(row.paidAmount, currency)}
                              </div>
                            </td>
                            <td>{row.windowEnd}</td>
                            <td>
                              <span style={{ color: watchColor(row.status), fontWeight: 700 }}>{WATCH_LABELS[row.status]}</span>
                              {row.clawbackDate ? <div style={{ color: "#625d54", fontSize: 12 }}>{row.clawbackDate}</div> : null}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ color: "#625d54", marginBottom: 0 }}>No commissioned deals are inside a clawback window.</p>
              )}
            </section>
          ) : null}

          <section className="stripe-ui__panel ui-reveal">
            <h2 className="stripe-ui__panel-title">Methodology</h2>
            <p className="stripe-ui__panel-subtitle">{data.methodology.clawbackRule}</p>
            <p style={{ color: "#625d54" }}>
              HubSpot: {data.methodology.includedPipelines.join(" + ")} · Deal types: {data.methodology.dealTypes.join(" + ")} · Rates: monthly 8%, quarterly 10%, annual 11%.{" "}
              Stripe source: {data.methodology.paymentSource}.
            </p>
            <p style={{ color: "#625d54" }}>
              Existing Business reps ({data.methodology.existingBusinessOwnerSource || "owner list"}): {data.methodology.existingBusinessOwners.join(", ")}.
              {data.methodology.excludedOwners?.length ? (
                <> No per-deal commission (directors, paid on team attainment): {data.methodology.excludedOwners.join(", ")}.</>
              ) : null}
            </p>
            {data.methodology.flagRules?.length ? (
              <ul style={{ color: "#625d54", paddingLeft: 18 }}>
                {data.methodology.flagRules.map((rule) => <li key={rule}>{rule}</li>)}
              </ul>
            ) : null}
            {data.methodology.lockRule ? (
              <p style={{ color: "#625d54", marginBottom: 0 }}>{data.methodology.lockRule}</p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
