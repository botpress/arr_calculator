import {
  batchReadLineItems,
  fetchDealsInStageClosedBetween,
  fetchHubspotOwnersById,
  fetchLineItemIdsForDeals,
  type HubspotOwner,
} from "@/lib/hubspot";
import { getMonthlyAverageFxRateForCloseMonth } from "@/lib/fx";
import { computeWindowForLineItem, parseDate, toNumber } from "@/lib/logic";
import {
  queryStripeCustomerIdsByWorkspaceIdsFromBigQuery,
  runBigQuerySqlRows,
  type BigQuerySqlParameter,
} from "@/lib/stripeBigquery";
import type { HubspotDeal, HubspotLineItem } from "@/lib/types";
import {
  calculateNetCommissionPlanPayment,
  calculateCommissionClawbacks,
  commissionPlanKey,
  commissionMonthKey,
  deriveCommissionRisksFromStripePlanEvents,
  isCommissionPlanActivityDescription,
  isCommissionPlanLineDescription,
  shouldIncludeCommissionDeal,
  type CommissionDealRuleInput,
  type CommissionPaymentRuleInput,
  type CommissionRiskRuleInput,
  type CommissionRiskType,
  type CommissionStripePlanEventInput,
} from "@/lib/commissionRules";

type PaymentFrequency = "monthly" | "quarterly" | "annual";

export type CommissionReportRequest = {
  month: string;
  targetCurrency?: string;
};

export type CommissionDealRow = {
  dealId: string;
  dealName: string;
  hubspotUrl: string;
  ownerId: string;
  ownerName: string;
  pipelineId: string;
  pipelineName: string;
  dealType: string;
  closeDate: string;
  workspaceId: string;
  stripeCustomerIds: string[];
  paymentFrequency: string;
  commissionRatePct: number;
  termMonths: number;
  dealCurrency: string;
  dealAmountOriginal: number;
  dealAmount: number;
  initialGrossCommission: number;
  grossCommission: number;
  paidAmount: number;
  protectedAmount: number;
  monitoringStart: string;
  fullyProtectedAt: string;
  proratedOpeningPaymentAmount: number;
  clawbackEventDate: string;
  clawbackType: CommissionRiskType | "";
  clawback: number;
  netCommission: number;
  status: "protected" | "monitoring" | "clawback" | "unmapped" | "ineligible";
  notes: string[];
};

export type CommissionOwnerGroup = {
  ownerId: string;
  ownerName: string;
  dealCount: number;
  dealAmount: number;
  grossCommission: number;
  clawback: number;
  netCommission: number;
  deals: CommissionDealRow[];
};

export type CommissionWarningDeal = {
  dealId: string;
  dealName: string;
  hubspotUrl: string;
  ownerName: string;
  closeDate: string;
  workspaceId: string;
};

export type CommissionReportResponse = {
  month: string;
  monthLabel: string;
  targetCurrency: string;
  generatedAt: string;
  totals: {
    ownerCount: number;
    dealCount: number;
    dealAmount: number;
    grossCommission: number;
    clawback: number;
    netCommission: number;
  };
  owners: CommissionOwnerGroup[];
  warnings: string[];
  warningDetails: {
    unmappedStripeCustomerDeals: CommissionWarningDeal[];
  };
  methodology: {
    includedPipelines: string[];
    dealTypes: string[];
    existingBusinessOwners: string[];
    commissionRates: Record<PaymentFrequency, number>;
    clawbackRule: string;
    paymentSource: string;
  };
};

type PreparedDeal = CommissionDealRuleInput & {
  dealName: string;
  pipelineId: string;
  pipelineName: string;
  dealType: string;
  dealCurrency: string;
  dealAmountOriginal: number;
  paymentFrequency: string;
  commissionRatePct: number;
  stripeCustomerIds: string[];
  notes: string[];
};

type RawStripePayment = {
  paymentId: string;
  customerId: string;
  paidDate: string;
  amount: number;
  currency: string;
};

type RawStripeRisk = {
  eventId: string;
  customerId: string;
  occurredAt: string;
  type: CommissionRiskType;
};

const COMMISSION_RATES: Record<PaymentFrequency, number> = {
  monthly: 0.08,
  quarterly: 0.1,
  annual: 0.11,
};

const DEFAULT_TRANSACTIONAL_PIPELINE_ID = "730649262";
const DEFAULT_TRANSACTIONAL_CLOSED_WON_STAGE_ID = "1064537523";
const DEFAULT_SALES_PIPELINE_ID = "0cbbc8c6-dccf-4601-8d59-b6a15ed5129b";
const DEFAULT_SALES_CLOSED_WON_STAGE_ID = "f12c408f-f92b-4a95-8b59-9f801b19b105";
const DEFAULT_STRIPE_INVOICES_TABLE = "botpress-stripe-data-pipeline.stripe.invoices";
const DEFAULT_STRIPE_INVOICE_LINES_TABLE = "botpress-stripe-data-pipeline.stripe.invoice_lines_helper";
const DEFAULT_STRIPE_RAW_INVOICE_LINES_TABLE = "botpress-stripe-data-pipeline.stripe.invoice_lines";
const DEFAULT_STRIPE_INVOICE_LINE_DISCOUNTS_TABLE =
  "botpress-stripe-data-pipeline.stripe.invoice_line_item_discount_amounts";
const DEFAULT_STRIPE_CHARGES_TABLE = "botpress-stripe-data-pipeline.stripe.charges";
const DEFAULT_STRIPE_PRICES_TABLE = "botpress-stripe-data-pipeline.stripe.prices";
const DEFAULT_STRIPE_PRODUCTS_TABLE = "botpress-stripe-data-pipeline.stripe.products";
const DEFAULT_STRIPE_MRR_EVENTS_TABLE =
  "botpress-stripe-data-pipeline.stripe.subscription_item_change_events_v2_beta";
