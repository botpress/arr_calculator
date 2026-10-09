"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";

type NrrMetric = {
  audience: "plg" | "sales";
  cohort: "new" | "legacy";
  openingArr: number;
  currentArr: number;
  nrrPct: number | null;
  customerCount: number;
  retainedCustomerCount: number;
};

type AcvMetric = {
  motion: "plg" | "sales_assist" | "sales_led";
  acv: number | null;
  newArr: number;
  customerCount: number;
};

type Report = {
  asOfDate: string;
  newBusinessStartDate: string;
  legacySnapshotDate: string;
  targetCurrency: string;
  generatedAtUtc: string;
  nrr: NrrMetric[];
  acv: AcvMetric[];
  definitions: Record<string, string>;
};

const nrrCards: Array<{ audience: NrrMetric["audience"]; cohort: NrrMetric["cohort"]; title: string; chip: string }> = [
  { audience: "plg", cohort: "new", title: "PLG · New business NRR", chip: "Self-serve" },
  { audience: "plg", cohort: "legacy", title: "PLG · Legacy NRR", chip: "Self-serve" },
  { audience: "sales", cohort: "new", title: "Sales · New business NRR", chip: "Assist + Led" },
  { audience: "sales", cohort: "legacy", title: "Sales · Legacy NRR", chip: "Assist + Led" },
];

const acvCards: Array<{ motion: AcvMetric["motion"]; title: string }> = [
  { motion: "sales_assist", title: "Sales Assist ACV" },
  { motion: "sales_led", title: "Sales Led ACV" },
  { motion: "plg", title: "PLG ACV" },
];

function money(value: number | null, currency: string) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: number | null) {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`;
}

function prettyDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export default function PlgMetricsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/plg-metrics", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(String(payload?.error || "Unable to load PLG metrics."));
        if (active) setReport(payload as Report);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.topbar}>
          <Link className={styles.back} href="/gtm">← GTM dashboard</Link>
          <div className={styles.status}>
            {report ? `BigQuery data through ${prettyDate(report.asOfDate)}` : "Loading BigQuery snapshot…"}
          </div>
        </div>

        <div className={styles.eyebrow}>Growth quality · FY27</div>
        <h1 className={styles.title}>PLG &amp; Sales cohort economics</h1>
        <p className={styles.lede}>
          Net revenue retention for the post-April new-business cohorts and the customers carried into FY27, plus fiscal-YTD ACV by revenue motion.
        </p>

        {error ? <div className={styles.error}>Could not load metrics: {error}</div> : null}
        {!report && !error ? <div className={styles.loading}>Calculating fixed cohorts from daily customer ARR snapshots…</div> : null}

        {report ? (
          <>
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>Net revenue retention</h2>
                <p>Latest ARR ÷ cohort opening ARR</p>
              </div>
              <div className={styles.grid}>
                {nrrCards.map((card) => {
                  const metric = report.nrr.find((row) => row.audience === card.audience && row.cohort === card.cohort);
                  return (
                    <article className={styles.card} key={`${card.audience}-${card.cohort}`}>
                      <div className={styles.cardLabel}><span>{card.title}</span><span className={styles.chip}>{card.chip}</span></div>
                      <div className={styles.value}>{percent(metric?.nrrPct ?? null)}</div>
                      <div className={styles.subvalue}>
                        <strong>{money(metric?.currentArr ?? null, report.targetCurrency)}</strong> current ARR from {money(metric?.openingArr ?? null, report.targetCurrency)} opening ARR<br />
                        {metric?.retainedCustomerCount ?? 0} of {metric?.customerCount ?? 0} customers remain active
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>ACV · fiscal YTD</h2>
                <p>{prettyDate(report.newBusinessStartDate)} – {prettyDate(report.asOfDate)}</p>
              </div>
              <div className={styles.acvGrid}>
                {acvCards.map((card) => {
                  const metric = report.acv.find((row) => row.motion === card.motion);
                  return (
                    <article className={styles.card} key={card.motion}>
                      <div className={styles.cardLabel}><span>{card.title}</span><span className={styles.chip}>FYTD</span></div>
                      <div className={styles.value}>{money(metric?.acv ?? null, report.targetCurrency)}</div>
                      <div className={styles.subvalue}>
                        <strong>{metric?.customerCount ?? 0}</strong> new customers · {money(metric?.newArr ?? null, report.targetCurrency)} total opening ARR
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className={styles.method}>
              <h2>Definitions</h2>
              <dl>
                <dt>New business NRR</dt><dd>{report.definitions.newBusinessNrr}</dd>
                <dt>Legacy NRR</dt><dd>{report.definitions.legacyNrr}</dd>
                <dt>ACV YTD</dt><dd>{report.definitions.acvYtd}</dd>
                <dt>Motion split</dt><dd>{report.definitions.motion}</dd>
              </dl>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
