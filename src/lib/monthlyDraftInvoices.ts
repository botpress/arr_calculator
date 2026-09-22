import Stripe from "stripe";
import {
  batchReadLineItems,
  fetchDealsInStage,
  fetchLineItemIdsForDeals,
} from "@/lib/hubspot";
import { LI_PROPS } from "@/lib/logic";
import { buildDraftInvoiceLine, currentBillingMonth, parseBillingMonth, type DraftInvoiceLine } from "@/lib/monthlyDraftInvoiceRules";

type DraftJobOptions = {
  billingMonth?: string;
  dryRun: boolean;
  maxDeals?: number;
};

type DraftJobResult = {
  ok: true;
  dryRun: boolean;
  billingMonth: string;
  scannedDeals: number;
  eligibleDeals: number;
  createdDrafts: Array<{ dealId: string; dealName: string; customerId: string; invoiceId: string; lineCount: number; amountMinor: number; currency: string }>;
  plannedDrafts: Array<{ dealId: string; dealName: string; customerId: string; lineCount: number; amountMinor: number; currency: string }>;
  existingDrafts: Array<{ dealId: string; dealName: string; customerId: string; invoiceId: string; lineCount: number; amountMinor: number; currency: string }>;
  skipped: Array<{ dealId: string; reason: string; detail?: string }>;
};

function requiredEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function truthy(value: unknown) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function firstValue(properties: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = String(properties[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function safeMetadataValue(value: unknown) {
  return String(value || "").trim().slice(0, 500);
}

function safeSearchValue(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Unsupported Stripe search value: ${value}`);
  return value;
}

function stripeClient() {
  return new Stripe(requiredEnv("STRIPE_SECRET_KEY"), { maxNetworkRetries: 2 });
}

async function findCustomerByWorkspace(stripe: Stripe, workspaceId: string, metadataKey: string) {
  const safeWorkspaceId = safeSearchValue(workspaceId);
  const safeMetadataKey = safeSearchValue(metadataKey);
  const result = await stripe.customers.search({
    query: `metadata['${safeMetadataKey}']:'${safeWorkspaceId}'`,
    limit: 100,
  });
  const customers = result.data.filter((customer) => !customer.deleted);
  if (customers.length === 1) return { customerId: customers[0].id, reason: "" };
  if (customers.length > 1) return { customerId: "", reason: "multiple_stripe_customers" };
  return { customerId: "", reason: "stripe_customer_not_found" };
}

async function validateExplicitCustomer(stripe: Stripe, customerId: string) {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer.deleted ? "" : customer.id;
  } catch {
    return "";
  }
}

async function findExistingInvoice(stripe: Stripe, customerId: string, dealId: string, billingMonth: string) {
  const safeDealId = safeSearchValue(dealId);
  try {
    const result = await stripe.invoices.search({
      query: `metadata['hubspot_deal_id']:'${safeDealId}' AND metadata['billing_period']:'${billingMonth}'`,
      limit: 100,
    });
    const exact = result.data.find((invoice) =>
      String(typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id || "") === customerId,
    );
    if (exact) return exact;
  } catch {
    // Search is unavailable for some Stripe accounts. Fall back to a consistent customer invoice listing.
  }

  const invoices = stripe.invoices.list({ customer: customerId, limit: 100 });
  let inspected = 0;
  for await (const invoice of invoices) {
    if (invoice.metadata?.hubspot_deal_id === dealId && invoice.metadata?.billing_period === billingMonth) {
      return invoice;
    }
    inspected += 1;
    if (inspected >= 1000) break;
  }
  return null;
}

async function countInvoiceLines(stripe: Stripe, invoice: Stripe.Invoice) {
  try {
    let count = 0;
    for await (const line of stripe.invoices.listLineItems(invoice.id, { limit: 100 })) {
      void line;
      count += 1;
      if (count >= 1000) break;
    }
    return count;
  } catch {
    return invoice.lines.data.length;
  }
}

async function createDraftInvoice(args: {
  stripe: Stripe;
  customerId: string;
  dealId: string;
  dealName: string;
  workspaceId: string;
  billingMonth: string;
  currency: string;
  daysUntilDue: number;
  lines: DraftInvoiceLine[];
}) {
  const metadata = {
    source: "hubspot_monthly_draft_job",
    hubspot_deal_id: safeMetadataValue(args.dealId),
    workspace_id: safeMetadataValue(args.workspaceId),
    billing_period: args.billingMonth,
  };
  const invoice = await args.stripe.invoices.create(
    {
      customer: args.customerId,
      auto_advance: false,
      collection_method: "send_invoice",
      days_until_due: args.daysUntilDue,
      currency: args.currency,
      description: `${args.dealName || `HubSpot deal ${args.dealId}`} — ${args.billingMonth}`.slice(0, 500),
      metadata,
      pending_invoice_items_behavior: "exclude",
    },
    { idempotencyKey: `hs-draft-invoice-${args.dealId}-${args.billingMonth}` },
  );

  try {
    for (const line of args.lines) {
      await args.stripe.invoiceItems.create(
        {
          customer: args.customerId,
          invoice: invoice.id,
          amount: line.amountMinor,
          currency: line.currency,
          description: line.description,
          discountable: true,
          period: { start: line.periodStart, end: line.periodEnd },
          metadata: {
            ...metadata,
            hubspot_line_item_id: safeMetadataValue(line.lineItemId),
          },
        },
        { idempotencyKey: `hs-draft-line-${args.dealId}-${args.billingMonth}-${line.lineItemId}` },
      );
    }
    return invoice;
  } catch (error) {
    try {
      await args.stripe.invoices.del(invoice.id);
    } catch {
      // Leave the incomplete invoice as a draft if rollback fails; it can never auto-finalize.
    }
    throw error;
  }
}

export function monthlyDraftInvoicesEnabled() {
  return truthy(process.env.BILLING_DRAFTS_ENABLED);
}

export async function runMonthlyDraftInvoiceJob(options: DraftJobOptions): Promise<DraftJobResult> {
  const billingMonth = String(options.billingMonth || currentBillingMonth()).trim();
  parseBillingMonth(billingMonth);

  const pipelineId = String(process.env.BILLING_PIPELINE_ID || "0cbbc8c6-dccf-4601-8d59-b6a15ed5129b").trim();
  const stageId = String(process.env.BILLING_DEALSTAGE || "f12c408f-f92b-4a95-8b59-9f801b19b105").trim();
  const workspaceProperty = String(process.env.DEAL_WORKSPACE_ID_PROP || "workspace_id").trim();
  const customerIdProperty = String(process.env.BILLING_STRIPE_CUSTOMER_ID_PROPERTY || "").trim();
  const customerMetadataKey = String(process.env.BILLING_STRIPE_CUSTOMER_METADATA_KEY || "workspace_id").trim();
  const defaultDaysUntilDue = boundedInteger(process.env.BILLING_DAYS_UNTIL_DUE, 30, 0, 365);
  const daysUntilDueProperty = String(process.env.BILLING_DAYS_UNTIL_DUE_PROPERTY || "").trim();
  const allowedCurrencies = new Set(
    String(process.env.BILLING_ALLOWED_CURRENCIES || "USD")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  );
  const maxDeals = boundedInteger(options.maxDeals ?? process.env.BILLING_MAX_DEALS_PER_RUN, 1000, 1, 1000);

  const dealProperties = Array.from(new Set([
    "dealname",
    "deal_currency_code",
    "pipeline",
    workspaceProperty,
    customerIdProperty,
    daysUntilDueProperty,
  ].filter(Boolean)));
  const allDeals = await fetchDealsInStage(dealProperties, stageId);
  const scopedDeals = allDeals
    .filter((deal) => String(deal.properties?.pipeline || "").trim() === pipelineId)
    .slice(0, maxDeals);
  const dealIds = scopedDeals.map((deal) => String(deal.id));
  const associations = await fetchLineItemIdsForDeals(dealIds);
  const lineItemIdsByDeal = new Map(associations.map((entry) => [entry.dealId, entry.ids]));
  const allLineItemIds = Array.from(new Set(associations.flatMap((entry) => entry.ids)));
  const lineItemsById = await batchReadLineItems(allLineItemIds, LI_PROPS);
  const stripe = stripeClient();

  const result: DraftJobResult = {
    ok: true,
    dryRun: options.dryRun,
    billingMonth,
    scannedDeals: allDeals.length,
    eligibleDeals: scopedDeals.length,
    createdDrafts: [],
    plannedDrafts: [],
    existingDrafts: [],
    skipped: [],
  };

  for (const deal of scopedDeals) {
    const dealId = String(deal.id);
    const properties = (deal.properties || {}) as Record<string, unknown>;
    const dealName = String(properties.dealname || `HubSpot deal ${dealId}`).trim();
    const workspaceId = firstValue(properties, [workspaceProperty, "workspace_id", "workspace_id__c"]);
    const currency = String(properties.deal_currency_code || "USD").trim().toUpperCase();
    if (!allowedCurrencies.has(currency)) {
      result.skipped.push({ dealId, reason: "currency_not_allowed", detail: currency });
      continue;
    }

    const lines: DraftInvoiceLine[] = [];
    const lineSkips: string[] = [];
    for (const lineItemId of lineItemIdsByDeal.get(dealId) || []) {
      const lineItem = lineItemsById.get(lineItemId);
      if (!lineItem) {
        lineSkips.push(`${lineItemId}:not_found`);
        continue;
      }
      const built = buildDraftInvoiceLine({
        lineItemId,
        properties: lineItem.properties || {},
        billingMonth,
        currency,
      });
      if (built.line) lines.push(built.line);
      else if (built.reason !== "not_due" && built.reason !== "contract_ended") lineSkips.push(`${lineItemId}:${built.reason}`);
    }
    if (!lines.length) {
      result.skipped.push({ dealId, reason: "no_billable_lines", detail: lineSkips.slice(0, 10).join(", ") || undefined });
      continue;
    }
    if (lines.length > 250) {
      result.skipped.push({ dealId, reason: "too_many_billable_lines", detail: String(lines.length) });
      continue;
    }

    let customerId = customerIdProperty ? String(properties[customerIdProperty] || "").trim() : "";
    if (customerId) customerId = await validateExplicitCustomer(stripe, customerId);
    if (!customerId) {
      if (!workspaceId) {
        result.skipped.push({ dealId, reason: "missing_customer_mapping" });
        continue;
      }
      let match: Awaited<ReturnType<typeof findCustomerByWorkspace>>;
      try {
        match = await findCustomerByWorkspace(stripe, workspaceId, customerMetadataKey);
      } catch (error) {
        result.skipped.push({
          dealId,
          reason: "stripe_customer_lookup_failed",
          detail: error instanceof Error ? error.message.slice(0, 300) : "Unknown Stripe error",
        });
        continue;
      }
      if (!match.customerId) {
        result.skipped.push({ dealId, reason: match.reason, detail: workspaceId });
        continue;
      }
      customerId = match.customerId;
    }

    let existingInvoice: Stripe.Invoice | null = null;
    try {
      existingInvoice = await findExistingInvoice(stripe, customerId, dealId, billingMonth);
    } catch (error) {
      result.skipped.push({
        dealId,
        reason: "stripe_invoice_lookup_failed",
        detail: error instanceof Error ? error.message.slice(0, 300) : "Unknown Stripe error",
      });
      continue;
    }
    if (existingInvoice) {
      const existingLineCount = await countInvoiceLines(stripe, existingInvoice);
      result.existingDrafts.push({
        dealId,
        dealName,
        customerId,
        invoiceId: existingInvoice.id,
        lineCount: existingLineCount,
        amountMinor: existingInvoice.amount_due,
        currency: existingInvoice.currency.toUpperCase(),
      });
      continue;
    }

    const amountMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
    if (options.dryRun) {
      result.plannedDrafts.push({ dealId, dealName, customerId, lineCount: lines.length, amountMinor, currency });
      continue;
    }

    const configuredDaysUntilDue = daysUntilDueProperty ? Number(properties[daysUntilDueProperty]) : defaultDaysUntilDue;
    const daysUntilDue = boundedInteger(configuredDaysUntilDue, defaultDaysUntilDue, 0, 365);
    try {
      const invoice = await createDraftInvoice({
        stripe,
        customerId,
        dealId,
        dealName,
        workspaceId,
        billingMonth,
        currency: currency.toLowerCase(),
        daysUntilDue,
        lines,
      });
      result.createdDrafts.push({ dealId, dealName, customerId, invoiceId: invoice.id, lineCount: lines.length, amountMinor, currency });
    } catch (error) {
      result.skipped.push({
        dealId,
        reason: "stripe_create_failed",
        detail: error instanceof Error ? error.message.slice(0, 300) : "Unknown Stripe error",
      });
    }
  }

  return result;
}
