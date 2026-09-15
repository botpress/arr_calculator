"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommissionDealRow, CommissionReportResponse } from "@/lib/commissionsReport";
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

function statusLabel(row: CommissionDealRow) {
  if (row.status === "clawback") {
    const label = row.clawbackType === "upgrade" ? "Upgrade" : row.clawbackType === "downgrade" ? "Downgrade" : "Churn";
    return `${label} clawback`;
  }
  if (row.status === "protected") return "3-month payment cleared";
  if (row.status === "unmapped") return "Stripe mapping missing";
  if (row.status === "ineligible") return "Frequency ineligible";
  return "Monitoring first 3 months";
}

function statusColor(row: CommissionDealRow) {
  if (row.status === "clawback") return "#b91c1c";
  if (row.status === "protected") return "#166534";
  if (row.status === "unmapped" || row.status === "ineligible") return "#92400e";
  return "#1d4ed8";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load commissions");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [month]);

  const currency = data?.targetCurrency || "USD";
  const filteredOwners = useMemo(() => {
    if (!data) return [];
    if (!ownerFilter) return data.owners;
    return data.owners.filter((owner) => (owner.ownerId || "unassigned") === ownerFilter);
  }, [data, ownerFilter]);
  const filteredTotals = useMemo(() => {
    if (!data || !ownerFilter) return data?.totals;
    return filteredOwners.reduce(
      (totals, owner) => ({
        ownerCount: totals.ownerCount + 1,
        dealCount: totals.dealCount + owner.dealCount,
        dealAmount: totals.dealAmount + owner.dealAmount,
        grossCommission: totals.grossCommission + owner.grossCommission,
        clawback: totals.clawback + owner.clawback,
        netCommission: totals.netCommission + owner.netCommission,
      }),
      { ownerCount: 0, dealCount: 0, dealAmount: 0, grossCommission: 0, clawback: 0, netCommission: 0 },
    );
  }, [data, filteredOwners, ownerFilter]);

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
          <p style={{ color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 12px" }}>
            {error}
          </p>
        ) : null}
      </section>

      {data && filteredTotals ? (
        <>
          <section className="stripe-ui__panel ui-reveal ui-reveal-2">
            <h2 className="stripe-ui__panel-title">{data.monthLabel} summary</h2>
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
                <p className="stripe-ui__stat-value" style={{ color: filteredTotals.clawback > 0 ? "#b91c1c" : undefined }}>
                  {formatMoney(filteredTotals.clawback, currency)}
                </p>
              </article>
              <article className="stripe-ui__stat">
                <p className="stripe-ui__stat-label">Net commission</p>
                <p className="stripe-ui__stat-value">{formatMoney(filteredTotals.netCommission, currency)}</p>
              </article>
            </div>
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
                <div style={{ color: "#475569", textAlign: "right" }}>
                  Gross {formatMoney(owner.grossCommission, currency)} · Clawback {formatMoney(owner.clawback, currency)}
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
                          <div style={{ color: "#64748b", fontSize: 12 }}>#{deal.dealId}</div>
                        </td>
                        <td>
                          <div>{deal.closeDate}</div>
                          <div style={{ color: "#64748b", fontSize: 12 }}>{deal.pipelineName}</div>
                          <div style={{ color: "#64748b", fontSize: 12 }}>{deal.dealType}</div>
                        </td>
                        <td style={{ maxWidth: 210, overflowWrap: "anywhere" }}>
                          {deal.workspaceId || "—"}
                          {deal.stripeCustomerIds.length ? (
                            <div style={{ color: "#64748b", fontSize: 12 }}>{deal.stripeCustomerIds.join(", ")}</div>
                          ) : null}
                        </td>
                        <td>
                          <div style={{ textTransform: "capitalize" }}>{deal.paymentFrequency}</div>
                          <div style={{ color: "#64748b", fontSize: 12 }}>{deal.commissionRatePct}% · {deal.termMonths} mo.</div>
                        </td>
                        <td>
                          {formatMoney(deal.dealAmount, currency)}
                          {deal.dealCurrency !== currency ? (
                            <div style={{ color: "#64748b", fontSize: 12 }}>
                              {formatMoney(deal.dealAmountOriginal, deal.dealCurrency)} source
                            </div>
                          ) : null}
                        </td>
                        <td>{formatMoney(deal.grossCommission, currency)}</td>
                        <td>
                          {formatMoney(deal.paidAmount, currency)}
                          <div style={{ color: "#64748b", fontSize: 12 }}>
                            3-mo target {formatMoney(deal.protectedAmount, currency)}
                          </div>
                          {deal.proratedOpeningPaymentAmount > 0 ? (
                            <div style={{ color: "#92400e", fontSize: 12 }}>
                              Opening proration {formatMoney(deal.proratedOpeningPaymentAmount, currency)} excluded from target · Clock starts {deal.monitoringStart}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ color: deal.clawback > 0 ? "#b91c1c" : undefined }}>
                          {formatMoney(deal.clawback, currency)}
                          {deal.clawbackEventDate ? (
                            <div style={{ fontSize: 12 }}>{deal.clawbackEventDate}</div>
                          ) : null}
                        </td>
                        <td style={{ fontWeight: 700 }}>{formatMoney(deal.netCommission, currency)}</td>
                        <td style={{ minWidth: 170 }}>
                          <span style={{ color: statusColor(deal), fontWeight: 700 }}>{statusLabel(deal)}</span>
                          {deal.fullyProtectedAt ? (
                            <div style={{ color: "#64748b", fontSize: 12 }}>Paid through {deal.fullyProtectedAt}</div>
                          ) : null}
                          {deal.notes.map((note) => (
                            <div key={note} style={{ color: "#92400e", fontSize: 12 }}>{note}</div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )) : (
            <section className="stripe-ui__panel ui-reveal">
              <h2 className="stripe-ui__panel-title">No commission activity</h2>
              <p className="stripe-ui__panel-subtitle">No new commissions or one-time clawbacks were found for {data.monthLabel}.</p>
            </section>
          )}

          <section className="stripe-ui__panel ui-reveal">
            <h2 className="stripe-ui__panel-title">Methodology</h2>
            <p className="stripe-ui__panel-subtitle">{data.methodology.clawbackRule}</p>
            <p style={{ color: "#475569", marginBottom: 0 }}>
              HubSpot: {data.methodology.includedPipelines.join(" + ")} · Deal types: {data.methodology.dealTypes.join(" + ")} ({data.methodology.existingBusinessOwners.join(", ")}) · Rates: monthly 8%, quarterly 10%, annual 11%.{" "}
              Stripe source: {data.methodology.paymentSource}.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
