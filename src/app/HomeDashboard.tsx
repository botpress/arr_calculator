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

function formatAsOf(iso: string) {
  if (!iso) return "";
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(at);
  return `${day} · ${time}`;
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

export default function HomeDashboard() {
  const [data, setData] = useState<HomeSummaryPayload | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [showLegacyDeals, setShowLegacyDeals] = useState(false);
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const [hoveredAi, setHoveredAi] = useState<number | null>(null);

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
        <p className="home-asof">
          <span className="home-dot home-dot--ok" aria-hidden="true" />
          {formatAsOf(live.asOfUtc)}
        </p>
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
          <div className="home-legend home-legend--chart">
            {SERIES.map((s) => (
              <span key={s.key}>
                <i className={`home-legend__swatch ${s.className}`} aria-hidden="true" />
                {s.label}
              </span>
            ))}
          </div>
          <div className={`home-chart${hoveredBar !== null ? " home-chart--hovering" : ""}`} onMouseLeave={() => setHoveredBar(null)}>
            {trendBars.map((bar, index) => {
              const previous = index > 0 ? trendBars[index - 1] : null;
              const change = previous ? bar.totalArr - previous.totalArr : null;
              const align = index < trendBars.length / 2 ? "after" : "before";
              return (
                <div
                  key={bar.monthKey}
                  className={`home-chart__col${bar.isLive ? " home-chart__col--live" : ""}${hoveredBar === index ? " home-chart__col--active" : ""}`}
                  onMouseEnter={() => setHoveredBar(index)}
                  onFocus={() => setHoveredBar(index)}
                  onBlur={() => setHoveredBar(null)}
                  tabIndex={0}
                  aria-label={`${bar.isLive ? "Today" : monthLabel(bar.monthKey, true)}: ${formatMoney(bar.totalArr)}`}
                >
                  <span className="home-chart__total">{formatMoney(bar.totalArr)}</span>
                  <div
                    className="home-chart__stack"
                    style={{ height: `${(bar.totalArr / trendMax) * 100}%`, animationDelay: `${index * 35}ms` }}
                  >
                    <div className="home-swatch--legacy" style={{ flexGrow: bar.legacyArr }} />
                    <div className="home-swatch--salesled" style={{ flexGrow: bar.salesLedCloudArr }} />
                    <div className="home-swatch--selfserve" style={{ flexGrow: bar.selfServeArr }} />
                  </div>
                  <span className="home-chart__label">{bar.label}</span>
                  {hoveredBar === index && (
                    <div className={`home-tooltip home-tooltip--${align}`} role="tooltip">
                      <p className="home-tooltip__title">
                        {bar.isLive ? "Today (mid-month)" : `${monthLabel(bar.monthKey, true)} month-end`}
                      </p>
                      <p className="home-tooltip__total">{formatMoney(bar.totalArr)}</p>
                      {SERIES.map((s) => (
                        <div className="home-tooltip__row" key={s.key}>
                          <span>
                            <i className={`home-legend__swatch ${s.className}`} aria-hidden="true" />
                            {s.label}
                          </span>
                          <span className="home-num">
                            {formatMoney(bar[s.key])}
                            <span className="home-tooltip__share">
                              {bar.totalArr > 0 ? Math.round((bar[s.key] / bar.totalArr) * 100) : 0}%
                            </span>
                          </span>
                        </div>
                      ))}
                      {change !== null && previous && (
                        <p className={`home-tooltip__change ${change >= 0 ? "home-good" : "home-bad"}`}>
                          {formatSignedMoney(change)} vs {previous.isLive ? "today" : monthLabel(previous.monthKey)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="home-label home-label--spaced">AI spend billed per month (not in ARR)</p>
          <div className={`home-chart home-chart--short${hoveredAi !== null ? " home-chart--hovering" : ""}`} onMouseLeave={() => setHoveredAi(null)}>
            {data.aiSpend.monthly.map((m, index, all) => {
              const previous = index > 0 ? all[index - 1] : null;
              const change = previous ? m.billed - previous.billed : null;
              const align = index < all.length / 2 ? "after" : "before";
              return (
                <div
                  key={m.monthKey}
                  className={`home-chart__col${hoveredAi === index ? " home-chart__col--active" : ""}`}
                  onMouseEnter={() => setHoveredAi(index)}
                  onFocus={() => setHoveredAi(index)}
                  onBlur={() => setHoveredAi(null)}
                  tabIndex={0}
                  aria-label={`${monthLabel(m.monthKey, true)}: ${formatMoney(m.billed)} billed`}
                >
                  <span className="home-chart__total">{formatMoney(m.billed)}</span>
                  <div
                    className="home-chart__stack"
                    style={{ height: `${(m.billed / aiMax) * 100}%`, animationDelay: `${index * 35}ms` }}
                  >
                    <div className="home-swatch--ai" style={{ flexGrow: 1 }} />
                  </div>
                  <span className="home-chart__label">{monthLabel(m.monthKey)}</span>
                  {hoveredAi === index && (
                    <div className={`home-tooltip home-tooltip--${align}`} role="tooltip">
                      <p className="home-tooltip__title">{monthLabel(m.monthKey, true)} AI spend</p>
                      <p className="home-tooltip__total">{formatMoney(m.billed)} billed</p>
                      <p className="home-tooltip__row">
                        <span>Annualized</span>
                        <span className="home-num">{formatMoney(m.billed * 12)}/yr</span>
                      </p>
                      {change !== null && previous && (
                        <p className={`home-tooltip__change ${change >= 0 ? "home-good" : "home-bad"}`}>
                          {formatSignedMoney(change)} vs {monthLabel(previous.monthKey)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