const DEFAULT_HUBSPOT_PORTAL_ID = "20692578";
const DEFAULT_EXISTING_BUSINESS_OWNER_NAMES = ["Tyler", "Luca", "Evan", "Felipe", "Antonin", "Sarah"];

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isIsoMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || "").trim());
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 0));
  return { start, end, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

function addMonthsUtc(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function isoDate(value: unknown) {
  const parsed = parseDate(value);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

function normalizedWorkspace(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizeFrequency(value: unknown): PaymentFrequency | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized.includes("one")) return null;
  if (normalized.includes("quarter") || normalized.includes("three") || normalized === "per_quarter") return "quarterly";
  if (normalized.includes("annual") || normalized.includes("year")) return "annual";
  if (normalized.includes("month") && !normalized.includes("six")) return "monthly";
  return null;
}

function frequencyCadenceMonths(frequency: PaymentFrequency) {
  if (frequency === "quarterly") return 3;
  if (frequency === "annual") return 12;
  return 1;
}

function termMonthsForLineItem(lineItem: HubspotLineItem) {
  const properties = lineItem.properties || {};
  const explicit = Math.floor(toNumber(properties.hs_term_in_months));
  if (explicit > 0) return explicit;
  const window = computeWindowForLineItem(properties);
  if (!window || window.endIsOpenEnded) return 0;
  const months =
    (window.end.getFullYear() - window.start.getFullYear()) * 12 +
    (window.end.getMonth() - window.start.getMonth()) +
    1;
  return Math.max(1, months);
}

function commissionProfileForLineItems(lineItems: HubspotLineItem[]) {
  const weights = new Map<PaymentFrequency, number>();
  const starts: Date[] = [];
  const planDescriptions: string[] = [];
  let maxTermMonths = 0;

  for (const lineItem of lineItems) {
    const properties = lineItem.properties || {};
    planDescriptions.push(
      String(properties.name || ""),
      String(properties.description || ""),
      String(properties.hs_product_name || ""),
      String(properties.hs_sku || ""),
    );
    const frequency = normalizeFrequency(properties.recurringbillingfrequency);
    if (!frequency) continue;
    const termMonths = termMonthsForLineItem(lineItem) || 12;
    maxTermMonths = Math.max(maxTermMonths, termMonths);
    const window = computeWindowForLineItem(properties);
    if (window?.start && !Number.isNaN(window.start.getTime())) starts.push(window.start);
    const recurringAmount = Math.abs(toNumber(properties.amount) || toNumber(properties.net_price));
    const installments = Math.max(1, Math.ceil(termMonths / frequencyCadenceMonths(frequency)));
    const weight = recurringAmount > 0 ? recurringAmount * installments : 1;
    weights.set(frequency, (weights.get(frequency) || 0) + weight);
  }

  const totalWeight = Array.from(weights.values()).reduce((sum, value) => sum + value, 0);
  const rate = totalWeight > 0
    ? Array.from(weights.entries()).reduce((sum, [frequency, weight]) => sum + COMMISSION_RATES[frequency] * weight, 0) /
      totalWeight
    : 0;
  const frequencies = Array.from(weights.keys());
  starts.sort((a, b) => a.getTime() - b.getTime());
  return {
    rate,
    frequencyLabel: frequencies.length === 1 ? frequencies[0] : frequencies.length > 1 ? "mixed" : "",
    termMonths: maxTermMonths || 12,
    effectiveStartDate: starts[0]?.toISOString() || "",
    planKey: commissionPlanKey(planDescriptions),
  };
}

function envValue(name: string, fallback: string) {
  return String(process.env[name] || fallback).trim() || fallback;
}

function existingBusinessOwnerNames() {
  const configured = String(process.env.COMMISSION_EXISTING_BUSINESS_OWNER_NAMES || "").trim();
  const values = configured ? configured.split(/[;,|\n\r]+/) : DEFAULT_EXISTING_BUSINESS_OWNER_NAMES;
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function ownerIdentities(owner: HubspotOwner | undefined) {
  const firstName = String(owner?.firstName || "").trim();
  const lastName = String(owner?.lastName || "").trim();
  const email = String(owner?.email || "").trim();
  const emailLocalPart = email.split("@")[0] || "";
  return [firstName, [firstName, lastName].filter(Boolean).join(" "), email, emailLocalPart].filter(Boolean);
}

function safeBigQueryTable(value: string) {
  const table = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(table)) {
    throw new Error(`Invalid BigQuery table name: ${table}`);
  }
  return table;
}

function pipelineConfiguration() {
  return [
    {
      id: envValue("HUBSPOT_COMMISSION_TRANSACTIONAL_PIPELINE_ID", DEFAULT_TRANSACTIONAL_PIPELINE_ID),
      name: "Transactional Pipeline",
      closedWonStageId: envValue(
        "HUBSPOT_COMMISSION_TRANSACTIONAL_CLOSED_WON_STAGE_ID",
        DEFAULT_TRANSACTIONAL_CLOSED_WON_STAGE_ID,
      ),
    },
    {
      id: envValue("HUBSPOT_COMMISSION_SALES_PIPELINE_ID", DEFAULT_SALES_PIPELINE_ID),
      name: "Sales Default Pipeline",
      closedWonStageId: envValue(
        "HUBSPOT_COMMISSION_SALES_CLOSED_WON_STAGE_ID",
        DEFAULT_SALES_CLOSED_WON_STAGE_ID,
      ),
    },
  ];
}

async function queryStripeActivity(customerIds: string[], startDate: string, endDate: string) {
  const ids = Array.from(new Set(customerIds.map((id) => String(id || "").trim()).filter(Boolean)));
  if (!ids.length) return { payments: [] as RawStripePayment[], risks: [] as RawStripeRisk[] };

  const invoicesTable = safeBigQueryTable(
    envValue("BIGQUERY_STRIPE_INVOICES_TABLE", DEFAULT_STRIPE_INVOICES_TABLE),
  );
  const invoiceLinesTable = safeBigQueryTable(
    envValue("BIGQUERY_STRIPE_ARR_CORRECT_TABLE", DEFAULT_STRIPE_INVOICE_LINES_TABLE),
  );
  const rawInvoiceLinesTable = safeBigQueryTable(
    envValue("BIGQUERY_STRIPE_INVOICE_LINES_RAW_TABLE", DEFAULT_STRIPE_RAW_INVOICE_LINES_TABLE),
  );
  const invoiceLineDiscountsTable = safeBigQueryTable(
    envValue("BIGQUERY_STRIPE_INVOICE_LINE_DISCOUNTS_TABLE", DEFAULT_STRIPE_INVOICE_LINE_DISCOUNTS_TABLE),
  );
  const chargesTable = safeBigQueryTable(
    envValue("BIGQUERY_STRIPE_ARR_CORRECT_CHARGES_TABLE", DEFAULT_STRIPE_CHARGES_TABLE),
  );
  const pricesTable = safeBigQueryTable(envValue("BIGQUERY_STRIPE_PRICES_TABLE", DEFAULT_STRIPE_PRICES_TABLE));
  const productsTable = safeBigQueryTable(envValue("BIGQUERY_STRIPE_PRODUCTS_TABLE", DEFAULT_STRIPE_PRODUCTS_TABLE));
  const eventsTable = safeBigQueryTable(
    envValue("BIGQUERY_STRIPE_ARR_CORRECT_MRR_CHANGE_TABLE", DEFAULT_STRIPE_MRR_EVENTS_TABLE),
  );
  const idParams: BigQuerySqlParameter[] = ids.map((customerId, index) => ({
    name: `customer_${index}`,
    type: "STRING",
    value: customerId,
  }));
  const requestedIdsSql = ids.map((_, index) => `@customer_${index}`).join(", ");
  const sharedParams: BigQuerySqlParameter[] = [
    ...idParams,
    { name: "start_date", type: "STRING", value: startDate },
    { name: "end_date", type: "STRING", value: endDate },
  ];

  const invoiceSql = `
WITH latest_invoices AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      i.*,
      ROW_NUMBER() OVER (PARTITION BY i.id ORDER BY i.batch_timestamp DESC) AS rn
    FROM \`${invoicesTable}\` i
    WHERE COALESCE(NULLIF(TRIM(CAST(i.customer_id AS STRING)), ''), '') IN (${requestedIdsSql})
      AND DATE(i.date) BETWEEN DATE(@start_date) AND DATE(@end_date)
  )
  WHERE rn = 1
),
latest_charges AS (
  SELECT raw_json
  FROM (
    SELECT
      TO_JSON_STRING(c) AS raw_json,
      ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY c.batch_timestamp DESC) AS rn
    FROM \`${chargesTable}\` c
    WHERE COALESCE(NULLIF(TRIM(CAST(c.customer_id AS STRING)), ''), '') IN (${requestedIdsSql})
  )
  WHERE rn = 1
),
charge_refunds AS (
  SELECT
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.invoice_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.invoice')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.invoice.id')), '')
    ) AS invoice_id,
    SUM(GREATEST(COALESCE(SAFE_CAST(JSON_VALUE(raw_json, '$.amount_refunded') AS FLOAT64), 0), 0)) AS amount_refunded
  FROM latest_charges
  GROUP BY invoice_id
),
helper_invoice_lines AS (
  SELECT
    CAST(invoice_id AS STRING) AS invoice_id,
    CAST(line_item_id AS STRING) AS line_item_id,
    CAST(line_item_description AS STRING) AS line_item_description,
    MAX(CAST(COALESCE(amount_minor, 0) AS FLOAT64)) AS line_amount
  FROM \`${invoiceLinesTable}\`
  WHERE CAST(invoice_id AS STRING) IN (SELECT CAST(id AS STRING) FROM latest_invoices)
  GROUP BY invoice_id, line_item_id, line_item_description
),
latest_raw_invoice_lines AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      line_row.*,
      ROW_NUMBER() OVER (PARTITION BY line_row.id ORDER BY line_row.batch_timestamp DESC) AS rn
    FROM \`${rawInvoiceLinesTable}\` line_row
    WHERE CAST(line_row.invoice_id AS STRING) IN (SELECT CAST(id AS STRING) FROM latest_invoices)
  )
  WHERE rn = 1
),
raw_line_discounts AS (
  SELECT
    CAST(invoice_line_item_id AS STRING) AS line_item_id,
    SUM(COALESCE(amount, 0)) AS discount_amount
  FROM \`${invoiceLineDiscountsTable}\`
  WHERE CAST(invoice_line_item_id AS STRING) IN (SELECT CAST(id AS STRING) FROM latest_raw_invoice_lines)
  GROUP BY line_item_id
),
raw_invoice_lines AS (
  SELECT
    CAST(line_row.invoice_id AS STRING) AS invoice_id,
    CAST(line_row.id AS STRING) AS line_item_id,
    CAST(line_row.description AS STRING) AS line_item_description,
    GREATEST(
      CAST(
        COALESCE(line_row.amount, 0) - COALESCE(discount.discount_amount, line_row.total_discount, 0)
        AS FLOAT64
      ),
      0
    ) / 100.0 AS line_amount
  FROM latest_raw_invoice_lines line_row
  LEFT JOIN raw_line_discounts discount
    ON discount.line_item_id = CAST(line_row.id AS STRING)
  WHERE COALESCE(
      NULLIF(TRIM(CAST(line_row.subscription_item_id AS STRING)), ''),
      NULLIF(TRIM(CAST(line_row.subscription AS STRING)), ''),
      NULLIF(TRIM(CAST(line_row.plan_id AS STRING)), ''),
      ''
    ) != ''
    AND NOT EXISTS (
      SELECT 1
      FROM helper_invoice_lines helper
      WHERE helper.invoice_id = CAST(line_row.invoice_id AS STRING)
    )
),
invoice_lines AS (
  SELECT invoice_id, line_item_id, line_item_description, line_amount
  FROM helper_invoice_lines
  UNION ALL
  SELECT invoice_id, line_item_id, line_item_description, line_amount
  FROM raw_invoice_lines
)
SELECT
  CAST(i.id AS STRING) AS payment_id,
  CAST(i.customer_id AS STRING) AS customer_id,
  FORMAT_DATE('%Y-%m-%d', DATE(i.date)) AS paid_date,
  CAST(COALESCE(i.amount_paid, 0) AS FLOAT64) / 100.0 AS invoice_amount_paid,
  CAST(COALESCE(r.amount_refunded, 0) AS FLOAT64) / 100.0 AS amount_refunded,
  UPPER(TRIM(COALESCE(CAST(i.currency AS STRING), 'USD'))) AS currency,
  COALESCE(l.line_item_id, '') AS line_item_id,
  COALESCE(l.line_item_description, '') AS line_item_description,
  COALESCE(l.line_amount, 0) AS line_amount
FROM latest_invoices i
LEFT JOIN charge_refunds r
  ON r.invoice_id = CAST(i.id AS STRING)
LEFT JOIN invoice_lines l
  ON l.invoice_id = CAST(i.id AS STRING)
WHERE LOWER(TRIM(COALESCE(CAST(i.status AS STRING), ''))) = 'paid'
  AND COALESCE(i.amount_paid, 0) > 0
ORDER BY paid_date ASC, payment_id ASC, line_item_id ASC`;

  const riskSql = `
WITH source AS (
  SELECT
    event_timestamp,
    UPPER(CAST(event_type AS STRING)) AS event_type,
    TO_JSON_STRING(event_row) AS raw_json
  FROM \`${eventsTable}\` AS event_row
  WHERE DATE(event_timestamp) BETWEEN DATE(@start_date) AND DATE(@end_date)
    AND UPPER(CAST(event_type AS STRING)) IN ('ACTIVE_START', 'ACTIVE_UPGRADE', 'ACTIVE_END', 'ACTIVE_DOWNGRADE')
),
parsed AS (
  SELECT
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.customer_id')), ''), '') AS customer_id,
    event_timestamp,
    event_type,
    COALESCE(SAFE_CAST(JSON_VALUE(raw_json, '$.mrr_change') AS FLOAT64), 0) AS mrr_change,
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.subscription_id')), ''), '') AS subscription_id,
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.subscription_item_id')), ''), '') AS subscription_item_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.id')), ''),
      ''
    ) AS price_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.id')), ''),
      ''
    ) AS product_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_description')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_nickname')), ''),
      ''
    ) AS event_price_description,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product_description')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product_name')), ''),
      ''
    ) AS event_product_description
  FROM source
),
latest_prices AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      price_row.*,
      ROW_NUMBER() OVER (PARTITION BY price_row.id ORDER BY price_row.batch_timestamp DESC) AS rn
    FROM \`${pricesTable}\` price_row
  )
  WHERE rn = 1
),
latest_products AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      product_row.*,
      ROW_NUMBER() OVER (PARTITION BY product_row.id ORDER BY product_row.batch_timestamp DESC) AS rn
    FROM \`${productsTable}\` product_row
  )
  WHERE rn = 1
)
SELECT DISTINCT
  CONCAT(
    CAST(customer_id AS STRING), '|',
    FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', event_timestamp, 'UTC'), '|',
    UPPER(CAST(event_type AS STRING)), '|',
    COALESCE(NULLIF(TRIM(subscription_item_id), ''), '(no item)')
  ) AS event_id,
  CAST(customer_id AS STRING) AS customer_id,
  FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', event_timestamp, 'UTC') AS occurred_at,
  UPPER(CAST(event_type AS STRING)) AS event_type,
  CAST(mrr_change AS FLOAT64) AS mrr_change,
  subscription_id,
  COALESCE(
    NULLIF(TRIM(event_price_description), ''),
    NULLIF(TRIM(CAST(price_row.nickname AS STRING)), ''),
    ''
  ) AS price_description,
  COALESCE(
    NULLIF(TRIM(event_product_description), ''),
    NULLIF(TRIM(CAST(product_row.name AS STRING)), ''),
    NULLIF(TRIM(CAST(product_row.description AS STRING)), ''),
    ''
  ) AS product_description
FROM parsed AS parsed_event
LEFT JOIN latest_prices price_row
  ON CAST(price_row.id AS STRING) = parsed_event.price_id
LEFT JOIN latest_products product_row
  ON CAST(product_row.id AS STRING) = COALESCE(
    NULLIF(parsed_event.product_id, ''),
    NULLIF(CAST(price_row.product_id AS STRING), '')
  )
WHERE COALESCE(NULLIF(TRIM(CAST(customer_id AS STRING)), ''), '') IN (${requestedIdsSql})
ORDER BY occurred_at ASC, event_id ASC`;

  const [invoiceRows, eventRows] = await Promise.all([
    runBigQuerySqlRows(invoiceSql, sharedParams, { profile: "stripe_arr_correct" }),
    runBigQuerySqlRows(riskSql, sharedParams, { profile: "stripe_arr_correct" }),
  ]);

  const invoices = new Map<
    string,
    {
      paymentId: string;
      customerId: string;
      paidDate: string;
      invoiceAmountPaid: number;
      amountRefunded: number;
      currency: string;
      planLineAmount: number;
      totalPositiveLineAmount: number;
      seenLineItems: Set<string>;
    }
  >();
  for (const row of invoiceRows) {
    const paymentId = String(row.payment_id || "");
    if (!paymentId) continue;
    if (!invoices.has(paymentId)) {
      invoices.set(paymentId, {
        paymentId,
        customerId: String(row.customer_id || ""),
        paidDate: String(row.paid_date || ""),
        invoiceAmountPaid: Math.max(0, Number(row.invoice_amount_paid || 0)),
        amountRefunded: Math.max(0, Number(row.amount_refunded || 0)),
        currency: String(row.currency || "USD").trim().toUpperCase(),
        planLineAmount: 0,
        totalPositiveLineAmount: 0,
        seenLineItems: new Set<string>(),
      });
    }
    const invoice = invoices.get(paymentId)!;
    const lineItemId = String(row.line_item_id || "");
    const lineDescription = String(row.line_item_description || "");
    const lineAmount = Math.max(0, Number(row.line_amount || 0));
    const lineKey = lineItemId || `${lineDescription}|${lineAmount}`;
    if (!lineAmount || invoice.seenLineItems.has(lineKey)) continue;
    invoice.seenLineItems.add(lineKey);
    invoice.totalPositiveLineAmount += lineAmount;
    if (isCommissionPlanLineDescription(lineDescription)) invoice.planLineAmount += lineAmount;
  }

  const payments = Array.from(invoices.values())
    .map((invoice) => ({
      paymentId: invoice.paymentId,
      customerId: invoice.customerId,
      paidDate: invoice.paidDate,
      amount: calculateNetCommissionPlanPayment(invoice),
      currency: invoice.currency,
    }))
    .filter((payment) => payment.amount > 0);

  return {
    payments,
    risks: deriveCommissionRisksFromStripePlanEvents(
      eventRows
      .filter((row) =>
        isCommissionPlanActivityDescription([
          String(row.price_description || ""),
          String(row.product_description || ""),
        ]),
      )
      .map((row) => ({
        eventId: String(row.event_id || ""),
        customerId: String(row.customer_id || ""),
        subscriptionId: String(row.subscription_id || ""),
        occurredAt: String(row.occurred_at || ""),
        eventType: String(row.event_type || "").toUpperCase(),
        mrrChange: Number(row.mrr_change || 0),
      } as CommissionStripePlanEventInput)),
    ).map((risk) => risk as RawStripeRisk),
  };
}

function closestWorkspaceForActivity(
  customerId: string,
  occurredAt: string,
  customerToWorkspaces: Map<string, string[]>,
  dealsByWorkspace: Map<string, PreparedDeal[]>,
  mode: "payment" | "risk",
) {
  const occurredAtMs = Date.parse(occurredAt);
  let bestWorkspace = "";
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const workspaceId of customerToWorkspaces.get(customerId) || []) {
    for (const deal of dealsByWorkspace.get(workspaceId) || []) {
      const candidateDate = mode === "payment" ? deal.closeDate : deal.effectiveStartDate;
      const candidateAt = Date.parse(candidateDate);
      const eligible = mode === "risk" ? candidateAt < occurredAtMs : candidateAt <= occurredAtMs;
      if (!eligible || !Number.isFinite(candidateAt) || candidateAt < bestAt) continue;
      bestAt = candidateAt;
      bestWorkspace = workspaceId;
    }
  }
  return bestWorkspace;
}

function ownerDisplayName(owner: { firstName?: string; lastName?: string; email?: string } | undefined, ownerId: string) {
  const fullName = [owner?.firstName, owner?.lastName].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  return fullName || String(owner?.email || "").trim() || (ownerId ? `Owner ${ownerId}` : "Unassigned");
}

function dealTypeLabel(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized === "existingbusiness") return "Existing Business";
  if (normalized === "newbusiness") return "New Business";
  return String(value || "").trim() || "Unknown";
}

