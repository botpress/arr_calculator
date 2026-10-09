"use client";

import { useEffect, useState } from "react";

type DraftSummary = {
  dealId: string;
  dealName?: string;
  customerId: string;
  invoiceId?: string;
  lineCount?: number;
  amountMinor?: number;
  currency?: string;
};

type DraftInvoiceJobResult = {
  ok: true;
  dryRun: boolean;
  billingMonth: string;
  scannedDeals: number;
  eligibleDeals: number;
  enabled: boolean;
  guardMessage: string | null;
  createdDrafts: DraftSummary[];
  plannedDrafts: DraftSummary[];
  existingDrafts: DraftSummary[];
  skipped: Array<{ dealId: string; reason: string; detail?: string }>;
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMinorAmount(amountMinor: number | undefined, currency: string | undefined) {
  const normalizedCurrency = String(currency || "USD").toUpperCase();
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: normalizedCurrency,
  }).format((amountMinor || 0) / 100);
}

async function runDraftJob(month: string, dryRun: boolean) {
  const response = await fetch("/api/billing/monthly-draft-invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month, dryRun }),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: unknown }).error || "Request failed")
      : text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  if (!payload || typeof payload !== "object" || !("ok" in payload)) throw new Error("Invalid API response");
  return payload as DraftInvoiceJobResult;
}

export default function DraftInvoiceAdminControls() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [month, setMonth] = useState(currentMonth);
  const [loading, setLoading] = useState<"preview" | "create" | null>(null);
  const [preview, setPreview] = useState<DraftInvoiceJobResult | null>(null);
  const [result, setResult] = useState<DraftInvoiceJobResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((session: { user?: { role?: string } } | null) => {
        if (!cancelled) setIsAdmin(String(session?.user?.role || "").toLowerCase() === "admin");
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isAdmin) return null;

  async function previewDrafts() {
    setLoading("preview");
    setError(null);
    setResult(null);
    try {
      setPreview(await runDraftJob(month, true));
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Unable to preview draft invoices");
    } finally {
      setLoading(null);
    }
  }

  async function createDrafts() {
    if (!preview || preview.billingMonth !== month || preview.plannedDrafts.length === 0) return;
    const confirmed = window.confirm(
      `Create ${preview.plannedDrafts.length} Stripe draft invoice${preview.plannedDrafts.length === 1 ? "" : "s"} for ${month}? ` +
      "They will remain drafts and will not be sent or charged.",
    );
    if (!confirmed) return;

    setLoading("create");
    setError(null);
    try {
      const created = await runDraftJob(month, false);
      setResult(created);
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create draft invoices");
    } finally {
      setLoading(null);
    }
  }

  const displayed = result || preview;
  const creationCompleted = Boolean(result && !result.dryRun);
  const invoiceRows = displayed
    ? [
        ...(creationCompleted ? displayed.createdDrafts : displayed.plannedDrafts).map((draft) => ({
          ...draft,
          status: creationCompleted ? "Created" : "Will create",
        })),
        ...displayed.existingDrafts.map((draft) => ({ ...draft, status: "Already exists" })),
      ].sort((a, b) => String(a.dealName || a.dealId).localeCompare(String(b.dealName || b.dealId)))
    : [];
  const canCreate = Boolean(
    preview && preview.enabled && preview.billingMonth === month && preview.plannedDrafts.length > 0 && !loading,
  );

  return (
    <section className="stripe-ui__panel ui-reveal ui-reveal-1" aria-labelledby="draft-invoice-admin-title">
      <div className="stripe-ui__section-head">
        <div>
          <h2 id="draft-invoice-admin-title" className="stripe-ui__panel-title">Draft invoice creation</h2>
          <p className="stripe-ui__panel-subtitle" style={{ marginBottom: 0 }}>
            Admin only. Preview eligible closed-won deals first, then create Stripe drafts for the selected billing month.
            Drafts are created with auto-advance disabled, so this action does not send invoices or charge customers.
          </p>
        </div>
        <span className="stripe-ui__chip">Admin</span>
      </div>

      <div className="stripe-ui__control-grid">
        <div className="stripe-ui__field">
          <label className="stripe-ui__field-label" htmlFor="draft-invoice-month">Billing month</label>
          <input
            id="draft-invoice-month"
            className="stripe-ui__control"
            type="month"
            value={month}
            disabled={Boolean(loading)}
            onChange={(event) => {
              setMonth(event.target.value);
              setPreview(null);
              setResult(null);
              setError(null);
            }}
          />
        </div>
      </div>

      <div className="stripe-ui__actions">
        <button className="stripe-ui__btn stripe-ui__btn--secondary" disabled={!month || Boolean(loading)} onClick={() => void previewDrafts()}>
          {loading === "preview" ? "Checking deals..." : "Preview draft invoices"}
        </button>
        <button className="stripe-ui__btn stripe-ui__btn--primary" disabled={!canCreate} onClick={() => void createDrafts()}>
          {loading === "create" ? "Creating drafts..." : "Create draft invoices"}
        </button>
      </div>

      {error && <div className="stripe-ui__error" role="alert" style={{ marginTop: "0.8rem" }}>{error}</div>}
      {displayed?.guardMessage && <div className="stripe-ui__error" role="alert" style={{ marginTop: "0.8rem" }}>{displayed.guardMessage}</div>}

      {displayed && (
        <div style={{ marginTop: "0.9rem" }} aria-live="polite">
          <div className="stripe-ui__stats">
            <div className="stripe-ui__stat"><p className="stripe-ui__stat-label">Deals scanned</p><p className="stripe-ui__stat-value">{displayed.scannedDeals}</p></div>
            <div className="stripe-ui__stat"><p className="stripe-ui__stat-label">Invoices this month</p><p className="stripe-ui__stat-value">{invoiceRows.length}</p></div>
            <div className="stripe-ui__stat"><p className="stripe-ui__stat-label">To create / already exists / skipped</p><p className="stripe-ui__stat-value">{creationCompleted ? displayed.createdDrafts.length : displayed.plannedDrafts.length} / {displayed.existingDrafts.length} / {displayed.skipped.length}</p></div>
          </div>

          {invoiceRows.length > 0 && (
            <div className="stripe-ui__table-wrap stripe-ui__table-wrap--compact">
              <table className="stripe-ui__table">
                <thead><tr><th>Status</th><th>HubSpot deal</th><th>Deal ID</th><th>Stripe customer</th><th>Stripe invoice</th><th>Lines</th><th className="stripe-ui__num">Amount</th></tr></thead>
                <tbody>
                  {invoiceRows.map((invoice) => (
                    <tr key={`${invoice.dealId}:${invoice.invoiceId || "planned"}`}>
                      <td>{invoice.status}</td><td>{invoice.dealName || `Deal ${invoice.dealId}`}</td><td>{invoice.dealId}</td><td>{invoice.customerId}</td><td>{invoice.invoiceId || "—"}</td><td>{invoice.lineCount || 0}</td>
                      <td className="stripe-ui__num">{formatMinorAmount(invoice.amountMinor, invoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {invoiceRows.length === 0 && (
            <p className="stripe-ui__hint">No sales-led invoices are due for {displayed.billingMonth}.</p>
          )}
        </div>
      )}
    </section>
  );
}
