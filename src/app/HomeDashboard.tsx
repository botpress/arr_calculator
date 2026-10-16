"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HomeSummaryPayload } from "@/lib/homeSummary";
import "./home.css";

const SERIES = [
  { key: "selfServeArr", label: "Self-serve", className: "home-swatch--selfserve" },
  { key: "salesLedCloudArr", label: "Sales-led Cloud", className: "home-swatch--salesled" },
  { key: "legacyArr", label: "Legacy (ends Dec 31)", className: "home-swatch--legacy" },
] as const;

function formatMoney(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000).toLocaleString("en-US")}k`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatSignedMoney(value: number) {
  return `${value >= 0 ? "+" : "−"}${formatMoney(Math.abs(value))}`;
}

function monthLabel(monthKey: string, withYear = false) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 15)));
}

function formatDateTime(iso: string) {
  if (!iso) return "unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatDate(isoDate: string) {
  if (!isoDate) return "unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${isoDate}T12:00:00.000Z`),
  );
}

function daysUntil(isoDate: string) {
  const target = Date.parse(`${isoDate}T23:59:59.000Z`);
  return Math.max(0, Math.ceil((target - Date.now()) / 86_400_000));
}

function daysSince(isoDate: string) {
  const at = Date.parse(isoDate.length === 10 ? `${isoDate}T00:00:00.000Z` : isoDate);
  if (!Number.isFinite(at)) return Infinity;
  return (Date.now() - at) / 86_400_000;
}

