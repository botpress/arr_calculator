"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type QuickBooksStatus = {
  connected: boolean;
  storage: "vercel_blob" | "local_tmp";
  realmId?: string;
  realmIds?: string[];
  scope?: string;
  accessTokenExpiresAt?: number;
  refreshTokenExpiresAt?: number;
  updatedAt?: number;
  statusError?: string;
  needsReconnect?: boolean;
};

function formatEpoch(epochMs?: number) {
  if (!epochMs || !Number.isFinite(epochMs)) return "n/a";
  return new Date(epochMs).toLocaleString();
}

export default function QuickBooksPage() {
  const [status, setStatus] = useState<QuickBooksStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [companyInfo, setCompanyInfo] = useState<unknown>(null);
  const [queryText, setQueryText] = useState("SELECT * FROM Customer MAXRESULTS 10");
  const [queryResult, setQueryResult] = useState<unknown>(null);
  const [oauthFlowStatus, setOauthFlowStatus] = useState("");
  const [oauthFlowReason, setOauthFlowReason] = useState("");
  const [oauthFlowRealmId, setOauthFlowRealmId] = useState("");
  const [oauthFlowExpectedRealmId, setOauthFlowExpectedRealmId] = useState("");

  const oauthBanner = useMemo(() => {
    if (oauthFlowStatus === "connected") {
      return {
        kind: "success" as const,
        text: oauthFlowRealmId
          ? `QuickBooks connected successfully. Realm ID: ${oauthFlowRealmId}`
          : "QuickBooks connected successfully.",
      };
    }
    if (oauthFlowStatus === "error") {
      return { kind: "error" as const, text: oauthFlowReason || "QuickBooks OAuth failed." };
    }
    return null;
  }, [oauthFlowRealmId, oauthFlowReason, oauthFlowStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOauthFlowStatus(String(params.get("status") || ""));
    setOauthFlowReason(String(params.get("reason") || ""));
    setOauthFlowRealmId(String(params.get("realmId") || ""));
    setOauthFlowExpectedRealmId(String(params.get("expectedRealmId") || ""));
  }, []);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setError("");
    try {
      const res = await fetch("/api/quickbooks/status", { cache: "no-store" });
      const payload = (await res.json()) as QuickBooksStatus & { error?: string };
      if (!res.ok) throw new Error(payload.error || `Status request failed (${res.status})`);
      setStatus(payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  async function loadCompanyInfo() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/quickbooks/company-info", { method: "GET", cache: "no-store" });
      const payload = (await res.json()) as { error?: string; companyInfo?: unknown; raw?: unknown };
      if (!res.ok) throw new Error(payload.error || `Company info request failed (${res.status})`);
      setCompanyInfo(payload.companyInfo || payload.raw || payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function runQuery() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/quickbooks/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queryText }),
      });
      const payload = (await res.json()) as { error?: string; queryResponse?: unknown; raw?: unknown };
      if (!res.ok) throw new Error(payload.error || `Query request failed (${res.status})`);
      setQueryResult(payload.queryResponse || payload.raw || payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/quickbooks/disconnect", { method: "POST" });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || `Disconnect failed (${res.status})`);
      setCompanyInfo(null);
      setQueryResult(null);
      await refreshStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stripe-ui">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Finance integrations</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">QuickBooks Connection</h1>
            <p className="stripe-ui__subtitle">
              Connect your Intuit app, store OAuth tokens securely, and fetch live company data from QuickBooks.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <a href="/api/quickbooks/connect?mode=ensure_required" className="stripe-ui__hero-link">
              Connect QuickBooks
            </a>
            <Link href="/eula" className="stripe-ui__hero-link">
              EULA
            </Link>
            <Link href="/privacy-policy" className="stripe-ui__hero-link">
              Privacy Policy
            </Link>
          </div>
        </div>
      </section>

      {oauthBanner ? (
        <section
          className="stripe-ui__panel ui-reveal ui-reveal-1"
          style={{
            borderColor: oauthBanner.kind === "error" ? "#a53555" : "#2e6d4d",
            background: oauthBanner.kind === "error" ? "#25101b" : "#0f2419",
          }}
        >
          <p className="stripe-ui__panel-subtitle" style={{ margin: 0, color: "#dbe8ff" }}>
            {oauthBanner.text}
          </p>
          {oauthBanner.kind === "error" && oauthFlowExpectedRealmId ? (
            <div className="stripe-ui__actions" style={{ marginTop: "0.7rem" }}>
              <a
                href={`/api/quickbooks/connect?mode=ensure_required&targetRealmId=${encodeURIComponent(
                  oauthFlowExpectedRealmId,
                )}`}
                className="stripe-ui__btn stripe-ui__btn--secondary"
              >
                Connect missing realm {oauthFlowExpectedRealmId}
              </a>
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div className="stripe-ui__error ui-reveal ui-reveal-1" role="alert" aria-live="assertive">
          <strong>Request failed.</strong> {error}
        </div>
      ) : null}

      {status?.statusError ? (
        <div className="stripe-ui__error ui-reveal ui-reveal-1" role="alert" aria-live="polite">
          <strong>{status.needsReconnect ? "Reconnect required." : "Token refresh warning."}</strong>{" "}
          {status.statusError}
        </div>
      ) : null}

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Connection status</h2>
        <p className="stripe-ui__panel-subtitle">Use Connect once, then pull company data and run queries.</p>

        <div className="stripe-ui__stats">
          <div className="stripe-ui__stat">
            <p className="stripe-ui__stat-label">Connected</p>
            <p className="stripe-ui__stat-value">{status?.connected ? "Yes" : "No"}</p>
          </div>
          <div className="stripe-ui__stat">
            <p className="stripe-ui__stat-label">Realm ID</p>
            <p className="stripe-ui__stat-value">{status?.realmId || "n/a"}</p>
          </div>
          <div className="stripe-ui__stat">
            <p className="stripe-ui__stat-label">Connected companies</p>
            <p className="stripe-ui__stat-value">{status?.realmIds?.length || 0}</p>
          </div>
          <div className="stripe-ui__stat">
            <p className="stripe-ui__stat-label">Storage</p>
            <p className="stripe-ui__stat-value">{status?.storage || "n/a"}</p>
          </div>
          <div className="stripe-ui__stat">
            <p className="stripe-ui__stat-label">Access token expires</p>
            <p className="stripe-ui__stat-value">{formatEpoch(status?.accessTokenExpiresAt)}</p>
          </div>
        </div>

        <p className="stripe-ui__hint" style={{ marginTop: "0.8rem" }}>
          Refresh token expires: {formatEpoch(status?.refreshTokenExpiresAt)} | Last update: {formatEpoch(status?.updatedAt)}
        </p>
        {status?.realmIds?.length ? (
          <p className="stripe-ui__hint" style={{ marginTop: "0.3rem" }}>
            Realm IDs: {status.realmIds.join(", ")}
          </p>
        ) : null}

        <div className="stripe-ui__actions">
          <a href="/api/quickbooks/connect?mode=ensure_required" className="stripe-ui__btn stripe-ui__btn--primary">
            Connect / Reconnect (Both)
          </a>
          <button
            className="stripe-ui__btn stripe-ui__btn--secondary"
            onClick={() => void refreshStatus()}
            disabled={statusLoading || busy}
          >
            {statusLoading ? "Refreshing..." : "Refresh status"}
          </button>
          <button className="stripe-ui__btn stripe-ui__btn--ghost" onClick={() => void disconnect()} disabled={busy}>
            Disconnect
          </button>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-2">
        <div className="stripe-ui__section-head">
          <div>
            <h2 className="stripe-ui__panel-title">Company info</h2>
            <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
              Calls `GET /api/quickbooks/company-info` and returns your CompanyInfo object.
            </p>
          </div>
        </div>

        <div className="stripe-ui__actions">
          <button
            className="stripe-ui__btn stripe-ui__btn--primary"
            onClick={() => void loadCompanyInfo()}
            disabled={!status?.connected || busy}
          >
            Load company info
          </button>
        </div>

        {companyInfo ? (
          <div className="stripe-ui__table-wrap stripe-ui__table-wrap--comfortable" style={{ marginTop: "0.9rem" }}>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "420px",
                overflow: "auto",
              }}
            >
              {JSON.stringify(companyInfo, null, 2)}
            </pre>
          </div>
        ) : (
          <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.8rem", marginBottom: 0 }}>
            No company info loaded yet.
          </p>
        )}
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-3">
        <h2 className="stripe-ui__panel-title">Run QuickBooks query</h2>
        <p className="stripe-ui__panel-subtitle">
          Execute SQL-like QuickBooks queries through `POST /api/quickbooks/query`.
        </p>

        <div className="stripe-ui__field">
          <label className="stripe-ui__field-label" htmlFor="qb-query">
            Query
          </label>
          <textarea
            id="qb-query"
            className="stripe-ui__control"
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            rows={5}
            style={{ resize: "vertical", minHeight: "6.5rem" }}
          />
        </div>

        <div className="stripe-ui__actions">
          <button className="stripe-ui__btn stripe-ui__btn--primary" onClick={() => void runQuery()} disabled={!status?.connected || busy}>
            Run query
          </button>
        </div>

        {queryResult ? (
          <div className="stripe-ui__table-wrap stripe-ui__table-wrap--comfortable" style={{ marginTop: "0.9rem" }}>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "460px",
                overflow: "auto",
              }}
            >
              {JSON.stringify(queryResult, null, 2)}
            </pre>
          </div>
        ) : (
          <p className="stripe-ui__panel-subtitle" style={{ marginTop: "0.8rem", marginBottom: 0 }}>
            No query response loaded yet.
          </p>
        )}
      </section>
    </div>
  );
}
