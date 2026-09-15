"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AccountManagementAccountRow,
  AccountManagementOwnerRow,
  AccountManagementReportResponse,
} from "@/lib/accountManagementReport";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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

function formatPct(value: number | null) {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

function movementLabel(movement: AccountManagementAccountRow["movement"]) {
  if (movement === "expanded") return "Expansion";
  if (movement === "contracted") return "Contraction";
  if (movement === "churned") return "Churn";
  if (movement === "not_in_baseline") return "No starting ARR";
  return "Retained";
}

function movementClass(movement: AccountManagementAccountRow["movement"]) {
  if (movement === "expanded") return "account-management__status account-management__status--positive";
  if (movement === "contracted" || movement === "churned") {
    return "account-management__status account-management__status--negative";
  }
  if (movement === "not_in_baseline") return "account-management__status account-management__status--neutral";
  return "account-management__status";
}

function signedMoney(value: number, currency: string) {
  const amount = formatMoney(Math.abs(value), currency);
  if (value > 0) return `+${amount}`;
  if (value < 0) return `−${amount}`;
  return amount;
}

function RetentionSummaryStats({
  metrics,
  currency,
}: {
  metrics: AccountManagementReportResponse["team"];
  currency: string;
}) {
  return (
    <div className="stripe-ui__stats account-management__stats">
      <article className="stripe-ui__stat">
        <p className="stripe-ui__stat-label">Starting CARR</p>
        <p className="stripe-ui__stat-value">{formatMoney(metrics.previousArr, currency)}</p>
      </article>
      <article className="stripe-ui__stat">
        <p className="stripe-ui__stat-label">Ending CARR</p>
        <p className="stripe-ui__stat-value">{formatMoney(metrics.currentArr, currency)}</p>
      </article>
      <article className="stripe-ui__stat">
        <p className="stripe-ui__stat-label">Net change</p>
        <p
          className="stripe-ui__stat-value"
          style={{ color: metrics.netChange < 0 ? "#b91c1c" : metrics.netChange > 0 ? "#166534" : undefined }}
        >
          {signedMoney(metrics.netChange, currency)}
        </p>
      </article>
      <article className="stripe-ui__stat">
        <p className="stripe-ui__stat-label">Expansion</p>
        <p className="stripe-ui__stat-value">{formatMoney(metrics.expansionArr, currency)}</p>
      </article>
      <article className="stripe-ui__stat">
        <p className="stripe-ui__stat-label">Contraction</p>
        <p className="stripe-ui__stat-value">{formatMoney(metrics.contractionArr, currency)}</p>
      </article>
      <article className="stripe-ui__stat">
        <p className="stripe-ui__stat-label">Churn</p>
        <p className="stripe-ui__stat-value">{formatMoney(metrics.churnArr, currency)}</p>
      </article>
    </div>
  );
}

function OwnerSection({
  owner,
  data,
}: {
  owner: AccountManagementOwnerRow;
  data: AccountManagementReportResponse;
}) {
  return (
    <section className="stripe-ui__panel account-management__owner ui-reveal">
      <div className="account-management__owner-heading">
        <div>
          <div className="stripe-ui__eyebrow">Account manager</div>
          <h2 className="stripe-ui__panel-title">{owner.ownerName}</h2>
          <p className="stripe-ui__panel-subtitle">
            {owner.baselineAccountCount} NRR cohort account{owner.baselineAccountCount === 1 ? "" : "s"} from {owner.accountCount} portfolio account{owner.accountCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="account-management__nrr">
          <span>NRR</span>
          <strong>{formatPct(owner.nrrPct)}</strong>
        </div>
      </div>

      <div className="stripe-ui__stats account-management__stats">
        <article className="stripe-ui__stat">
          <p className="stripe-ui__stat-label">{data.previousMonthLabel} CARR</p>
          <p className="stripe-ui__stat-value">{formatMoney(owner.previousArr, data.targetCurrency)}</p>
        </article>
        <article className="stripe-ui__stat">
          <p className="stripe-ui__stat-label">{data.currentMonthLabel} CARR</p>
          <p className="stripe-ui__stat-value">{formatMoney(owner.currentArr, data.targetCurrency)}</p>
        </article>
        <article className="stripe-ui__stat">
          <p className="stripe-ui__stat-label">Net change</p>
          <p className="stripe-ui__stat-value" style={{ color: owner.netChange < 0 ? "#b91c1c" : owner.netChange > 0 ? "#166534" : undefined }}>
            {signedMoney(owner.netChange, data.targetCurrency)}
          </p>
        </article>
        <article className="stripe-ui__stat">
          <p className="stripe-ui__stat-label">Expansion</p>
          <p className="stripe-ui__stat-value">{formatMoney(owner.expansionArr, data.targetCurrency)}</p>
        </article>
        <article className="stripe-ui__stat">
          <p className="stripe-ui__stat-label">Contraction + churn</p>
          <p className="stripe-ui__stat-value">
            {formatMoney(owner.contractionArr + owner.churnArr, data.targetCurrency)}
          </p>
        </article>
      </div>

      <div className="stripe-ui__table-wrap">
        <table className="stripe-ui__table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Existing Business deal(s)</th>
              <th>{data.previousMonthLabel} CARR</th>
              <th>{data.currentMonthLabel} CARR</th>
              <th>Change</th>
              <th>Account NRR</th>
              <th>Movement</th>
            </tr>
          </thead>
          <tbody>
            {owner.accounts.length ? (
              owner.accounts.map((account) => (
                <tr key={account.companyId}>
                  <td>
                    <a href={account.companyUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
                      {account.companyName}
                    </a>
                    <div className="account-management__muted">Company {account.companyId}</div>
                  </td>
                  <td>
                    <div className="account-management__deals">
                      {account.portfolioDealNames.map((dealName, index) => (
                        <a
                          href={account.portfolioDealUrls[index]}
                          target="_blank"
                          rel="noreferrer"
                          key={account.portfolioDealIds[index]}
                        >
                          {dealName}
                        </a>
                      ))}
                    </div>
                  </td>
                  <td>{formatMoney(account.previousArr, data.targetCurrency)}</td>
                  <td>{formatMoney(account.currentArr, data.targetCurrency)}</td>
                  <td style={{ color: account.netChange < 0 ? "#b91c1c" : account.netChange > 0 ? "#166534" : undefined }}>
                    {signedMoney(account.netChange, data.targetCurrency)}
                  </td>
                  <td>{formatPct(account.nrrPct)}</td>
                  <td><span className={movementClass(account.movement)}>{movementLabel(account.movement)}</span></td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>No Existing Business portfolio accounts were assigned to this manager at the snapshot.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function AccountManagementPage() {
  const initialMonth = useMemo(currentMonth, []);
  const [month, setMonth] = useState(initialMonth);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [data, setData] = useState<AccountManagementReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const autoRunDone = useRef(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/account-management", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const text = await response.text();
      const payload = text
        ? (JSON.parse(text) as AccountManagementReportResponse & { error?: string })
        : null;
      if (!response.ok) throw new Error(payload?.error || text || `HTTP ${response.status}`);
      if (!payload) throw new Error("Empty Account Management response");
      setData(payload);
      setOwnerFilter("");
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load Account Management");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    if (autoRunDone.current) return;
    autoRunDone.current = true;
    void run();
  }, [run]);

  const visibleOwners = useMemo(() => {
    if (!data) return [];
    if (!ownerFilter) return data.owners;
    return data.owners.filter((owner) => owner.ownerId === ownerFilter);
  }, [data, ownerFilter]);

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Customer revenue retention</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Account Management</h1>
            <p className="stripe-ui__subtitle">
              Monthly NRR for Chloé, Sam, and Kieran, using their prior-month Existing Business portfolio and the HubSpot CARR calculation.
            </p>
          </div>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Report month</h2>
        <p className="stripe-ui__panel-subtitle">
          The portfolio is frozen at the end of the prior month. NRR then compares that cohort&apos;s prior and selected month-end CARR.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div className="stripe-ui__field" style={{ minWidth: 220 }}>
            <label className="stripe-ui__field-label" htmlFor="account-management-month">Month</label>
            <input
              id="account-management-month"
              className="stripe-ui__control"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </div>
          <div className="stripe-ui__field" style={{ minWidth: 220 }}>
            <label className="stripe-ui__field-label" htmlFor="account-management-owner">Deal owner</label>
            <select
              id="account-management-owner"
              className="stripe-ui__control"
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
              disabled={!data?.owners.length}
            >
              <option value="">All account managers</option>
              {(data?.owners || []).map((owner) => (
                <option value={owner.ownerId} key={owner.ownerId}>{owner.ownerName}</option>
              ))}
            </select>
          </div>
          <button
            className="stripe-ui__btn stripe-ui__btn--primary"
            type="button"
            onClick={() => void run()}
            disabled={loading || !month}
          >
            {loading ? "Calculating…" : "Load NRR"}
          </button>
        </div>
        {error ? <p className="stripe-ui__error">{error}</p> : null}
      </section>

      {loading ? (
        <section className="stripe-ui__panel ui-reveal ui-reveal-2">
          <h2 className="stripe-ui__panel-title">Calculating account NRR</h2>
          <p className="stripe-ui__panel-subtitle">Loading Existing Business ownership history and month-end HubSpot CARR.</p>
          <div className="stripe-ui__skeleton-grid" aria-label="Loading Account Management report">
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row" />
            <div className="stripe-ui__skeleton-row stripe-ui__skeleton-row--short" />
          </div>
        </section>
      ) : null}

      {!loading && data ? (
        <>
          <section className="stripe-ui__panel account-management__all ui-reveal ui-reveal-2">
            <div className="account-management__owner-heading">
              <div>
                <div className="stripe-ui__eyebrow">Company-wide retention</div>
                <h2 className="stripe-ui__panel-title">{data.monthLabel} · All HubSpot deals</h2>
                <p className="stripe-ui__panel-subtitle">
                  Every owner and company in the HubSpot CARR report · {data.allHubspot.baselineAccountCount} starting compan{data.allHubspot.baselineAccountCount === 1 ? "y" : "ies"}
                </p>
              </div>
              <div className="account-management__nrr account-management__nrr--all">
                <span>All HubSpot NRR</span>
                <strong>{formatPct(data.allHubspot.nrrPct)}</strong>
              </div>
            </div>
            <RetentionSummaryStats metrics={data.allHubspot} currency={data.targetCurrency} />
          </section>

          <section className="stripe-ui__panel account-management__team ui-reveal ui-reveal-2">
            <div className="account-management__owner-heading">
              <div>
                <div className="stripe-ui__eyebrow">Account Management team retention</div>
                <h2 className="stripe-ui__panel-title">{data.monthLabel} · Chloé, Sam &amp; Kieran</h2>
                <p className="stripe-ui__panel-subtitle">
                  Owner snapshot: {data.ownerSnapshotDate} · {data.team.baselineAccountCount} starting account{data.team.baselineAccountCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="account-management__nrr account-management__nrr--team">
                <span>Team NRR</span>
                <strong>{formatPct(data.team.nrrPct)}</strong>
              </div>
            </div>
            <RetentionSummaryStats metrics={data.team} currency={data.targetCurrency} />
            {data.warnings.length ? (
              <div className="commissions-warning">
                {data.warnings.map((warning) => <div key={warning}>{warning}</div>)}
              </div>
            ) : null}
          </section>

          <section className="stripe-ui__panel account-management__outside ui-reveal">
            <div className="account-management__owner-heading">
              <div>
                <div className="stripe-ui__eyebrow">Coverage outside the AM team</div>
                <h2 className="stripe-ui__panel-title">Companies outside Chloé, Sam &amp; Kieran</h2>
                <p className="stripe-ui__panel-subtitle">
                  {data.outsideTeam.baselineAccountCount} compan{data.outsideTeam.baselineAccountCount === 1 ? "y" : "ies"} in company-wide NRR but not in the three-manager cohort · owner snapshot {data.ownerSnapshotDate}
                </p>
              </div>
              <div className="account-management__nrr account-management__nrr--outside">
                <span>Outside-team NRR</span>
                <strong>{formatPct(data.outsideTeam.nrrPct)}</strong>
              </div>
            </div>
            <RetentionSummaryStats metrics={data.outsideTeam} currency={data.targetCurrency} />
            <div className="stripe-ui__table-wrap">
              <table className="stripe-ui__table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Deal owner at snapshot</th>
                    <th>Deal(s)</th>
                    <th>{data.previousMonthLabel} CARR</th>
                    <th>{data.currentMonthLabel} CARR</th>
                    <th>Change</th>
                    <th>Account NRR</th>
                    <th>Movement</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outsideTeam.accounts.length ? data.outsideTeam.accounts.map((account) => (
                    <tr key={account.companyId}>
                      <td>
                        <a href={account.companyUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
                          {account.companyName}
                        </a>
                        <div className="account-management__muted">Company {account.companyId}</div>
                      </td>
                      <td>
                        <strong>{account.ownerName}</strong>
                        <div className="account-management__muted">{account.ownerId ? `Owner ${account.ownerId}` : "No owner at snapshot"}</div>
                      </td>
                      <td>
                        <div className="account-management__deals">
                          {account.portfolioDealIds.length ? account.portfolioDealNames.map((dealName, index) => (
                            <a
                              href={account.portfolioDealUrls[index]}
                              target="_blank"
                              rel="noreferrer"
                              key={account.portfolioDealIds[index]}
                            >
                              {dealName}
                            </a>
                          )) : "—"}
                        </div>
                      </td>
                      <td>{formatMoney(account.previousArr, data.targetCurrency)}</td>
                      <td>{formatMoney(account.currentArr, data.targetCurrency)}</td>
                      <td style={{ color: account.netChange < 0 ? "#b91c1c" : account.netChange > 0 ? "#166534" : undefined }}>
                        {signedMoney(account.netChange, data.targetCurrency)}
                      </td>
                      <td>{formatPct(account.nrrPct)}</td>
                      <td><span className={movementClass(account.movement)}>{movementLabel(account.movement)}</span></td>
                    </tr>
                  )) : (
                    <tr><td colSpan={8}>Every company in the company-wide NRR cohort is assigned to one of the three account managers.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {visibleOwners.map((owner) => <OwnerSection owner={owner} data={data} key={owner.ownerId} />)}

          <section className="stripe-ui__panel ui-reveal">
            <h2 className="stripe-ui__panel-title">Methodology</h2>
            <div className="account-management__methodology">
              <p><strong>Portfolio:</strong> {data.methodology.portfolioDealType}</p>
              <p><strong>Company-wide cohort:</strong> {data.methodology.allHubspotCohort}</p>
              <p><strong>Outside-team cohort:</strong> {data.methodology.outsideTeamCohort}</p>
              <p><strong>Ownership:</strong> {data.methodology.ownerCohort}</p>
              <p><strong>CARR:</strong> {data.methodology.carrCalculation}</p>
              <p><strong>NRR:</strong> {data.methodology.nrrFormula}</p>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
