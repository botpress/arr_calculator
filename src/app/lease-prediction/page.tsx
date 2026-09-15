"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type LeasePredictionTerms = {
  leaseStartDate: string;
  leaseEndDate: string;
  monthlyExpense: number;
  annualEscalationPct: number;
  confidence: number;
  summary: string;
  extractionSource: "heuristic_pdf" | "manual";
};

type LeaseDocument = {
  id: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  uploadedAtUtc: string;
  updatedAtUtc: string;
  uploadedByEmail: string;
  filePath: string;
  extractedTextPreview: string;
  terms: LeasePredictionTerms;
};

type DocumentsResponse = {
  ok: boolean;
  error?: string;
  documents?: LeaseDocument[];
};

type TermsEdit = {
  leaseStartDate: string;
  leaseEndDate: string;
  monthlyExpense: string;
  annualEscalationPct: string;
  confidence: string;
  summary: string;
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function defaultDateRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: todayIsoDate(),
  };
}

function parseIsoDate(value: string) {
  const trimmed = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
  return dt;
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function monthStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function monthEnd(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0));
}

function addMonths(value: Date, months: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}

function fullYearsElapsed(leaseStart: Date, periodStart: Date) {
  let years = periodStart.getUTCFullYear() - leaseStart.getUTCFullYear();
  const periodMonth = periodStart.getUTCMonth();
  const periodDay = periodStart.getUTCDate();
  const leaseMonth = leaseStart.getUTCMonth();
  const leaseDay = leaseStart.getUTCDate();
  if (periodMonth < leaseMonth || (periodMonth === leaseMonth && periodDay < leaseDay)) {
    years -= 1;
  }
  return Math.max(0, years);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatDateTime(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}

function formatBytes(value: number) {
  const size = Math.max(0, Number(value || 0));
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function toTermsEdit(doc: LeaseDocument): TermsEdit {
  return {
    leaseStartDate: doc.terms.leaseStartDate || "",
    leaseEndDate: doc.terms.leaseEndDate || "",
    monthlyExpense: String(doc.terms.monthlyExpense || 0),
    annualEscalationPct: String(doc.terms.annualEscalationPct || 0),
    confidence: String(doc.terms.confidence || 0),
    summary: doc.terms.summary || "",
  };
}

async function readJsonResponse<T>(res: Response): Promise<{ json: T | null; text: string }> {
  const text = await res.text();
  try {
    return { json: text ? (JSON.parse(text) as T) : null, text };
  } catch {
    return { json: null, text };
  }
}

export default function LeasePredictionPage() {
  const defaults = useMemo(() => defaultDateRange(), []);
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);

  const [documents, setDocuments] = useState<LeaseDocument[]>([]);
  const [edits, setEdits] = useState<Record<string, TermsEdit>>({});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/lease-prediction/documents", { cache: "no-store" });
      const { json } = await readJsonResponse<DocumentsResponse>(res);
      const payload = json || { ok: false, error: `HTTP ${res.status}` };
      if (!res.ok || !payload.ok) throw new Error(payload.error || `HTTP ${res.status}`);
      const docs = Array.isArray(payload.documents) ? payload.documents : [];
      setDocuments(docs);
      const nextEdits: Record<string, TermsEdit> = {};
      for (const doc of docs) nextEdits[doc.id] = toTermsEdit(doc);
      setEdits(nextEdits);

      if (docs.length > 0 && (!startDate || !endDate)) {
        const allDates = docs
          .flatMap((doc) => [doc.terms.leaseStartDate, doc.terms.leaseEndDate])
          .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
          .sort();
        if (allDates.length) {
          setStartDate(allDates[0]);
          setEndDate(allDates[allDates.length - 1]);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const onUpload = useCallback(async () => {
    if (!selectedFile) return;
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const res = await fetch("/api/lease-prediction/documents", {
        method: "POST",
        body: formData,
      });
      const { json, text } = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      const payload = json;
      if (!res.ok || !payload?.ok) {
        const plain = String(text || "").trim();
        if (res.status === 413 || /request entity too large/i.test(plain)) {
          throw new Error("Uploaded PDF is too large. Please upload a smaller file.");
        }
        throw new Error(payload?.error || plain || `HTTP ${res.status}`);
      }
      setSelectedFile(null);
      setMessage("Lease uploaded and parsed.");
      await loadDocuments();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [loadDocuments, selectedFile]);

  const onSave = useCallback(
    async (documentId: string) => {
      const edit = edits[documentId];
      if (!edit) return;
      setSavingId(documentId);
      setError("");
      setMessage("");
      try {
        const res = await fetch(`/api/lease-prediction/documents/${encodeURIComponent(documentId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leaseStartDate: edit.leaseStartDate,
            leaseEndDate: edit.leaseEndDate,
            monthlyExpense: Number(edit.monthlyExpense || 0),
            annualEscalationPct: Number(edit.annualEscalationPct || 0),
            confidence: Number(edit.confidence || 0),
            summary: edit.summary,
          }),
        });
        const { json, text } = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
        const payload = json;
        if (!res.ok || !payload?.ok) throw new Error(payload?.error || text || `HTTP ${res.status}`);
        setMessage("Lease terms saved.");
        await loadDocuments();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSavingId("");
      }
    },
    [edits, loadDocuments],
  );

  const onDelete = useCallback(
    async (documentId: string) => {
      if (!window.confirm("Delete this lease document permanently?")) return;
      setDeletingId(documentId);
      setError("");
      setMessage("");
      try {
        const res = await fetch(`/api/lease-prediction/documents/${encodeURIComponent(documentId)}`, {
          method: "DELETE",
        });
        const { json, text } = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
        const payload = json;
        if (!res.ok || !payload?.ok) throw new Error(payload?.error || text || `HTTP ${res.status}`);
        setMessage("Lease deleted.");
        await loadDocuments();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Delete failed");
      } finally {
        setDeletingId("");
      }
    },
    [loadDocuments],
  );

  const docsForCalc = useMemo(() => {
    return documents.map((doc) => {
      const edit = edits[doc.id] || toTermsEdit(doc);
      return {
        ...doc,
        terms: {
          ...doc.terms,
          leaseStartDate: String(edit.leaseStartDate || "").trim(),
          leaseEndDate: String(edit.leaseEndDate || "").trim(),
          monthlyExpense: Math.max(0, Number(edit.monthlyExpense || 0)),
          annualEscalationPct: Math.max(0, Number(edit.annualEscalationPct || 0)),
          confidence: Math.max(0, Math.min(1, Number(edit.confidence || 0))),
          summary: String(edit.summary || "").trim(),
          extractionSource: doc.terms.extractionSource,
        },
      };
    });
  }, [documents, edits]);

  const monthlyTotals = useMemo(() => {
    const start = parseIsoDate(startDate);
    const end = parseIsoDate(endDate);
    if (!start || !end || end.getTime() < start.getTime()) return [] as Array<{ monthKey: string; monthLabel: string; total: number; activeCount: number }>;

    const rangeMonthStart = monthStart(start);
    const rangeMonthEnd = monthStart(end);
    const rows: Array<{ monthKey: string; monthLabel: string; total: number; activeCount: number }> = [];

    for (let cursor = new Date(rangeMonthStart); cursor.getTime() <= rangeMonthEnd.getTime(); cursor = addMonths(cursor, 1)) {
      const bucketStart = monthStart(cursor);
      const bucketEnd = monthEnd(cursor);
      let total = 0;
      let activeCount = 0;

      for (const doc of docsForCalc) {
        const leaseStart = parseIsoDate(doc.terms.leaseStartDate);
        const leaseEnd = parseIsoDate(doc.terms.leaseEndDate);
        const monthlyExpense = Number(doc.terms.monthlyExpense || 0);
        if (!leaseStart || !leaseEnd || leaseEnd.getTime() < leaseStart.getTime() || monthlyExpense <= 0) continue;

        const activeStartMs = Math.max(bucketStart.getTime(), leaseStart.getTime());
        const activeEndMs = Math.min(bucketEnd.getTime(), leaseEnd.getTime());
        if (activeEndMs < activeStartMs) continue;

        const activeStart = new Date(activeStartMs);
        const activeEnd = new Date(activeEndMs);
        const daysInMonth = bucketEnd.getUTCDate();
        const activeDays = Math.floor((activeEnd.getTime() - activeStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;
        const escalationYears = fullYearsElapsed(leaseStart, bucketStart);
        const escalationFactor = Math.pow(1 + Math.max(0, Number(doc.terms.annualEscalationPct || 0)) / 100, escalationYears);
        const prorated = monthlyExpense * escalationFactor * (activeDays / Math.max(1, daysInMonth));
        total += prorated;
        activeCount += 1;
      }

      const monthKey = toIsoDate(bucketStart).slice(0, 7);
      const monthLabel = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(bucketStart);
      rows.push({ monthKey, monthLabel, total: Number(total.toFixed(2)), activeCount });
    }

    return rows;
  }, [docsForCalc, endDate, startDate]);

  const rangeTotal = useMemo(
    () => monthlyTotals.reduce((sum, row) => sum + Number(row.total || 0), 0),
    [monthlyTotals],
  );

  return (
    <main className="stripe-ui">
      <header className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Admin</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Lease Prediction</h1>
            <p className="stripe-ui__subtitle">
              Upload lease PDFs, review/edit extracted lease terms, and compute monthly lease expense totals across a selected date range.
              Uploaded files persist until you delete them.
            </p>
          </div>
        </div>
      </header>

      <section className="stripe-ui__panel ui-reveal ui-reveal-1">
        <h2 className="stripe-ui__panel-title">Upload Lease PDF</h2>
        <p className="stripe-ui__panel-subtitle">PDFs are stored and listed on this page until deleted.</p>
        <div className="stripe-ui__control-grid">
          <div className="stripe-ui__field" style={{ gridColumn: "span 4" }}>
            <label className="stripe-ui__field-label" htmlFor="lease-upload-file">PDF file</label>
            <input
              id="lease-upload-file"
              className="stripe-ui__control"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />
          </div>
          <div className="stripe-ui__field" style={{ gridColumn: "span 2", justifyContent: "flex-end" }}>
            <label className="stripe-ui__field-label">Action</label>
            <button
              className="stripe-ui__btn stripe-ui__btn--primary"
              type="button"
              onClick={() => void onUpload()}
              disabled={uploading || !selectedFile}
            >
              {uploading ? "Uploading..." : "Upload & parse"}
            </button>
          </div>
        </div>
        {selectedFile ? (
          <div className="stripe-ui__hint" style={{ marginTop: 8 }}>
            Selected: {selectedFile.name} ({formatBytes(selectedFile.size)})
          </div>
        ) : null}
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-2">
        <h2 className="stripe-ui__panel-title">Monthly Lease Totals</h2>
        <p className="stripe-ui__panel-subtitle">Totals are prorated for partial months and include per-lease annual escalation.</p>
        <div className="stripe-ui__control-grid" style={{ gridTemplateColumns: "repeat(4, minmax(150px, 1fr))" }}>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="lease-range-start">Start date</label>
            <input
              id="lease-range-start"
              className="stripe-ui__control"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label" htmlFor="lease-range-end">End date</label>
            <input
              id="lease-range-end"
              className="stripe-ui__control"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label">Months</label>
            <div className="stripe-ui__control">{monthlyTotals.length}</div>
          </div>
          <div className="stripe-ui__field">
            <label className="stripe-ui__field-label">Range total</label>
            <div className="stripe-ui__control">{formatMoney(rangeTotal)}</div>
          </div>
        </div>

        <div className="stripe-ui__table-wrap" style={{ marginTop: 12 }}>
          <table className="stripe-ui__table" aria-label="Monthly lease totals">
            <thead>
              <tr>
                <th>Month</th>
                <th className="stripe-ui__num">Active leases</th>
                <th className="stripe-ui__num">Total lease expense</th>
              </tr>
            </thead>
            <tbody>
              {monthlyTotals.length === 0 ? (
                <tr>
                  <td colSpan={3}>No monthly totals available for this range.</td>
                </tr>
              ) : (
                monthlyTotals.map((row) => (
                  <tr key={row.monthKey}>
                    <td>{row.monthLabel}</td>
                    <td className="stripe-ui__num">{row.activeCount}</td>
                    <td className="stripe-ui__num">{formatMoney(row.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stripe-ui__panel ui-reveal ui-reveal-3">
        <h2 className="stripe-ui__panel-title">Lease Documents</h2>
        <p className="stripe-ui__panel-subtitle">
          AI-assisted extraction is heuristic. Review and edit terms before relying on totals.
        </p>

        {loading ? <div className="stripe-ui__loading-panel">Loading documents...</div> : null}

        {!loading && documents.length === 0 ? (
          <div className="stripe-ui__hint">No lease documents uploaded yet.</div>
        ) : null}

        {!loading && documents.length > 0 ? (
          <div className="stripe-ui__table-wrap">
            <table className="stripe-ui__table" aria-label="Lease documents">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Uploaded</th>
                  <th>Start</th>
                  <th>End</th>
                  <th className="stripe-ui__num">Monthly</th>
                  <th className="stripe-ui__num">Escalation %</th>
                  <th className="stripe-ui__num">Confidence</th>
                  <th>Summary</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const edit = edits[doc.id] || toTermsEdit(doc);
                  return (
                    <tr key={doc.id}>
                      <td>
                        <div style={{ display: "grid", gap: 4 }}>
                          <a
                            href={`/api/lease-prediction/documents/${encodeURIComponent(doc.id)}/file`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {doc.fileName}
                          </a>
                          <span className="stripe-ui__hint">{formatBytes(doc.fileSizeBytes)}</span>
                          <span className="stripe-ui__hint">{doc.terms.extractionSource === "manual" ? "Manual" : "AI/heuristic"}</span>
                        </div>
                      </td>
                      <td>{formatDateTime(doc.uploadedAtUtc)}</td>
                      <td>
                        <input
                          className="stripe-ui__control"
                          type="date"
                          value={edit.leaseStartDate}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [doc.id]: { ...edit, leaseStartDate: e.target.value },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="stripe-ui__control"
                          type="date"
                          value={edit.leaseEndDate}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [doc.id]: { ...edit, leaseEndDate: e.target.value },
                            }))
                          }
                        />
                      </td>
                      <td className="stripe-ui__num">
                        <input
                          className="stripe-ui__control"
                          type="number"
                          min={0}
                          step="0.01"
                          value={edit.monthlyExpense}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [doc.id]: { ...edit, monthlyExpense: e.target.value },
                            }))
                          }
                        />
                      </td>
                      <td className="stripe-ui__num">
                        <input
                          className="stripe-ui__control"
                          type="number"
                          min={0}
                          step="0.01"
                          value={edit.annualEscalationPct}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [doc.id]: { ...edit, annualEscalationPct: e.target.value },
                            }))
                          }
                        />
                      </td>
                      <td className="stripe-ui__num">
                        <input
                          className="stripe-ui__control"
                          type="number"
                          min={0}
                          max={1}
                          step="0.01"
                          value={edit.confidence}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [doc.id]: { ...edit, confidence: e.target.value },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <textarea
                          className="stripe-ui__control"
                          value={edit.summary}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [doc.id]: { ...edit, summary: e.target.value },
                            }))
                          }
                          rows={3}
                        />
                      </td>
                      <td>
                        <div style={{ display: "grid", gap: 8 }}>
                          <button
                            className="stripe-ui__btn stripe-ui__btn--primary"
                            type="button"
                            disabled={savingId === doc.id}
                            onClick={() => void onSave(doc.id)}
                          >
                            {savingId === doc.id ? "Saving..." : "Save"}
                          </button>
                          <button
                            className="stripe-ui__btn stripe-ui__btn--ghost"
                            type="button"
                            disabled={deletingId === doc.id}
                            onClick={() => void onDelete(doc.id)}
                          >
                            {deletingId === doc.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {error ? <div className="stripe-ui__error">{error}</div> : null}
      {message ? <div className="stripe-ui__hint">{message}</div> : null}
    </main>
  );
}