function hubspotDealUrl(dealId: string) {
  const portalId = envValue("HUBSPOT_PORTAL_ID", DEFAULT_HUBSPOT_PORTAL_ID);
  return `https://app.hubspot.com/contacts/${encodeURIComponent(portalId)}/record/0-3/${encodeURIComponent(dealId)}`;
}

export async function generateCommissionReport(request: CommissionReportRequest): Promise<CommissionReportResponse> {
  const month = String(request.month || "").trim();
  if (!isIsoMonth(month)) throw new Error("Invalid month; expected YYYY-MM");
  const targetCurrency = String(request.targetCurrency || process.env.FX_TARGET_CURRENCY || "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(targetCurrency)) throw new Error("Invalid targetCurrency");

  const selected = monthBounds(month);
  const lookbackMonths = Math.max(3, Math.min(60, Number(process.env.COMMISSION_CLAWBACK_LOOKBACK_MONTHS || 24)));
  const lookbackStartDate = addMonthsUtc(selected.start, -lookbackMonths).toISOString().slice(0, 10);
  const pipelines = pipelineConfiguration();
  const includedExistingBusinessOwners = existingBusinessOwnerNames();
  const warnings = new Set<string>();
  const dealProperties = [
    "dealname",
    "dealtype",
    "pipeline",
    "dealstage",
    "closedate",
    "amount",
    "deal_currency_code",
    "hubspot_owner_id",
    "workspace_id",
  ];

  const fetchedByPipeline = await Promise.all(
    pipelines.map(async (pipeline) => ({
      pipeline,
      deals: await fetchDealsInStageClosedBetween(
        dealProperties,
        pipeline.closedWonStageId,
        lookbackStartDate,
        selected.endDate,
      ),
    })),
  );
  const dealsWithSupportedTypes: Array<{ deal: HubspotDeal; pipelineName: string }> = [];
  const seenDealIds = new Set<string>();
  for (const fetched of fetchedByPipeline) {
    for (const deal of fetched.deals) {
      const properties = deal.properties || {};
      if (String(properties.pipeline || "") !== fetched.pipeline.id) continue;
      const normalizedDealType = String(properties.dealtype || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
      if (normalizedDealType !== "newbusiness" && normalizedDealType !== "existingbusiness") continue;
      const dealId = String(deal.id || "");
      if (!dealId || seenDealIds.has(dealId)) continue;
      seenDealIds.add(dealId);
      dealsWithSupportedTypes.push({ deal, pipelineName: fetched.pipeline.name });
    }
  }

  const ownerIds = Array.from(
    new Set(
      dealsWithSupportedTypes
        .map(({ deal }) => String(deal.properties?.hubspot_owner_id || "").trim())
        .filter(Boolean),
    ),
  );
  let ownersById = new Map<string, HubspotOwner>();
  try {
    ownersById = await fetchHubspotOwnersById(ownerIds);
  } catch {
    warnings.add("HubSpot owner names were unavailable; owner IDs are shown instead and Existing Business deals could not be matched to the approved reps.");
  }

  const candidateDeals = dealsWithSupportedTypes.filter(({ deal }) => {
    const properties = deal.properties || {};
    const ownerId = String(properties.hubspot_owner_id || "").trim();
    return shouldIncludeCommissionDeal({
      dealType: String(properties.dealtype || ""),
      ownerIdentities: ownerIdentities(ownersById.get(ownerId)),
      existingBusinessOwnerNames: includedExistingBusinessOwners,
    });
  });

  const dealIds = candidateDeals.map(({ deal }) => String(deal.id));
  const dealLineItemAssociations = await fetchLineItemIdsForDeals(dealIds);
  const lineItemIdsByDeal = new Map(dealLineItemAssociations.map((entry) => [entry.dealId, entry.ids]));
  const allLineItemIds = Array.from(new Set(dealLineItemAssociations.flatMap((entry) => entry.ids)));
  const lineItemsById = await batchReadLineItems(allLineItemIds, [
    "amount",
    "net_price",
    "quantity",
    "recurringbillingfrequency",
    "hs_recurring_billing_start_date",
    "hs_recurring_billing_end_date",
    "hs_billing_period_start_date",
    "hs_billing_period_end_date",
    "hs_term_in_months",
    "name",
    "description",
    "hs_product_name",
    "hs_sku",
  ]);

  const preparedDeals: PreparedDeal[] = [];
  for (const { deal, pipelineName } of candidateDeals) {
    const properties = deal.properties || {};
    const dealId = String(deal.id || "");
    const closeDate = isoDate(properties.closedate);
    if (!closeDate) continue;
    const lineItems = (lineItemIdsByDeal.get(dealId) || [])
      .map((lineItemId) => lineItemsById.get(lineItemId))
      .filter((lineItem): lineItem is HubspotLineItem => !!lineItem);
    const profile = commissionProfileForLineItems(lineItems);
    const notes: string[] = [];
    if (!lineItems.length) notes.push("No HubSpot line items");
    if (!profile.rate) notes.push("No supported monthly, quarterly, or annual recurring frequency");

    const dealCurrency = String(properties.deal_currency_code || targetCurrency).trim().toUpperCase();
    const dealAmountOriginal = Math.max(0, toNumber(properties.amount));
    const closeDateObject = parseDate(properties.closedate);
    const fx = await getMonthlyAverageFxRateForCloseMonth(dealCurrency, targetCurrency, closeDateObject);
    const fxRate = dealCurrency === targetCurrency ? 1 : Number(fx.rate || 0);
    if (fxRate <= 0) {
      notes.push(`No ${dealCurrency}→${targetCurrency} FX rate`);
      warnings.add(`Some ${dealCurrency} deals could not be converted to ${targetCurrency}.`);
    }
    const dealAmount = round2(dealAmountOriginal * Math.max(0, fxRate));
    const workspaceId = normalizedWorkspace(properties.workspace_id);
    if (!workspaceId) notes.push("Missing primary workspace ID; clawback unavailable");
    const grossCommission = round2(dealAmount * profile.rate);
    const effectiveStartDate = profile.effectiveStartDate || `${closeDate}T00:00:00.000Z`;
    const dealName = String(properties.dealname || `Deal ${dealId}`);

    preparedDeals.push({
      dealId,
      dealName,
      ownerId: String(properties.hubspot_owner_id || "").trim(),
      workspaceId,
      closeDate: `${closeDate}T00:00:00.000Z`,
      effectiveStartDate,
      planKey: profile.planKey || commissionPlanKey([dealName]),
      termMonths: profile.termMonths,
      dealAmount,
      grossCommission,
      pipelineId: String(properties.pipeline || ""),
      pipelineName,
      dealType: dealTypeLabel(properties.dealtype),
      dealCurrency,
      dealAmountOriginal,
      paymentFrequency: profile.frequencyLabel || "unsupported",
      commissionRatePct: round2(profile.rate * 100),
      stripeCustomerIds: [],
      notes,
    });
  }

  const workspaceIds = Array.from(new Set(preparedDeals.map((deal) => deal.workspaceId).filter(Boolean)));
  const mapping = await queryStripeCustomerIdsByWorkspaceIdsFromBigQuery(workspaceIds, {
    profile: "stripe_arr_correct",
  });
  const customerToWorkspaces = new Map<string, string[]>();
  const workspaceToCustomers = new Map<string, string[]>();
  for (const entry of mapping.mappings) {
    const workspaceId = normalizedWorkspace(entry.workspaceId);
    const customerId = String(entry.customerId || "").trim();
    if (!workspaceId || !customerId) continue;
    if (!customerToWorkspaces.has(customerId)) customerToWorkspaces.set(customerId, []);
    if (!customerToWorkspaces.get(customerId)!.includes(workspaceId)) customerToWorkspaces.get(customerId)!.push(workspaceId);
    if (!workspaceToCustomers.has(workspaceId)) workspaceToCustomers.set(workspaceId, []);
    if (!workspaceToCustomers.get(workspaceId)!.includes(customerId)) workspaceToCustomers.get(workspaceId)!.push(customerId);
  }
  for (const deal of preparedDeals) deal.stripeCustomerIds = workspaceToCustomers.get(deal.workspaceId) || [];

  const dealsByWorkspace = new Map<string, PreparedDeal[]>();
  for (const deal of preparedDeals) {
    if (!deal.workspaceId) continue;
    if (!dealsByWorkspace.has(deal.workspaceId)) dealsByWorkspace.set(deal.workspaceId, []);
    dealsByWorkspace.get(deal.workspaceId)!.push(deal);
  }
  for (const deals of dealsByWorkspace.values()) {
    deals.sort((a, b) => Date.parse(a.effectiveStartDate) - Date.parse(b.effectiveStartDate));
  }

  const stripeActivity = await queryStripeActivity(mapping.customerIds, lookbackStartDate, selected.endDate);
  const paymentFxCache = new Map<string, Promise<number>>();
  async function paymentFxRate(currency: string, paidDate: string) {
    const normalizedCurrency = String(currency || "USD").trim().toUpperCase();
    if (normalizedCurrency === targetCurrency) return 1;
    const key = `${normalizedCurrency}|${targetCurrency}|${paidDate.slice(0, 7)}`;
    if (!paymentFxCache.has(key)) {
      paymentFxCache.set(
        key,
        getMonthlyAverageFxRateForCloseMonth(normalizedCurrency, targetCurrency, parseDate(paidDate)).then((fx) =>
          Number(fx.rate || 0),
        ),
      );
    }
    return paymentFxCache.get(key)!;
  }

  const payments: CommissionPaymentRuleInput[] = [];
  for (const payment of stripeActivity.payments) {
    const workspaceId = closestWorkspaceForActivity(
      payment.customerId,
      payment.paidDate,
      customerToWorkspaces,
      dealsByWorkspace,
      "payment",
    );
    if (!workspaceId) continue;
    const fxRate = await paymentFxRate(payment.currency, payment.paidDate);
    if (fxRate <= 0) {
      warnings.add(`Some Stripe ${payment.currency} payments could not be converted to ${targetCurrency}.`);
      continue;
    }
    payments.push({
      paymentId: payment.paymentId,
      workspaceId,
      paidDate: `${payment.paidDate}T23:59:59.999Z`,
      amount: round2(payment.amount * fxRate),
    });
  }

  const riskEvents: CommissionRiskRuleInput[] = stripeActivity.risks
    .map((event) => ({
      event,
      workspaceId: closestWorkspaceForActivity(
        event.customerId,
        event.occurredAt,
        customerToWorkspaces,
        dealsByWorkspace,
        "risk",
      ),
    }))
    .filter((entry) => !!entry.workspaceId)
    .map(({ event, workspaceId }) => ({
      eventId: event.eventId,
      workspaceId,
      occurredAt: event.occurredAt,
      type: event.type,
    }));

  const ruleResults = new Map(
    calculateCommissionClawbacks(preparedDeals, payments, riskEvents).map((result) => [result.dealId, result]),
  );
  const visibleRows: CommissionDealRow[] = [];
  for (const deal of preparedDeals) {
    const result = ruleResults.get(deal.dealId);
    if (!result) continue;
    const closeMonth = commissionMonthKey(deal.closeDate);
    const clawbackMonth = commissionMonthKey(result.riskEventDate);
    const hasGrossThisMonth = closeMonth === month;
    const hasClawbackThisMonth = !!result.clawback && clawbackMonth === month;
    if (!hasGrossThisMonth && !hasClawbackThisMonth) continue;

    const grossCommission = hasGrossThisMonth ? result.commissionableGrossCommission : 0;
    const clawback = hasClawbackThisMonth ? result.clawback : 0;
    const commissionableScale = deal.dealAmount > 0 ? result.commissionableDealAmount / deal.dealAmount : 1;
    const rowNotes = deal.notes.slice();
    if (result.commissionableTermMonths < deal.termMonths) {
      rowNotes.push(
        `Deal-backed plan replacement: commission limited to ${result.commissionableTermMonths} remaining contract months.`,
      );
    }
    let status: CommissionDealRow["status"] = "monitoring";
    if (!result.commissionableGrossCommission) status = "ineligible";
    else if (!deal.workspaceId || !deal.stripeCustomerIds.length) status = "unmapped";
    else if (hasClawbackThisMonth) status = "clawback";
    else if (result.fullyProtectedAt) status = "protected";

    visibleRows.push({
      dealId: deal.dealId,
      dealName: deal.dealName,
      hubspotUrl: hubspotDealUrl(deal.dealId),
      ownerId: deal.ownerId,
      ownerName: ownerDisplayName(ownersById.get(deal.ownerId), deal.ownerId),
      pipelineId: deal.pipelineId,
      pipelineName: deal.pipelineName,
      dealType: deal.dealType,
      closeDate: deal.closeDate.slice(0, 10),
      workspaceId: deal.workspaceId,
      stripeCustomerIds: deal.stripeCustomerIds,
      paymentFrequency: deal.paymentFrequency,
      commissionRatePct: deal.commissionRatePct,
      termMonths: result.commissionableTermMonths,
      dealCurrency: deal.dealCurrency,
      dealAmountOriginal: round2(deal.dealAmountOriginal * commissionableScale),
      dealAmount: result.commissionableDealAmount,
      initialGrossCommission: deal.grossCommission,
      grossCommission,
      paidAmount: result.riskEventId ? result.paidBeforeRisk : result.allocatedPaidAmount,
      protectedAmount: result.protectedAmount,
      monitoringStart: result.monitoringStart ? result.monitoringStart.slice(0, 10) : "",
      fullyProtectedAt: result.fullyProtectedAt ? result.fullyProtectedAt.slice(0, 10) : "",
      proratedOpeningPaymentAmount: result.proratedOpeningPaymentAmount,
      clawbackEventDate: hasClawbackThisMonth ? result.riskEventDate.slice(0, 10) : "",
      clawbackType: hasClawbackThisMonth ? result.riskType : "",
      clawback,
      netCommission: round2(grossCommission - clawback),
      status,
      notes: rowNotes,
    });
  }

  const grouped = new Map<string, CommissionOwnerGroup>();
  for (const row of visibleRows) {
    const ownerKey = row.ownerId || "unassigned";
    if (!grouped.has(ownerKey)) {
      grouped.set(ownerKey, {
        ownerId: row.ownerId,
        ownerName: row.ownerName,
        dealCount: 0,
        dealAmount: 0,
        grossCommission: 0,
        clawback: 0,
        netCommission: 0,
        deals: [],
      });
    }
    const owner = grouped.get(ownerKey)!;
    owner.deals.push(row);
    owner.dealCount += row.grossCommission > 0 ? 1 : 0;
    owner.dealAmount = round2(owner.dealAmount + (row.grossCommission > 0 ? row.dealAmount : 0));
    owner.grossCommission = round2(owner.grossCommission + row.grossCommission);
    owner.clawback = round2(owner.clawback + row.clawback);
    owner.netCommission = round2(owner.netCommission + row.netCommission);
  }

  const owners = Array.from(grouped.values())
    .map((owner) => ({
      ...owner,
      deals: owner.deals.sort((a, b) => b.closeDate.localeCompare(a.closeDate) || a.dealName.localeCompare(b.dealName)),
    }))
    .sort((a, b) => b.netCommission - a.netCommission || a.ownerName.localeCompare(b.ownerName));

  const totals = owners.reduce(
    (acc, owner) => ({
      ownerCount: acc.ownerCount + 1,
      dealCount: acc.dealCount + owner.dealCount,
      dealAmount: round2(acc.dealAmount + owner.dealAmount),
      grossCommission: round2(acc.grossCommission + owner.grossCommission),
      clawback: round2(acc.clawback + owner.clawback),
      netCommission: round2(acc.netCommission + owner.netCommission),
    }),
    { ownerCount: 0, dealCount: 0, dealAmount: 0, grossCommission: 0, clawback: 0, netCommission: 0 },
  );

  const unmappedStripeCustomerDeals = preparedDeals
    .filter((deal) => deal.workspaceId && !deal.stripeCustomerIds.length)
    .map((deal) => ({
      dealId: deal.dealId,
      dealName: deal.dealName,
      hubspotUrl: hubspotDealUrl(deal.dealId),
      ownerName: ownerDisplayName(ownersById.get(deal.ownerId), deal.ownerId),
      closeDate: deal.closeDate.slice(0, 10),
      workspaceId: deal.workspaceId,
    }))
    .sort((a, b) => b.closeDate.localeCompare(a.closeDate) || a.dealName.localeCompare(b.dealName));

  if (unmappedStripeCustomerDeals.length) {
    warnings.add("Some deals have no Stripe customer match for their primary workspace ID; those deals remain payable but cannot be clawback-checked.");
  }
  if (preparedDeals.some((deal) => !deal.workspaceId)) {
    warnings.add("Some deals are missing a primary workspace ID; those deals remain payable but cannot be clawback-checked.");
  }

  return {
    month,
    monthLabel: selected.start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    targetCurrency,
    generatedAt: new Date().toISOString(),
    totals,
    owners,
    warnings: Array.from(warnings),
    warningDetails: {
      unmappedStripeCustomerDeals,
    },
    methodology: {
      includedPipelines: pipelines.map((pipeline) => pipeline.name),
      dealTypes: ["New Business", "Existing Business for approved reps"],
      existingBusinessOwners: includedExistingBusinessOwners,
      commissionRates: COMMISSION_RATES,
      clawbackRule:
        "A churn or downgrade is assigned to one deal only. Stripe upgrades do not change commissions unless a qualifying replacement HubSpot deal exists; then the prior deal is retained only on its plan payments and the replacement deal is commissioned for the original contract's remaining months, with no overlap. Until Stripe shows full plan payments for the first three eligible months, commission is retained only on plan payments net of refunds; for mid-month starts, the prorated opening month does not advance the three-month clock, which begins on the next 1st.",
      paymentSource:
        "botpress-stripe-data-pipeline.stripe BigQuery tables (stripe_arr_correct profile; plan lines only, net of refunds)",
    },
  };
}