export default function HomeDashboard() {
  const [data, setData] = useState<HomeSummaryPayload | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [showLegacyDeals, setShowLegacyDeals] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    setError("");
    try {
      const res = await fetch(`/api/home-summary${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const payload = (await res.json()) as HomeSummaryPayload & { error?: string };
      if (!res.ok || payload.error) throw new Error(payload.error || `Request failed (${res.status})`);
      setData(payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't load the dashboard.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const syncHealthy = useMemo(() => {
    const sync = data?.lastNightlySync;
    if (!sync) return false;
    return sync.failedTaskCount === 0 && daysSince(sync.finishedAtUtc) < 1.5;
  }, [data]);

  const aiMax = useMemo(() => Math.max(1, ...(data?.aiSpend.monthly || []).map((m) => m.billed)), [data]);

  const trendMax = useMemo(() => {
    const totals = (data?.trend || []).map((p) => p.totalArr);
    if (data) totals.push(data.live.totalArr);
    return Math.max(1, ...totals);
  }, [data]);

  if (error && !data) {
    return (
      <main className="home">
        <p className="home-error">{error}</p>
        <button type="button" className="home-button" onClick={() => void load(true)}>
          Try again
        </button>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="home">
        <p className="home-muted">Loading ARR…</p>
      </main>
    );
  }

  const { live, aiSpend, lastMonthChange } = data;
  const share = (value: number) => `${live.totalArr > 0 ? (value / live.totalArr) * 100 : 0}%`;
  const legacyDealCount = live.legacyByDeploymentType.reduce((sum, entry) => sum + entry.dealCount, 0);
  const trendBars = [
    ...data.trend.map((p) => ({ ...p, label: monthLabel(p.monthKey), isLive: false })),
    {
      monthKey: "today",
      label: "Today",
      isLive: true,
      selfServeArr: live.selfServeArr,
      salesLedCloudArr: live.salesLedCloudArr,
      legacyArr: live.legacyArr,
      totalArr: live.totalArr,
    },
  ];

  return (
    <main className="home">
      <div className="home-status">
        <span className={`home-dot ${syncHealthy ? "home-dot--ok" : "home-dot--warn"}`} aria-hidden="true" />
        <span>
          Live figures as of {formatDateTime(live.asOfUtc)}
          {data.lastNightlySync
            ? syncHealthy
              ? " · nightly refresh OK"
              : ` · nightly refresh ${data.lastNightlySync.failedTaskCount ? `had ${data.lastNightlySync.failedTaskCount} failed steps` : "is late"} (last ${formatDateTime(data.lastNightlySync.finishedAtUtc)})`
            : " · nightly refresh status unknown"}
        </span>
        <button type="button" className="home-button" onClick={() => void load(true)} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {error && <p className="home-error">{error}</p>}

      <section className="home-card home-hero">
        <p className="home-label">Total ARR</p>
        <div className="home-hero__value">
          <span className="home-hero__number">{formatMoney(live.totalArr)}</span>
          {lastMonthChange && (
            <span
              className={lastMonthChange.change >= 0 ? "home-good" : "home-bad"}
              title="Change between the last two completed month-ends. Today's figure isn't compared: Stripe cancellations take effect on the 1st, so mid-month totals run lower than month-ends."
            >
              {formatSignedMoney(lastMonthChange.change)} in {monthLabel(lastMonthChange.monthKey)} (month-end vs{" "}
              {monthLabel(lastMonthChange.previousMonthKey)})
            </span>
          )}
        </div>
        <div className="home-split" role="img" aria-label="Total ARR split by self-serve, sales-led Cloud and Legacy">
          <div className="home-swatch--selfserve" style={{ width: share(live.selfServeArr) }} />
          <div className="home-swatch--salesled" style={{ width: share(live.salesLedCloudArr) }} />
          <div className="home-swatch--legacy" style={{ width: share(live.legacyArr) }} />
        </div>
        <div className="home-legend">
          {SERIES.map((s) => (
            <span key={s.key}>
              <i className={`home-legend__swatch ${s.className}`} aria-hidden="true" />
              {s.label} {formatMoney(live[s.key])}
            </span>
          ))}
        </div>
      </section>

      <section className="home-tiles">
        <div className="home-tile" title="Self-serve (Stripe) plus sales-led Cloud contracts (HubSpot). This is what remains after legacy contracts end.">
          <p className="home-label">Cloud ARR</p>
          <p className="home-tile__value">{formatMoney(live.cloudArr)}</p>
          <p className="home-muted">Stays after Dec 31</p>
        </div>
        <div className="home-tile" title="HubSpot contracts whose deployment type isn't Cloud (including blank).">
          <p className="home-label">Legacy ARR</p>
          <p className="home-tile__value">{formatMoney(live.legacyArr)}</p>
          <p className="home-muted">
            {legacyDealCount} deals · ends {formatDate(data.legacySunsetDate)}
          </p>
        </div>
        <div className="home-tile" title="Usage billing (AI tokens, web search) invoiced last month, after prepaid offsets. Not part of ARR.">
          <p className="home-label">AI spend (not in ARR)</p>
          <p className="home-tile__value">{formatMoney(aiSpend.annualized)}/yr</p>
          <p className="home-muted">
            {formatMoney(aiSpend.lastMonthBilled)} billed in {aiSpend.lastMonthKey ? monthLabel(aiSpend.lastMonthKey) : "last month"} × 12
          </p>
        </div>
      </section>

      <div className="home-columns">
        <section className="home-card">
          <p className="home-label">ARR by month-end</p>
          <div className="home-chart">
            {trendBars.map((bar) => (
              <div
                key={bar.monthKey}
                className={`home-chart__col${bar.isLive ? " home-chart__col--live" : ""}`}
                title={`${bar.isLive ? "Today" : monthLabel(bar.monthKey, true)}: ${formatMoney(bar.totalArr)} (self-serve ${formatMoney(bar.selfServeArr)}, sales-led Cloud ${formatMoney(bar.salesLedCloudArr)}, legacy ${formatMoney(bar.legacyArr)})`}
              >
                <span className="home-chart__total">{formatMoney(bar.totalArr)}</span>
                <div className="home-chart__stack" style={{ height: `${(bar.totalArr / trendMax) * 100}%` }}>
                  <div className="home-swatch--legacy" style={{ flexGrow: bar.legacyArr }} />
                  <div className="home-swatch--salesled" style={{ flexGrow: bar.salesLedCloudArr }} />
                  <div className="home-swatch--selfserve" style={{ flexGrow: bar.selfServeArr }} />
                </div>
                <span className="home-chart__label">{bar.label}</span>
              </div>
            ))}
          </div>
          <p className="home-label home-label--spaced">AI spend billed per month (not in ARR)</p>
          <div className="home-chart home-chart--short">
            {data.aiSpend.monthly.map((m) => (
              <div key={m.monthKey} className="home-chart__col" title={`${monthLabel(m.monthKey, true)}: ${formatMoney(m.billed)} billed`}>
                <span className="home-chart__total">{formatMoney(m.billed)}</span>
                <div className="home-chart__stack" style={{ height: `${(m.billed / aiMax) * 100}%` }}>
                  <div className="home-swatch--ai" style={{ flexGrow: 1 }} />
                </div>
                <span className="home-chart__label">{monthLabel(m.monthKey)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="home-card">
          <p className="home-label">Legacy sunset</p>
          <p className="home-tile__value">
            {formatMoney(live.legacyArr)} ends {formatDate(data.legacySunsetDate)}
          </p>
          <p className="home-muted">{daysUntil(data.legacySunsetDate)} days left</p>
          <table className="home-table">
            <tbody>
              {live.legacyByDeploymentType.map((entry) => (
                <tr key={entry.deploymentType}>
                  <td>{entry.deploymentType}</td>
                  <td className="home-num">{entry.dealCount}</td>
                  <td className="home-num">{formatMoney(entry.arr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="home-link" onClick={() => setShowLegacyDeals((v) => !v)}>
            {showLegacyDeals ? "Hide deals" : "Show deals"}
          </button>
          {showLegacyDeals && (
            <table className="home-table">
              <tbody>
                {live.legacyDeals.map((deal) => (
                  <tr key={deal.dealId}>
                    <td>{deal.accountName || deal.dealName}</td>
                    <td>{deal.deploymentType}</td>
                    <td className="home-num">{formatMoney(deal.arr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
