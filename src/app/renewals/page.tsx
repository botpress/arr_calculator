"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LEGACY_SUNSET_DATE,
  RENEWAL_WINDOW_OPTIONS,
  daysBetween,
  filterRenewals,
  normalizeWindowDays,
  summarizeRenewals,
  type RenewalDeployment,
  type RenewalRow,
  type RenewalWindowDays,
  type RenewalsResponse,
} from "@/lib/renewalsRules";

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  } catch {
    return `${Number(value || 0).toFixed(0)} ${currency}`;
  }
}

function daysLeftLabel(days: number) {
  if (!Number.isFinite(days)) return "—";
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function statusClass(row: RenewalRow) {
  if (row.status === "renewed") return "renewals__status renewals__status--good";
  if (row.status === "in_progress") return "renewals__status renewals__status--warning";
  return "renewals__status renewals__status--critical";
}

export default function RenewalsPage() {
  const [data, setData] = useState<RenewalsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [windowDays, setWindowDays] = useState<RenewalWindowDays>(30);
  const [csmFilter, setCsmFilter] = useState("");
  const [deploymentFilter, setDeploymentFilter] = useState<RenewalDeployment | "">("");
  const autoRunDone = useRef(false);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/renewals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
      const json = (await response.json()) as RenewalsResponse & { error?: string };
      if (!response.ok) throw new Error(json.error || `Request failed (${response.status})`);
      setData(json);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Could not load renewals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoRunDone.current) return;
    autoRunDone.current = true;
    void load(false);
  }, [load]);

  const csmOptions = useMemo(() => {
    const byId = new Map<string, string>();
    let hasUnassigned = false;
    for (const row of data?.rows || []) {
      if (row.csmOwnerId) byId.set(row.csmOwnerId, row.csmOwnerName);
      else hasUnassigned = true;
    }
    const options = Array.from(byId.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (hasUnassigned) options.push({ value: "__none__", label: "No CSM assigned" });
    return options;
  }, [data]);

  const visibleRows = useMemo(() => {
    if (!data) return [];
    return filterRenewals(data.rows, {
      asOf: data.asOf,
      windowDays,
      csmOwnerId: csmFilter,
      deployment: deploymentFilter,
    });
  }, [data, windowDays, csmFilter, deploymentFilter]);

  const summary = useMemo(() => summarizeRenewals(visibleRows), [visibleRows]);
  const currency = data?.targetCurrency || "USD";

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Contracts coming up for renewal</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Renewals</h1>
            <p className="stripe-ui__subtitle">
              Every closed-won HubSpot contract whose end date falls in the selected window, with the company CSM, the deal owner, and whether a renewal deal is open.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div className="stripe-ui__field" style={{ minWidth: 160 }}>
            <label className="stripe-ui__field-label" htmlFor="renewals-window">Renewing within</label>
            <select
              id="renewals-window"
              className="stripe-ui__control"
              value={windowDays}
              onChange={(event) => setWindowDays(normalizeWindowDays(event.target.value))}
            >
              {RENEWAL_WINDOW_OPTIONS.map((days) => (
                <option value={days} key={days}>Next {days} days</option>
              ))}
            </select>
          </div>
          <div className="stripe-ui__field" style={{ minWidth: 220 }}>
            <label className="stripe-ui__field-label" htmlFor="renewals-csm">CSM owner</label>
            <select
              id="renewals-csm"
              className="stripe-ui__control"
              value={csmFilter}
              onChange={(event) => setCsmFilter(event.target.value)}
              disabled={!csmOptions.length}
            >
              <option value="">All CSM owners</option>
              {csmOptions.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="stripe-ui__field" style={{ minWidth: 160 }}>
            <label className="stripe-ui__field-label" htmlFor="renewals-deployment">Deployment</label>
            <select
              id="renewals-deployment"
              className="stripe-ui__control"
              value={deploymentFilter}
              onChange={(event) => setDeploymentFilter(event.target.value as RenewalDeployment | "")}
            >
              <option value="">Cloud and Legacy</option>
              <option value="Cloud">Cloud</option>
              <option value="Legacy">Legacy</option>
            </select>
          </div>
          <button
            className="stripe-ui__btn stripe-ui__btn--secondary"
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {data ? (
          <p className="stripe-ui__panel-subtitle" style={{ marginTop: 12 }}>
            As of {formatDate(data.asOf)} · data loaded {new Date(data.generatedAt).toLocaleString("en-US")}. Results are cached for about an hour; Refresh reloads from HubSpot data in BigQuery.
          </p>
        ) : null}
        {error ? <p className="stripe-ui__error">{error}</p> : null}
      </section>

      {loading && !data ? (
        <section className="stripe-ui__panel ui-reveal ui-reveal-2">
          <h2 className="stripe-ui__panel-title">Loading renewals</h2>
          <div className="stripe-ui__skeleton-grid" aria-label="Loading renewals">
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row stripe-ui__skeleton-row--short" />
          </div>
        </section>
      ) : null}

      {data ? (
        <section className="stripe-ui__panel ui-reveal ui-reveal-2">
          <p className="renewals__summary">
            <strong>{summary.count}</strong> contract{summary.count === 1 ? "" : "s"} renewing in the next {windowDays} days
            {" "}· <strong>{formatMoney(summary.totalArr, currency)}</strong> ARR
            {" "}· <strong className="renewals__critical-text">{summary.noRenewalCount}</strong> with no renewal deal
            {" "}(<strong className="renewals__critical-text">{formatMoney(summary.noRenewalArr, currency)}</strong> ARR)
          </p>
          {data.warnings.length ? (
            <div className="renewals__warnings">
              {data.warnings.map((warning) => <div key={warning}>{warning}</div>)}
            </div>
          ) : null}
          <div className="stripe-ui__table-wrap">
            <table className="stripe-ui__table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Contract</th>
                  <th>Renewal date</th>
                  <th>Days left</th>
                  <th>ARR ({currency})</th>
                  <th>Deployment</th>
                  <th>CSM</th>
                  <th>Deal owner</th>
                  <th>Renewal deal</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length ? visibleRows.map((row) => (
                  <tr key={row.dealId}>
                    <td>
                      {row.companyUrl ? (
                        <a href={row.companyUrl} target="_blank" rel="noreferrer" className="renewals__strong">{row.companyName}</a>
                      ) : (
                        <span className="renewals__strong">{row.companyName}</span>
                      )}
                    </td>
                    <td>
                      <a href={row.dealUrl} target="_blank" rel="noreferrer">{row.dealName}</a>
                    </td>
                    <td>{formatDate(row.renewalDate)}</td>
                    <td>{daysLeftLabel(daysBetween(data.asOf, row.renewalDate))}</td>
                    <td>
                      <span className="renewals__strong">{formatMoney(row.arr, currency)}</span>
                      {row.currency !== currency ? (
                        <div className="renewals__muted">
                          {formatMoney(row.nativeArr, row.currency)} {row.currency}
                          {row.fxFallback ? " · latest FX rate" : ""}
                          {row.fxMissing ? " · no FX rate" : ""}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {row.deployment === "Cloud" ? (
                        "Cloud"
                      ) : (
                        <>
                          <span className="renewals__status renewals__status--warning">Legacy</span>
                          <div className="renewals__muted">
                            {row.deploymentType || "No deployment type"} · sunset {formatDate(LEGACY_SUNSET_DATE)}
                          </div>
                        </>
                      )}
                    </td>
                    <td>{row.csmOwnerName || <span className="renewals__muted">No CSM assigned</span>}</td>
                    <td>{row.dealOwnerName || <span className="renewals__muted">No owner</span>}</td>
                    <td>
                      <span className={statusClass(row)}>{row.statusLabel}</span>
                      {row.statusDealUrl ? (
                        <div className="renewals__muted">
                          <a href={row.statusDealUrl} target="_blank" rel="noreferrer">{row.statusDealName || "Open deal"}</a>
                        </div>
                      ) : null}
                      {row.statusDetail ? <div className="renewals__muted">{row.statusDetail}</div> : null}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={9}>No contracts renew in the next {windowDays} days for these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data ? (
        <section className="stripe-ui__panel ui-reveal">
          <h2 className="stripe-ui__panel-title">How this list is built</h2>
          <div className="renewals__methodology">
            <p><strong>Contracts:</strong> non-archived HubSpot deals in the closed-won contract stage, using the same line-item rules as HubSpot ARR (start date, end date or start + term, annualized recurring amount; one-time lines and Desk early-access deals are excluded).</p>
            <p><strong>Renewal date:</strong> the HubSpot end date of the contract&apos;s last recurring line item, i.e. the first day the contract is no longer active. ARR sums the line items that end on that day; earlier-ending ramp or add-on lines have already lapsed.</p>
            <p><strong>ARR:</strong> converted to USD with the monthly FX rate for the deal&apos;s close month, falling back to the latest available rate for that currency. Non-USD contracts also show the native amount.</p>
            <p><strong>Deployment:</strong> only a &quot;Cloud&quot; deployment type is Cloud. Every other type (Migration, Dedicated, Self-Managed) and a blank deployment type count as Legacy, which is being sunset on {formatDate(LEGACY_SUNSET_DATE)}.</p>
            <p><strong>Renewal deal:</strong> &quot;Renewal in progress&quot; when the company has an open (not closed) Existing Business deal; the one with the earliest expected close date is shown. &quot;Renewed&quot; when another closed-won contract for the company starts within 31 days of the renewal date. Otherwise &quot;No renewal deal&quot;.</p>
            <p><strong>People:</strong> CSM is the company&apos;s CSM owner property; deal owner is the owner of the contract deal.</p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
