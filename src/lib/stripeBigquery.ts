import { createSign } from "node:crypto";
import { fetchSalesAssistWorkspaceIds } from "@/lib/hubspot";
import {
  canonicalCountryLabel,
  canonicalTerritoryLabel,
  countryCodeFromValue,
  countryCodeToTerritoryEntries,
  countryNameKeyToCodeEntries,
} from "@/lib/geo";
import type { SyncedStripeLineItem } from "@/lib/stripeSyncStore";
import type { ReportRow } from "@/lib/types";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

type BigQueryQueryResponse = {
  schema?: { fields?: Array<{ name: string }> };
  rows?: Array<{ f?: Array<{ v?: unknown }> }>;
  pageToken?: string;
  jobComplete?: boolean;
  jobReference?: {
    projectId?: string;
    jobId?: string;
    location?: string;
  };
};

export type StripeBigQueryFilters = {
  customerId?: string;
  lineItemDescription?: string;
  lineItemDescriptionPrefix?: string;
};

export type StripeBigQueryPeriodSpec = {
  key: string;
  label: string;
  startTsMs: number;
  endTsMs: number;
};

export type StripeBigQueryGroupField = "customerId" | "lineItemDescription" | "lineItemDescriptionPrefix";
export type StripeBigQueryProfile = "default" | "stripe_arr_correct";

export type StripeBigQueryReportRequest = {
  startTsMs: number;
  endTsMs: number;
  targetCurrency: string;
  page: number;
  pageSize: number;
  periods: StripeBigQueryPeriodSpec[];
  sortByPeriodKey?: string;
  groupByFields?: StripeBigQueryGroupField[];
  filters?: StripeBigQueryFilters;
};

type StripeBigQueryReportBase = {
  rows: ReportRow[];
  totalsByPeriod: { key: string; label: string; total: number }[];
  totalRows: number;
  sourceRowsFetched: number;
};

export type StripeBigQueryPeriodTotal = {
  key: string;
  label: string;
  total: number;
};

export type StripeBigQueryReportPageResult = StripeBigQueryReportBase & {
  page: number;
  totalPages: number;
};

export type StripeThroughMrrGroupBy =
  | "none"
  | "customer_id"
  | "country"
  | "territory"
  | "product_id"
  | "price_id"
  | "subscription_id"
  | "subscription_item_id"
  | "event_type"
  | "email";
export type StripeThroughMrrGrain = "monthly" | "daily";

export type StripeThroughMrrMonthlyRow = {
  monthKey: string;
  monthLabel: string;
  monthEndMrr: number;
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnMrr: number;
  netMrrChange: number;
};

export type StripeThroughMrrRawDetailRow = {
  eventTimestampUtc: string;
  eventType: string;
  mrrChange: number;
  customerId: string;
  customerCountry: string;
  customerTerritory: string;
  subscriptionId: string;
  subscriptionItemId: string;
  productId: string;
  productDescription: string;
  priceId: string;
  priceDescription: string;
};

export type StripeThroughMrrGroupedDetailRow = {
  groupKey: string;
  groupLabel: string;
  customerCountry?: string;
  customerTerritory?: string;
  monthKey: string;
  monthLabel: string;
  eventCount: number;
  netMrrChange: number;
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnMrr: number;
  monthEndMrr: number;
  monthEndArr: number;
  associatedCustomerIds?: string[];
  associatedWorkspaceIds?: string[];
  salesAssist?: "yes" | "no";
};

export type StripeThroughMrrReportRequest = {
  startDate: string;
  endDate: string;
  detailStartMonth: string;
  detailEndMonth: string;
  grain?: StripeThroughMrrGrain;
  groupBy: StripeThroughMrrGroupBy;
  countryFilters?: string[];
  page: number;
  pageSize: number;
  targetCurrency: string;
  skipSummary?: boolean;
  skipCount?: boolean;
};

export type StripeThroughMrrReportResult = {
  startDate: string;
  endDate: string;
  detailStartMonth: string;
  detailEndMonth: string;
  grain: StripeThroughMrrGrain;
  groupBy: StripeThroughMrrGroupBy;
  targetCurrency: string;
  totalMrr: number;
  months: StripeThroughMrrMonthlyRow[];
  detailRows: Array<StripeThroughMrrRawDetailRow | StripeThroughMrrGroupedDetailRow>;
  detailMode: "raw" | "grouped";
  pagination: {
    page: number;
    pageSize: number;
    returnedRows: number;
    totalRows: number;
    totalPages: number;
    hasMore: boolean;
  };
};

export type StripeThroughMrrCustomerArrRow = {
  customerKey: string;
  customerIds: string[];
  workspaceIds: string[];
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  arr: number;
};

export type StripeThroughMrrCustomerArrRequest = {
  startDate: string;
  endDate: string;
  targetCurrency: string;
  grain?: "daily" | "monthly";
  baseSubscriptionOnly?: boolean;
};

export type StripeThroughMrrCustomerArrResult = {
  startDate: string;
  endDate: string;
  targetCurrency: string;
  grain: "daily" | "monthly";
  rows: StripeThroughMrrCustomerArrRow[];
};

export type StripeThroughMrrSalesAssistExportRequest = {
  detailMonth: string;
  targetCurrency: string;
  workspaceIds?: string[];
};

export type StripeThroughMrrSalesAssistExportCandidateRow = {
  emailGroup: string;
  associatedCustomerIds: string[];
  associatedWorkspaceIds: string[];
  customerCountry: string;
  customerCountryCode: string;
  customerTerritory: string;
  previousMonthEndMrr: number;
  currentMonthEndMrr: number;
};

export type StripeThroughMrrSalesAssistExportResult = {
  detailMonth: string;
  previousMonth: string;
  targetCurrency: string;
  rows: StripeThroughMrrSalesAssistExportCandidateRow[];
};

export type StripeCustomerWorkspaceCustomerMapping = {
  workspaceId: string;
  customerId: string;
};

export type StripeCustomerIdsByWorkspaceResult = {
  workspaceIds: string[];
  customerIds: string[];
  mappings: StripeCustomerWorkspaceCustomerMapping[];
};

export type StripeThroughMrrCustomerPlan = "enterprise" | "managed" | "team" | "plus" | "pay_as_you_go" | "free";

export type StripeThroughMrrCustomerPlanRow = {
  customerKey: string;
  customerIds: string[];
  workspaceIds: string[];
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  plan: StripeThroughMrrCustomerPlan;
  arr: number;
};

export type StripeThroughMrrCustomerPlanRequest = {
  startDate: string;
  endDate: string;
  targetCurrency: string;
  grain?: "daily" | "monthly";
};

export type StripeThroughMrrCustomerPlanResult = {
  startDate: string;
  endDate: string;
  targetCurrency: string;
  grain: "daily" | "monthly";
  rows: StripeThroughMrrCustomerPlanRow[];
};

export type StripeManagedEarlyLifecycleActivityRow = {
  workspaceId: string;
  customerId: string;
  managedStartDate: string;
  activityDate: string;
};

export type StripeManagedEarlyLifecycleActivityResult = {
  rows: StripeManagedEarlyLifecycleActivityRow[];
};

export type StripeLegacyToV4MigrationRequest = {
  startDate: string;
  endDate: string;
  targetCurrency: string;
};

export type StripeLegacyToV4MigrationRow = {
  customerId: string;
  customerName: string;
  customerEmail: string;
  workspaceId: string;
  migratedAt: string;
  previousPlan: string;
  currentPlan: string;
  migratedArr: number;
  legacyArrBefore: number;
  v4ArrAfter: number;
};

export type StripeLegacyToV4MigrationResult = {
  startDate: string;
  endDate: string;
  targetCurrency: string;
  rows: StripeLegacyToV4MigrationRow[];
};

export type StripeLegacyPlanPopulationRequest = {
  fiscalYearStart: string;
  asOfDate: string;
  targetCurrency: string;
};

export type StripeLegacyPlanPopulationResult = {
  fiscalYearStart: string;
  asOfDate: string;
  targetCurrency: string;
  opening: {
    customers: number;
    arr: number;
  };
  current: {
    customers: number;
    arr: number;
  };
  openingCustomers: StripeLegacyPlanPopulationCustomerRow[];
  currentCustomers: StripeLegacyPlanPopulationCustomerRow[];
};

export type StripeLegacyPlanPopulationCustomerRow = {
  customerId: string;
  customerName: string;
  customerEmail: string;
  workspaceId: string;
  arr: number;
};

export type StripeBillingOverviewGrain = "daily" | "weekly" | "monthly" | "quarterly";
export type StripeBillingOverviewGroupBy =
  | "none"
  | "product_id"
  | "price_id"
  | "subscription_item_id"
  | "subscription_id"
  | "customer_id";

export type StripeBillingOverviewRequest = {
  startDate: string;
  endDate: string;
  grain: StripeBillingOverviewGrain;
  targetCurrency: string;
  groupBy?: StripeBillingOverviewGroupBy;
  includeCustomerArrRows?: boolean;
  includeCurrentMonthProjection?: boolean;
};

export type StripeBillingOverviewPoint = {
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  mrrEnd: number;
  newMrr: number;
  reactivationMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnMrr: number;
  netMrrChange: number;
  mrrGrowthRatePct: number;
  arr: number;
  arrGrowth: number;
};

export type StripeBillingOverviewCustomerArrRow = {
  customerId: string;
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  arr: number;
};

export type StripeBillingOverviewGroupedSeries = {
  groupKey: string;
  groupLabel: string;
  historyPoints: StripeBillingOverviewPoint[];
  points: StripeBillingOverviewPoint[];
};

export type StripeBillingOverviewCurrentMonthProjectionPoint = {
  date: string;
  label: string;
  dayOfMonth: number;
  mrrActual: number | null;
  mrrProjected: number;
};

export type StripeBillingOverviewCurrentMonthProjection = {
  monthStart: string;
  monthEnd: string;
  observedThrough: string;
  historicalMonthsUsed: number;
  projectedEndMrr: number;
  model: "shape";
  points: StripeBillingOverviewCurrentMonthProjectionPoint[];
};

export type StripeBillingOverviewResult = {
  startDate: string;
  endDate: string;
  grain: StripeBillingOverviewGrain;
  groupBy: StripeBillingOverviewGroupBy;
  targetCurrency: string;
  currentMrr: number;
  currentArr: number;
  historyPoints: StripeBillingOverviewPoint[];
  points: StripeBillingOverviewPoint[];
  stripeExactHistoryPoints: StripeBillingOverviewPoint[];
  stripeExactPoints: StripeBillingOverviewPoint[];
  groupedSeries: StripeBillingOverviewGroupedSeries[];
  customerArrRows: StripeBillingOverviewCustomerArrRow[];
  currentMonthProjection: StripeBillingOverviewCurrentMonthProjection | null;
};

export type StripeAiSpendGrain = "daily" | "weekly" | "monthly" | "quarterly";

export type StripeAiSpendRequest = {
  startDate: string;
  endDate: string;
  grain: StripeAiSpendGrain;
  targetCurrency: string;
  topLimit?: number;
  detailLimit?: number;
  excludeCustomerIds?: string[];
  excludeCustomerMonthPairs?: string[];
  prepaidOffsetByCustomerMonthPairs?: Array<{
    pairKey: string;
    prepaidAppliedMajor: number;
  }>;
};

export type StripeAiSpendPoint = {
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  revenue: number;
  lineCount: number;
  customerCount: number;
};

export type StripeAiSpendGroupRow = {
  key: string;
  label: string;
  revenue: number;
  lineCount: number;
};

export type StripeAiSpendPriceRow = {
  priceId: string;
  priceLabel: string;
  productId: string;
  productLabel: string;
  revenue: number;
  lineCount: number;
};

export type StripeAiSpendDetailRow = {
  invoiceDate: string;
  customerId: string;
  customerName: string;
  lineItemId: string;
  lineItemDescription: string;
  priceId: string;
  priceLabel: string;
  productId: string;
  productLabel: string;
  revenue: number;
  quantity: number;
};

export type StripeAiSpendResult = {
  startDate: string;
  endDate: string;
  grain: StripeAiSpendGrain;
  targetCurrency: string;
  totalRevenue: number;
  meteredRevenueSalesled: number;
  meteredRevenueSelfserve: number;
  points: StripeAiSpendPoint[];
  topCustomers: StripeAiSpendGroupRow[];
  topProducts: StripeAiSpendGroupRow[];
  topPrices: StripeAiSpendPriceRow[];
  detailRows: StripeAiSpendDetailRow[];
};

export type StripeCustomerBalanceByEmailRequest = {
  emails: string[];
  asOfDate?: string;
};

export type StripeCustomerBalanceByEmailRow = {
  customerId: string;
  email: string;
  name: string;
  currency: string;
  balanceMinor: number;
  accountBalanceMinor: number;
  invoiceCreditBalance: string;
  batchTimestamp: string;
};

export type StripeCustomerInvoicePrepaidUsageByEmailRequest = {
  emails: string[];
  monthStartDate: string;
  monthEndDate: string;
  asOfDate?: string;
};

export type StripeCustomerInvoicePrepaidUsageByEmailRow = {
  customerId: string;
  email: string;
  name: string;
  currency: string;
  invoiceCount: number;
  creditInvoiceCount: number;
  prepaidAppliedMinor: number;
  maxAvailableCreditMinor: number;
  invoiceDateStart: string;
  invoiceDateEnd: string;
};

export type StripeSalesLedCustomerInvoicePrepaidUsageRequest = {
  monthStartDate: string;
  monthEndDate: string;
  asOfDate?: string;
};

export type StripeSalesLedCustomerInvoicePrepaidUsageRow = {
  customerId: string;
  email: string;
  name: string;
  currency: string;
  accountIds: string[];
  accountNames: string[];
  invoiceCount: number;
  creditInvoiceCount: number;
  prepaidAppliedMinor: number;
  maxAvailableCreditMinor: number;
  invoiceDateStart: string;
  invoiceDateEnd: string;
};

export type StripeSalesLedCustomerLatestInvoiceCreditRequest = {
  asOfDate?: string;
};

export type StripeSalesLedCustomerLatestInvoiceCreditRow = {
  customerId: string;
  email: string;
  name: string;
  currency: string;
  accountIds: string[];
  accountNames: string[];
  invoiceId: string;
  invoiceDate: string;
  availableCreditMinor: number;
};

export type StripeSalesLedCustomerCurrentBalanceRequest = {
  asOfDate?: string;
};

export type StripeSalesLedCustomerCurrentBalanceRow = {
  customerId: string;
  email: string;
  name: string;
  currency: string;
  accountIds: string[];
  accountNames: string[];
  currentBalanceMinor: number;
  accountBalanceMinor: number;
  invoiceCreditBalance: string;
  availableCreditMinor: number;
  batchTimestamp: string;
};

export type StripeCustomerCurrentBalanceByCustomerIdsRequest = {
  customerIds: string[];
  asOfDate?: string;
};

export type StripeCustomerCurrentBalanceByCustomerIdsRow = {
  customerId: string;
  email: string;
  name: string;
  currency: string;
  currentBalanceMinor: number;
  accountBalanceMinor: number;
  invoiceCreditBalance: string;
  availableCreditMinor: number;
  batchTimestamp: string;
};

export type StripeMeteredUsageByCustomerRequest = {
  customerIds: string[];
  startDate: string;
  endDate: string;
  targetCurrency: string;
};

export type StripeMeteredUsageByCustomerRow = {
  customerId: string;
  usageMajor: number;
  lineCount: number;
};

export type StripeUpcomingCurrentMonthRequest = {
  monthStartDate: string;
  nextMonthStartDate: string;
  targetCurrency: string;
};

export type StripeUpcomingCurrentMonthResult = {
  snapshotDate: string;
  lineCount: number;
  amountMinorSum: number;
  amountMajorSum: number;
  targetCurrency: string;
};

export type StripeUpcomingCurrentMonthDescriptionAmountRequest = {
  monthStartDate: string;
  nextMonthStartDate: string;
  targetCurrency: string;
  productDescriptionIncludes: string[];
  excludeCustomerIds?: string[];
  prepaidOffsetByCustomerIds?: Array<{
    customerId: string;
    prepaidAppliedMajor: number;
  }>;
};

export type StripeUpcomingCurrentMonthDescriptionAmountResult = {
  snapshotDate: string;
  snapshotTimestampUtc: string;
  lineCount: number;
  amountMinorSum: number;
  amountMajorSum: number;
  targetCurrency: string;
};

export type StripeAiSpendCurrentMonthFromUpcomingRequest = {
  startDate: string;
  endDate: string;
  grain: StripeAiSpendGrain;
  targetCurrency: string;
  topLimit?: number;
  detailLimit?: number;
  productDescriptionIncludes: string[];
  excludeCustomerIds?: string[];
  prepaidOffsetByCustomerIds?: Array<{
    customerId: string;
    prepaidAppliedMajor: number;
  }>;
};

export type StripeAiSpendCurrentMonthFromUpcomingResult = StripeAiSpendResult & {
  snapshotDate: string;
};

export type StripeAiSpendDailyAnnualizedFromUpcomingSnapshotsRequest = {
  startDate: string;
  endDate: string;
  targetCurrency: string;
  productDescriptionIncludes: string[];
  excludeCustomerMonthPairs?: string[];
  prepaidOffsetByCustomerMonthPairs?: Array<{
    pairKey: string;
    prepaidAppliedMajor: number;
  }>;
};

export type StripeAiSpendDailyAnnualizedFromUpcomingSnapshotsPoint = {
  snapshotDate: string;
  snapshotTimestampUtc: string;
  annualizedArrWithoutExclusions: number;
  annualizedArr: number;
  annualizedArrExcluded: number;
  lineCount: number;
  customerCount: number;
};

export type StripeAiSpendDailyAnnualizedFromUpcomingSnapshotsResult = {
  startDate: string;
  endDate: string;
  targetCurrency: string;
  points: StripeAiSpendDailyAnnualizedFromUpcomingSnapshotsPoint[];
};

export type StripeAiSpendDailyAnnualizedCustomerBreakdownRequest = {
  startDate: string;
  endDate: string;
  targetCurrency: string;
  productDescriptionIncludes: string[];
  excludeCustomerMonthPairs?: string[];
  prepaidOffsetByCustomerMonthPairs?: Array<{
    pairKey: string;
    prepaidAppliedMajor: number;
  }>;
};

export type StripeAiSpendDailyAnnualizedCustomerBreakdownRow = {
  snapshotDate: string;
  snapshotTimestampUtc: string;
  customerId: string;
  customerName: string;
  annualizedArrWithoutExclusions: number;
  annualizedArr: number;
  annualizedArrExcluded: number;
  lineCount: number;
};

export type StripeAiSpendDailyAnnualizedCustomerBreakdownResult = {
  startDate: string;
  endDate: string;
  targetCurrency: string;
  rows: StripeAiSpendDailyAnnualizedCustomerBreakdownRow[];
};

export type StripeUpcomingProjectedArrRequest = {
  monthStartDate: string;
  nextMonthStartDate: string;
  targetCurrency: string;
};

export type StripeUpcomingProjectedArrResult = {
  snapshotDate: string;
  lineCount: number;
  amountMajorSum: number;
  projectedArr: number;
  targetCurrency: string;
};

export type StripeUpcomingSnapshotsCleanupRequest = {
  targetDate?: string;
  dryRun?: boolean;
};

export type StripeUpcomingSnapshotsCleanupResult = {
  profile: StripeBigQueryProfile;
  table: string;
  targetDate: string;
  latestSnapshotKey: string;
  candidateRows: number;
  deletedRows: number;
  dryRun: boolean;
};

type BigQueryNamedParameter =
  | {
      name: string;
      type: "INT64" | "STRING";
      value: string;
    }
  | {
      name: string;
      type: "ARRAY_STRING";
      value: string[];
    };

type StripeBigQueryOptions = {
  profile?: StripeBigQueryProfile;
};

type AccessTokenCacheEntry = {
  token: string;
  expiresAtMs: number;
};

const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const BQ_SCOPE = "https://www.googleapis.com/auth/bigquery";
const BQ_MAX_RESULTS = Number(process.env.BIGQUERY_MAX_RESULTS || "50000");
const ACCESS_TOKEN_FALLBACK_TTL_MS = 50 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const STRIPE_ARR_CORRECT_DEFAULT_TABLE = "botpress-stripe-data-pipeline.stripe.invoice_lines_helper";
const STRIPE_ARR_CORRECT_MRR_CHANGE_DEFAULT_TABLE =
  "botpress-stripe-data-pipeline.stripe.subscription_item_change_events_v2_beta";
const STRIPE_PRODUCTS_DEFAULT_TABLE = "botpress-stripe-data-pipeline.stripe.products";
const STRIPE_PRICES_DEFAULT_TABLE = "botpress-stripe-data-pipeline.stripe.prices";
const STRIPE_CUSTOMERS_DEFAULT_TABLE = "botpress-stripe-data-pipeline.stripe.customers";
const STRIPE_CUSTOMERS_METADATA_DEFAULT_TABLE = "botpress-stripe-data-pipeline.stripe.customers_metadata";
const STRIPE_CHARGES_DEFAULT_TABLE = "botpress-stripe-data-pipeline.stripe.charges";
const STRIPE_PAYMENT_METHODS_DEFAULT_TABLE = "botpress-stripe-data-pipeline.stripe.payment_methods";
const STRIPE_UPCOMING_SNAPSHOTS_DEFAULT_TABLE =
  "botpress-stripe-data-pipeline.stripe.upcoming_invoice_line_snapshots";
const STRIPE_THROUGH_MRR_MAX_PAGE_SIZE = 100000;
const STRIPE_ARR_CORRECT_ENV_MAP: Record<string, string> = {
  GOOGLE_SERVICE_ACCOUNT_JSON: "GOOGLE_SERVICE_ACCOUNT_JSON_STRIPE_ARR_CORRECT",
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64_STRIPE_ARR_CORRECT",
  BIGQUERY_PROJECT_ID: "BIGQUERY_STRIPE_ARR_CORRECT_PROJECT_ID",
  BIGQUERY_LOCATION: "BIGQUERY_STRIPE_ARR_CORRECT_LOCATION",
  BIGQUERY_STRIPE_TABLE: "BIGQUERY_STRIPE_ARR_CORRECT_TABLE",
  BIGQUERY_STRIPE_CUSTOMERS_METADATA_TABLE: "BIGQUERY_STRIPE_ARR_CORRECT_CUSTOMERS_METADATA_TABLE",
  BIGQUERY_STRIPE_CHARGES_TABLE: "BIGQUERY_STRIPE_ARR_CORRECT_CHARGES_TABLE",
  BIGQUERY_STRIPE_PAYMENT_METHODS_TABLE: "BIGQUERY_STRIPE_ARR_CORRECT_PAYMENT_METHODS_TABLE",
  BIGQUERY_STRIPE_SERVING_TABLE: "BIGQUERY_STRIPE_ARR_CORRECT_SERVING_TABLE",
  BIGQUERY_SERVING_SCHEMA_MODE: "BIGQUERY_STRIPE_ARR_CORRECT_SERVING_SCHEMA_MODE",
  BIGQUERY_SCHEMA_MODE: "BIGQUERY_STRIPE_ARR_CORRECT_SCHEMA_MODE",
  BIGQUERY_SERVING_TS_UNIT: "BIGQUERY_STRIPE_ARR_CORRECT_SERVING_TS_UNIT",
  BIGQUERY_TS_UNIT: "BIGQUERY_STRIPE_ARR_CORRECT_TS_UNIT",
};

const SERVICE_ACCOUNT_CACHE = new Map<StripeBigQueryProfile, ServiceAccount>();
const ACCESS_TOKEN_CACHE = new Map<string, AccessTokenCacheEntry>();
const ACCESS_TOKEN_IN_FLIGHT = new Map<string, Promise<string>>();

function escapeSqlString(value: string) {
  return String(value || "").replace(/'/g, "''");
}

function buildUpcomingSnapshotTimestampSql(snapshotTsRef: string, snapshotDateRef: string) {
  const snapshotTsTextExpr = `NULLIF(TRIM(CAST(${snapshotTsRef} AS STRING)), '')`;
  return `COALESCE(
  SAFE_CAST(${snapshotTsTextExpr} AS TIMESTAMP),
  CASE
    WHEN REGEXP_CONTAINS(${snapshotTsTextExpr}, r'^\\d{13,}$') THEN TIMESTAMP_MILLIS(SAFE_CAST(${snapshotTsTextExpr} AS INT64))
    WHEN REGEXP_CONTAINS(${snapshotTsTextExpr}, r'^\\d{10}$') THEN TIMESTAMP_SECONDS(SAFE_CAST(${snapshotTsTextExpr} AS INT64))
    ELSE NULL
  END,
  SAFE.PARSE_TIMESTAMP('%Y%m%d%H', CAST(${snapshotDateRef} AS STRING)),
  SAFE.PARSE_TIMESTAMP('%Y%m%d', CAST(${snapshotDateRef} AS STRING)),
  SAFE_CAST(CAST(${snapshotDateRef} AS STRING) AS TIMESTAMP)
)`;
}

const COUNTRY_KEY_TO_CODE_SQL_WHENS = countryNameKeyToCodeEntries()
  .map(({ key, code }) => `WHEN '${escapeSqlString(key)}' THEN '${escapeSqlString(code)}'`)
  .join("\n      ");

const COUNTRY_CODE_TO_TERRITORY_SQL_WHENS = countryCodeToTerritoryEntries()
  .map(({ code, territory }) => `WHEN '${escapeSqlString(code)}' THEN '${escapeSqlString(territory)}'`)
  .join("\n      ");

function base64Url(input: Buffer | string) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function normalizeProfile(profile?: StripeBigQueryProfile): StripeBigQueryProfile {
  return profile === "stripe_arr_correct" ? "stripe_arr_correct" : "default";
}

function readEnv(name: string, profile: StripeBigQueryProfile = "default") {
  if (profile !== "stripe_arr_correct") return process.env[name];

  const mappedName = STRIPE_ARR_CORRECT_ENV_MAP[name];
  const mappedValue = mappedName ? process.env[mappedName] : undefined;
  if (mappedValue) return mappedValue;

  // For the corrected profile, pin table/project defaults and avoid inheriting
  // the default Stripe serving table by accident.
  if (name === "BIGQUERY_STRIPE_TABLE") return STRIPE_ARR_CORRECT_DEFAULT_TABLE;
  if (name === "BIGQUERY_STRIPE_SERVING_TABLE") return "";
  if (name === "BIGQUERY_SCHEMA_MODE") return "int_ts";
  if (name === "BIGQUERY_TS_UNIT") return "milliseconds";
  if (name === "BIGQUERY_SERVING_SCHEMA_MODE") return "int";
  if (name === "BIGQUERY_SERVING_TS_UNIT") return "milliseconds";

  if (name === "GOOGLE_SERVICE_ACCOUNT_JSON" || name === "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64") {
    return process.env[name];
  }
  if (name === "BIGQUERY_LOCATION") {
    return process.env[name];
  }
  return process.env[name];
}

function mustEnv(name: string, profile: StripeBigQueryProfile = "default") {
  const v = readEnv(name, profile);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getServiceAccount(profile: StripeBigQueryProfile = "default"): ServiceAccount {
  const cached = SERVICE_ACCOUNT_CACHE.get(profile);
  if (cached) return cached;

  const raw = readEnv("GOOGLE_SERVICE_ACCOUNT_JSON", profile);
  const rawB64 = readEnv("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64", profile);

  if (!raw && !rawB64) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
  }

  const jsonText = raw || Buffer.from(rawB64!, "base64").toString("utf8");
  const parsed = JSON.parse(jsonText) as Partial<ServiceAccount>;

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Invalid Google service account JSON");
  }

  const serviceAccount = {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    project_id: parsed.project_id,
  };
  SERVICE_ACCOUNT_CACHE.set(profile, serviceAccount);
  return serviceAccount;
}

async function getAccessToken(sa: ServiceAccount) {
  const cacheKey = `${sa.client_email}|${sa.project_id || ""}`;
  const current = Date.now();
  const cached = ACCESS_TOKEN_CACHE.get(cacheKey);
  if (cached && cached.expiresAtMs - ACCESS_TOKEN_REFRESH_BUFFER_MS > current) {
    return cached.token;
  }

  const inFlight = ACCESS_TOKEN_IN_FLIGHT.get(cacheKey);
  if (inFlight) return inFlight;

  const tokenPromise = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss: sa.client_email,
      sub: sa.client_email,
      aud: TOKEN_AUDIENCE,
      scope: BQ_SCOPE,
      iat: now,
      exp: now + 3600,
    };

    const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    const signature = signer.sign(sa.private_key);
    const assertion = `${unsigned}.${base64Url(signature)}`;

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });

    const res = await fetch(TOKEN_AUDIENCE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`Google token error ${res.status}: ${text}`);
    const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("Google token response missing access_token");
    const expiresInMs = Number.isFinite(json.expires_in) && Number(json.expires_in) > 0
      ? Number(json.expires_in) * 1000
      : ACCESS_TOKEN_FALLBACK_TTL_MS;
    ACCESS_TOKEN_CACHE.set(cacheKey, {
      token: json.access_token,
      expiresAtMs: Date.now() + expiresInMs,
    });
    return json.access_token;
  })();

  ACCESS_TOKEN_IN_FLIGHT.set(cacheKey, tokenPromise);
  try {
    return await tokenPromise;
  } finally {
    ACCESS_TOKEN_IN_FLIGHT.delete(cacheKey);
  }
}

function asString(v: unknown) {
  if (v == null) return "";
  return String(v);
}

function normalizeWorkspaceIdToken(value: string) {
  return String(value || "").trim().toLowerCase();
}

function asStringArray(v: unknown): string[] {
  const values: string[] = [];
  const pushValue = (raw: unknown) => {
    if (raw == null) return;
    if (Array.isArray(raw)) {
      for (const item of raw) pushValue(item);
      return;
    }
    if (typeof raw === "object") {
      const record = raw as { v?: unknown };
      if ("v" in record) {
        pushValue(record.v);
        return;
      }
    }
    const text = asString(raw).trim();
    if (!text || text === "(blank)") return;
    values.push(text);
  };
  pushValue(v);
  return Array.from(new Set(values));
}

function asNumber(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rowToObject(fields: string[], row: { f?: Array<{ v?: unknown }> }) {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < fields.length; i++) {
    out[fields[i]] = row.f?.[i]?.v;
  }
  return out;
}

function mapBigQueryRowToSyncedItem(raw: Record<string, unknown>, tsMultiplier: number): SyncedStripeLineItem {
  const invoiceId = asString(raw.invoice_id || raw.invoiceId);
  const lineItemId = asString(raw.line_item_id || raw.lineItemId);
  const customerId = asString(raw.customer_id || raw.customerId);
  const lineItemDescription = asString(raw.line_item_description || raw.lineItemDescription);

  const periodStart = Math.floor(asNumber(raw.period_start_ts || raw.periodStartTs) * tsMultiplier);
  const periodEnd = Math.floor(asNumber(raw.period_end_ts || raw.periodEndTs) * tsMultiplier);
  const invoiceCreated = Math.floor(asNumber(raw.invoice_created_ts || raw.invoiceCreatedTs) * tsMultiplier);

  return {
    key: `${invoiceId}:${lineItemId}`,
    invoiceId,
    invoiceCreatedTs: invoiceCreated,
    customerId,
    customerName: customerId,
    lineItemId,
    lineItemDescription,
    amountMinor: asNumber(raw.amount_minor || raw.amountMinor),
    currency: asString(raw.currency).toLowerCase(),
    quantity: asNumber(raw.quantity || 1),
    periodStartTs: periodStart,
    periodEndTs: periodEnd,
  };
}

function parseTextFilter(raw: string) {
  const tokens = String(raw || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  const includeTerms: string[] = [];
  const excludeTerms: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith("not ")) {
      const term = token.slice(4).trim().toLowerCase();
      if (term) excludeTerms.push(term);
    } else {
      includeTerms.push(lower);
    }
  }

  return { includeTerms, excludeTerms };
}

function pushStringFilterSql(
  clauses: string[],
  params: BigQueryNamedParameter[],
  columnExpr: string,
  rawFilter: string | undefined,
  prefix: string,
) {
  if (!rawFilter) return;
  const { includeTerms, excludeTerms } = parseTextFilter(rawFilter);
  if (includeTerms.length === 0 && excludeTerms.length === 0) return;

  if (includeTerms.length > 0) {
    const includeChecks: string[] = [];
    for (let i = 0; i < includeTerms.length; i++) {
      const name = `${prefix}_inc_${i}`;
      params.push({ name, type: "STRING", value: includeTerms[i] });
      includeChecks.push(`STRPOS(LOWER(CAST(${columnExpr} AS STRING)), @${name}) > 0`);
    }
    clauses.push(`(${includeChecks.join(" OR ")})`);
  }

  if (excludeTerms.length > 0) {
    for (let i = 0; i < excludeTerms.length; i++) {
      const name = `${prefix}_exc_${i}`;
      params.push({ name, type: "STRING", value: excludeTerms[i] });
      clauses.push(`STRPOS(LOWER(CAST(${columnExpr} AS STRING)), @${name}) = 0`);
    }
  }
}

function buildQuery(table: string) {
  const mode = (process.env.BIGQUERY_SCHEMA_MODE || "int_ts").toLowerCase();
  if (mode === "timestamp") {
    return `
SELECT
  COALESCE(JSON_VALUE(TO_JSON_STRING(t), '$.customer_id'), '') AS customer_id,
  CAST(invoice_id AS STRING) AS invoice_id,
  CAST(id AS STRING) AS line_item_id,
  CAST(description AS STRING) AS line_item_description,
  CAST(COALESCE(amount, 0) AS FLOAT64) AS amount_minor,
  LOWER(CAST(currency AS STRING)) AS currency,
  CAST(COALESCE(quantity, 1) AS FLOAT64) AS quantity,
  CAST(UNIX_MILLIS(period_start) AS INT64) AS period_start_ts,
  CAST(UNIX_MILLIS(period_end) AS INT64) AS period_end_ts,
  CAST(UNIX_MILLIS(period_start) AS INT64) AS invoice_created_ts,
  TO_JSON_STRING(t) AS raw_row_json
FROM \`${table}\` AS t
WHERE
  period_start <= TIMESTAMP_MILLIS(@range_end_ts)
  AND period_end > TIMESTAMP_MILLIS(@range_start_ts)
`;
  }

  return `
SELECT
  CAST(customer_id AS STRING) AS customer_id,
  CAST(invoice_id AS STRING) AS invoice_id,
  CAST(line_item_id AS STRING) AS line_item_id,
  CAST(line_item_description AS STRING) AS line_item_description,
  CAST(amount_minor AS FLOAT64) AS amount_minor,
  LOWER(CAST(currency AS STRING)) AS currency,
  CAST(quantity AS FLOAT64) AS quantity,
  CAST(period_start_ts AS INT64) AS period_start_ts,
  CAST(period_end_ts AS INT64) AS period_end_ts,
  CAST(invoice_created_ts AS INT64) AS invoice_created_ts,
  TO_JSON_STRING(t) AS raw_row_json
FROM \`${table}\` AS t
WHERE
  CAST(period_start_ts AS INT64) <= @range_end_ts
  AND CAST(period_end_ts AS INT64) > @range_start_ts
`;
}

function buildServingQueryTimestampColumns(table: string, filters?: StripeBigQueryFilters) {
  const filterClauses: string[] = [];
  const filterParams: BigQueryNamedParameter[] = [];
  pushStringFilterSql(filterClauses, filterParams, "customer_id", filters?.customerId, "customer_id");
  pushStringFilterSql(
    filterClauses,
    filterParams,
    "line_item_description",
    filters?.lineItemDescription,
    "line_item_description",
  );

  const query = `
SELECT
  CAST(customer_id AS STRING) AS customer_id,
  CAST(invoice_id AS STRING) AS invoice_id,
  CAST(line_item_id AS STRING) AS line_item_id,
  CAST(line_item_description AS STRING) AS line_item_description,
  CAST(amount_minor AS FLOAT64) AS amount_minor,
  LOWER(CAST(currency AS STRING)) AS currency,
  CAST(quantity AS FLOAT64) AS quantity,
  CAST(UNIX_MILLIS(period_start_ts) AS INT64) AS period_start_ts,
  CAST(UNIX_MILLIS(period_end_ts) AS INT64) AS period_end_ts,
  CAST(UNIX_MILLIS(COALESCE(invoice_created_ts, period_start_ts)) AS INT64) AS invoice_created_ts,
  TO_JSON_STRING(t) AS raw_row_json
FROM \`${table}\` AS t
WHERE
  period_start_ts <= TIMESTAMP_MILLIS(@range_end_ts)
  AND period_end_ts > TIMESTAMP_MILLIS(@range_start_ts)
  ${filterClauses.length ? `AND ${filterClauses.join(" AND ")}` : ""}
ORDER BY period_start_ts DESC, invoice_id DESC, line_item_id DESC
`;
  return { query, filterParams };
}

function buildServingQueryIntColumns(table: string, filters?: StripeBigQueryFilters) {
  const filterClauses: string[] = [];
  const filterParams: BigQueryNamedParameter[] = [];
  pushStringFilterSql(filterClauses, filterParams, "customer_id", filters?.customerId, "customer_id");
  pushStringFilterSql(
    filterClauses,
    filterParams,
    "line_item_description",
    filters?.lineItemDescription,
    "line_item_description",
  );

  const query = `
SELECT
  CAST(customer_id AS STRING) AS customer_id,
  CAST(invoice_id AS STRING) AS invoice_id,
  CAST(line_item_id AS STRING) AS line_item_id,
  CAST(line_item_description AS STRING) AS line_item_description,
  CAST(amount_minor AS FLOAT64) AS amount_minor,
  LOWER(CAST(currency AS STRING)) AS currency,
  CAST(quantity AS FLOAT64) AS quantity,
  CAST(period_start_ts AS INT64) AS period_start_ts,
  CAST(period_end_ts AS INT64) AS period_end_ts,
  CAST(COALESCE(invoice_created_ts, period_start_ts) AS INT64) AS invoice_created_ts,
  TO_JSON_STRING(t) AS raw_row_json
FROM \`${table}\` AS t
WHERE
  CAST(period_start_ts AS INT64) <= @range_end_ts
  AND CAST(period_end_ts AS INT64) > @range_start_ts
  ${filterClauses.length ? `AND ${filterClauses.join(" AND ")}` : ""}
ORDER BY CAST(period_start_ts AS INT64) DESC, invoice_id DESC, line_item_id DESC
`;
  return { query, filterParams };
}

type BigQuerySourceConfig = {
  table: string;
  servingTable: string;
  servingSchemaMode: string;
  schemaMode: string;
  tsUnit: string;
  tsMultiplier: number;
};

function getBigQuerySourceConfig(profile: StripeBigQueryProfile = "default"): BigQuerySourceConfig {
  const table = mustEnv("BIGQUERY_STRIPE_TABLE", profile);
  const servingTable = (readEnv("BIGQUERY_STRIPE_SERVING_TABLE", profile) || "").trim();
  const servingSchemaMode = (readEnv("BIGQUERY_SERVING_SCHEMA_MODE", profile) || "int").toLowerCase();
  const schemaMode = servingTable ? "int_ts" : (readEnv("BIGQUERY_SCHEMA_MODE", profile) || "int_ts").toLowerCase();
  const tsUnit = servingTable
    ? (readEnv("BIGQUERY_SERVING_TS_UNIT", profile) || "milliseconds").toLowerCase()
    : (readEnv("BIGQUERY_TS_UNIT", profile) || "milliseconds").toLowerCase();
  const tsMultiplier = schemaMode === "timestamp" ? 1 : tsUnit === "seconds" ? 1000 : 1;
  return { table, servingTable, servingSchemaMode, schemaMode, tsUnit, tsMultiplier };
}

function getStripeCustomersTable() {
  const configured = String(process.env.BIGQUERY_STRIPE_CUSTOMERS_TABLE || "").trim();
  return configured || STRIPE_CUSTOMERS_DEFAULT_TABLE;
}

function getStripeCustomersMetadataTable(profile: StripeBigQueryProfile = "default") {
  const envName =
    profile === "stripe_arr_correct"
      ? "BIGQUERY_STRIPE_ARR_CORRECT_CUSTOMERS_METADATA_TABLE"
      : "BIGQUERY_STRIPE_CUSTOMERS_METADATA_TABLE";
  const configured = String(process.env[envName] || "").trim();
  return configured || STRIPE_CUSTOMERS_METADATA_DEFAULT_TABLE;
}

function getStripeChargesTable(profile: StripeBigQueryProfile = "default") {
  const envName =
    profile === "stripe_arr_correct"
      ? "BIGQUERY_STRIPE_ARR_CORRECT_CHARGES_TABLE"
      : "BIGQUERY_STRIPE_CHARGES_TABLE";
  const configured = String(process.env[envName] || "").trim();
  return configured || STRIPE_CHARGES_DEFAULT_TABLE;
}

function getStripePaymentMethodsTable(profile: StripeBigQueryProfile = "default") {
  const envName =
    profile === "stripe_arr_correct"
      ? "BIGQUERY_STRIPE_ARR_CORRECT_PAYMENT_METHODS_TABLE"
      : "BIGQUERY_STRIPE_PAYMENT_METHODS_TABLE";
  const configured = String(process.env[envName] || "").trim();
  return configured || STRIPE_PAYMENT_METHODS_DEFAULT_TABLE;
}

function getStripeArrCorrectMrrChangeTable() {
  const configured = String(process.env.BIGQUERY_STRIPE_ARR_CORRECT_MRR_CHANGE_TABLE || "").trim();
  return configured || STRIPE_ARR_CORRECT_MRR_CHANGE_DEFAULT_TABLE;
}

function getStripeProductsTable(profile: StripeBigQueryProfile = "default") {
  const envName =
    profile === "stripe_arr_correct"
      ? "BIGQUERY_STRIPE_ARR_CORRECT_PRODUCTS_TABLE"
      : "BIGQUERY_STRIPE_PRODUCTS_TABLE";
  const configured = String(process.env[envName] || "").trim();
  return configured || STRIPE_PRODUCTS_DEFAULT_TABLE;
}

function getStripePricesTable(profile: StripeBigQueryProfile = "default") {
  const envName =
    profile === "stripe_arr_correct"
      ? "BIGQUERY_STRIPE_ARR_CORRECT_PRICES_TABLE"
      : "BIGQUERY_STRIPE_PRICES_TABLE";
  const configured = String(process.env[envName] || "").trim();
  return configured || STRIPE_PRICES_DEFAULT_TABLE;
}

function getStripeUpcomingSnapshotsTable(profile: StripeBigQueryProfile = "default") {
  const envName =
    profile === "stripe_arr_correct"
      ? "BIGQUERY_STRIPE_ARR_CORRECT_UPCOMING_SNAPSHOTS_TABLE"
      : "BIGQUERY_STRIPE_UPCOMING_SNAPSHOTS_TABLE";
  const configured = String(process.env[envName] || "").trim();
  return configured || STRIPE_UPCOMING_SNAPSHOTS_DEFAULT_TABLE;
}

function toQueryTimestamp(tsMs: number, sourceConfig: BigQuerySourceConfig) {
  if (sourceConfig.schemaMode === "timestamp") return Math.floor(tsMs);
  if (sourceConfig.tsUnit === "seconds") return Math.floor(tsMs / 1000);
  return Math.floor(tsMs);
}

function buildRawSourceQuery(sourceConfig: BigQuerySourceConfig) {
  if (sourceConfig.servingTable) {
    if (sourceConfig.servingSchemaMode === "int") {
      return `
SELECT
  CAST(customer_id AS STRING) AS customer_id,
  CAST(invoice_id AS STRING) AS invoice_id,
  CAST(line_item_id AS STRING) AS line_item_id,
  CAST(line_item_description AS STRING) AS line_item_description,
  CAST(amount_minor AS FLOAT64) AS amount_minor,
  LOWER(CAST(currency AS STRING)) AS currency,
  CAST(quantity AS FLOAT64) AS quantity,
  CAST(period_start_ts AS INT64) AS period_start_ts,
  CAST(period_end_ts AS INT64) AS period_end_ts,
  CAST(COALESCE(invoice_created_ts, period_start_ts) AS INT64) AS invoice_created_ts,
  TO_JSON_STRING(t) AS raw_row_json
FROM \`${sourceConfig.servingTable}\` AS t
WHERE
  CAST(period_start_ts AS INT64) <= @range_end_ts
  AND CAST(period_end_ts AS INT64) > @range_start_ts
`;
    }

    return `
SELECT
  CAST(customer_id AS STRING) AS customer_id,
  CAST(invoice_id AS STRING) AS invoice_id,
  CAST(line_item_id AS STRING) AS line_item_id,
  CAST(line_item_description AS STRING) AS line_item_description,
  CAST(amount_minor AS FLOAT64) AS amount_minor,
  LOWER(CAST(currency AS STRING)) AS currency,
  CAST(quantity AS FLOAT64) AS quantity,
  CAST(UNIX_MILLIS(period_start_ts) AS INT64) AS period_start_ts,
  CAST(UNIX_MILLIS(period_end_ts) AS INT64) AS period_end_ts,
  CAST(UNIX_MILLIS(COALESCE(invoice_created_ts, period_start_ts)) AS INT64) AS invoice_created_ts,
  TO_JSON_STRING(t) AS raw_row_json
FROM \`${sourceConfig.servingTable}\` AS t
WHERE
  period_start_ts <= TIMESTAMP_MILLIS(@range_end_ts)
  AND period_end_ts > TIMESTAMP_MILLIS(@range_start_ts)
`;
  }

  return buildQuery(sourceConfig.table);
}

function normalizeDescriptionBucketSql(valueExpr: string) {
  const normalized = `TRIM(REGEXP_REPLACE(REPLACE(REPLACE(LOWER(${valueExpr}), '_', ' '), '-', ' '), r'\\s+', ' '))`;
  return `CASE
    WHEN ${normalized} = '' THEN '(blank)'
    WHEN REGEXP_CONTAINS(${normalized}, r'remaining time on .+ add on') THEN 'Remaining Time on Add-On'
    WHEN REGEXP_CONTAINS(${normalized}, r'time on .+ add on') THEN 'Time on Add-On'
    ELSE ${valueExpr}
  END`;
}

function normalizeGroupByFields(fields?: StripeBigQueryGroupField[]) {
  return Array.from(new Set((fields || []).filter(Boolean)));
}

function asInt(v: unknown) {
  return Math.max(0, Math.floor(asNumber(v)));
}

function round2(v: number) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

type FixedAiSpendMonthAdjustment = {
  monthKey: string;
  amountMajor: number;
};

const FIXED_AI_SPEND_MONTH_ADJUSTMENTS: FixedAiSpendMonthAdjustment[] = [
  { monthKey: "2026-03", amountMajor: 300 },
];

function isoMonthFromIsoDate(value: string) {
  const match = /^(\d{4}-\d{2})-\d{2}$/.exec(String(value || "").trim());
  return match ? match[1] : "";
}

function dayDiffInclusive(startUtc: Date, endUtc: Date) {
  const ms = endUtc.getTime() - startUtc.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000) + 1;
}

function fixedAiSpendAdjustmentMajorForPeriod(periodStartIso: string, periodEndIso: string) {
  const periodStart = parseIsoDateUtc(periodStartIso);
  const periodEnd = parseIsoDateUtc(periodEndIso);
  if (!periodStart || !periodEnd) return 0;
  if (periodEnd.getTime() < periodStart.getTime()) return 0;

  let adjustment = 0;
  for (const config of FIXED_AI_SPEND_MONTH_ADJUSTMENTS) {
    const monthStart = parseIsoMonthUtc(config.monthKey);
    if (!monthStart) continue;
    const monthEnd = endOfMonthUtc(monthStart);
    const overlapStartMs = Math.max(periodStart.getTime(), monthStart.getTime());
    const overlapEndMs = Math.min(periodEnd.getTime(), monthEnd.getTime());
    if (overlapEndMs < overlapStartMs) continue;
    const overlapDays = dayDiffInclusive(new Date(overlapStartMs), new Date(overlapEndMs));
    const monthDays = dayDiffInclusive(monthStart, monthEnd);
    if (monthDays <= 0 || overlapDays <= 0) continue;
    adjustment += config.amountMajor * (overlapDays / monthDays);
  }
  return round2(adjustment);
}

function fixedAiSpendMonthlyAdjustmentMajorForMonth(monthKey: string) {
  const normalized = String(monthKey || "").trim();
  const found = FIXED_AI_SPEND_MONTH_ADJUSTMENTS.find((entry) => entry.monthKey === normalized);
  return round2(found?.amountMajor || 0);
}

function fixedAiSpendAnnualizedAdjustmentForSnapshotDate(snapshotDateIso: string) {
  const monthKey = isoMonthFromIsoDate(snapshotDateIso);
  if (!monthKey) return 0;
  return round2(fixedAiSpendMonthlyAdjustmentMajorForMonth(monthKey) * 12);
}

function applyFixedAiSpendAdjustmentsToPoints(points: StripeAiSpendPoint[]) {
  return (points || []).map((point) => {
    const adjustment = fixedAiSpendAdjustmentMajorForPeriod(point.periodStart, point.periodEnd);
    if (Math.abs(adjustment) <= 1e-9) return point;
    return {
      ...point,
      revenue: round2((Number(point.revenue || 0) + adjustment)),
    };
  });
}

function normalizeAnnualizationDescription(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function shouldForceTwelveByDescription(
  description: string,
  profile: StripeBigQueryProfile,
) {
  const normalized = normalizeAnnualizationDescription(description);
  if (!normalized) return false;
  if (profile === "stripe_arr_correct") {
    return normalized === "web search and crawl" || normalized.includes("ai tokens");
  }
  return normalized === "web search and crawl" || normalized === "ai tokens";
}

function annualizationMultiplierForUpcomingLine(
  periodStartTs: number,
  periodEndTs: number,
  description: string,
  profile: StripeBigQueryProfile,
) {
  const startMs = Math.floor(periodStartTs || 0);
  const endMs = Math.floor(periodEndTs || 0);
  const durationMs = endMs - startMs;
  if (durationMs <= 0) return 0;

  const startUtc = new Date(startMs);
  const oneYearAfterStartUtc = new Date(startMs);
  oneYearAfterStartUtc.setUTCFullYear(oneYearAfterStartUtc.getUTCFullYear() + 1);
  if (oneYearAfterStartUtc.getTime() === endMs) {
    return 1;
  }

  if (shouldForceTwelveByDescription(description, profile)) {
    return 12;
  }

  const oneMonthAfterStartUtc = new Date(startMs);
  oneMonthAfterStartUtc.setUTCMonth(oneMonthAfterStartUtc.getUTCMonth() + 1);
  if (oneMonthAfterStartUtc.getTime() === endMs) {
    return 12;
  }

  const monthStartMs = Date.UTC(
    startUtc.getUTCFullYear(),
    startUtc.getUTCMonth(),
    1,
    0,
    0,
    0,
    0,
  );
  const nextMonthStartMs = Date.UTC(
    startUtc.getUTCFullYear(),
    startUtc.getUTCMonth() + 1,
    1,
    0,
    0,
    0,
    0,
  );
  const monthMs = Math.max(nextMonthStartMs - monthStartMs, 1);
  return 12 * (monthMs / Math.max(durationMs, 1));
}

function parseIsoDateUtc(dateText: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) return null;
  if (monthIndex < 0 || monthIndex > 11) return null;
  if (day < 1 || day > 31) return null;
  const ts = Date.UTC(year, monthIndex, day, 0, 0, 0, 0);
  const d = new Date(ts);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== monthIndex ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

function parseIsoMonthUtc(monthText: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthText || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) return null;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
}

function isoMonthFromDateUtc(d: Date) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function isoDateFromUtcDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfMonthUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfMonthUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 0, 0, 0, 0));
}

function addMonthsUtc(d: Date, months: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

function minIsoDate(...values: string[]) {
  const filtered = values.filter((value) => !!value);
  if (!filtered.length) return "";
  return filtered.reduce((best, value) => (value < best ? value : best), filtered[0]);
}

type StripeDailyMrrPoint = {
  date: string;
  mrrEnd: number;
};

type StripeMonthlyShape = {
  days: number;
  progresses: number[];
};

function median(values: number[]) {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const mid = Math.floor(clean.length / 2);
  if (clean.length % 2 === 1) return clean[mid];
  return (clean[mid - 1] + clean[mid]) / 2;
}

function average(values: number[]) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function dayFraction(dayIndex: number, monthDays: number) {
  if (monthDays <= 1) return 1;
  return dayIndex / (monthDays - 1);
}

function normalizeWindowDays(monthDays: number, startDay: number, endDay: number) {
  const start = Math.max(1, Math.min(monthDays, startDay));
  const end = Math.max(start, Math.min(monthDays, endDay));
  return { start, end };
}

function linearInterpolation(start: number, end: number, frac: number) {
  return start + (end - start) * frac;
}

function averageSlice(values: number[], startDay: number, endDay: number) {
  if (!values.length) return 0;
  const monthDays = values.length;
  const window = normalizeWindowDays(monthDays, startDay, endDay);
  const startIdx = window.start - 1;
  const endIdx = window.end - 1;
  if (startIdx > endIdx) return 0;
  return average(values.slice(startIdx, endIdx + 1));
}

function dipAdjustmentForFraction(
  frac: number,
  dipStartFrac: number,
  dipMidFrac: number,
  dipEndFrac: number,
  dipDepth: number,
  postDipLevel: number,
) {
  const clamped = Math.max(0, Math.min(1, frac));
  if (clamped <= dipStartFrac) return 0;
  if (clamped <= dipMidFrac) {
    const t = (clamped - dipStartFrac) / Math.max(dipMidFrac - dipStartFrac, 1e-9);
    return linearInterpolation(0, dipDepth, t);
  }
  if (clamped <= dipEndFrac) {
    const t = (clamped - dipMidFrac) / Math.max(dipEndFrac - dipMidFrac, 1e-9);
    return linearInterpolation(dipDepth, postDipLevel, t);
  }
  const t = (clamped - dipEndFrac) / Math.max(1 - dipEndFrac, 1e-9);
  return linearInterpolation(postDipLevel, 0, t);
}

function buildStripeCurrentMonthProjection(params: {
  dailyPoints: StripeDailyMrrPoint[];
  requestedEndDateIso: string;
  todayUtc?: Date;
}): StripeBillingOverviewCurrentMonthProjection | null {
  const nowUtc = params.todayUtc || new Date();
  const todayUtcDateOnly = new Date(
    Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 0, 0, 0, 0),
  );
  const monthStartDate = startOfMonthUtc(todayUtcDateOnly);
  const monthEndDate = endOfMonthUtc(todayUtcDateOnly);
  const monthStartIso = isoDateFromUtcDate(monthStartDate);
  const monthEndIso = isoDateFromUtcDate(monthEndDate);
  if (params.requestedEndDateIso < monthStartIso) return null;

  const todayIso = isoDateFromUtcDate(todayUtcDateOnly);
  const observedThroughTargetIso = minIsoDate(todayIso, params.requestedEndDateIso, monthEndIso);
  const dailyByDate = new Map<string, number>();
  for (const point of params.dailyPoints) {
    if (!point.date) continue;
    dailyByDate.set(point.date, point.mrrEnd);
  }

  const monthDates: string[] = [];
  const monthActualValues: Array<number | null> = [];
  for (let day = 1; day <= monthEndDate.getUTCDate(); day++) {
    const dayIso = isoDateFromUtcDate(
      new Date(Date.UTC(todayUtcDateOnly.getUTCFullYear(), todayUtcDateOnly.getUTCMonth(), day, 0, 0, 0, 0)),
    );
    monthDates.push(dayIso);
    monthActualValues.push(dailyByDate.has(dayIso) ? (dailyByDate.get(dayIso) as number) : null);
  }

  let observedIndex = -1;
  for (let idx = 0; idx < monthDates.length; idx++) {
    if (monthDates[idx] > observedThroughTargetIso) continue;
    if (monthActualValues[idx] == null) continue;
    observedIndex = idx;
  }
  if (observedIndex < 0) return null;
  const observedThroughIso = monthDates[observedIndex];
  const monthStartMrr = monthActualValues[0];
  if (monthStartMrr == null) return null;
  const observedMrr = monthActualValues[observedIndex];
  if (observedMrr == null) return null;
  const todayStartMs = Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 0, 0, 0, 0);
  const tomorrowStartMs = Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() + 1, 0, 0, 0, 0);
  const observedDayInProgress =
    observedThroughIso === todayIso && nowUtc.getTime() > todayStartMs && nowUtc.getTime() < tomorrowStartMs;
  const observedDayProgress = observedDayInProgress
    ? Math.max(
        0,
        Math.min(
          1,
          (nowUtc.getTime() - todayStartMs) / 86_400_000,
        ),
      )
    : 1;
  const observedPosition = observedDayInProgress
    ? Math.max(0, observedIndex - (1 - observedDayProgress))
    : observedIndex;

  const historicalShapes: StripeMonthlyShape[] = [];
  const historicalPerDaySlopes: number[] = [];
  const historicalDipDepthAbs: number[] = [];
  const historicalDipDepthPct: number[] = [];
  const historicalPostDipLevelAbs: number[] = [];
  const historicalRecoveryShare: number[] = [];

  for (let offset = 12; offset >= 1; offset--) {
    const shapeMonthStart = addMonthsUtc(monthStartDate, -offset);
    const shapeMonthEnd = endOfMonthUtc(shapeMonthStart);
    const daysInMonth = shapeMonthEnd.getUTCDate();
    const values: number[] = [];
    let complete = true;
    for (let day = 1; day <= daysInMonth; day++) {
      const dayIso = isoDateFromUtcDate(
        new Date(Date.UTC(shapeMonthStart.getUTCFullYear(), shapeMonthStart.getUTCMonth(), day, 0, 0, 0, 0)),
      );
      const value = dailyByDate.get(dayIso);
      if (value == null) {
        complete = false;
        break;
      }
      values.push(value);
    }
    if (!complete || values.length < 2) continue;
    const start = values[0];
    const end = values[values.length - 1];
    const slope = (end - start) / Math.max(daysInMonth - 1, 1);
    historicalPerDaySlopes.push(slope);

    const baseline = values.map((_, idx) => linearInterpolation(start, end, dayFraction(idx, daysInMonth)));
    const residuals = values.map((value, idx) => value - baseline[idx]);
    const dipResidual = averageSlice(residuals, 15, 21);
    const tailResidual = averageSlice(residuals, Math.max(daysInMonth - 4, 1), daysInMonth);
    const dipDepth = Math.min(dipResidual, 0);
    const postDip = Math.min(tailResidual, 0);
    historicalDipDepthAbs.push(dipDepth);
    historicalDipDepthPct.push(Math.abs(start) > 1e-9 ? dipDepth / start : 0);
    historicalPostDipLevelAbs.push(postDip);
    if (Math.abs(dipDepth) > 1e-9) {
      const recoveryShare = Math.max(0, Math.min(1, (postDip - dipDepth) / Math.abs(dipDepth)));
      historicalRecoveryShare.push(recoveryShare);
    }

    const delta = end - start;
    if (Math.abs(delta) >= 1e-9) {
      const progresses = values.map((value) => (value - start) / delta);
      historicalShapes.push({ days: daysInMonth, progresses });
    }
  }

  const monthDays = monthDates.length;
  const currentObservedSlope =
    observedPosition > 0 ? (observedMrr - monthStartMrr) / Math.max(observedPosition, 1e-9) : 0;
  const historicalSlope = median(historicalPerDaySlopes);
  const monthProgress = Math.max(0, Math.min(1, observedPosition / Math.max(monthDays - 1, 1)));
  const currentWeight = Math.max(0.2, Math.min(0.9, monthProgress));
  const blendedSlope = currentObservedSlope * currentWeight + historicalSlope * (1 - currentWeight);
  const projectedLinearEnd = monthStartMrr + blendedSlope * Math.max(monthDays - 1, 0);

  const dipDepthAbs = median(historicalDipDepthAbs);
  const dipDepthPct = median(historicalDipDepthPct) * monthStartMrr;
  const dipDepth = Math.min((dipDepthAbs + dipDepthPct) / 2, 0);
  const recoveryShare = Math.max(0, Math.min(1, median(historicalRecoveryShare)));
  const postDipLevel = dipDepth * (1 - recoveryShare);

  const dipWindow = normalizeWindowDays(monthDays, 15, 21);
  const dipStartFrac = dayFraction(dipWindow.start - 1, monthDays);
  const dipEndFrac = dayFraction(dipWindow.end - 1, monthDays);
  const dipMidFrac = (dipStartFrac + dipEndFrac) / 2;

  const anchorIndex = observedDayInProgress ? Math.max(0, observedIndex - 1) : observedIndex;
  const anchorMrr = monthActualValues[anchorIndex] == null ? observedMrr : (monthActualValues[anchorIndex] as number);
  const anchorFrac = dayFraction(anchorIndex, monthDays);
  const modeledAtAnchor = linearInterpolation(monthStartMrr, projectedLinearEnd, anchorFrac)
    + dipAdjustmentForFraction(anchorFrac, dipStartFrac, dipMidFrac, dipEndFrac, dipDepth, postDipLevel);
  const anchorOffset = anchorMrr - modeledAtAnchor;

  const points: StripeBillingOverviewCurrentMonthProjectionPoint[] = monthDates.map((date, idx) => {
    const actual = monthActualValues[idx];
    const frac = dayFraction(idx, monthDays);
    const baseline = linearInterpolation(monthStartMrr, projectedLinearEnd, frac);
    const dipAdj = dipAdjustmentForFraction(frac, dipStartFrac, dipMidFrac, dipEndFrac, dipDepth, postDipLevel);
    const modeled = baseline + dipAdj + anchorOffset;
    let projected = modeled;
    if (idx < observedIndex && actual != null) {
      projected = actual;
    } else if (idx === observedIndex && actual != null && !observedDayInProgress) {
      projected = actual;
    } else if (idx === observedIndex && observedDayInProgress && actual != null) {
      projected = actual + (modeled - actual) * (1 - observedDayProgress);
    }
    return {
      date,
      label: date,
      dayOfMonth: idx + 1,
      mrrActual: idx <= observedIndex ? actual : null,
      mrrProjected: round2(projected),
    };
  });
  const projectedEndMrr = points.length ? round2(points[points.length - 1].mrrProjected) : round2(observedMrr);

  return {
    monthStart: monthStartIso,
    monthEnd: monthEndIso,
    observedThrough: observedThroughIso,
    historicalMonthsUsed: historicalPerDaySlopes.length,
    projectedEndMrr,
    model: "shape",
    points,
  };
}

async function fetchBigQueryResultsPage(
  accessToken: string,
  projectId: string,
  location: string,
  query: string,
  params: BigQueryNamedParameter[],
  pageToken?: string,
): Promise<BigQueryQueryResponse> {
  const queryParameters = params.map((parameter) => {
    if (parameter.type === "ARRAY_STRING") {
      return {
        name: parameter.name,
        parameterType: { type: "ARRAY", arrayType: { type: "STRING" } },
        parameterValue: { arrayValues: parameter.value.map((value) => ({ value })) },
      };
    }
    return {
      name: parameter.name,
      parameterType: { type: parameter.type },
      parameterValue: { value: parameter.value },
    };
  });

  const body: Record<string, unknown> = {
    query,
    useLegacySql: false,
    location,
    parameterMode: "NAMED",
    queryParameters,
    maxResults: BQ_MAX_RESULTS,
    timeoutMs: 20000,
  };

  if (pageToken) body.pageToken = pageToken;

  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`BigQuery error ${res.status}: ${text}`);
  return JSON.parse(text) as BigQueryQueryResponse;
}

async function waitForJobCompletion(
  accessToken: string,
  projectId: string,
  jobId: string,
  location: string,
): Promise<BigQueryQueryResponse> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}?location=${encodeURIComponent(location)}&maxResults=${encodeURIComponent(String(BQ_MAX_RESULTS))}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`BigQuery getQueryResults error ${res.status}: ${text}`);
    const json = JSON.parse(text) as BigQueryQueryResponse;
    if (json.jobComplete) return json;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("BigQuery query timed out waiting for completion");
}

async function runBigQueryQueryRows(
  accessToken: string,
  projectId: string,
  location: string,
  query: string,
  params: BigQueryNamedParameter[],
) {
  const rowsOut: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  let fields: string[] = [];

  while (true) {
    let json = await fetchBigQueryResultsPage(
      accessToken,
      projectId,
      location,
      query,
      params,
      pageToken,
    );
    if (!json.jobComplete && json.jobReference?.jobId) {
      const jobProjectId = json.jobReference.projectId || projectId;
      const jobLocation = json.jobReference.location || location;
      json = await waitForJobCompletion(accessToken, jobProjectId, json.jobReference.jobId, jobLocation);
    }

    const pageFields = (json.schema?.fields || []).map((f) => f.name);
    if (pageFields.length) fields = pageFields;
    for (const row of json.rows || []) {
      rowsOut.push(rowToObject(fields, row));
    }

    if (!json.pageToken) break;
    pageToken = json.pageToken;
  }

  return rowsOut;
}

type BuiltStripeBigQueryReport = {
  ctesSql: string;
  sharedParams: BigQueryNamedParameter[];
  periodAliases: string[];
  orderBySql: string;
  groupByFields: StripeBigQueryGroupField[];
};

function buildStripeBigQueryReportQuery(
  request: StripeBigQueryReportRequest,
  sourceConfig: BigQuerySourceConfig,
  rangeStart: number,
  rangeEnd: number,
  profile: StripeBigQueryProfile,
): BuiltStripeBigQueryReport {
  const useStripeArrCorrectAnnualizationRules = profile === "stripe_arr_correct";
  const rawSourceQuery = buildRawSourceQuery(sourceConfig);
  const groupByFields = normalizeGroupByFields(request.groupByFields);
  const rawDescriptionExpr =
    "COALESCE(NULLIF(TRIM(CAST(line_item_description AS STRING)), ''), NULLIF(TRIM(CAST(line_item_id AS STRING)), ''), '(no description)')";
  const normalizedDescriptionExpr = `TRIM(REGEXP_REPLACE(LOWER(${rawDescriptionExpr}), r'\\s+', ' '))`;
  const forceTwelveByDescriptionCondition = useStripeArrCorrectAnnualizationRules
    ? `(${normalizedDescriptionExpr} = 'web search and crawl' OR STRPOS(${normalizedDescriptionExpr}, 'ai tokens') > 0)`
    : `${normalizedDescriptionExpr} IN ('web search and crawl', 'ai tokens')`;
  const cancellationDateRawExpr = `COALESCE(
    JSON_VALUE(raw_row_json, '$.cancellation_date'),
    JSON_VALUE(raw_row_json, '$.cancellationDate'),
    JSON_VALUE(raw_row_json, '$.canceled_at'),
    JSON_VALUE(raw_row_json, '$.canceledAt')
  )`;
  const cancellationDateIntExpr = `SAFE_CAST(${cancellationDateRawExpr} AS INT64)`;
  const cancellationDateExpr = `COALESCE(
    SAFE_CAST(${cancellationDateRawExpr} AS DATE),
    DATE(SAFE_CAST(${cancellationDateRawExpr} AS TIMESTAMP)),
    CASE
      WHEN ${cancellationDateIntExpr} IS NULL THEN NULL
      WHEN ${cancellationDateIntExpr} >= 100000000000 THEN DATE(TIMESTAMP_MILLIS(${cancellationDateIntExpr}))
      WHEN ${cancellationDateIntExpr} >= 1000000000 THEN DATE(TIMESTAMP_SECONDS(${cancellationDateIntExpr}))
      ELSE NULL
    END
  )`;
  const cancelledFlagExpr = `LOWER(TRIM(COALESCE(
    JSON_VALUE(raw_row_json, '$.cancelled'),
    JSON_VALUE(raw_row_json, '$.canceled'),
    'false'
  ))) IN ('true', '1', 't', 'yes', 'y')`;
  const cancelledInCurrentMonthExpr = `(
    ${cancelledFlagExpr}
    AND DATE_TRUNC(${cancellationDateExpr}, MONTH) = DATE_TRUNC(DATE(TIMESTAMP_MILLIS(period_start_ts)), MONTH)
  )`;
  const descriptionPrefixExpr = `COALESCE(NULLIF(TRIM(SPLIT(${rawDescriptionExpr}, ' - ')[SAFE_OFFSET(0)]), ''), '(blank)')`;
  const descriptionBucketExpr = normalizeDescriptionBucketSql(rawDescriptionExpr);
  const descriptionPrefixBucketExpr = normalizeDescriptionBucketSql(descriptionPrefixExpr);

  const filterClauses: string[] = [];
  const filterParams: BigQueryNamedParameter[] = [];
  pushStringFilterSql(filterClauses, filterParams, "customer_id", request.filters?.customerId, "customer_id");
  pushStringFilterSql(
    filterClauses,
    filterParams,
    rawDescriptionExpr,
    request.filters?.lineItemDescription,
    "line_item_description",
  );
  pushStringFilterSql(
    filterClauses,
    filterParams,
    descriptionPrefixExpr,
    request.filters?.lineItemDescriptionPrefix,
    "line_item_description_prefix",
  );

  const periodAliases = request.periods.map((_, idx) => `period_${idx}`);
  const periodExpressions = request.periods.map((period, idx) => {
    const alias = periodAliases[idx];
    const startTs = Math.floor(period.startTsMs);
    const endTs = Math.floor(period.endTsMs);
    const expression = `IF(
      period_start_ts <= ${endTs}
      AND period_end_ts > ${startTs}
      AND NOT (
        period_start_ts < ${startTs}
        AND DATE(TIMESTAMP_MILLIS(period_end_ts), 'UTC') = DATE(TIMESTAMP_MILLIS(${startTs}), 'UTC')
      ),
      annualized,
      0.0
    )`;
    return `ROUND(${expression}, 2) AS ${alias}`;
  });
  const periodAliasByKey = new Map(request.periods.map((period, idx) => [period.key, periodAliases[idx]]));
  const sortAlias =
    request.sortByPeriodKey && request.sortByPeriodKey !== "none"
      ? periodAliasByKey.get(request.sortByPeriodKey) || ""
      : "";
  const orderBySql = [
    sortAlias ? `${sortAlias} DESC` : "",
    "deal_name ASC",
    "deal_id ASC",
    "line_item_id ASC",
    "line_item_description ASC",
    "close_date ASC",
  ]
    .filter(Boolean)
    .join(", ");

  const groupFieldSourceColumn: Record<StripeBigQueryGroupField, string> = {
    customerId: "group_customer_id_base",
    lineItemDescription: "group_line_item_description_base",
    lineItemDescriptionPrefix: "group_line_item_description_prefix_base",
  };
  const groupFieldOutputColumn: Record<StripeBigQueryGroupField, string> = {
    customerId: "group_customer_id",
    lineItemDescription: "group_line_item_description",
    lineItemDescriptionPrefix: "group_line_item_description_prefix",
  };

  const ctes: string[] = [];
  ctes.push(`raw_source AS (${rawSourceQuery})`);
  ctes.push(`source AS (
  SELECT *
  FROM raw_source
  WHERE 1=1
  ${filterClauses.map((clause) => `AND ${clause}`).join("\n  ")}
)`);
  ctes.push(`prepared AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(customer_id AS STRING)), ''), '(no customer id)') AS deal_name_base,
    COALESCE(NULLIF(TRIM(CAST(customer_id AS STRING)), ''), '(no customer id)') AS deal_id_base,
    CAST(invoice_id AS STRING) AS invoice_id,
    COALESCE(
      NULLIF(TRIM(CAST(line_item_id AS STRING)), ''),
      CONCAT(
        'line_',
        CAST(
          FARM_FINGERPRINT(
            CONCAT(
              CAST(invoice_id AS STRING),
              '|',
              CAST(period_start_ts AS STRING),
              '|',
              CAST(period_end_ts AS STRING),
              '|',
              CAST(amount_minor AS STRING),
              '|',
              COALESCE(CAST(customer_id AS STRING), '')
            )
          ) AS STRING
        )
      )
    ) AS line_item_id_base,
    ${rawDescriptionExpr} AS raw_description,
    ${descriptionBucketExpr} AS group_line_item_description_base,
    ${descriptionPrefixBucketExpr} AS group_line_item_description_prefix_base,
    COALESCE(NULLIF(TRIM(CAST(customer_id AS STRING)), ''), '(no customer id)') AS group_customer_id_base,
    FORMAT_DATE('%Y-%m-%d', DATE(TIMESTAMP_MILLIS(invoice_created_ts))) AS close_date_base,
    FORMAT_DATE('%Y-%m-%d', DATE(TIMESTAMP_MILLIS(period_start_ts))) AS window_start_base,
    FORMAT_DATE('%Y-%m-%d', DATE(TIMESTAMP_MILLIS(period_end_ts))) AS window_end_base,
    CAST(period_start_ts AS INT64) AS period_start_ts,
    CAST(period_end_ts AS INT64) AS period_end_ts,
    GREATEST(CAST(period_end_ts AS INT64) - CAST(period_start_ts AS INT64), 0) AS duration_ms_base,
    CAST(amount_minor AS FLOAT64) AS amount_major,
    COALESCE(CAST(quantity AS FLOAT64), 1.0) AS quantity,
    ${cancelledInCurrentMonthExpr} AS is_cancelled_in_current_month_base,
    CASE
      WHEN UNIX_MILLIS(
        TIMESTAMP(
          DATETIME_ADD(DATETIME(TIMESTAMP_MILLIS(period_start_ts), 'UTC'), INTERVAL 1 YEAR),
          'UTC'
        )
      ) = period_end_ts
      THEN 1.0
      WHEN ${forceTwelveByDescriptionCondition}
      THEN 12.0
      WHEN CAST(period_end_ts AS INT64) <= CAST(period_start_ts AS INT64)
      THEN 0.0
      WHEN UNIX_MILLIS(
        TIMESTAMP(
          DATETIME_ADD(DATETIME(TIMESTAMP_MILLIS(period_start_ts), 'UTC'), INTERVAL 1 MONTH),
          'UTC'
        )
      ) = period_end_ts
      THEN 12.0
      ELSE
        12.0 * (
          CAST(
            (
              UNIX_MILLIS(
                TIMESTAMP(
                  DATE_ADD(
                    DATE_TRUNC(DATE(TIMESTAMP_MILLIS(period_start_ts), 'UTC'), MONTH),
                    INTERVAL 1 MONTH
                  ),
                  'UTC'
                )
              )
              - UNIX_MILLIS(
                TIMESTAMP(DATE_TRUNC(DATE(TIMESTAMP_MILLIS(period_start_ts), 'UTC'), MONTH), 'UTC')
              )
            ) AS FLOAT64
          )
          / GREATEST(
            CAST(period_end_ts - period_start_ts AS FLOAT64),
            1.0
          )
        )
    END AS annualization_multiplier_base
  FROM source
  WHERE
    LOWER(COALESCE(currency, '')) = @target_currency
    AND (
      CAST(period_end_ts AS INT64) > CAST(period_start_ts AS INT64)
      OR (
        CAST(period_end_ts AS INT64) = CAST(period_start_ts AS INT64)
        AND LOWER(TRIM(${rawDescriptionExpr})) IN ('refund', 'discount')
      )
    )
)`);
  ctes.push(`invoice_percent_flag AS (
  SELECT
    invoice_id,
    MAX(IF(STRPOS(raw_description, '%') > 0, 1, 0)) AS has_percent_description
  FROM prepared
  GROUP BY invoice_id
)`);
  ctes.push(`invoice_anchor AS (
  SELECT
    invoice_id,
    ARRAY_AGG(annualization_multiplier_base ORDER BY amount_major DESC, line_item_id_base DESC LIMIT 1)[OFFSET(0)] AS invoice_refund_anchor_multiplier,
    ARRAY_AGG(
      annualization_multiplier_base
      ORDER BY duration_ms_base DESC, amount_major DESC, line_item_id_base DESC
      LIMIT 1
    )[OFFSET(0)] AS invoice_discount_anchor_multiplier
  FROM prepared
  GROUP BY invoice_id
)`);
  ctes.push(`cancelled_current_month_invoices AS (
  SELECT DISTINCT invoice_id
  FROM prepared
  WHERE is_cancelled_in_current_month_base
)`);
  const preparedAnnualizedWhereClauses: string[] = [];
  if (useStripeArrCorrectAnnualizationRules) {
    preparedAnnualizedWhereClauses.push("NOT p.is_cancelled_in_current_month_base");
    preparedAnnualizedWhereClauses.push("NOT (LOWER(TRIM(p.raw_description)) = 'refund' AND cmi.invoice_id IS NOT NULL)");
  } else {
    preparedAnnualizedWhereClauses.push(
      "NOT (LOWER(TRIM(p.raw_description)) = 'discount' AND IFNULL(f.has_percent_description, 0) = 1)",
    );
  }
  ctes.push(`prepared_with_annualized AS (
  SELECT
    p.*,
    CASE
      WHEN LOWER(TRIM(p.raw_description)) = 'refund'
      THEN ${
        useStripeArrCorrectAnnualizationRules
          ? "p.amount_major * 12.0"
          : "p.amount_major * IFNULL(a.invoice_refund_anchor_multiplier, 0.0)"
      }
      WHEN LOWER(TRIM(p.raw_description)) = 'discount'
      THEN ${
        useStripeArrCorrectAnnualizationRules
          ? "p.amount_major * p.annualization_multiplier_base"
          : "p.amount_major * IFNULL(a.invoice_discount_anchor_multiplier, 0.0)"
      }
      ELSE p.amount_major * p.annualization_multiplier_base
    END AS annualized
  FROM prepared AS p
  LEFT JOIN invoice_anchor AS a
    ON a.invoice_id = p.invoice_id
  LEFT JOIN invoice_percent_flag AS f
    ON f.invoice_id = p.invoice_id
  LEFT JOIN cancelled_current_month_invoices AS cmi
    ON cmi.invoice_id = p.invoice_id
  ${preparedAnnualizedWhereClauses.length ? `WHERE ${preparedAnnualizedWhereClauses.join("\n    AND ")}` : ""}
)`);
  ctes.push(`scored AS (
  SELECT
    deal_name_base,
    deal_id_base,
    line_item_id_base,
    raw_description,
    group_customer_id_base,
    group_line_item_description_base,
    group_line_item_description_prefix_base,
    close_date_base,
    window_start_base,
    window_end_base,
    amount_major,
    quantity,
    annualized,
    ${periodExpressions.join(",\n    ")}
  FROM prepared_with_annualized
)`);

  if (groupByFields.length > 0) {
    const groupBySelect = (["customerId", "lineItemDescription", "lineItemDescriptionPrefix"] as StripeBigQueryGroupField[]).map(
      (field) =>
        groupByFields.includes(field)
          ? `${groupFieldSourceColumn[field]} AS ${groupFieldOutputColumn[field]}`
          : `CAST(NULL AS STRING) AS ${groupFieldOutputColumn[field]}`,
    );
    const groupByColumns = groupByFields.map((field) => groupFieldSourceColumn[field]);
    const periodAggregates = periodAliases.map((alias) => `ROUND(SUM(${alias}), 2) AS ${alias}`);

    const dealNameExpr = `ARRAY_TO_STRING([${groupByFields
      .map((field) => `COALESCE(${groupFieldOutputColumn[field]}, '(blank)')`)
      .join(", ")}], ' | ')`;
    const dealIdExpr = groupByFields.includes("customerId") ? "COALESCE(group_customer_id, '(blank)')" : "'(group)'";
    const lineItemIdExpr = `ARRAY_TO_STRING([${groupByFields
      .map((field) => `CONCAT('${field}:', COALESCE(${groupFieldOutputColumn[field]}, '(blank)'))`)
      .join(", ")}], '|')`;
    const nonCustomerGroupFields = groupByFields.filter((field) => field !== "customerId");
    const lineItemDescriptionExpr = nonCustomerGroupFields.length
      ? `ARRAY_TO_STRING([${nonCustomerGroupFields
          .map((field) => `COALESCE(${groupFieldOutputColumn[field]}, '(blank)')`)
          .join(", ")}], ' | ')`
      : "''";

    ctes.push(`grouped_rows AS (
  SELECT
    ${groupBySelect.join(",\n    ")},
    ROUND(SUM(annualized), 2) AS value_usd,
    ROUND(SUM(amount_major), 2) AS amount,
    ROUND(SUM(amount_major), 2) AS net_price,
    SUM(quantity) AS quantity,
    ${periodAggregates.join(",\n    ")}
  FROM scored
  GROUP BY ${groupByColumns.join(", ")}
)`);
    ctes.push(`final_rows AS (
  SELECT
    ${dealNameExpr} AS deal_name,
    ${dealIdExpr} AS deal_id,
    ${lineItemIdExpr} AS line_item_id,
    ${lineItemDescriptionExpr} AS line_item_description,
    group_customer_id,
    group_line_item_description,
    group_line_item_description_prefix,
    '' AS close_date,
    '' AS window_start,
    '' AS window_end,
    value_usd,
    amount,
    net_price,
    quantity,
    ${periodAliases.join(", ")}
  FROM grouped_rows
)`);
  } else {
    ctes.push(`final_rows AS (
  SELECT
    deal_name_base AS deal_name,
    deal_id_base AS deal_id,
    line_item_id_base AS line_item_id,
    raw_description AS line_item_description,
    CAST(NULL AS STRING) AS group_customer_id,
    CAST(NULL AS STRING) AS group_line_item_description,
    CAST(NULL AS STRING) AS group_line_item_description_prefix,
    close_date_base AS close_date,
    window_start_base AS window_start,
    window_end_base AS window_end,
    annualized AS value_usd,
    ROUND(amount_major, 2) AS amount,
    ROUND(amount_major, 2) AS net_price,
    quantity,
    ${periodAliases.join(", ")}
  FROM scored
)`);
  }

  ctes.push(`non_zero AS (
  SELECT *
  FROM final_rows
)`);

  const sharedParams: BigQueryNamedParameter[] = [
    { name: "range_start_ts", type: "INT64", value: String(rangeStart) },
    { name: "range_end_ts", type: "INT64", value: String(rangeEnd) },
    { name: "target_currency", type: "STRING", value: request.targetCurrency.toLowerCase() },
    ...filterParams,
  ];

  return {
    ctesSql: `WITH\n${ctes.join(",\n")}`,
    sharedParams,
    periodAliases,
    orderBySql,
    groupByFields,
  };
}

function mapBigQueryReportRows(
  rawRows: Record<string, unknown>[],
  periods: StripeBigQueryPeriodSpec[],
  periodAliases: string[],
  targetCurrency: string,
  groupByFields: StripeBigQueryGroupField[],
) {
  const rows: ReportRow[] = [];
  for (const raw of rawRows) {
    const valuesByPeriod: Record<string, number> = {};
    for (let idx = 0; idx < periods.length; idx++) {
      valuesByPeriod[periods[idx].key] = asNumber(raw[periodAliases[idx]]);
    }

    const groupValues =
      groupByFields.length > 0
        ? {
            ...(groupByFields.includes("customerId")
              ? { customerId: asString(raw.group_customer_id) || "(blank)" }
              : {}),
            ...(groupByFields.includes("lineItemDescription")
              ? { lineItemDescription: asString(raw.group_line_item_description) || "(blank)" }
              : {}),
            ...(groupByFields.includes("lineItemDescriptionPrefix")
              ? { lineItemDescriptionPrefix: asString(raw.group_line_item_description_prefix) || "(blank)" }
              : {}),
          }
        : undefined;

    rows.push({
      dealName: asString(raw.deal_name),
      dealId: asString(raw.deal_id),
      lineItemId: asString(raw.line_item_id),
      valueUsd: asNumber(raw.value_usd),
      dealCurrency: targetCurrency.toUpperCase(),
      fxRate: null,
      fxDateUsed: "",
      dealType: "stripe_invoice_line",
      closeDate: asString(raw.close_date),
      windowStart: asString(raw.window_start),
      windowEnd: asString(raw.window_end),
      isOpenEnded: false,
      recurringbillingfrequency: "",
      termMonths: null,
      amount: asNumber(raw.amount),
      netPrice: asNumber(raw.net_price),
      quantity: asNumber(raw.quantity || 1),
      valuesByPeriod,
      deploymentType: "",
      accountId: "",
      territory: "",
      country: "",
      industry: "",
      lineItemDescription: asString(raw.line_item_description),
      groupValues,
    });
  }
  return rows;
}

async function queryStripeReportBigQueryBase(
  request: StripeBigQueryReportRequest,
  mode: "page" | "all",
  options?: StripeBigQueryOptions,
): Promise<StripeBigQueryReportBase & { totalPages: number; page: number }> {
  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");

  const sourceConfig = getBigQuerySourceConfig(profile);
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const rangeStart = toQueryTimestamp(request.startTsMs, sourceConfig);
  const rangeEnd = toQueryTimestamp(request.endTsMs, sourceConfig);
  const built = buildStripeBigQueryReportQuery(request, sourceConfig, rangeStart, rangeEnd, profile);
  const accessToken = await getAccessToken(sa);

  const summaryQuery = `${built.ctesSql}
SELECT
  (SELECT COUNT(*) FROM prepared) AS source_rows_fetched,
  COUNT(*) AS total_rows
  ${built.periodAliases.length ? `,\n  ${built.periodAliases.map((alias) => `ROUND(COALESCE(SUM(${alias}), 0), 2) AS total_${alias}`).join(",\n  ")}` : ""}
FROM non_zero`;
  const summaryRows = await runBigQueryQueryRows(accessToken, projectId, location, summaryQuery, built.sharedParams);
  const summary = summaryRows[0] || {};
  const sourceRowsFetched = asInt(summary.source_rows_fetched);
  const totalRows = asInt(summary.total_rows);
  const totalsByPeriod = request.periods.map((period, idx) => {
    const alias = built.periodAliases[idx];
    return {
      key: period.key,
      label: period.label,
      total: asNumber(summary[`total_${alias}`]),
    };
  });

  const totalPages = totalRows > 0 ? Math.ceil(totalRows / Math.max(1, request.pageSize)) : 1;
  const page = Math.min(Math.max(1, Math.floor(request.page || 1)), totalPages);
  const offsetRows = (page - 1) * Math.max(1, request.pageSize);

  let pageRowsRaw: Record<string, unknown>[] = [];
  if (totalRows > 0) {
    const pageQuery =
      mode === "all"
        ? `${built.ctesSql}
SELECT *
FROM non_zero
ORDER BY ${built.orderBySql}`
        : `${built.ctesSql}
SELECT *
FROM non_zero
ORDER BY ${built.orderBySql}
LIMIT @limit_rows
OFFSET @offset_rows`;
    const pageParams =
      mode === "all"
        ? built.sharedParams
        : [
            ...built.sharedParams,
            { name: "limit_rows", type: "INT64" as const, value: String(Math.max(1, Math.floor(request.pageSize))) },
            { name: "offset_rows", type: "INT64" as const, value: String(offsetRows) },
          ];
    pageRowsRaw = await runBigQueryQueryRows(accessToken, projectId, location, pageQuery, pageParams);
  }

  const rows = mapBigQueryReportRows(
    pageRowsRaw,
    request.periods,
    built.periodAliases,
    request.targetCurrency,
    built.groupByFields,
  );

  return {
    rows,
    totalsByPeriod,
    totalRows,
    sourceRowsFetched,
    totalPages,
    page,
  };
}

export async function queryStripeReportPageFromBigQuery(
  request: StripeBigQueryReportRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeBigQueryReportPageResult> {
  const result = await queryStripeReportBigQueryBase(request, "page", options);
  return {
    rows: result.rows,
    totalsByPeriod: result.totalsByPeriod,
    totalRows: result.totalRows,
    sourceRowsFetched: result.sourceRowsFetched,
    totalPages: result.totalPages,
    page: result.page,
  };
}

export async function queryStripeReportAllRowsFromBigQuery(
  request: StripeBigQueryReportRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeBigQueryReportBase> {
  const result = await queryStripeReportBigQueryBase(request, "all", options);
  return {
    rows: result.rows,
    totalsByPeriod: result.totalsByPeriod,
    totalRows: result.totalRows,
    sourceRowsFetched: result.sourceRowsFetched,
  };
}

export async function queryStripeCumulativeMrrChangeByPeriodsFromBigQuery(
  request: Pick<StripeBigQueryReportRequest, "periods" | "targetCurrency">,
  options?: StripeBigQueryOptions,
): Promise<StripeBigQueryPeriodTotal[]> {
  if (!request.periods.length) return [];

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");

  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const table = getStripeArrCorrectMrrChangeTable();
  const maxCutoffTs = Math.max(...request.periods.map((period) => Math.floor(period.endTsMs) + 1));

  const periodSelectSql = request.periods
    .map((period, idx) => {
      const cutoffTs = Math.floor(period.endTsMs) + 1;
      return `ROUND(
    COALESCE(SUM(IF(event_timestamp < TIMESTAMP_MILLIS(${cutoffTs}), CAST(COALESCE(mrr_change, 0) AS FLOAT64), 0.0)), 0.0) / 100.0,
    2
  ) AS total_period_${idx}`;
    })
    .join(",\n  ");

  const query = `
SELECT
  ${periodSelectSql}
FROM \`${table}\`
WHERE
  LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
  AND event_timestamp < TIMESTAMP_MILLIS(@max_cutoff_ts)
`;
  const params: BigQueryNamedParameter[] = [
    { name: "target_currency", type: "STRING", value: request.targetCurrency.toLowerCase() },
    { name: "max_cutoff_ts", type: "INT64", value: String(maxCutoffTs) },
  ];

  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);
  const totals = rows[0] || {};
  return request.periods.map((period, idx) => ({
    key: period.key,
    label: period.label,
    total: asNumber(totals[`total_period_${idx}`]),
  }));
}

const STRIPE_THROUGH_MRR_GROUP_BY_SQL: Record<
  Exclude<StripeThroughMrrGroupBy, "none">,
  { keyExpr: string; labelExpr: string; customerIdsExpr?: string; workspaceIdsExpr?: string }
> = {
  customer_id: {
    keyExpr: "customer_id",
    labelExpr: "customer_id",
  },
  country: {
    keyExpr: "COALESCE(NULLIF(TRIM(customer_country_code), ''), NULLIF(TRIM(customer_country), ''), 'N/A')",
    labelExpr: "COALESCE(NULLIF(TRIM(customer_country_code), ''), NULLIF(TRIM(customer_country), ''), 'N/A')",
  },
  territory: {
    keyExpr: "COALESCE(NULLIF(TRIM(customer_territory), ''), 'N/A')",
    labelExpr: "COALESCE(NULLIF(TRIM(customer_territory), ''), 'N/A')",
  },
  product_id: {
    keyExpr: "product_id",
    labelExpr:
      "CASE WHEN product_description = '' OR product_description = '(blank)' OR LOWER(product_description) = LOWER(product_id) THEN product_id WHEN product_id = '' OR product_id = '(blank)' THEN product_description ELSE CONCAT(product_id, ' (', product_description, ')') END",
  },
  price_id: {
    keyExpr: "price_id",
    labelExpr:
      "CASE WHEN price_description = '' OR price_description = '(blank)' OR LOWER(price_description) = LOWER(price_id) THEN price_id WHEN price_id = '' OR price_id = '(blank)' THEN price_description ELSE CONCAT(price_id, ' (', price_description, ')') END",
  },
  subscription_id: {
    keyExpr: "subscription_id",
    labelExpr: "subscription_id",
  },
  subscription_item_id: {
    keyExpr: "subscription_item_id",
    labelExpr: "subscription_item_id",
  },
  event_type: {
    keyExpr: "event_type",
    labelExpr: "event_type",
  },
  email: {
    keyExpr: "COALESCE(NULLIF(TRIM(customer_email), ''), '(no email)')",
    labelExpr: "COALESCE(NULLIF(TRIM(customer_email), ''), '(no email)')",
    customerIdsExpr:
      "ARRAY_AGG(NULLIF(customer_id, '(blank)') IGNORE NULLS ORDER BY IFNULL(customer_created, TIMESTAMP('9999-12-31')) ASC)",
    workspaceIdsExpr:
      "ARRAY_AGG(NULLIF(customer_workspace_id, '') IGNORE NULLS ORDER BY IFNULL(customer_created, TIMESTAMP('9999-12-31')) ASC)",
  },
};

function normalizeStripeThroughMrrGroupBy(groupBy: string | undefined): StripeThroughMrrGroupBy {
  const candidate = String(groupBy || "").trim();
  if (candidate === "none") return "none";
  if (candidate in STRIPE_THROUGH_MRR_GROUP_BY_SQL) {
    return candidate as Exclude<StripeThroughMrrGroupBy, "none">;
  }
  return "none";
}

type StripeThroughMrrCountryFilterRule = {
  negate: boolean;
  labelLower: string;
  codeUpper: string;
};

function normalizeStripeThroughMrrCountryFilterRules(values: string[] | undefined): StripeThroughMrrCountryFilterRule[] {
  const seen = new Set<string>();
  const out: StripeThroughMrrCountryFilterRule[] = [];
  for (const raw of values || []) {
    const source = String(raw || "").trim();
    if (!source) continue;
    const negateMatch = /^(?:not|!|-)\s+/i.exec(source);
    const negate = !!negateMatch;
    const token = source.replace(/^(?:not|!|-)\s+/i, "").trim();
    if (!token) continue;
    const labelLower = String(canonicalCountryLabel(token) || token).trim().toLowerCase();
    if (!labelLower) continue;
    const codeUpper = String(countryCodeFromValue(token) || "").trim().toUpperCase();
    const dedupeKey = `${negate ? "not" : "in"}|${codeUpper}|${labelLower}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ negate, labelLower, codeUpper });
    if (out.length >= 50) break;
  }
  return out;
}

function buildStripeThroughMrrCountryFilterSql(
  rules: StripeThroughMrrCountryFilterRule[],
  countryCodeFieldSql: string,
  countryLabelFieldSql: string,
) {
  if (!rules.length) return { whereSql: "", params: [] as BigQueryNamedParameter[] };
  const clauses: string[] = [];
  const params: BigQueryNamedParameter[] = [];
  for (let idx = 0; idx < rules.length; idx += 1) {
    const rule = rules[idx];
    const codeParam = `country_filter_${idx}_code`;
    const labelParam = `country_filter_${idx}_label`;
    const baseMatch = rule.codeUpper
      ? `(
      UPPER(COALESCE(NULLIF(TRIM(${countryCodeFieldSql}), ''), '')) = @${codeParam}
      OR LOWER(COALESCE(NULLIF(TRIM(${countryLabelFieldSql}), ''), '')) = @${labelParam}
    )`
      : `(LOWER(COALESCE(NULLIF(TRIM(${countryLabelFieldSql}), ''), '')) = @${labelParam})`;
    clauses.push(rule.negate ? `NOT ${baseMatch}` : baseMatch);
    if (rule.codeUpper) {
      params.push({ name: codeParam, type: "STRING", value: rule.codeUpper });
    }
    params.push({ name: labelParam, type: "STRING", value: rule.labelLower });
  }
  return {
    // OR semantics across entered rules (e.g. "india, china, not russia")
    whereSql: `(${clauses.join(" OR ")})`,
    params,
  };
}

function normalizeStripeThroughMrrGrain(grain: string | undefined): StripeThroughMrrGrain {
  const candidate = String(grain || "").trim().toLowerCase();
  return candidate === "daily" ? "daily" : "monthly";
}

function normalizeStripeThroughMrrCustomerPlanGrain(grain: string | undefined): "daily" | "monthly" {
  const candidate = String(grain || "").trim().toLowerCase();
  return candidate === "daily" ? "daily" : "monthly";
}

function normalizeStripeBillingOverviewGrain(grain: string | undefined): StripeBillingOverviewGrain {
  const candidate = String(grain || "").trim().toLowerCase();
  if (candidate === "daily") return "daily";
  if (candidate === "weekly") return "weekly";
  if (candidate === "quarterly") return "quarterly";
  return "monthly";
}

function normalizeStripeAiSpendGrain(grain: string | undefined): StripeAiSpendGrain {
  const candidate = String(grain || "").trim().toLowerCase();
  if (candidate === "daily") return "daily";
  if (candidate === "weekly") return "weekly";
  if (candidate === "quarterly") return "quarterly";
  return "monthly";
}

function normalizeStripeBillingOverviewGroupBy(groupBy: string | undefined): StripeBillingOverviewGroupBy {
  const candidate = String(groupBy || "").trim().toLowerCase();
  if (candidate === "product_id") return "product_id";
  if (candidate === "price_id") return "price_id";
  if (candidate === "subscription_item_id") return "subscription_item_id";
  if (candidate === "subscription_id") return "subscription_id";
  if (candidate === "customer_id") return "customer_id";
  return "none";
}

const STRIPE_BILLING_OVERVIEW_GROUP_BY_SQL: Record<
  Exclude<StripeBillingOverviewGroupBy, "none">,
  { keyExpr: string; labelExpr: string }
> = {
  customer_id: {
    keyExpr: "customer_id",
    labelExpr: "customer_id",
  },
  product_id: {
    keyExpr: "product_id",
    labelExpr:
      "CASE WHEN product_description = '' OR product_description = '(blank)' THEN product_id ELSE product_description END",
  },
  price_id: {
    keyExpr: "price_id",
    labelExpr: "CASE WHEN price_description = '' OR price_description = '(blank)' THEN price_id ELSE price_description END",
  },
  subscription_id: {
    keyExpr: "subscription_id",
    labelExpr: "subscription_id",
  },
  subscription_item_id: {
    keyExpr: "subscription_item_id",
    labelExpr: "subscription_item_id",
  },
};

function stripeBillingOverviewGroupSql(groupBy: StripeBillingOverviewGroupBy): { keyExpr: string; labelExpr: string } {
  if (groupBy === "none") return { keyExpr: "'(all)'", labelExpr: "'(all)'" };
  return STRIPE_BILLING_OVERVIEW_GROUP_BY_SQL[groupBy];
}

function buildStripeThroughMrrDetailBaseCte(
  table: string,
  productsTable: string,
  customersTable: string,
  customersMetadataTable: string,
  chargesTable: string,
  paymentMethodsTable: string,
) {
  return `
WITH source AS (
  SELECT
    event_timestamp,
    UPPER(CAST(event_type AS STRING)) AS event_type,
    CAST(COALESCE(mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major,
    TO_JSON_STRING(t) AS raw_json
  FROM \`${table}\` AS t
  WHERE
    LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
    AND event_timestamp >= TIMESTAMP(@detail_range_start_date)
    AND event_timestamp < TIMESTAMP(@detail_end_exclusive_date)
),
parsed AS (
  SELECT
    event_timestamp,
    event_type,
    mrr_change_major,
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.customer_id')), ''), '(blank)') AS customer_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.workspace_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.workspaceId')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.workspace.id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.metadata.workspace_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.metadata.workspaceId')), ''),
      ''
    ) AS event_workspace_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.subscription_id')), ''),
      '(blank)'
    ) AS subscription_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.subscription_item_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.subscription_item')), ''),
      '(blank)'
    ) AS subscription_item_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price')), ''),
      '(blank)'
    ) AS price_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product')), ''),
      '(blank)'
    ) AS product_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_nickname')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_description')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_display_name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.nickname')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.lookup_key')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.product_name')), ''),
      '(blank)'
    ) AS price_description,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product_name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product_description')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.display_name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.nickname')), ''),
      ''
    ) AS product_description_event
  FROM source
) ,
customer_ids_in_scope AS (
  SELECT DISTINCT customer_id
  FROM parsed
  WHERE customer_id <> '(blank)'
  UNION DISTINCT
  SELECT DISTINCT
    COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') AS customer_id
  FROM \`${table}\` t
  WHERE
    LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
    AND event_timestamp < TIMESTAMP(@detail_start_month_date)
) ,
products_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS product_id,
    COALESCE(
      NULLIF(TRIM(CAST(description AS STRING)), ''),
      NULLIF(TRIM(CAST(name AS STRING)), ''),
      '(blank)'
    ) AS product_description_table
  FROM \`${productsTable}\`
) ,
customers_workspace_lookup AS (
  SELECT
    customer_id,
    workspace_id
  FROM (
    SELECT
      COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)') AS customer_id,
      NULLIF(TRIM(CAST(m.value AS STRING)), '') AS workspace_id,
      COALESCE(NULLIF(TRIM(CAST(m.batch_timestamp AS STRING)), ''), '') AS batch_timestamp_value,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)')
        ORDER BY
          COALESCE(NULLIF(TRIM(CAST(m.batch_timestamp AS STRING)), ''), '') DESC,
          NULLIF(TRIM(CAST(m.value AS STRING)), '') DESC
      ) AS rn
    FROM \`${customersMetadataTable}\` m
    WHERE LOWER(COALESCE(NULLIF(TRIM(CAST(m.\`key\` AS STRING)), ''), '')) = 'workspace_id'
      AND COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)') IN (
        SELECT customer_id FROM customer_ids_in_scope
      )
  )
  WHERE rn = 1
) ,
customers_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS customer_id,
    COALESCE(NULLIF(TRIM(CAST(email AS STRING)), ''), '') AS customer_email,
    COALESCE(NULLIF(TRIM(CAST(address_country AS STRING)), ''), '') AS address_country,
    COALESCE(NULLIF(TRIM(CAST(shipping_address_country AS STRING)), ''), '') AS shipping_address_country,
    COALESCE(NULLIF(TRIM(cwl.workspace_id), ''), '') AS customer_workspace_id,
    created AS customer_created
  FROM \`${customersTable}\` c
  LEFT JOIN customers_workspace_lookup cwl
    ON cwl.customer_id = COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)')
  WHERE COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') IN (
    SELECT customer_id FROM customer_ids_in_scope
  )
),
payment_methods_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS payment_method_id,
    COALESCE(NULLIF(TRIM(CAST(customer_id AS STRING)), ''), '(blank)') AS customer_id,
    created AS payment_method_created,
    COALESCE(NULLIF(TRIM(CAST(card_country AS STRING)), ''), '') AS card_country,
    COALESCE(NULLIF(TRIM(CAST(billing_details_address_country AS STRING)), ''), '') AS billing_details_address_country,
    COALESCE(NULLIF(TRIM(CAST(sepa_debit_country AS STRING)), ''), '') AS sepa_debit_country,
    COALESCE(NULLIF(TRIM(CAST(sofort_country AS STRING)), ''), '') AS sofort_country
  FROM \`${paymentMethodsTable}\`
),
charge_countries AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(c.customer_id AS STRING)), ''), '(blank)') AS customer_id,
    c.created AS charge_created,
    COALESCE(
      NULLIF(TRIM(CAST(c.card_country AS STRING)), ''),
      NULLIF(TRIM(pm.sepa_debit_country), ''),
      NULLIF(TRIM(pm.sofort_country), ''),
      NULLIF(TRIM(CAST(c.shipping_address_country AS STRING)), '')
    ) AS charge_country
  FROM \`${chargesTable}\` c
  LEFT JOIN payment_methods_lookup pm
    ON pm.payment_method_id = COALESCE(NULLIF(TRIM(CAST(c.payment_method_id AS STRING)), ''), '(blank)')
  WHERE
    COALESCE(NULLIF(TRIM(CAST(c.customer_id AS STRING)), ''), '(blank)') IN (SELECT customer_id FROM customer_ids_in_scope)
    AND COALESCE(NULLIF(TRIM(CAST(c.customer_id AS STRING)), ''), '(blank)') <> '(blank)'
),
most_recent_charge_country_by_customer AS (
  SELECT
    customer_id,
    ARRAY_AGG(charge_country IGNORE NULLS ORDER BY charge_created DESC LIMIT 1)[OFFSET(0)] AS most_recent_charge_country
  FROM charge_countries
  WHERE charge_country IS NOT NULL
  GROUP BY customer_id
),
most_recent_payment_method_country_by_customer AS (
  SELECT
    customer_id,
    ARRAY_AGG(
      payment_method_country IGNORE NULLS
      ORDER BY payment_method_created DESC, payment_method_id DESC
      LIMIT 1
    )[OFFSET(0)] AS most_recent_payment_method_country
  FROM (
    SELECT
      payment_method_id,
      customer_id,
      payment_method_created,
      COALESCE(
        NULLIF(TRIM(card_country), ''),
        NULLIF(TRIM(billing_details_address_country), ''),
        NULLIF(TRIM(sepa_debit_country), ''),
        NULLIF(TRIM(sofort_country), '')
      ) AS payment_method_country
    FROM payment_methods_lookup
    WHERE
      customer_id IN (SELECT customer_id FROM customer_ids_in_scope)
      AND customer_id <> '(blank)'
  )
  WHERE payment_method_country IS NOT NULL
  GROUP BY customer_id
),
customer_country_inputs AS (
  SELECT
    ids.customer_id,
    COALESCE(
      NULLIF(TRIM(cl.address_country), ''),
      NULLIF(TRIM(cl.shipping_address_country), ''),
      NULLIF(TRIM(mr.most_recent_charge_country), ''),
      NULLIF(TRIM(pm.most_recent_payment_method_country), ''),
      ''
    ) AS raw_customer_country,
    LOWER(
      REGEXP_REPLACE(
        COALESCE(
          NULLIF(TRIM(cl.address_country), ''),
          NULLIF(TRIM(cl.shipping_address_country), ''),
          NULLIF(TRIM(mr.most_recent_charge_country), ''),
          NULLIF(TRIM(pm.most_recent_payment_method_country), ''),
          ''
        ),
        r'[^a-z0-9]',
        ''
      )
    ) AS raw_country_key,
    COALESCE(cl.customer_email, '') AS customer_email,
    COALESCE(cl.customer_workspace_id, '') AS customer_workspace_id,
    cl.customer_created AS customer_created
  FROM customer_ids_in_scope ids
  LEFT JOIN customers_lookup cl
    ON cl.customer_id = ids.customer_id
  LEFT JOIN most_recent_charge_country_by_customer mr
    ON mr.customer_id = ids.customer_id
  LEFT JOIN most_recent_payment_method_country_by_customer pm
    ON pm.customer_id = ids.customer_id
),
customer_countries AS (
  SELECT
    cci.customer_id,
    cci.raw_customer_country AS customer_country,
    CASE
      WHEN REGEXP_CONTAINS(TRIM(cci.raw_customer_country), r'^[A-Za-z]{2}$') THEN UPPER(TRIM(cci.raw_customer_country))
      WHEN REGEXP_CONTAINS(TRIM(cci.raw_customer_country), r'^[A-Za-z]{3}$') THEN (
        CASE UPPER(TRIM(cci.raw_customer_country))
          WHEN 'USA' THEN 'US'
          WHEN 'GBR' THEN 'GB'
          WHEN 'ARE' THEN 'AE'
          WHEN 'KOR' THEN 'KR'
          WHEN 'PRK' THEN 'KP'
          WHEN 'CZE' THEN 'CZ'
          WHEN 'RUS' THEN 'RU'
          WHEN 'VNM' THEN 'VN'
          ELSE ''
        END
      )
      ELSE (
        CASE cci.raw_country_key
      ${COUNTRY_KEY_TO_CODE_SQL_WHENS}
          ELSE ''
        END
      )
    END AS customer_country_code,
    cci.customer_email AS customer_email,
    cci.customer_workspace_id AS customer_workspace_id,
    cci.customer_created AS customer_created
  FROM customer_country_inputs cci
),
customer_countries_enriched AS (
  SELECT
    cc.customer_id,
    COALESCE(NULLIF(TRIM(cc.customer_country), ''), 'N/A') AS customer_country,
    COALESCE(NULLIF(TRIM(cc.customer_country_code), ''), '') AS customer_country_code,
    CASE
      WHEN COALESCE(NULLIF(TRIM(cc.customer_country_code), ''), '') = '' THEN 'N/A'
      ELSE (
        CASE UPPER(TRIM(cc.customer_country_code))
      ${COUNTRY_CODE_TO_TERRITORY_SQL_WHENS}
          ELSE 'N/A'
        END
      )
    END AS customer_territory,
    COALESCE(cc.customer_email, '') AS customer_email,
    COALESCE(cc.customer_workspace_id, '') AS customer_workspace_id,
    cc.customer_created AS customer_created
  FROM customer_countries cc
),
enriched AS (
  SELECT
    p.event_timestamp,
    p.event_type,
    p.mrr_change_major,
    p.customer_id,
    COALESCE(cc.customer_email, '') AS customer_email,
    COALESCE(NULLIF(TRIM(cc.customer_workspace_id), ''), NULLIF(TRIM(p.event_workspace_id), ''), '') AS customer_workspace_id,
    cc.customer_created AS customer_created,
    COALESCE(cc.customer_country, 'N/A') AS customer_country,
    COALESCE(cc.customer_country_code, '') AS customer_country_code,
    COALESCE(cc.customer_territory, 'N/A') AS customer_territory,
    p.subscription_id,
    p.subscription_item_id,
    p.price_id,
    p.product_id,
    p.price_description,
    COALESCE(
      NULLIF(TRIM(pl.product_description_table), ''),
      NULLIF(TRIM(p.product_description_event), ''),
      '(blank)'
    ) AS product_description
  FROM parsed p
  LEFT JOIN products_lookup pl
    ON pl.product_id = p.product_id
  LEFT JOIN customer_countries_enriched cc
    ON cc.customer_id = p.customer_id
)`;
}

export async function queryStripeThroughMrrReportFromBigQuery(
  request: StripeThroughMrrReportRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeThroughMrrReportResult> {
  const startDate = parseIsoDateUtc(request.startDate);
  const endDate = parseIsoDateUtc(request.endDate);
  if (!startDate || !endDate) {
    throw new Error("Invalid startDate/endDate");
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("endDate must be >= startDate");
  }

  const startMonth = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1, 0, 0, 0, 0));
  const endMonth = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1, 0, 0, 0, 0));
  let detailStartMonthDate = parseIsoMonthUtc(request.detailStartMonth) || startMonth;
  let detailEndMonthDate = parseIsoMonthUtc(request.detailEndMonth) || endMonth;
  if (detailStartMonthDate.getTime() < startMonth.getTime()) detailStartMonthDate = startMonth;
  if (detailStartMonthDate.getTime() > endMonth.getTime()) detailStartMonthDate = endMonth;
  if (detailEndMonthDate.getTime() < startMonth.getTime()) detailEndMonthDate = startMonth;
  if (detailEndMonthDate.getTime() > endMonth.getTime()) detailEndMonthDate = endMonth;
  if (detailStartMonthDate.getTime() > detailEndMonthDate.getTime()) {
    const swap = detailStartMonthDate;
    detailStartMonthDate = detailEndMonthDate;
    detailEndMonthDate = swap;
  }

  const endExclusiveDate = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate() + 1, 0, 0, 0, 0),
  );
  const detailRangeStartDate = new Date(Math.max(startDate.getTime(), detailStartMonthDate.getTime()));
  const detailEndMonthNextStartDate = new Date(
    Date.UTC(detailEndMonthDate.getUTCFullYear(), detailEndMonthDate.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  const detailEndExclusiveDate =
    detailEndMonthNextStartDate.getTime() < endExclusiveDate.getTime() ? detailEndMonthNextStartDate : endExclusiveDate;

  const startDateIso = startDate.toISOString().slice(0, 10);
  const endDateIso = endDate.toISOString().slice(0, 10);
  const endExclusiveDateIso = endExclusiveDate.toISOString().slice(0, 10);
  const detailStartMonthDateIso = detailStartMonthDate.toISOString().slice(0, 10);
  const detailRangeStartDateIso = detailRangeStartDate.toISOString().slice(0, 10);
  const detailEndExclusiveDateIso = detailEndExclusiveDate.toISOString().slice(0, 10);
  const detailStartMonth = isoMonthFromDateUtc(detailStartMonthDate);
  const detailEndMonth = isoMonthFromDateUtc(detailEndMonthDate);
  const grain = normalizeStripeThroughMrrGrain(request.grain);
  const groupBy = normalizeStripeThroughMrrGroupBy(request.groupBy);
  const countryFilterRules =
    groupBy === "customer_id" || groupBy === "email"
      ? normalizeStripeThroughMrrCountryFilterRules(request.countryFilters)
      : [];
  const countryFilter = buildStripeThroughMrrCountryFilterSql(
    countryFilterRules,
    "group_customer_country_code",
    "group_customer_country",
  );
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const pageSize = Math.max(1, Math.min(STRIPE_THROUGH_MRR_MAX_PAGE_SIZE, Math.floor(asNumber(request.pageSize) || 1000)));
  const page = Math.max(1, Math.floor(asNumber(request.page) || 1));
  const skipSummary = !!request.skipSummary;
  const skipCount = !!request.skipCount;

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const table = getStripeArrCorrectMrrChangeTable();
  const productsTable = getStripeProductsTable(profile);
  const customersTable = getStripeCustomersTable();
  const customersMetadataTable = getStripeCustomersMetadataTable(profile);
  const chargesTable = getStripeChargesTable(profile);
  const paymentMethodsTable = getStripePaymentMethodsTable(profile);

  const summaryQuery =
    grain === "daily"
      ? `
WITH bounds AS (
  SELECT
    DATE(@start_date) AS range_start_date,
    DATE(@end_date) AS range_end_date,
    DATE(@end_exclusive_date) AS range_end_exclusive_date
),
days AS (
  SELECT
    day_date
  FROM bounds b
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(b.range_start_date, b.range_end_date, INTERVAL 1 DAY)) AS day_date
),
base_before_first_day AS (
  SELECT
    COALESCE(SUM(CAST(COALESCE(mrr_change, 0) AS FLOAT64)) / 100.0, 0.0) AS base_mrr
  FROM \`${table}\` t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
    AND event_timestamp < TIMESTAMP(b.range_start_date)
),
daily_net AS (
  SELECT
    DATE(event_timestamp) AS day_date,
    COALESCE(SUM(CAST(COALESCE(mrr_change, 0) AS FLOAT64)) / 100.0, 0.0) AS net_mrr_change
  FROM \`${table}\` t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
    AND event_timestamp >= TIMESTAMP(b.range_start_date)
    AND event_timestamp < TIMESTAMP(b.range_end_exclusive_date)
  GROUP BY day_date
),
daily_flow AS (
  SELECT
    DATE(event_timestamp) AS day_date,
    COALESCE(SUM(IF(UPPER(CAST(event_type AS STRING)) = 'ACTIVE_START', CAST(COALESCE(mrr_change, 0) AS FLOAT64), 0.0)) / 100.0, 0.0) AS new_mrr,
    COALESCE(SUM(IF(UPPER(CAST(event_type AS STRING)) = 'ACTIVE_UPGRADE', CAST(COALESCE(mrr_change, 0) AS FLOAT64), 0.0)) / 100.0, 0.0) AS expansion_mrr,
    COALESCE(SUM(IF(UPPER(CAST(event_type AS STRING)) = 'ACTIVE_DOWNGRADE', CAST(COALESCE(mrr_change, 0) AS FLOAT64), 0.0)) / 100.0, 0.0) AS contraction_mrr,
    COALESCE(SUM(IF(UPPER(CAST(event_type AS STRING)) = 'ACTIVE_END', CAST(COALESCE(mrr_change, 0) AS FLOAT64), 0.0)) / 100.0, 0.0) AS churn_mrr,
    COALESCE(SUM(CAST(COALESCE(mrr_change, 0) AS FLOAT64)) / 100.0, 0.0) AS net_mrr_change
  FROM \`${table}\` t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
    AND event_timestamp >= TIMESTAMP(b.range_start_date)
    AND event_timestamp < TIMESTAMP(b.range_end_exclusive_date)
  GROUP BY day_date
)
SELECT
  FORMAT_DATE('%Y-%m-%d', d.day_date) AS month_key,
  FORMAT_DATE('%Y-%m-%d', d.day_date) AS month_label,
  ROUND(
    b.base_mrr + SUM(COALESCE(n.net_mrr_change, 0.0)) OVER (ORDER BY d.day_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW),
    2
  ) AS month_end_mrr,
  ROUND(COALESCE(f.new_mrr, 0.0), 2) AS new_mrr,
  ROUND(COALESCE(f.expansion_mrr, 0.0), 2) AS expansion_mrr,
  ROUND(COALESCE(f.contraction_mrr, 0.0), 2) AS contraction_mrr,
  ROUND(COALESCE(f.churn_mrr, 0.0), 2) AS churn_mrr,
  ROUND(COALESCE(f.net_mrr_change, 0.0), 2) AS net_mrr_change
FROM days d
CROSS JOIN base_before_first_day b
LEFT JOIN daily_net n
  ON n.day_date = d.day_date
LEFT JOIN daily_flow f
  ON f.day_date = d.day_date
ORDER BY d.day_date
`
      : `
WITH bounds AS (
  SELECT
    DATE(@start_date) AS range_start_date,
    DATE(@end_date) AS range_end_date,
    DATE(@end_exclusive_date) AS range_end_exclusive_date,
    DATE_TRUNC(DATE(@start_date), MONTH) AS first_month_start
),
months AS (
  SELECT
    month_start
  FROM bounds b
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(b.first_month_start, DATE_TRUNC(b.range_end_date, MONTH), INTERVAL 1 MONTH)) AS month_start
),
base_before_first_month AS (
  SELECT
    COALESCE(SUM(CAST(COALESCE(mrr_change, 0) AS FLOAT64)) / 100.0, 0.0) AS base_mrr
  FROM \`${table}\` t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
    AND event_timestamp < TIMESTAMP(b.first_month_start)
),
monthly_net AS (
  SELECT
    DATE_TRUNC(DATE(event_timestamp), MONTH) AS month_start,
    COALESCE(SUM(CAST(COALESCE(mrr_change, 0) AS FLOAT64)) / 100.0, 0.0) AS net_mrr_change
  FROM \`${table}\` t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
    AND event_timestamp >= TIMESTAMP(b.first_month_start)
    AND event_timestamp < TIMESTAMP(b.range_end_exclusive_date)
  GROUP BY month_start
),
monthly_flow_in_range AS (
  SELECT
    DATE_TRUNC(DATE(event_timestamp), MONTH) AS month_start,
    COALESCE(SUM(IF(UPPER(CAST(event_type AS STRING)) = 'ACTIVE_START', CAST(COALESCE(mrr_change, 0) AS FLOAT64), 0.0)) / 100.0, 0.0) AS new_mrr,
    COALESCE(SUM(IF(UPPER(CAST(event_type AS STRING)) = 'ACTIVE_UPGRADE', CAST(COALESCE(mrr_change, 0) AS FLOAT64), 0.0)) / 100.0, 0.0) AS expansion_mrr,
    COALESCE(SUM(IF(UPPER(CAST(event_type AS STRING)) = 'ACTIVE_DOWNGRADE', CAST(COALESCE(mrr_change, 0) AS FLOAT64), 0.0)) / 100.0, 0.0) AS contraction_mrr,
    COALESCE(SUM(IF(UPPER(CAST(event_type AS STRING)) = 'ACTIVE_END', CAST(COALESCE(mrr_change, 0) AS FLOAT64), 0.0)) / 100.0, 0.0) AS churn_mrr,
    COALESCE(SUM(CAST(COALESCE(mrr_change, 0) AS FLOAT64)) / 100.0, 0.0) AS net_mrr_change
  FROM \`${table}\` t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
    AND event_timestamp >= TIMESTAMP(b.range_start_date)
    AND event_timestamp < TIMESTAMP(b.range_end_exclusive_date)
  GROUP BY month_start
)
SELECT
  FORMAT_DATE('%Y-%m', m.month_start) AS month_key,
  FORMAT_DATE('%b %Y', m.month_start) AS month_label,
  ROUND(
    b.base_mrr + SUM(COALESCE(n.net_mrr_change, 0.0)) OVER (ORDER BY m.month_start ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW),
    2
  ) AS month_end_mrr,
  ROUND(COALESCE(f.new_mrr, 0.0), 2) AS new_mrr,
  ROUND(COALESCE(f.expansion_mrr, 0.0), 2) AS expansion_mrr,
  ROUND(COALESCE(f.contraction_mrr, 0.0), 2) AS contraction_mrr,
  ROUND(COALESCE(f.churn_mrr, 0.0), 2) AS churn_mrr,
  ROUND(COALESCE(f.net_mrr_change, 0.0), 2) AS net_mrr_change
FROM months m
CROSS JOIN base_before_first_month b
LEFT JOIN monthly_net n
  ON n.month_start = m.month_start
LEFT JOIN monthly_flow_in_range f
  ON f.month_start = m.month_start
ORDER BY m.month_start
`;

  const totalMrrQuery = `
SELECT
  ROUND(COALESCE(SUM(CAST(COALESCE(mrr_change, 0) AS FLOAT64)) / 100.0, 0.0), 2) AS total_mrr
FROM \`${table}\`
WHERE
  LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
  AND event_timestamp < TIMESTAMP(@end_exclusive_date)
`;

  const baseParams: BigQueryNamedParameter[] = [
    { name: "target_currency", type: "STRING", value: targetCurrency },
    { name: "start_date", type: "STRING", value: startDateIso },
    { name: "end_date", type: "STRING", value: endDateIso },
    { name: "end_exclusive_date", type: "STRING", value: endExclusiveDateIso },
  ];

  let months: StripeThroughMrrMonthlyRow[] = [];
  let totalMrr = 0;
  if (!skipSummary) {
    const [summaryRows, totalMrrRows] = await Promise.all([
      runBigQueryQueryRows(accessToken, projectId, location, summaryQuery, baseParams),
      runBigQueryQueryRows(accessToken, projectId, location, totalMrrQuery, [
        { name: "target_currency", type: "STRING", value: targetCurrency },
        { name: "end_exclusive_date", type: "STRING", value: endExclusiveDateIso },
      ]),
    ]);

    months = summaryRows.map((row) => ({
      monthKey: asString(row.month_key),
      monthLabel: asString(row.month_label),
      monthEndMrr: asNumber(row.month_end_mrr),
      newMrr: asNumber(row.new_mrr),
      expansionMrr: asNumber(row.expansion_mrr),
      contractionMrr: asNumber(row.contraction_mrr),
      churnMrr: asNumber(row.churn_mrr),
      netMrrChange: asNumber(row.net_mrr_change),
    }));
    totalMrr = asNumber((totalMrrRows[0] || {}).total_mrr);
  }

  const detailBaseCte = buildStripeThroughMrrDetailBaseCte(
    table,
    productsTable,
    customersTable,
    customersMetadataTable,
    chargesTable,
    paymentMethodsTable,
  );
  const detailBaseParams: BigQueryNamedParameter[] = [
    { name: "target_currency", type: "STRING", value: targetCurrency },
    { name: "detail_range_start_date", type: "STRING", value: detailRangeStartDateIso },
    { name: "detail_end_exclusive_date", type: "STRING", value: detailEndExclusiveDateIso },
    { name: "detail_start_month_date", type: "STRING", value: detailStartMonthDateIso },
  ];
  const groupedDetailBaseParams: BigQueryNamedParameter[] = [
    { name: "target_currency", type: "STRING", value: targetCurrency },
    { name: "detail_range_start_date", type: "STRING", value: detailStartMonthDateIso },
    { name: "detail_end_exclusive_date", type: "STRING", value: detailEndExclusiveDateIso },
    { name: "detail_start_month_date", type: "STRING", value: detailStartMonthDateIso },
  ];
  const groupedDetailParamsWithCountryFilters: BigQueryNamedParameter[] = [
    ...groupedDetailBaseParams,
    ...countryFilter.params,
  ];

  let totalRows = 0;
  let detailRowsRaw: Record<string, unknown>[] = [];
  if (groupBy === "none") {
    const rowsQuery = `${detailBaseCte}
SELECT
  FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', event_timestamp, 'UTC') AS event_timestamp_utc,
  event_type,
  ROUND(mrr_change_major, 2) AS mrr_change,
  customer_id,
  customer_country,
  customer_country_code,
  customer_territory,
  subscription_id,
  subscription_item_id,
  product_id,
  product_description,
  price_id,
  price_description
FROM enriched
ORDER BY event_timestamp DESC, subscription_item_id DESC, price_id DESC
LIMIT @limit_rows
OFFSET @offset_rows`;
    if (skipCount) {
      const offsetRows = (page - 1) * pageSize;
      detailRowsRaw = await runBigQueryQueryRows(accessToken, projectId, location, rowsQuery, [
        ...detailBaseParams,
        { name: "limit_rows", type: "INT64", value: String(pageSize) },
        { name: "offset_rows", type: "INT64", value: String(offsetRows) },
      ]);
    } else {
      const countQuery = `${detailBaseCte}
SELECT
  COUNT(*) AS total_rows
FROM enriched`;
      const countRows = await runBigQueryQueryRows(accessToken, projectId, location, countQuery, detailBaseParams);
      totalRows = asInt((countRows[0] || {}).total_rows);
      const totalPages = totalRows > 0 ? Math.ceil(totalRows / pageSize) : 1;
      const clampedPage = Math.min(page, totalPages);
      const offsetRows = (clampedPage - 1) * pageSize;
      if (totalRows > 0) {
        detailRowsRaw = await runBigQueryQueryRows(accessToken, projectId, location, rowsQuery, [
          ...detailBaseParams,
          { name: "limit_rows", type: "INT64", value: String(pageSize) },
          { name: "offset_rows", type: "INT64", value: String(offsetRows) },
        ]);
      }
    }
  } else {
    const groupSql = STRIPE_THROUGH_MRR_GROUP_BY_SQL[groupBy];
    const historyGroupFilterSql = groupBy === "email" ? "TRUE" : "hbg.base_mrr <> 0";
    const rowsQuery = `${detailBaseCte}
, grouped_source AS (
  SELECT
    ${groupSql.keyExpr} AS group_key,
    ${groupSql.labelExpr} AS group_label,
    event_timestamp,
    event_type,
    mrr_change_major,
    customer_id,
    customer_workspace_id,
    customer_country,
    customer_country_code,
    customer_territory,
    customer_created
  FROM enriched
),
group_totals AS (
  SELECT
    group_key,
    group_label,
    ROUND(COALESCE(SUM(mrr_change_major), 0.0), 2) AS net_mrr_change,
    ${groupSql.customerIdsExpr ?? "ARRAY_AGG(NULLIF(customer_id, '(blank)') IGNORE NULLS LIMIT 1)"} AS associated_customer_ids,
    ${groupSql.workspaceIdsExpr ?? "ARRAY_AGG(NULLIF(customer_workspace_id, '') IGNORE NULLS LIMIT 1)"} AS associated_workspace_ids,
    COALESCE(
      ARRAY_AGG(NULLIF(customer_country, 'N/A') IGNORE NULLS ORDER BY IFNULL(customer_created, TIMESTAMP('9999-12-31')) ASC LIMIT 1)[OFFSET(0)],
      'N/A'
    ) AS group_customer_country,
    COALESCE(
      ARRAY_AGG(NULLIF(customer_country_code, '') IGNORE NULLS ORDER BY IFNULL(customer_created, TIMESTAMP('9999-12-31')) ASC LIMIT 1)[OFFSET(0)],
      ''
    ) AS group_customer_country_code,
    COALESCE(
      ARRAY_AGG(NULLIF(customer_territory, 'N/A') IGNORE NULLS ORDER BY IFNULL(customer_created, TIMESTAMP('9999-12-31')) ASC LIMIT 1)[OFFSET(0)],
      'N/A'
    ) AS group_customer_territory
  FROM grouped_source
  GROUP BY group_key, group_label
),
history_source AS (
  SELECT
    UPPER(CAST(event_type AS STRING)) AS event_type,
    CAST(COALESCE(mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major,
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.customer_id')), ''), '(blank)') AS customer_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.workspace_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.workspaceId')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.workspace.id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.metadata.workspace_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.metadata.workspaceId')), ''),
      ''
    ) AS event_workspace_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.subscription_id')), ''),
      '(blank)'
    ) AS subscription_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.subscription_item_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.subscription_item')), ''),
      '(blank)'
    ) AS subscription_item_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price')), ''),
      '(blank)'
    ) AS price_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product')), ''),
      '(blank)'
    ) AS product_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_nickname')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_description')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_display_name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.nickname')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.lookup_key')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.product_name')), ''),
      '(blank)'
    ) AS price_description,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product_name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product_description')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.display_name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.nickname')), ''),
      ''
    ) AS product_description_event
  FROM (
    SELECT
      t.*,
      TO_JSON_STRING(t) AS raw_json
    FROM \`${table}\` t
    WHERE
      LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
      AND event_timestamp < TIMESTAMP(@detail_start_month_date)
  ) t
),
history_enriched AS (
  SELECT
    hs.*,
    COALESCE(cc.customer_email, '') AS customer_email,
    COALESCE(NULLIF(TRIM(cc.customer_workspace_id), ''), NULLIF(TRIM(hs.event_workspace_id), ''), '') AS customer_workspace_id,
    cc.customer_created AS customer_created,
    COALESCE(cc.customer_country, 'N/A') AS customer_country,
    COALESCE(cc.customer_country_code, '') AS customer_country_code,
    COALESCE(cc.customer_territory, 'N/A') AS customer_territory,
    COALESCE(
      NULLIF(TRIM(pl.product_description_table), ''),
      NULLIF(TRIM(hs.product_description_event), ''),
      '(blank)'
    ) AS product_description
  FROM history_source hs
  LEFT JOIN customer_countries_enriched cc ON cc.customer_id = hs.customer_id
  LEFT JOIN products_lookup pl ON pl.product_id = hs.product_id
),
history_by_group AS (
  SELECT
    ${groupSql.keyExpr} AS group_key,
    ${groupSql.labelExpr} AS group_label,
    COALESCE(SUM(mrr_change_major), 0.0) AS base_mrr,
    ${groupSql.customerIdsExpr ?? "ARRAY_AGG(NULLIF(customer_id, '(blank)') IGNORE NULLS LIMIT 1)"} AS associated_customer_ids,
    ${groupSql.workspaceIdsExpr ?? "ARRAY_AGG(NULLIF(customer_workspace_id, '') IGNORE NULLS LIMIT 1)"} AS associated_workspace_ids,
    COALESCE(
      ARRAY_AGG(NULLIF(customer_country, 'N/A') IGNORE NULLS ORDER BY IFNULL(customer_created, TIMESTAMP('9999-12-31')) ASC LIMIT 1)[OFFSET(0)],
      'N/A'
    ) AS group_customer_country,
    COALESCE(
      ARRAY_AGG(NULLIF(customer_country_code, '') IGNORE NULLS ORDER BY IFNULL(customer_created, TIMESTAMP('9999-12-31')) ASC LIMIT 1)[OFFSET(0)],
      ''
    ) AS group_customer_country_code,
    COALESCE(
      ARRAY_AGG(NULLIF(customer_territory, 'N/A') IGNORE NULLS ORDER BY IFNULL(customer_created, TIMESTAMP('9999-12-31')) ASC LIMIT 1)[OFFSET(0)],
      'N/A'
    ) AS group_customer_territory
  FROM history_enriched
  GROUP BY group_key, group_label
),
all_group_totals AS (
  SELECT
    group_key,
    group_label,
    net_mrr_change,
    associated_customer_ids,
    associated_workspace_ids,
    group_customer_country,
    group_customer_country_code,
    group_customer_territory
  FROM group_totals
  UNION ALL
  SELECT
    hbg.group_key,
    hbg.group_label,
    0.0 AS net_mrr_change,
    hbg.associated_customer_ids,
    hbg.associated_workspace_ids,
    hbg.group_customer_country,
    hbg.group_customer_country_code,
    hbg.group_customer_territory
  FROM history_by_group hbg
  WHERE ${historyGroupFilterSql}
    AND NOT EXISTS (
      SELECT 1 FROM group_totals gt
      WHERE gt.group_key = hbg.group_key AND gt.group_label = hbg.group_label
    )
),
filtered_group_totals AS (
  SELECT *
  FROM all_group_totals
  ${countryFilter.whereSql ? `WHERE ${countryFilter.whereSql}` : ""}
),
paged_groups AS (
  SELECT
    group_key,
    group_label,
    net_mrr_change,
    associated_customer_ids,
    associated_workspace_ids,
    group_customer_country,
    group_customer_country_code,
    group_customer_territory
  FROM filtered_group_totals
  ORDER BY net_mrr_change DESC, group_label ASC
  LIMIT @limit_rows
  OFFSET @offset_rows
),
months_in_scope AS (
  SELECT
    month_start
  FROM UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(DATE(@detail_start_month_date), MONTH),
      DATE_TRUNC(DATE_SUB(DATE(@detail_end_exclusive_date), INTERVAL 1 DAY), MONTH),
      INTERVAL 1 MONTH
    )
  ) AS month_start
),
group_monthly AS (
  SELECT
    pg.group_key,
    pg.group_label,
    pg.net_mrr_change AS group_total_net_mrr_change,
    ANY_VALUE(pg.associated_customer_ids) AS associated_customer_ids,
    ANY_VALUE(pg.associated_workspace_ids) AS associated_workspace_ids,
    ANY_VALUE(pg.group_customer_country) AS group_customer_country,
    ANY_VALUE(pg.group_customer_country_code) AS group_customer_country_code,
    ANY_VALUE(pg.group_customer_territory) AS group_customer_territory,
    m.month_start,
    COUNT(gs.event_timestamp) AS event_count,
    COALESCE(SUM(gs.mrr_change_major), 0.0) AS net_mrr_change,
    COALESCE(SUM(IF(gs.event_type = 'ACTIVE_START', gs.mrr_change_major, 0.0)), 0.0) AS new_mrr,
    COALESCE(SUM(IF(gs.event_type = 'ACTIVE_UPGRADE', gs.mrr_change_major, 0.0)), 0.0) AS expansion_mrr,
    COALESCE(SUM(IF(gs.event_type = 'ACTIVE_DOWNGRADE', gs.mrr_change_major, 0.0)), 0.0) AS contraction_mrr,
    COALESCE(SUM(IF(gs.event_type = 'ACTIVE_END', gs.mrr_change_major, 0.0)), 0.0) AS churn_mrr
  FROM paged_groups pg
  CROSS JOIN months_in_scope m
  LEFT JOIN grouped_source gs
    ON gs.group_key = pg.group_key
    AND gs.group_label = pg.group_label
    AND DATE_TRUNC(DATE(gs.event_timestamp), MONTH) = m.month_start
  GROUP BY
    pg.group_key,
    pg.group_label,
    pg.net_mrr_change,
    m.month_start
),
group_monthly_with_base AS (
  SELECT
    gm.group_key,
    gm.group_label,
    gm.associated_customer_ids,
    gm.associated_workspace_ids,
    gm.group_customer_country,
    gm.group_customer_country_code,
    gm.group_customer_territory,
    gm.group_total_net_mrr_change,
    gm.month_start,
    gm.event_count,
    gm.net_mrr_change,
    gm.new_mrr,
    gm.expansion_mrr,
    gm.contraction_mrr,
    gm.churn_mrr,
    COALESCE(hbg.base_mrr, 0.0) AS base_mrr
  FROM group_monthly gm
  LEFT JOIN history_by_group hbg
    ON hbg.group_key = gm.group_key
    AND hbg.group_label = gm.group_label
)
SELECT
  gmb.group_key,
  gmb.group_label,
  gmb.associated_customer_ids,
  gmb.associated_workspace_ids,
  gmb.group_customer_country,
  gmb.group_customer_country_code,
  gmb.group_customer_territory,
  FORMAT_DATE('%Y-%m', gmb.month_start) AS month_key,
  FORMAT_DATE('%b %Y', gmb.month_start) AS month_label,
  gmb.event_count,
  ROUND(gmb.net_mrr_change, 2) AS net_mrr_change,
  ROUND(gmb.new_mrr, 2) AS new_mrr,
  ROUND(gmb.expansion_mrr, 2) AS expansion_mrr,
  ROUND(gmb.contraction_mrr, 2) AS contraction_mrr,
  ROUND(gmb.churn_mrr, 2) AS churn_mrr,
  ROUND(
    gmb.base_mrr
      + SUM(gmb.net_mrr_change) OVER (
          PARTITION BY gmb.group_key, gmb.group_label
          ORDER BY gmb.month_start
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ),
    2
  ) AS month_end_mrr,
  ROUND(
    (
      gmb.base_mrr
      + SUM(gmb.net_mrr_change) OVER (
          PARTITION BY gmb.group_key, gmb.group_label
          ORDER BY gmb.month_start
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
    ) * 12.0,
    2
  ) AS month_end_arr
FROM group_monthly_with_base gmb
ORDER BY gmb.group_total_net_mrr_change DESC, gmb.group_label ASC, gmb.month_start ASC`;
    if (skipCount) {
      const offsetRows = (page - 1) * pageSize;
      detailRowsRaw = await runBigQueryQueryRows(accessToken, projectId, location, rowsQuery, [
        ...groupedDetailParamsWithCountryFilters,
        { name: "limit_rows", type: "INT64", value: String(pageSize) },
        { name: "offset_rows", type: "INT64", value: String(offsetRows) },
      ]);
    } else {
      const countQuery = `${detailBaseCte}
, grouped_source AS (
  SELECT
    ${groupSql.keyExpr} AS group_key,
    ${groupSql.labelExpr} AS group_label,
    event_timestamp,
    event_type,
    mrr_change_major,
    customer_country,
    customer_country_code,
    customer_created
  FROM enriched
),
group_totals AS (
  SELECT
    group_key,
    group_label,
    ROUND(COALESCE(SUM(mrr_change_major), 0.0), 2) AS net_mrr_change,
    COALESCE(
      ARRAY_AGG(NULLIF(customer_country, 'N/A') IGNORE NULLS ORDER BY IFNULL(customer_created, TIMESTAMP('9999-12-31')) ASC LIMIT 1)[OFFSET(0)],
      'N/A'
    ) AS group_customer_country,
    COALESCE(
      ARRAY_AGG(NULLIF(customer_country_code, '') IGNORE NULLS ORDER BY IFNULL(customer_created, TIMESTAMP('9999-12-31')) ASC LIMIT 1)[OFFSET(0)],
      ''
    ) AS group_customer_country_code
  FROM grouped_source
  GROUP BY group_key, group_label
),
history_source AS (
  SELECT
    UPPER(CAST(event_type AS STRING)) AS event_type,
    CAST(COALESCE(mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major,
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.customer_id')), ''), '(blank)') AS customer_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.subscription_id')), ''),
      '(blank)'
    ) AS subscription_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.subscription_item_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.subscription_item')), ''),
      '(blank)'
    ) AS subscription_item_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price')), ''),
      '(blank)'
    ) AS price_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product_id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.id')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product')), ''),
      '(blank)'
    ) AS product_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_nickname')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_description')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price_display_name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.nickname')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.lookup_key')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.price.product_name')), ''),
      '(blank)'
    ) AS price_description,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product_name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product_description')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.display_name')), ''),
      NULLIF(TRIM(JSON_VALUE(raw_json, '$.product.nickname')), ''),
      ''
    ) AS product_description_event
  FROM (
    SELECT
      t.*,
      TO_JSON_STRING(t) AS raw_json
    FROM \`${table}\` t
    WHERE
      LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
      AND event_timestamp < TIMESTAMP(@detail_start_month_date)
  ) t
),
history_enriched AS (
  SELECT
    hs.*,
    COALESCE(cc.customer_email, '') AS customer_email,
    cc.customer_created AS customer_created,
    COALESCE(cc.customer_country, 'N/A') AS customer_country,
    COALESCE(cc.customer_country_code, '') AS customer_country_code,
    COALESCE(cc.customer_territory, 'N/A') AS customer_territory,
    COALESCE(
      NULLIF(TRIM(pl.product_description_table), ''),
      NULLIF(TRIM(hs.product_description_event), ''),
      '(blank)'
    ) AS product_description
  FROM history_source hs
  LEFT JOIN customer_countries_enriched cc ON cc.customer_id = hs.customer_id
  LEFT JOIN products_lookup pl ON pl.product_id = hs.product_id
),
history_by_group AS (
  SELECT
    ${groupSql.keyExpr} AS group_key,
    ${groupSql.labelExpr} AS group_label,
    COALESCE(SUM(mrr_change_major), 0.0) AS base_mrr,
    COALESCE(
      ARRAY_AGG(NULLIF(customer_country, 'N/A') IGNORE NULLS ORDER BY IFNULL(customer_created, TIMESTAMP('9999-12-31')) ASC LIMIT 1)[OFFSET(0)],
      'N/A'
    ) AS group_customer_country,
    COALESCE(
      ARRAY_AGG(NULLIF(customer_country_code, '') IGNORE NULLS ORDER BY IFNULL(customer_created, TIMESTAMP('9999-12-31')) ASC LIMIT 1)[OFFSET(0)],
      ''
    ) AS group_customer_country_code
  FROM history_enriched
  GROUP BY group_key, group_label
),
all_group_totals AS (
  SELECT group_key, group_label, group_customer_country, group_customer_country_code FROM group_totals
  UNION ALL
  SELECT hbg.group_key, hbg.group_label, hbg.group_customer_country, hbg.group_customer_country_code
  FROM history_by_group hbg
  WHERE ${historyGroupFilterSql}
    AND NOT EXISTS (
      SELECT 1 FROM group_totals gt
      WHERE gt.group_key = hbg.group_key AND gt.group_label = hbg.group_label
    )
),
filtered_group_totals AS (
  SELECT *
  FROM all_group_totals
  ${countryFilter.whereSql ? `WHERE ${countryFilter.whereSql}` : ""}
)
SELECT
  COUNT(*) AS total_rows
FROM filtered_group_totals`;
      const countRows = await runBigQueryQueryRows(
        accessToken,
        projectId,
        location,
        countQuery,
        groupedDetailParamsWithCountryFilters,
      );
      totalRows = asInt((countRows[0] || {}).total_rows);
      const totalPages = totalRows > 0 ? Math.ceil(totalRows / pageSize) : 1;
      const clampedPage = Math.min(page, totalPages);
      const offsetRows = (clampedPage - 1) * pageSize;
      if (totalRows > 0) {
        detailRowsRaw = await runBigQueryQueryRows(accessToken, projectId, location, rowsQuery, [
          ...groupedDetailParamsWithCountryFilters,
          { name: "limit_rows", type: "INT64", value: String(pageSize) },
          { name: "offset_rows", type: "INT64", value: String(offsetRows) },
        ]);
      }
    }
  }

  const detailMode: "raw" | "grouped" = groupBy === "none" ? "raw" : "grouped";
  const computedTotalPages = totalRows > 0 ? Math.ceil(totalRows / pageSize) : 1;
  const clampedPage = Math.min(page, computedTotalPages);
  const groupLabelForDisplay = (rawKey: string, rawLabel: string) => {
    const raw = rawLabel || rawKey;
    if (groupBy === "country") return canonicalCountryLabel(raw) || raw || "N/A";
    if (groupBy === "territory") return canonicalTerritoryLabel(raw) || raw || "N/A";
    return rawLabel || rawKey || "(blank)";
  };
  let transactionalWorkspaceIds = new Set<string>();
  if (detailMode === "grouped" && groupBy === "email") {
    try {
      const fetchedWorkspaceIds = await fetchSalesAssistWorkspaceIds();
      transactionalWorkspaceIds = new Set(
        Array.from(fetchedWorkspaceIds)
          .map((workspaceId) => normalizeWorkspaceIdToken(workspaceId))
          .filter(Boolean),
      );
    } catch (error) {
      console.warn(
        `Stripe through MRR: failed to fetch sales-assist workspace ids: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const detailRows: Array<StripeThroughMrrRawDetailRow | StripeThroughMrrGroupedDetailRow> =
    detailMode === "raw"
      ? detailRowsRaw.map((row) => ({
          eventTimestampUtc: asString(row.event_timestamp_utc),
          eventType: asString(row.event_type),
          mrrChange: asNumber(row.mrr_change),
          customerId: asString(row.customer_id),
          customerCountry:
            canonicalCountryLabel(asString(row.customer_country_code) || asString(row.customer_country)) ||
            asString(row.customer_country) ||
            "N/A",
          customerTerritory: canonicalTerritoryLabel(asString(row.customer_territory)) || asString(row.customer_territory) || "N/A",
          subscriptionId: asString(row.subscription_id),
          subscriptionItemId: asString(row.subscription_item_id),
          productId: asString(row.product_id),
          productDescription: asString(row.product_description),
          priceId: asString(row.price_id),
          priceDescription: asString(row.price_description),
        }))
      : detailRowsRaw.map((row) => {
          const associatedWorkspaceIds = asStringArray(row.associated_workspace_ids);
          const hasSalesAssist =
            groupBy === "email" &&
            associatedWorkspaceIds.some((workspaceId) =>
              transactionalWorkspaceIds.has(normalizeWorkspaceIdToken(workspaceId)),
            );
          return {
            groupKey: asString(row.group_key),
            groupLabel: groupLabelForDisplay(asString(row.group_key), asString(row.group_label)),
            customerCountry:
              canonicalCountryLabel(asString(row.group_customer_country_code) || asString(row.group_customer_country)) ||
              asString(row.group_customer_country) ||
              "N/A",
            customerTerritory:
              canonicalTerritoryLabel(asString(row.group_customer_territory)) ||
              asString(row.group_customer_territory) ||
              "N/A",
            monthKey: asString(row.month_key),
            monthLabel: asString(row.month_label),
            eventCount: asInt(row.event_count),
            netMrrChange: asNumber(row.net_mrr_change),
            newMrr: asNumber(row.new_mrr),
            expansionMrr: asNumber(row.expansion_mrr),
            contractionMrr: asNumber(row.contraction_mrr),
            churnMrr: asNumber(row.churn_mrr),
            monthEndMrr: asNumber(row.month_end_mrr),
            monthEndArr: asNumber(row.month_end_arr),
            associatedCustomerIds: asStringArray(row.associated_customer_ids),
            associatedWorkspaceIds,
            salesAssist: groupBy === "email" ? (hasSalesAssist ? "yes" : "no") : undefined,
          };
        });

  const returnedRows = detailRows.length;
  const hasMore = skipCount ? returnedRows === pageSize : clampedPage < computedTotalPages;
  const effectiveTotalRows = skipCount
    ? ((page - 1) * pageSize + returnedRows + (hasMore ? 1 : 0))
    : totalRows;
  const effectiveTotalPages = skipCount ? (hasMore ? page + 1 : Math.max(1, page)) : computedTotalPages;
  const effectivePage = skipCount ? page : clampedPage;

  return {
    startDate: startDateIso,
    endDate: endDateIso,
    detailStartMonth,
    detailEndMonth,
    grain,
    groupBy,
    targetCurrency: targetCurrency.toUpperCase(),
    totalMrr,
    months,
    detailRows,
    detailMode,
    pagination: {
      page: effectivePage,
      pageSize,
      returnedRows,
      totalRows: effectiveTotalRows,
      totalPages: effectiveTotalPages,
      hasMore,
    },
  };
}

export async function queryStripeThroughMrrCustomerArrFromBigQuery(
  request: StripeThroughMrrCustomerArrRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeThroughMrrCustomerArrResult> {
  const startDate = parseIsoDateUtc(request.startDate);
  const endDate = parseIsoDateUtc(request.endDate);
  if (!startDate || !endDate) {
    throw new Error("Invalid startDate/endDate");
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("endDate must be >= startDate");
  }

  const startDateIso = startDate.toISOString().slice(0, 10);
  const endDateIso = endDate.toISOString().slice(0, 10);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const grain = normalizeStripeThroughMrrCustomerPlanGrain(request.grain);

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const table = getStripeArrCorrectMrrChangeTable();
  const customersTable = getStripeCustomersTable();
  const customersMetadataTable = getStripeCustomersMetadataTable(profile);
  const productsTable = getStripeProductsTable(profile);
  const pricesTable = getStripePricesTable(profile);
  const baseSubscriptionOnly = request.baseSubscriptionOnly === true;
  const baseSubscriptionCtes = baseSubscriptionOnly
    ? `,
products_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS product_id,
    MAX(COALESCE(NULLIF(TRIM(CAST(name AS STRING)), ''), '')) AS product_name,
    MAX(COALESCE(NULLIF(TRIM(CAST(description AS STRING)), ''), '')) AS product_description
  FROM \`${productsTable}\`
  GROUP BY product_id
),
prices_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.id')), ''), '(blank)') AS price_id,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.nickname')), ''), '')) AS price_nickname,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.lookup_key')), ''), '')) AS price_lookup_key,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.metadata.version')), ''), '')) AS metadata_version,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.metadata.plan_version')), ''), '')) AS metadata_plan_version
  FROM (
    SELECT TO_JSON_STRING(p) AS raw_json
    FROM \`${pricesTable}\` p
  )
  GROUP BY price_id
),
described_events AS (
  SELECT
    es.*,
    LOWER(
      CONCAT(
        ' ', COALESCE(NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price_nickname')), ''), ''),
        ' ', COALESCE(NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price_description')), ''), ''),
        ' ', COALESCE(NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price_name')), ''), ''),
        ' ', COALESCE(NULLIF(TRIM(pr.price_nickname), ''), ''),
        ' ', COALESCE(NULLIF(TRIM(pr.price_lookup_key), ''), ''),
        ' ', COALESCE(NULLIF(TRIM(pr.metadata_version), ''), ''),
        ' ', COALESCE(NULLIF(TRIM(pr.metadata_plan_version), ''), ''),
        ' ', COALESCE(NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.product_name')), ''), ''),
        ' ', COALESCE(NULLIF(TRIM(pl.product_name), ''), ''),
        ' ', COALESCE(NULLIF(TRIM(pl.product_description), ''), ''),
        ' '
      )
    ) AS plan_hints
  FROM events_source es
  LEFT JOIN products_lookup pl
    ON pl.product_id = es.product_id
  LEFT JOIN prices_lookup pr
    ON pr.price_id = COALESCE(
      NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price_id')), ''),
      NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price.id')), ''),
      NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price')), ''),
      '(blank)'
    )
)`
    : "";
  const eventsBaseSource = baseSubscriptionOnly ? "described_events" : "events_source";
  const baseSubscriptionFilter = baseSubscriptionOnly
    ? `
  WHERE
    REGEXP_CONTAINS(e.plan_hints, r'(^|[^a-z])(enterprise|managed|team|plus|pay\\s*as\\s*you\\s*go|payg|free)([^a-z]|$)')
    AND NOT REGEXP_CONTAINS(e.plan_hints, r'add\\s*ons?|ai\\s+tokens?|conversation\\s+sessions?|web\\s+search\\s+and\\s+crawl')`
    : "";

  const query = `
WITH bounds AS (
  SELECT
    DATE(@start_date) AS requested_start_date,
    DATE(@end_date) AS requested_end_date,
    DATE_ADD(DATE(@end_date), INTERVAL 1 DAY) AS requested_end_exclusive_date
),
bucket_candidates AS (
  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 DAY) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(b.requested_start_date, b.requested_end_date, INTERVAL 1 DAY)) AS d
  WHERE @grain = 'daily'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 MONTH) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.requested_start_date, MONTH),
      DATE_TRUNC(b.requested_end_date, MONTH),
      INTERVAL 1 MONTH
    )
  ) AS d
  WHERE @grain = 'monthly'
),
buckets AS (
  SELECT
    bc.bucket_start,
    GREATEST(bc.bucket_start, b.requested_start_date) AS effective_start,
    LEAST(bc.bucket_end_exclusive_raw, b.requested_end_exclusive_date) AS effective_end_exclusive
  FROM bounds b
  JOIN bucket_candidates bc
    ON TRUE
),
events_source AS (
  SELECT
    t.event_timestamp,
    COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') AS customer_id,
    COALESCE(NULLIF(TRIM(CAST(t.product_id AS STRING)), ''), '(blank)') AS product_id,
    TO_JSON_STRING(t) AS raw_json,
    CAST(COALESCE(t.mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major
  FROM \`${table}\` AS t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(t.currency AS STRING), '')) = @target_currency
    AND t.event_timestamp < TIMESTAMP(b.requested_end_exclusive_date)
)${baseSubscriptionCtes},
customer_ids_in_scope AS (
  SELECT DISTINCT customer_id
  FROM ${eventsBaseSource}
  WHERE customer_id <> '(blank)'
),
customers_workspace_lookup AS (
  SELECT
    customer_id,
    workspace_id
  FROM (
    SELECT
      COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)') AS customer_id,
      NULLIF(TRIM(CAST(m.value AS STRING)), '') AS workspace_id,
      COALESCE(NULLIF(TRIM(CAST(m.batch_timestamp AS STRING)), ''), '') AS batch_timestamp_value,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)')
        ORDER BY
          COALESCE(NULLIF(TRIM(CAST(m.batch_timestamp AS STRING)), ''), '') DESC,
          NULLIF(TRIM(CAST(m.value AS STRING)), '') DESC
      ) AS rn
    FROM \`${customersMetadataTable}\` m
    WHERE LOWER(COALESCE(NULLIF(TRIM(CAST(m.\`key\` AS STRING)), ''), '')) = 'workspace_id'
      AND COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)') IN (
        SELECT customer_id FROM customer_ids_in_scope
      )
  )
  WHERE rn = 1
),
customers_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS customer_id,
    LOWER(COALESCE(NULLIF(TRIM(CAST(email AS STRING)), ''), '')) AS customer_email,
    COALESCE(NULLIF(TRIM(cwl.workspace_id), ''), '') AS customer_workspace_id
  FROM \`${customersTable}\` c
  LEFT JOIN customers_workspace_lookup cwl
    ON cwl.customer_id = COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)')
  WHERE COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') IN (
    SELECT customer_id FROM customer_ids_in_scope
  )
),
events_base AS (
  SELECT
    e.event_timestamp,
    e.customer_id,
    LOWER(
      COALESCE(
        NULLIF(TRIM(cl.customer_email), ''),
        NULLIF(TRIM(e.customer_id), ''),
        '(blank)'
      )
    ) AS customer_key,
    COALESCE(
      NULLIF(TRIM(cl.customer_workspace_id), ''),
      NULLIF(TRIM(JSON_VALUE(e.raw_json, '$.workspace_id')), ''),
      NULLIF(TRIM(JSON_VALUE(e.raw_json, '$.workspaceId')), ''),
      NULLIF(TRIM(JSON_VALUE(e.raw_json, '$.workspace.id')), ''),
      NULLIF(TRIM(JSON_VALUE(e.raw_json, '$.metadata.workspace_id')), ''),
      NULLIF(TRIM(JSON_VALUE(e.raw_json, '$.metadata.workspaceId')), ''),
      ''
    ) AS workspace_id,
    e.mrr_change_major
  FROM ${eventsBaseSource} e
  LEFT JOIN customers_lookup cl
    ON cl.customer_id = e.customer_id
${baseSubscriptionFilter}
),
customer_ids_by_key AS (
  SELECT
    customer_key,
    ARRAY_AGG(DISTINCT customer_id IGNORE NULLS ORDER BY customer_id ASC) AS customer_ids,
    ARRAY_AGG(
      DISTINCT IF(workspace_id = '', NULL, workspace_id)
      IGNORE NULLS
      ORDER BY IF(workspace_id = '', NULL, workspace_id) ASC
    ) AS workspace_ids
  FROM events_base
  WHERE customer_id <> '(blank)'
  GROUP BY customer_key
),
customer_start_mrr AS (
  SELECT
    e.customer_key,
    COALESCE(SUM(e.mrr_change_major), 0.0) AS start_mrr
  FROM events_base e
  CROSS JOIN bounds b
  WHERE e.event_timestamp < TIMESTAMP(b.requested_start_date)
  GROUP BY e.customer_key
),
bucket_deltas AS (
  SELECT
    b.bucket_start,
    e.customer_key,
    COALESCE(SUM(e.mrr_change_major), 0.0) AS delta_mrr
  FROM buckets b
  JOIN events_base e
    ON e.event_timestamp >= TIMESTAMP(b.effective_start)
    AND e.event_timestamp < TIMESTAMP(b.effective_end_exclusive)
  GROUP BY b.bucket_start, e.customer_key
),
customers_in_scope AS (
  SELECT customer_key
  FROM customer_start_mrr
  WHERE ABS(start_mrr) > 1e-9

  UNION DISTINCT

  SELECT customer_key
  FROM bucket_deltas
),
customer_buckets AS (
  SELECT
    c.customer_key,
    b.bucket_start,
    b.effective_start,
    b.effective_end_exclusive
  FROM customers_in_scope c
  CROSS JOIN buckets b
),
snapshot_rows AS (
  SELECT
    cb.customer_key,
    cb.bucket_start,
    cb.effective_start,
    cb.effective_end_exclusive,
    COALESCE(csm.start_mrr, 0.0)
      + SUM(COALESCE(bd.delta_mrr, 0.0)) OVER (
          PARTITION BY cb.customer_key
          ORDER BY cb.bucket_start
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS mrr_end
  FROM customer_buckets cb
  LEFT JOIN customer_start_mrr csm
    ON csm.customer_key = cb.customer_key
  LEFT JOIN bucket_deltas bd
    ON bd.customer_key = cb.customer_key
    AND bd.bucket_start = cb.bucket_start
)
SELECT
  sr.customer_key,
  COALESCE(cik.customer_ids, ARRAY<STRING>[]) AS customer_ids,
  COALESCE(cik.workspace_ids, ARRAY<STRING>[]) AS workspace_ids,
  CASE
    WHEN @grain = 'daily' THEN FORMAT_DATE('%Y-%m-%d', sr.effective_start)
    ELSE FORMAT_DATE('%Y-%m', sr.bucket_start)
  END AS period_key,
  CASE
    WHEN @grain = 'daily' THEN FORMAT_DATE('%Y-%m-%d', sr.effective_start)
    ELSE FORMAT_DATE('%b %Y', sr.bucket_start)
  END AS period_label,
  FORMAT_DATE('%Y-%m-%d', sr.effective_start) AS period_start,
  FORMAT_DATE('%Y-%m-%d', DATE_SUB(sr.effective_end_exclusive, INTERVAL 1 DAY)) AS period_end,
  ROUND(sr.mrr_end * 12.0, 2) AS arr
FROM snapshot_rows sr
LEFT JOIN customer_ids_by_key cik
  ON cik.customer_key = sr.customer_key
WHERE ABS(sr.mrr_end) > 1e-9
ORDER BY sr.customer_key ASC, sr.bucket_start ASC
`;

  const params: BigQueryNamedParameter[] = [
    { name: "start_date", type: "STRING", value: startDateIso },
    { name: "end_date", type: "STRING", value: endDateIso },
    { name: "grain", type: "STRING", value: grain },
    { name: "target_currency", type: "STRING", value: targetCurrency },
  ];
  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);

  return {
    startDate: startDateIso,
    endDate: endDateIso,
    targetCurrency: targetCurrency.toUpperCase(),
    grain,
    rows: rows.map((row) => ({
      customerKey: asString(row.customer_key),
      customerIds: asStringArray(row.customer_ids),
      workspaceIds: asStringArray(row.workspace_ids),
      periodKey: asString(row.period_key),
      periodLabel: asString(row.period_label),
      periodStart: asString(row.period_start),
      periodEnd: asString(row.period_end),
      arr: asNumber(row.arr),
    })),
  };
}

export async function queryStripeThroughMrrSalesAssistExportFromBigQuery(
  request: StripeThroughMrrSalesAssistExportRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeThroughMrrSalesAssistExportResult> {
  const detailMonthDate = parseIsoMonthUtc(request.detailMonth);
  if (!detailMonthDate) {
    throw new Error("Invalid detailMonth");
  }

  const previousMonthDate = addMonthsUtc(detailMonthDate, -1);
  const detailMonth = isoMonthFromDateUtc(detailMonthDate);
  const previousMonth = isoMonthFromDateUtc(previousMonthDate);
  const detailMonthStartIso = isoDateFromUtcDate(detailMonthDate);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const transactionalWorkspaceIds = Array.from(
    new Set(
      (request.workspaceIds || [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  if (!transactionalWorkspaceIds.length) {
    return {
      detailMonth,
      previousMonth,
      targetCurrency: targetCurrency.toUpperCase(),
      rows: [],
    };
  }

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const table = getStripeArrCorrectMrrChangeTable();
  const customersTable = getStripeCustomersTable();
  const customersMetadataTable = getStripeCustomersMetadataTable(profile);
  const workspaceIdsSql = transactionalWorkspaceIds.map((id) => `'${escapeSqlString(id)}'`).join(", ");

  const query = `
WITH bounds AS (
  SELECT
    DATE(@detail_month_start) AS detail_month_start,
    DATE_ADD(DATE(@detail_month_start), INTERVAL 1 MONTH) AS next_month_start
),
transactional_workspace_ids AS (
  SELECT workspace_id
  FROM UNNEST([${workspaceIdsSql}]) AS workspace_id
),
eligible_customer_ids AS (
  SELECT DISTINCT COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)') AS customer_id
  FROM \`${customersMetadataTable}\` m
  WHERE
    LOWER(COALESCE(NULLIF(TRIM(CAST(m.\`key\` AS STRING)), ''), '')) = 'workspace_id'
    AND LOWER(COALESCE(NULLIF(TRIM(CAST(m.value AS STRING)), ''), '')) IN (
      SELECT workspace_id FROM transactional_workspace_ids
    )
),
events_source AS (
  SELECT
    t.event_timestamp,
    COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') AS customer_id,
    TO_JSON_STRING(t) AS raw_json,
    CAST(COALESCE(t.mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major
  FROM \`${table}\` AS t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(t.currency AS STRING), '')) = @target_currency
    AND t.event_timestamp < TIMESTAMP(b.next_month_start)
    AND COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') IN (
      SELECT customer_id FROM eligible_customer_ids
    )
),
customer_ids_in_scope AS (
  SELECT DISTINCT customer_id
  FROM events_source
  WHERE customer_id <> '(blank)'
),
customers_workspace_lookup AS (
  SELECT
    customer_id,
    workspace_id
  FROM (
    SELECT
      COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)') AS customer_id,
      NULLIF(TRIM(CAST(m.value AS STRING)), '') AS workspace_id,
      COALESCE(NULLIF(TRIM(CAST(m.batch_timestamp AS STRING)), ''), '') AS batch_timestamp_value,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)')
        ORDER BY
          COALESCE(NULLIF(TRIM(CAST(m.batch_timestamp AS STRING)), ''), '') DESC,
          NULLIF(TRIM(CAST(m.value AS STRING)), '') DESC
      ) AS rn
    FROM \`${customersMetadataTable}\` m
    WHERE LOWER(COALESCE(NULLIF(TRIM(CAST(m.\`key\` AS STRING)), ''), '')) = 'workspace_id'
      AND COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)') IN (
        SELECT customer_id FROM customer_ids_in_scope
      )
      AND LOWER(COALESCE(NULLIF(TRIM(CAST(m.value AS STRING)), ''), '')) IN (
        SELECT workspace_id FROM transactional_workspace_ids
      )
  )
  WHERE rn = 1
),
customers_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') AS customer_id,
    LOWER(COALESCE(NULLIF(TRIM(CAST(c.email AS STRING)), ''), '')) AS customer_email,
    COALESCE(NULLIF(TRIM(cwl.workspace_id), ''), '') AS customer_workspace_id,
    COALESCE(
      NULLIF(TRIM(CAST(c.address_country AS STRING)), ''),
      NULLIF(TRIM(CAST(c.shipping_address_country AS STRING)), ''),
      ''
    ) AS raw_customer_country
  FROM \`${customersTable}\` c
  LEFT JOIN customers_workspace_lookup cwl
    ON cwl.customer_id = COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)')
  WHERE COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') IN (
    SELECT customer_id FROM customer_ids_in_scope
  )
),
events_base AS (
  SELECT
    e.event_timestamp,
    LOWER(
      COALESCE(
        NULLIF(TRIM(cl.customer_email), ''),
        NULLIF(TRIM(e.customer_id), ''),
        '(blank)'
      )
    ) AS customer_key,
    e.customer_id,
    COALESCE(
      NULLIF(TRIM(cl.customer_workspace_id), ''),
      NULLIF(TRIM(JSON_VALUE(e.raw_json, '$.workspace_id')), ''),
      NULLIF(TRIM(JSON_VALUE(e.raw_json, '$.workspaceId')), ''),
      NULLIF(TRIM(JSON_VALUE(e.raw_json, '$.workspace.id')), ''),
      NULLIF(TRIM(JSON_VALUE(e.raw_json, '$.metadata.workspace_id')), ''),
      NULLIF(TRIM(JSON_VALUE(e.raw_json, '$.metadata.workspaceId')), ''),
      ''
    ) AS workspace_id,
    COALESCE(NULLIF(TRIM(cl.raw_customer_country), ''), '') AS raw_customer_country,
    e.mrr_change_major
  FROM events_source e
  LEFT JOIN customers_lookup cl
    ON cl.customer_id = e.customer_id
),
group_dimensions AS (
  SELECT
    customer_key,
    ARRAY_AGG(DISTINCT IF(customer_id = '(blank)', NULL, customer_id) IGNORE NULLS) AS associated_customer_ids,
    ARRAY_AGG(DISTINCT IF(workspace_id = '', NULL, workspace_id) IGNORE NULLS) AS associated_workspace_ids,
    COALESCE(
      ARRAY_AGG(NULLIF(TRIM(raw_customer_country), '') IGNORE NULLS LIMIT 1)[OFFSET(0)],
      ''
    ) AS group_customer_country
  FROM events_base
  GROUP BY customer_key
),
mrr_by_group AS (
  SELECT
    eb.customer_key,
    COALESCE(SUM(IF(eb.event_timestamp < TIMESTAMP(b.detail_month_start), eb.mrr_change_major, 0.0)), 0.0) AS previous_month_end_mrr,
    COALESCE(SUM(eb.mrr_change_major), 0.0) AS current_month_end_mrr
  FROM events_base eb
  CROSS JOIN bounds b
  GROUP BY eb.customer_key
),
country_normalized AS (
  SELECT
    gd.customer_key,
    gd.associated_customer_ids,
    gd.associated_workspace_ids,
    gd.group_customer_country AS customer_country,
    CASE
      WHEN REGEXP_CONTAINS(TRIM(gd.group_customer_country), r'^[A-Za-z]{2}$') THEN UPPER(TRIM(gd.group_customer_country))
      WHEN REGEXP_CONTAINS(TRIM(gd.group_customer_country), r'^[A-Za-z]{3}$') THEN (
        CASE UPPER(TRIM(gd.group_customer_country))
          WHEN 'USA' THEN 'US'
          WHEN 'CAN' THEN 'CA'
          WHEN 'GBR' THEN 'GB'
          WHEN 'AUS' THEN 'AU'
          WHEN 'NZL' THEN 'NZ'
          ELSE ''
        END
      )
      ELSE (
        CASE LOWER(TRIM(gd.group_customer_country))
          ${COUNTRY_KEY_TO_CODE_SQL_WHENS}
          ELSE ''
        END
      )
    END AS customer_country_code
  FROM group_dimensions gd
)
SELECT
  cn.customer_key,
  COALESCE(cn.associated_customer_ids, ARRAY<STRING>[]) AS associated_customer_ids,
  COALESCE(cn.associated_workspace_ids, ARRAY<STRING>[]) AS associated_workspace_ids,
  COALESCE(NULLIF(TRIM(cn.customer_country), ''), 'N/A') AS customer_country,
  COALESCE(NULLIF(TRIM(cn.customer_country_code), ''), '') AS customer_country_code,
  CASE
    WHEN COALESCE(NULLIF(TRIM(cn.customer_country_code), ''), '') = '' THEN 'N/A'
    ELSE (
      CASE UPPER(TRIM(cn.customer_country_code))
        ${COUNTRY_CODE_TO_TERRITORY_SQL_WHENS}
        ELSE 'Other'
      END
    )
  END AS customer_territory,
  ROUND(mbg.previous_month_end_mrr, 2) AS previous_month_end_mrr,
  ROUND(mbg.current_month_end_mrr, 2) AS current_month_end_mrr
FROM country_normalized cn
JOIN mrr_by_group mbg
  ON mbg.customer_key = cn.customer_key
ORDER BY mbg.current_month_end_mrr DESC, cn.customer_key ASC
`;

  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, [
    { name: "detail_month_start", type: "STRING", value: detailMonthStartIso },
    { name: "target_currency", type: "STRING", value: targetCurrency },
  ]);

  return {
    detailMonth,
    previousMonth,
    targetCurrency: targetCurrency.toUpperCase(),
    rows: rows.map((row) => ({
      emailGroup: asString(row.customer_key),
      associatedCustomerIds: asStringArray(row.associated_customer_ids),
      associatedWorkspaceIds: asStringArray(row.associated_workspace_ids),
      customerCountry:
        canonicalCountryLabel(asString(row.customer_country_code) || asString(row.customer_country)) ||
        asString(row.customer_country) ||
        "N/A",
      customerCountryCode: asString(row.customer_country_code),
      customerTerritory: canonicalTerritoryLabel(asString(row.customer_territory)) || asString(row.customer_territory) || "N/A",
      previousMonthEndMrr: asNumber(row.previous_month_end_mrr),
      currentMonthEndMrr: asNumber(row.current_month_end_mrr),
    })),
  };
}

export async function queryStripeCustomerIdsByWorkspaceIdsFromBigQuery(
  workspaceIds: string[],
  options?: StripeBigQueryOptions,
): Promise<StripeCustomerIdsByWorkspaceResult> {
  const normalizedWorkspaceIds = Array.from(
    new Set(
      (workspaceIds || [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  if (!normalizedWorkspaceIds.length) {
    return {
      workspaceIds: [],
      customerIds: [],
      mappings: [],
    };
  }

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const customersMetadataTable = getStripeCustomersMetadataTable(profile);
  const query = `
WITH requested_workspace_ids AS (
  SELECT workspace_id
  FROM UNNEST(@workspace_ids) AS workspace_id
)
SELECT
  LOWER(COALESCE(NULLIF(TRIM(CAST(m.value AS STRING)), ''), '')) AS workspace_id,
  COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '') AS customer_id
FROM \`${customersMetadataTable}\` m
WHERE
  LOWER(COALESCE(NULLIF(TRIM(CAST(m.\`key\` AS STRING)), ''), '')) = 'workspace_id'
  AND LOWER(COALESCE(NULLIF(TRIM(CAST(m.value AS STRING)), ''), '')) IN (
    SELECT workspace_id FROM requested_workspace_ids
  )
  AND COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '') <> ''
GROUP BY workspace_id, customer_id
ORDER BY workspace_id ASC, customer_id ASC
`;

  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, [
    { name: "workspace_ids", type: "ARRAY_STRING", value: normalizedWorkspaceIds },
  ]);
  const mappings: StripeCustomerWorkspaceCustomerMapping[] = rows
    .map((row) => ({
      workspaceId: asString(row.workspace_id).trim().toLowerCase(),
      customerId: asString(row.customer_id).trim(),
    }))
    .filter((row) => row.workspaceId && row.customerId);
  const customerIds = Array.from(new Set(mappings.map((row) => row.customerId))).sort((a, b) => a.localeCompare(b));

  return {
    workspaceIds: normalizedWorkspaceIds,
    customerIds,
    mappings,
  };
}

export async function queryStripeManagedEarlyLifecycleActivityFromBigQuery(
  request: {
    workspaceIds: string[];
    activityStartDate: string;
    activityEndDate: string;
    targetCurrency: string;
    maxAgeDays?: number;
  },
  options?: StripeBigQueryOptions,
): Promise<StripeManagedEarlyLifecycleActivityResult> {
  const activityStart = parseIsoDateUtc(request.activityStartDate);
  const activityEnd = parseIsoDateUtc(request.activityEndDate);
  if (!activityStart || !activityEnd || activityEnd.getTime() < activityStart.getTime()) {
    throw new Error("Invalid activityStartDate/activityEndDate");
  }
  const workspaceIds = Array.from(
    new Set((request.workspaceIds || []).map((value) => normalizeWorkspaceIdToken(value)).filter(Boolean)),
  ).sort();
  if (!workspaceIds.length) return { rows: [] };

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const eventsTable = getStripeArrCorrectMrrChangeTable();
  const productsTable = getStripeProductsTable(profile);
  const customersMetadataTable = getStripeCustomersMetadataTable(profile);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const maxAgeDays = Math.max(0, Math.min(365, Math.trunc(Number(request.maxAgeDays ?? 90))));

  const query = `
WITH workspace_customers AS (
  SELECT
    LOWER(TRIM(CAST(m.value AS STRING))) AS workspace_id,
    CAST(m.customer_id AS STRING) AS customer_id
  FROM \`${customersMetadataTable}\` m
  WHERE LOWER(TRIM(CAST(m.\`key\` AS STRING))) = 'workspace_id'
    AND LOWER(TRIM(CAST(m.value AS STRING))) IN UNNEST(@workspace_ids)
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY LOWER(TRIM(CAST(m.value AS STRING))), CAST(m.customer_id AS STRING)
    ORDER BY CAST(m.batch_timestamp AS STRING) DESC
  ) = 1
),
products_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS product_id,
    COALESCE(NULLIF(TRIM(CAST(name AS STRING)), ''), '') AS product_name,
    COALESCE(NULLIF(TRIM(CAST(description AS STRING)), ''), '') AS product_description
  FROM \`${productsTable}\`
),
classified_events AS (
  SELECT
    wc.workspace_id,
    wc.customer_id,
    t.event_timestamp,
    CAST(COALESCE(t.mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major,
    CASE
      WHEN LOWER(CAST(t.product_id AS STRING)) = 'prod_m9gpcuhm0q9uzg' THEN 0
      WHEN LOWER(CAST(t.product_id AS STRING)) = 'prod_pbflquwvpscoaw' THEN 1
      WHEN REGEXP_CONTAINS(LOWER(CONCAT(' ', CAST(t.price_id AS STRING), ' ', CAST(t.product_id AS STRING), ' ', COALESCE(p.product_name, ''), ' ', COALESCE(p.product_description, ''), ' ')), r'enterprise') THEN 5
      WHEN REGEXP_CONTAINS(LOWER(CONCAT(' ', CAST(t.price_id AS STRING), ' ', CAST(t.product_id AS STRING), ' ', COALESCE(p.product_name, ''), ' ', COALESCE(p.product_description, ''), ' ')), r'managed') THEN 4
      WHEN REGEXP_CONTAINS(LOWER(CONCAT(' ', CAST(t.price_id AS STRING), ' ', CAST(t.product_id AS STRING), ' ', COALESCE(p.product_name, ''), ' ', COALESCE(p.product_description, ''), ' ')), r'(^|[^a-z])team([^a-z]|$)') THEN 3
      WHEN REGEXP_CONTAINS(LOWER(CONCAT(' ', CAST(t.price_id AS STRING), ' ', CAST(t.product_id AS STRING), ' ', COALESCE(p.product_name, ''), ' ', COALESCE(p.product_description, ''), ' ')), r'(^|[^a-z])plus([^a-z]|$)') THEN 2
      ELSE 0
    END AS plan_rank
  FROM \`${eventsTable}\` t
  JOIN workspace_customers wc ON wc.customer_id = CAST(t.customer_id AS STRING)
  LEFT JOIN products_lookup p
    ON p.product_id = COALESCE(NULLIF(TRIM(CAST(t.product_id AS STRING)), ''), '(blank)')
  WHERE LOWER(COALESCE(CAST(t.currency AS STRING), '')) = @target_currency
    AND DATE(t.event_timestamp) <= DATE(@activity_end_date)
),
managed_deltas AS (
  SELECT workspace_id, customer_id, event_timestamp, SUM(mrr_change_major) AS mrr_change_major
  FROM classified_events
  WHERE plan_rank >= 3
  GROUP BY workspace_id, customer_id, event_timestamp
),
managed_balances AS (
  SELECT
    *,
    COALESCE(SUM(mrr_change_major) OVER (
      PARTITION BY workspace_id, customer_id
      ORDER BY event_timestamp
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ), 0.0) AS balance_before,
    COALESCE(SUM(mrr_change_major) OVER (
      PARTITION BY workspace_id, customer_id
      ORDER BY event_timestamp
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ), 0.0) AS balance_after
  FROM managed_deltas
),
managed_segments AS (
  SELECT
    *,
    MAX(IF(balance_before <= 1e-9 AND balance_after > 1e-9, event_timestamp, NULL)) OVER (
      PARTITION BY workspace_id, customer_id
      ORDER BY event_timestamp
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS managed_start_timestamp
  FROM managed_balances
),
qualifying_activity AS (
  SELECT
    workspace_id,
    customer_id,
    DATE(managed_start_timestamp) AS managed_start_date,
    MIN(DATE(event_timestamp)) AS activity_date
  FROM managed_segments
  WHERE mrr_change_major < -1e-9
    AND balance_before > 1e-9
    AND DATE(event_timestamp) BETWEEN DATE(@activity_start_date) AND DATE(@activity_end_date)
    AND DATE_DIFF(DATE(event_timestamp), DATE(managed_start_timestamp), DAY) BETWEEN 0 AND @max_age_days
  GROUP BY workspace_id, customer_id, managed_start_date
)
SELECT workspace_id, customer_id, managed_start_date, activity_date
FROM qualifying_activity
ORDER BY workspace_id, customer_id
`;
  const params: BigQueryNamedParameter[] = [
    { name: "workspace_ids", type: "ARRAY_STRING", value: workspaceIds },
    { name: "activity_start_date", type: "STRING", value: request.activityStartDate },
    { name: "activity_end_date", type: "STRING", value: request.activityEndDate },
    { name: "target_currency", type: "STRING", value: targetCurrency },
    { name: "max_age_days", type: "INT64", value: String(maxAgeDays) },
  ];
  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);
  return {
    rows: rows.map((row) => ({
      workspaceId: asString(row.workspace_id),
      customerId: asString(row.customer_id),
      managedStartDate: asString(row.managed_start_date),
      activityDate: asString(row.activity_date),
    })),
  };
}

export async function queryStripeThroughMrrCustomerPlanFromBigQuery(
  request: StripeThroughMrrCustomerPlanRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeThroughMrrCustomerPlanResult> {
  const startDate = parseIsoDateUtc(request.startDate);
  const endDate = parseIsoDateUtc(request.endDate);
  if (!startDate || !endDate) {
    throw new Error("Invalid startDate/endDate");
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("endDate must be >= startDate");
  }

  const startDateIso = startDate.toISOString().slice(0, 10);
  const endDateIso = endDate.toISOString().slice(0, 10);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const grain = normalizeStripeThroughMrrCustomerPlanGrain(request.grain);

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const table = getStripeArrCorrectMrrChangeTable();
  const productsTable = getStripeProductsTable(profile);
  const customersTable = getStripeCustomersTable();
  const customersMetadataTable = getStripeCustomersMetadataTable(profile);

  const query = `
WITH bounds AS (
  SELECT
    DATE(@start_date) AS requested_start_date,
    DATE(@end_date) AS requested_end_date,
    DATE_ADD(DATE(@end_date), INTERVAL 1 DAY) AS requested_end_exclusive_date
),
bucket_candidates AS (
  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 DAY) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(b.requested_start_date, b.requested_end_date, INTERVAL 1 DAY)) AS d
  WHERE @grain = 'daily'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 MONTH) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.requested_start_date, MONTH),
      DATE_TRUNC(b.requested_end_date, MONTH),
      INTERVAL 1 MONTH
    )
  ) AS d
  WHERE @grain = 'monthly'
),
buckets AS (
  SELECT
    bc.bucket_start,
    GREATEST(bc.bucket_start, b.requested_start_date) AS effective_start,
    LEAST(bc.bucket_end_exclusive_raw, b.requested_end_exclusive_date) AS effective_end_exclusive
  FROM bucket_candidates bc
  CROSS JOIN bounds b
  WHERE GREATEST(bc.bucket_start, b.requested_start_date) < LEAST(bc.bucket_end_exclusive_raw, b.requested_end_exclusive_date)
),
events_source AS (
  SELECT
    t.event_timestamp,
    COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') AS customer_id,
    COALESCE(NULLIF(TRIM(CAST(t.product_id AS STRING)), ''), '(blank)') AS product_id_norm,
    COALESCE(NULLIF(TRIM(CAST(t.price_id AS STRING)), ''), '') AS price_id_norm,
    CAST(COALESCE(t.mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major
  FROM \`${table}\` t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(t.currency AS STRING), '')) = @target_currency
    AND t.event_timestamp < TIMESTAMP(b.requested_end_exclusive_date)
),
customer_ids_in_scope AS (
  SELECT DISTINCT customer_id
  FROM events_source
  WHERE customer_id <> '(blank)'
),
products_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS product_id,
    COALESCE(NULLIF(TRIM(CAST(name AS STRING)), ''), '') AS product_name,
    COALESCE(NULLIF(TRIM(CAST(description AS STRING)), ''), '') AS product_description
  FROM \`${productsTable}\`
),
customers_workspace_lookup AS (
  SELECT
    customer_id,
    workspace_id
  FROM (
    SELECT
      COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)') AS customer_id,
      NULLIF(TRIM(CAST(m.value AS STRING)), '') AS workspace_id,
      COALESCE(NULLIF(TRIM(CAST(m.batch_timestamp AS STRING)), ''), '') AS batch_timestamp_value,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)')
        ORDER BY
          COALESCE(NULLIF(TRIM(CAST(m.batch_timestamp AS STRING)), ''), '') DESC,
          NULLIF(TRIM(CAST(m.value AS STRING)), '') DESC
      ) AS rn
    FROM \`${customersMetadataTable}\` m
    WHERE LOWER(COALESCE(NULLIF(TRIM(CAST(m.\`key\` AS STRING)), ''), '')) = 'workspace_id'
      AND COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)') IN (
        SELECT customer_id FROM customer_ids_in_scope
      )
  )
  WHERE rn = 1
),
customers_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') AS customer_id,
    LOWER(COALESCE(NULLIF(TRIM(CAST(c.email AS STRING)), ''), '')) AS customer_email,
    COALESCE(NULLIF(TRIM(cwl.workspace_id), ''), '') AS customer_workspace_id
  FROM \`${customersTable}\` c
  LEFT JOIN customers_workspace_lookup cwl
    ON cwl.customer_id = COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)')
  WHERE COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') IN (
    SELECT customer_id FROM customer_ids_in_scope
  )
),
events_base AS (
  SELECT
    base.event_timestamp,
    base.customer_id,
    base.customer_key,
    base.workspace_id,
    base.mrr_change_major,
    CASE
      -- Explicit overrides for known Stripe products.
      WHEN LOWER(base.product_id_norm) = 'prod_m9gpcuhm0q9uzg' THEN 0
      WHEN LOWER(base.product_id_norm) = 'prod_pbflquwvpscoaw' THEN 1
      WHEN REGEXP_CONTAINS(base.plan_hints, r'enterprise') THEN 5
      WHEN REGEXP_CONTAINS(base.plan_hints, r'managed') THEN 4
      WHEN REGEXP_CONTAINS(base.plan_hints, r'(^|[^a-z])team([^a-z]|$)') THEN 3
      WHEN REGEXP_CONTAINS(base.plan_hints, r'(^|[^a-z])plus([^a-z]|$)') THEN 2
      WHEN REGEXP_CONTAINS(base.plan_hints, r'pay\\s*as\\s*you\\s*go|payg|metered|usage|token') THEN 1
      ELSE 0
    END AS plan_rank
  FROM (
    SELECT
      es.event_timestamp,
      es.customer_id,
      es.product_id_norm,
      LOWER(COALESCE(NULLIF(TRIM(cl.customer_email), ''), NULLIF(TRIM(es.customer_id), ''), '(blank)')) AS customer_key,
      COALESCE(NULLIF(TRIM(cl.customer_workspace_id), ''), '') AS workspace_id,
      es.mrr_change_major,
      LOWER(
        CONCAT(
          ' ',
          COALESCE(NULLIF(TRIM(es.price_id_norm), ''), ''),
          ' ',
          COALESCE(NULLIF(TRIM(es.product_id_norm), ''), ''),
          ' ',
          COALESCE(NULLIF(TRIM(pl.product_name), ''), ''),
          ' ',
          COALESCE(NULLIF(TRIM(pl.product_description), ''), ''),
          ' '
        )
      ) AS plan_hints
    FROM events_source es
    LEFT JOIN customers_lookup cl
      ON cl.customer_id = es.customer_id
    LEFT JOIN products_lookup pl
      ON pl.product_id = es.product_id_norm
  ) base
),
customer_ids_by_key AS (
  SELECT
    customer_key,
    ARRAY_AGG(DISTINCT customer_id IGNORE NULLS ORDER BY customer_id ASC) AS customer_ids,
    ARRAY_AGG(
      DISTINCT IF(workspace_id = '', NULL, workspace_id)
      IGNORE NULLS
      ORDER BY IF(workspace_id = '', NULL, workspace_id) ASC
    ) AS workspace_ids
  FROM events_base
  WHERE customer_id <> '(blank)'
  GROUP BY customer_key
),
start_mrr_by_customer_plan AS (
  SELECT
    e.customer_key,
    e.plan_rank,
    COALESCE(SUM(e.mrr_change_major), 0.0) AS start_mrr
  FROM events_base e
  CROSS JOIN bounds b
  WHERE e.event_timestamp < TIMESTAMP(b.requested_start_date)
  GROUP BY e.customer_key, e.plan_rank
),
bucket_deltas_by_customer_plan AS (
  SELECT
    bu.bucket_start,
    e.customer_key,
    e.plan_rank,
    COALESCE(SUM(e.mrr_change_major), 0.0) AS delta_mrr
  FROM buckets bu
  JOIN events_base e
    ON e.event_timestamp >= TIMESTAMP(bu.effective_start)
    AND e.event_timestamp < TIMESTAMP(bu.effective_end_exclusive)
  GROUP BY bu.bucket_start, e.customer_key, e.plan_rank
),
customer_plan_in_scope AS (
  SELECT customer_key, plan_rank
  FROM start_mrr_by_customer_plan
  WHERE ABS(start_mrr) > 1e-9

  UNION DISTINCT

  SELECT customer_key, plan_rank
  FROM bucket_deltas_by_customer_plan
),
customer_plan_buckets AS (
  SELECT
    cpis.customer_key,
    cpis.plan_rank,
    b.bucket_start
  FROM customer_plan_in_scope cpis
  CROSS JOIN buckets b
),
customer_plan_snapshots AS (
  SELECT
    cpb.customer_key,
    cpb.plan_rank,
    cpb.bucket_start,
    COALESCE(s.start_mrr, 0.0)
      + SUM(COALESCE(bd.delta_mrr, 0.0)) OVER (
        PARTITION BY cpb.customer_key, cpb.plan_rank
        ORDER BY cpb.bucket_start
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS mrr_end
  FROM customer_plan_buckets cpb
  LEFT JOIN start_mrr_by_customer_plan s
    ON s.customer_key = cpb.customer_key
    AND s.plan_rank = cpb.plan_rank
  LEFT JOIN bucket_deltas_by_customer_plan bd
    ON bd.customer_key = cpb.customer_key
    AND bd.plan_rank = cpb.plan_rank
    AND bd.bucket_start = cpb.bucket_start
),
customer_bucket_snapshot AS (
  SELECT
    cps.customer_key,
    cps.bucket_start,
    COALESCE(MAX(IF(cps.mrr_end > 1e-9, cps.plan_rank, 0)), 0) AS plan_rank,
    COALESCE(SUM(cps.mrr_end), 0.0) AS mrr_end_total
  FROM customer_plan_snapshots cps
  GROUP BY cps.customer_key, cps.bucket_start
)
SELECT
  cbs.customer_key,
  COALESCE(cik.customer_ids, ARRAY<STRING>[]) AS customer_ids,
  COALESCE(cik.workspace_ids, ARRAY<STRING>[]) AS workspace_ids,
  CASE
    WHEN @grain = 'daily' THEN FORMAT_DATE('%Y-%m-%d', b.effective_start)
    ELSE FORMAT_DATE('%Y-%m', b.bucket_start)
  END AS period_key,
  CASE
    WHEN @grain = 'daily' THEN FORMAT_DATE('%Y-%m-%d', b.effective_start)
    ELSE FORMAT_DATE('%b %Y', b.bucket_start)
  END AS period_label,
  FORMAT_DATE('%Y-%m-%d', b.effective_start) AS period_start,
  FORMAT_DATE('%Y-%m-%d', DATE_SUB(b.effective_end_exclusive, INTERVAL 1 DAY)) AS period_end,
  CASE cbs.plan_rank
    WHEN 5 THEN 'enterprise'
    WHEN 4 THEN 'managed'
    WHEN 3 THEN 'team'
    WHEN 2 THEN 'plus'
    WHEN 1 THEN 'pay_as_you_go'
    ELSE 'free'
  END AS plan,
  ROUND(cbs.mrr_end_total * 12.0, 2) AS arr
FROM customer_bucket_snapshot cbs
JOIN buckets b
  ON b.bucket_start = cbs.bucket_start
LEFT JOIN customer_ids_by_key cik
  ON cik.customer_key = cbs.customer_key
WHERE ABS(cbs.mrr_end_total) > 1e-9
ORDER BY cbs.customer_key ASC, b.bucket_start ASC
`;

  const params: BigQueryNamedParameter[] = [
    { name: "start_date", type: "STRING", value: startDateIso },
    { name: "end_date", type: "STRING", value: endDateIso },
    { name: "target_currency", type: "STRING", value: targetCurrency },
    { name: "grain", type: "STRING", value: grain },
  ];
  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);

  return {
    startDate: startDateIso,
    endDate: endDateIso,
    targetCurrency: targetCurrency.toUpperCase(),
    grain,
    rows: rows.map((row) => ({
      customerKey: asString(row.customer_key),
      customerIds: asStringArray(row.customer_ids),
      workspaceIds: asStringArray(row.workspace_ids),
      periodKey: asString(row.period_key),
      periodLabel: asString(row.period_label),
      periodStart: asString(row.period_start),
      periodEnd: asString(row.period_end),
      plan: (asString(row.plan) || "free") as StripeThroughMrrCustomerPlan,
      arr: asNumber(row.arr),
    })),
  };
}

export async function queryStripeLegacyToV4MigrationsFromBigQuery(
  request: StripeLegacyToV4MigrationRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeLegacyToV4MigrationResult> {
  const startDate = parseIsoDateUtc(request.startDate);
  const endDate = parseIsoDateUtc(request.endDate);
  if (!startDate || !endDate || endDate.getTime() < startDate.getTime()) {
    throw new Error("Invalid startDate/endDate");
  }

  const startDateIso = startDate.toISOString().slice(0, 10);
  const endDateIso = endDate.toISOString().slice(0, 10);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const profile = normalizeProfile(options?.profile || "stripe_arr_correct");
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const table = getStripeArrCorrectMrrChangeTable();
  const productsTable = getStripeProductsTable(profile);
  const pricesTable = getStripePricesTable(profile);
  const customersTable = getStripeCustomersTable();
  const customersMetadataTable = getStripeCustomersMetadataTable(profile);

  const query = `
WITH bounds AS (
  SELECT
    DATE(@start_date) AS migration_start_date,
    DATE(@end_date) AS migration_end_date,
    DATE_ADD(DATE(@end_date), INTERVAL 1 DAY) AS migration_end_exclusive_date
),
products_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS product_id,
    MAX(COALESCE(NULLIF(TRIM(CAST(name AS STRING)), ''), '')) AS product_name,
    MAX(COALESCE(NULLIF(TRIM(CAST(description AS STRING)), ''), '')) AS product_description
  FROM \`${productsTable}\`
  GROUP BY product_id
),
prices_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.id')), ''), '(blank)') AS price_id,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.nickname')), ''), '')) AS price_nickname,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.lookup_key')), ''), '')) AS price_lookup_key,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.metadata.version')), ''), '')) AS metadata_version,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.metadata.plan_version')), ''), '')) AS metadata_plan_version
  FROM (
    SELECT TO_JSON_STRING(p) AS raw_json
    FROM \`${pricesTable}\` p
  )
  GROUP BY price_id
),
events_source AS (
  SELECT
    t.event_timestamp,
    COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') AS customer_id,
    COALESCE(NULLIF(TRIM(CAST(t.product_id AS STRING)), ''), '(blank)') AS product_id,
    CAST(COALESCE(t.mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major,
    TO_JSON_STRING(t) AS raw_json
  FROM \`${table}\` t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(t.currency AS STRING), '')) = @target_currency
    AND t.event_timestamp < TIMESTAMP(b.migration_end_exclusive_date)
    AND COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') <> '(blank)'
),
described_events AS (
  SELECT
    es.event_timestamp,
    es.customer_id,
    es.mrr_change_major,
    LOWER(
      CONCAT(
        ' ',
        COALESCE(NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price_nickname')), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price_description')), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price_name')), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(pr.price_nickname), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(pr.price_lookup_key), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(pr.metadata_version), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(pr.metadata_plan_version), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.product_name')), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(pl.product_name), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(pl.product_description), ''), ''),
        ' '
      )
    ) AS plan_hints
  FROM events_source es
  LEFT JOIN products_lookup pl
    ON pl.product_id = es.product_id
  LEFT JOIN prices_lookup pr
    ON pr.price_id = COALESCE(
      NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price_id')), ''),
      NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price.id')), ''),
      NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price')), ''),
      '(blank)'
    )
),
classified_events AS (
  SELECT
    event_timestamp,
    customer_id,
    mrr_change_major,
    CASE
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z0-9])v4([^a-z0-9]|$)') THEN 'v4'
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z0-9])v3([^a-z0-9]|$)') THEN 'v3'
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z0-9])v2([^a-z0-9]|$)') THEN 'v2'
      ELSE 'other'
    END AS plan_version,
    CASE
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z])enterprise([^a-z]|$)') THEN 'Enterprise'
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z])managed([^a-z]|$)') THEN 'Managed'
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z])team([^a-z]|$)') THEN 'Team'
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z])plus([^a-z]|$)') THEN 'Plus'
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z])(pay\\s*as\\s*you\\s*go|payg)([^a-z]|$)') THEN 'Pay As You Go'
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z])free([^a-z]|$)') THEN 'Free'
      ELSE 'Plan'
    END AS plan_name
  FROM described_events
  WHERE
    REGEXP_CONTAINS(plan_hints, r'(^|[^a-z])(enterprise|managed|team|plus|pay\\s*as\\s*you\\s*go|payg|free)([^a-z]|$)')
    AND NOT REGEXP_CONTAINS(plan_hints, r'add\\s*ons?|ai\\s+tokens?|conversation\\s+sessions?|web\\s+search\\s+and\\s+crawl')
),
daily_plan_changes AS (
  SELECT
    customer_id,
    DATE(event_timestamp) AS event_date,
    COALESCE(SUM(IF(plan_version IN ('v2', 'v3'), mrr_change_major, 0.0)), 0.0) AS legacy_delta_mrr,
    COALESCE(SUM(IF(plan_version = 'v4', mrr_change_major, 0.0)), 0.0) AS v4_delta_mrr
  FROM classified_events
  GROUP BY customer_id, event_date
),
daily_balances AS (
  SELECT
    customer_id,
    event_date,
    legacy_delta_mrr,
    v4_delta_mrr,
    SUM(legacy_delta_mrr) OVER (
      PARTITION BY customer_id
      ORDER BY event_date
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS legacy_after_mrr,
    SUM(v4_delta_mrr) OVER (
      PARTITION BY customer_id
      ORDER BY event_date
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS v4_after_mrr
  FROM daily_plan_changes
),
migration_candidates AS (
  SELECT
    db.customer_id,
    db.event_date AS migrated_at,
    db.legacy_after_mrr - db.legacy_delta_mrr AS legacy_before_mrr,
    db.v4_after_mrr AS v4_after_mrr
  FROM daily_balances db
  CROSS JOIN bounds b
  WHERE
    db.event_date >= b.migration_start_date
    AND db.event_date <= b.migration_end_date
    AND db.legacy_after_mrr - db.legacy_delta_mrr > 1e-9
    AND db.v4_after_mrr - db.v4_delta_mrr <= 1e-9
    AND db.v4_after_mrr > 1e-9
  QUALIFY ROW_NUMBER() OVER (PARTITION BY db.customer_id ORDER BY db.event_date ASC) = 1
),
plan_balances_at_migration AS (
  SELECT
    mc.customer_id,
    mc.migrated_at,
    ce.plan_version,
    ce.plan_name,
    SUM(IF(DATE(ce.event_timestamp) < mc.migrated_at, ce.mrr_change_major, 0.0)) AS before_mrr,
    SUM(ce.mrr_change_major) AS current_mrr
  FROM migration_candidates mc
  JOIN classified_events ce
    ON ce.customer_id = mc.customer_id
  GROUP BY mc.customer_id, mc.migrated_at, ce.plan_version, ce.plan_name
),
migration_plan_labels AS (
  SELECT
    customer_id,
    COALESCE(
      STRING_AGG(
        DISTINCT IF(
          plan_version IN ('v2', 'v3') AND before_mrr > 1e-9,
          CONCAT(plan_name, ' (', UPPER(plan_version), ')'),
          NULL
        ),
        ' + '
        ORDER BY IF(
          plan_version IN ('v2', 'v3') AND before_mrr > 1e-9,
          CONCAT(plan_name, ' (', UPPER(plan_version), ')'),
          NULL
        )
      ),
      'V2/V3 plan'
    ) AS previous_plan,
    COALESCE(
      STRING_AGG(
        DISTINCT IF(
          plan_version IN ('v2', 'v3', 'v4') AND current_mrr > 1e-9,
          CONCAT(plan_name, ' (', UPPER(plan_version), ')'),
          NULL
        ),
        ' + '
        ORDER BY IF(
          plan_version IN ('v2', 'v3', 'v4') AND current_mrr > 1e-9,
          CONCAT(plan_name, ' (', UPPER(plan_version), ')'),
          NULL
        )
      ),
      'No active plan'
    ) AS current_plan
  FROM plan_balances_at_migration
  GROUP BY customer_id
),
customers_workspace_lookup AS (
  SELECT customer_id, workspace_id
  FROM (
    SELECT
      COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)') AS customer_id,
      COALESCE(NULLIF(TRIM(CAST(m.value AS STRING)), ''), '') AS workspace_id,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)')
        ORDER BY COALESCE(NULLIF(TRIM(CAST(m.batch_timestamp AS STRING)), ''), '') DESC
      ) AS rn
    FROM \`${customersMetadataTable}\` m
    WHERE
      LOWER(COALESCE(NULLIF(TRIM(CAST(m.\`key\` AS STRING)), ''), '')) = 'workspace_id'
      AND COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)') IN (
        SELECT customer_id FROM migration_candidates
      )
  )
  WHERE rn = 1
),
customers_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') AS customer_id,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(c), '$.name')), ''), '')) AS customer_name,
    MAX(COALESCE(NULLIF(TRIM(CAST(c.email AS STRING)), ''), '')) AS customer_email
  FROM \`${customersTable}\` c
  WHERE COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') IN (
    SELECT customer_id FROM migration_candidates
  )
  GROUP BY customer_id
)
SELECT
  mc.customer_id,
  COALESCE(NULLIF(cl.customer_name, ''), NULLIF(cl.customer_email, ''), mc.customer_id) AS customer_name,
  COALESCE(cl.customer_email, '') AS customer_email,
  COALESCE(cwl.workspace_id, '') AS workspace_id,
  FORMAT_DATE('%Y-%m-%d', mc.migrated_at) AS migrated_at,
  COALESCE(mpl.previous_plan, 'V2/V3 plan') AS previous_plan,
  COALESCE(mpl.current_plan, 'No active plan') AS current_plan,
  ROUND(mc.legacy_before_mrr * 12.0, 2) AS migrated_arr,
  ROUND(mc.legacy_before_mrr * 12.0, 2) AS legacy_arr_before,
  ROUND(mc.v4_after_mrr * 12.0, 2) AS v4_arr_after
FROM migration_candidates mc
LEFT JOIN customers_workspace_lookup cwl
  ON cwl.customer_id = mc.customer_id
LEFT JOIN customers_lookup cl
  ON cl.customer_id = mc.customer_id
LEFT JOIN migration_plan_labels mpl
  ON mpl.customer_id = mc.customer_id
ORDER BY mc.migrated_at DESC, customer_name ASC
`;

  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, [
    { name: "start_date", type: "STRING", value: startDateIso },
    { name: "end_date", type: "STRING", value: endDateIso },
    { name: "target_currency", type: "STRING", value: targetCurrency },
  ]);

  return {
    startDate: startDateIso,
    endDate: endDateIso,
    targetCurrency: targetCurrency.toUpperCase(),
    rows: rows.map((row) => ({
      customerId: asString(row.customer_id),
      customerName: asString(row.customer_name),
      customerEmail: asString(row.customer_email),
      workspaceId: asString(row.workspace_id),
      migratedAt: asString(row.migrated_at),
      previousPlan: asString(row.previous_plan),
      currentPlan: asString(row.current_plan),
      migratedArr: asNumber(row.migrated_arr),
      legacyArrBefore: asNumber(row.legacy_arr_before),
      v4ArrAfter: asNumber(row.v4_arr_after),
    })),
  };
}

export async function queryStripeLegacyPlanPopulationFromBigQuery(
  request: StripeLegacyPlanPopulationRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeLegacyPlanPopulationResult> {
  const fiscalYearStart = parseIsoDateUtc(request.fiscalYearStart);
  const asOfDate = parseIsoDateUtc(request.asOfDate);
  if (!fiscalYearStart || !asOfDate || asOfDate.getTime() < fiscalYearStart.getTime()) {
    throw new Error("Invalid fiscalYearStart/asOfDate");
  }

  const fiscalYearStartIso = fiscalYearStart.toISOString().slice(0, 10);
  const asOfDateIso = asOfDate.toISOString().slice(0, 10);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const profile = normalizeProfile(options?.profile || "stripe_arr_correct");
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const table = getStripeArrCorrectMrrChangeTable();
  const productsTable = getStripeProductsTable(profile);
  const pricesTable = getStripePricesTable(profile);
  const customersTable = getStripeCustomersTable();
  const customersMetadataTable = getStripeCustomersMetadataTable(profile);

  const query = `
WITH bounds AS (
  SELECT
    DATE(@fiscal_year_start) AS fiscal_year_start,
    DATE_ADD(DATE(@as_of_date), INTERVAL 1 DAY) AS current_end_exclusive
),
products_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS product_id,
    MAX(COALESCE(NULLIF(TRIM(CAST(name AS STRING)), ''), '')) AS product_name,
    MAX(COALESCE(NULLIF(TRIM(CAST(description AS STRING)), ''), '')) AS product_description
  FROM \`${productsTable}\`
  GROUP BY product_id
),
prices_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.id')), ''), '(blank)') AS price_id,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.nickname')), ''), '')) AS price_nickname,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.lookup_key')), ''), '')) AS price_lookup_key,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.metadata.version')), ''), '')) AS metadata_version,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(raw_json, '$.metadata.plan_version')), ''), '')) AS metadata_plan_version
  FROM (
    SELECT TO_JSON_STRING(p) AS raw_json
    FROM \`${pricesTable}\` p
  )
  GROUP BY price_id
),
events_source AS (
  SELECT
    t.event_timestamp,
    COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') AS customer_id,
    COALESCE(NULLIF(TRIM(CAST(t.product_id AS STRING)), ''), '(blank)') AS product_id,
    CAST(COALESCE(t.mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major,
    TO_JSON_STRING(t) AS raw_json
  FROM \`${table}\` t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(t.currency AS STRING), '')) = @target_currency
    AND t.event_timestamp < TIMESTAMP(b.current_end_exclusive)
    AND COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') <> '(blank)'
),
described_events AS (
  SELECT
    es.event_timestamp,
    es.customer_id,
    es.mrr_change_major,
    LOWER(
      CONCAT(
        ' ',
        COALESCE(NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price_nickname')), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price_description')), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price_name')), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(pr.price_nickname), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(pr.price_lookup_key), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(pr.metadata_version), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(pr.metadata_plan_version), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.product_name')), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(pl.product_name), ''), ''),
        ' ',
        COALESCE(NULLIF(TRIM(pl.product_description), ''), ''),
        ' '
      )
    ) AS plan_hints
  FROM events_source es
  LEFT JOIN products_lookup pl
    ON pl.product_id = es.product_id
  LEFT JOIN prices_lookup pr
    ON pr.price_id = COALESCE(
      NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price_id')), ''),
      NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price.id')), ''),
      NULLIF(TRIM(JSON_VALUE(es.raw_json, '$.price')), ''),
      '(blank)'
    )
),
classified_events AS (
  SELECT
    event_timestamp,
    customer_id,
    mrr_change_major,
    CASE
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z0-9])v4([^a-z0-9]|$)') THEN 'v4'
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z0-9])v3([^a-z0-9]|$)') THEN 'v3'
      WHEN REGEXP_CONTAINS(plan_hints, r'(^|[^a-z0-9])v2([^a-z0-9]|$)') THEN 'v2'
      ELSE 'other'
    END AS plan_version
  FROM described_events
  WHERE
    REGEXP_CONTAINS(plan_hints, r'(^|[^a-z])(enterprise|managed|team|plus|pay\\s*as\\s*you\\s*go|payg|free)([^a-z]|$)')
    AND NOT REGEXP_CONTAINS(plan_hints, r'add\\s*ons?|ai\\s+tokens?|conversation\\s+sessions?|web\\s+search\\s+and\\s+crawl')
),
customer_ids AS (
  SELECT DISTINCT customer_id FROM classified_events
),
workspace_lookup AS (
  SELECT customer_id, workspace_id
  FROM (
    SELECT
      COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)') AS customer_id,
      LOWER(COALESCE(NULLIF(TRIM(CAST(m.value AS STRING)), ''), '')) AS workspace_id,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)')
        ORDER BY COALESCE(NULLIF(TRIM(CAST(m.batch_timestamp AS STRING)), ''), '') DESC
      ) AS rn
    FROM \`${customersMetadataTable}\` m
    WHERE
      LOWER(COALESCE(NULLIF(TRIM(CAST(m.\`key\` AS STRING)), ''), '')) = 'workspace_id'
      AND COALESCE(NULLIF(TRIM(CAST(m.customer_id AS STRING)), ''), '(blank)') IN (
        SELECT customer_id FROM customer_ids
      )
  )
  WHERE rn = 1
),
customers_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') AS customer_id,
    MAX(COALESCE(NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(c), '$.name')), ''), '')) AS customer_name,
    MAX(LOWER(COALESCE(NULLIF(TRIM(CAST(c.email AS STRING)), ''), ''))) AS customer_email
  FROM \`${customersTable}\` c
  WHERE COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') IN (
    SELECT customer_id FROM customer_ids
  )
  GROUP BY customer_id
),
customer_balances AS (
  SELECT
    ce.customer_id,
    COALESCE(NULLIF(wl.workspace_id, ''), CONCAT('customer:', ce.customer_id)) AS customer_key,
    COALESCE(wl.workspace_id, '') AS workspace_id,
    COALESCE(cl.customer_name, '') AS customer_name,
    COALESCE(cl.customer_email, '') AS customer_email,
    SUM(IF(
      ce.event_timestamp < TIMESTAMP(b.fiscal_year_start) AND ce.plan_version IN ('v2', 'v3'),
      ce.mrr_change_major,
      0.0
    )) AS opening_legacy_mrr,
    SUM(IF(
      ce.event_timestamp < TIMESTAMP(b.fiscal_year_start) AND ce.plan_version = 'v4',
      ce.mrr_change_major,
      0.0
    )) AS opening_v4_mrr,
    SUM(IF(ce.plan_version IN ('v2', 'v3'), ce.mrr_change_major, 0.0)) AS current_legacy_mrr,
    SUM(IF(ce.plan_version = 'v4', ce.mrr_change_major, 0.0)) AS current_v4_mrr
  FROM classified_events ce
  CROSS JOIN bounds b
  LEFT JOIN workspace_lookup wl
    ON wl.customer_id = ce.customer_id
  LEFT JOIN customers_lookup cl
    ON cl.customer_id = ce.customer_id
  GROUP BY ce.customer_id, customer_key, workspace_id, customer_name, customer_email
),
workspace_balances AS (
  SELECT
    customer_key,
    STRING_AGG(DISTINCT customer_id, ' | ' ORDER BY customer_id) AS customer_ids,
    COALESCE(NULLIF(MAX(workspace_id), ''), '') AS workspace_id,
    COALESCE(STRING_AGG(DISTINCT NULLIF(customer_name, ''), ' | ' ORDER BY NULLIF(customer_name, '')), '') AS customer_name,
    COALESCE(STRING_AGG(DISTINCT NULLIF(customer_email, ''), ' | ' ORDER BY NULLIF(customer_email, '')), '') AS customer_email,
    SUM(opening_legacy_mrr) AS opening_legacy_mrr,
    SUM(opening_v4_mrr) AS opening_v4_mrr,
    SUM(current_legacy_mrr) AS current_legacy_mrr,
    SUM(current_v4_mrr) AS current_v4_mrr
  FROM customer_balances
  GROUP BY customer_key
)
SELECT
  customer_key,
  customer_ids,
  customer_name,
  customer_email,
  workspace_id,
  opening_legacy_mrr > 1e-9 AND opening_v4_mrr <= 1e-9 AS is_opening,
  ROUND(IF(opening_legacy_mrr > 1e-9 AND opening_v4_mrr <= 1e-9, opening_legacy_mrr, 0.0) * 12.0, 2) AS opening_arr,
  current_legacy_mrr > 1e-9 AND current_v4_mrr <= 1e-9 AS is_current,
  ROUND(IF(current_legacy_mrr > 1e-9 AND current_v4_mrr <= 1e-9, current_legacy_mrr, 0.0) * 12.0, 2) AS current_arr
FROM workspace_balances
WHERE
  (opening_legacy_mrr > 1e-9 AND opening_v4_mrr <= 1e-9)
  OR (current_legacy_mrr > 1e-9 AND current_v4_mrr <= 1e-9)
ORDER BY customer_name, customer_ids
`;

  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, [
    { name: "fiscal_year_start", type: "STRING", value: fiscalYearStartIso },
    { name: "as_of_date", type: "STRING", value: asOfDateIso },
    { name: "target_currency", type: "STRING", value: targetCurrency },
  ]);
  const openingCustomers = rows
    .filter((row) => asString(row.is_opening).toLowerCase() === "true")
    .map((row) => ({
      customerId: asString(row.customer_ids),
      customerName: asString(row.customer_name) || asString(row.customer_ids),
      customerEmail: asString(row.customer_email),
      workspaceId: asString(row.workspace_id),
      arr: asNumber(row.opening_arr),
    }));
  const currentCustomers = rows
    .filter((row) => asString(row.is_current).toLowerCase() === "true")
    .map((row) => ({
      customerId: asString(row.customer_ids),
      customerName: asString(row.customer_name) || asString(row.customer_ids),
      customerEmail: asString(row.customer_email),
      workspaceId: asString(row.workspace_id),
      arr: asNumber(row.current_arr),
    }));

  return {
    fiscalYearStart: fiscalYearStartIso,
    asOfDate: asOfDateIso,
    targetCurrency: targetCurrency.toUpperCase(),
    opening: {
      customers: openingCustomers.length,
      arr: round2(openingCustomers.reduce((sum, row) => sum + row.arr, 0)),
    },
    current: {
      customers: currentCustomers.length,
      arr: round2(currentCustomers.reduce((sum, row) => sum + row.arr, 0)),
    },
    openingCustomers,
    currentCustomers,
  };
}

export async function queryStripeBillingOverviewFromBigQuery(
  request: StripeBillingOverviewRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeBillingOverviewResult> {
  const startDate = parseIsoDateUtc(request.startDate);
  const endDate = parseIsoDateUtc(request.endDate);
  if (!startDate || !endDate) {
    throw new Error("Invalid startDate/endDate");
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("endDate must be >= startDate");
  }

  const startDateIso = startDate.toISOString().slice(0, 10);
  const endDateIso = endDate.toISOString().slice(0, 10);
  const grain = normalizeStripeBillingOverviewGrain(request.grain);
  const groupBy = normalizeStripeBillingOverviewGroupBy(request.groupBy);
  const includeCustomerArrRows = request.includeCustomerArrRows !== false;
  const includeCurrentMonthProjection = request.includeCurrentMonthProjection !== false;
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const todayUtc = new Date();
  const currentMonthStartUtc = startOfMonthUtc(todayUtc);
  const currentMonthEndUtc = endOfMonthUtc(todayUtc);
  const projectionLookbackStartUtc = addMonthsUtc(currentMonthStartUtc, -12);
  const projectionLookbackStartIso = isoDateFromUtcDate(projectionLookbackStartUtc);
  const projectionCurrentMonthEndIso = isoDateFromUtcDate(currentMonthEndUtc);

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const table = getStripeArrCorrectMrrChangeTable();
  const productsTable = getStripeProductsTable(profile);
  const { keyExpr: groupKeyExpr, labelExpr: groupLabelExpr } = stripeBillingOverviewGroupSql(groupBy);

  const pointsQuery = `
WITH bounds AS (
  SELECT
    DATE(@start_date) AS requested_start_date,
    DATE(@end_date) AS requested_end_date,
    DATE_ADD(DATE(@end_date), INTERVAL 1 DAY) AS requested_end_exclusive_date,
    CASE
      WHEN @grain = 'daily' THEN DATE_SUB(DATE(@start_date), INTERVAL 90 DAY)
      WHEN @grain = 'weekly' THEN DATE_SUB(DATE(@start_date), INTERVAL 13 WEEK)
      WHEN @grain = 'monthly' THEN DATE_SUB(DATE(@start_date), INTERVAL 3 MONTH)
      ELSE DATE_SUB(DATE(@start_date), INTERVAL 3 MONTH)
    END AS series_start_date
),
bucket_candidates AS (
  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 DAY) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(b.series_start_date, b.requested_end_date, INTERVAL 1 DAY)) AS d
  WHERE @grain = 'daily'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 WEEK) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.series_start_date, WEEK(MONDAY)),
      DATE_TRUNC(b.requested_end_date, WEEK(MONDAY)),
      INTERVAL 1 WEEK
    )
  ) AS d
  WHERE @grain = 'weekly'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 MONTH) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.series_start_date, MONTH),
      DATE_TRUNC(b.requested_end_date, MONTH),
      INTERVAL 1 MONTH
    )
  ) AS d
  WHERE @grain = 'monthly'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 3 MONTH) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.series_start_date, QUARTER),
      DATE_TRUNC(b.requested_end_date, QUARTER),
      INTERVAL 3 MONTH
    )
  ) AS d
  WHERE @grain = 'quarterly'
),
buckets AS (
  SELECT
    bc.bucket_start,
    GREATEST(bc.bucket_start, b.series_start_date) AS effective_start,
    LEAST(bc.bucket_end_exclusive_raw, b.requested_end_exclusive_date) AS effective_end_exclusive
  FROM bucket_candidates bc
  CROSS JOIN bounds b
  WHERE GREATEST(bc.bucket_start, b.series_start_date) < LEAST(bc.bucket_end_exclusive_raw, b.requested_end_exclusive_date)
),
events_base AS (
  SELECT
    event_timestamp,
    COALESCE(NULLIF(TRIM(CAST(customer_id AS STRING)), ''), '(blank)') AS customer_id,
    CAST(COALESCE(mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major
  FROM \`${table}\` AS t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
    AND event_timestamp < TIMESTAMP(b.requested_end_exclusive_date)
),
events_in_series AS (
  SELECT
    event_timestamp,
    customer_id,
    mrr_change_major
  FROM events_base e
  CROSS JOIN bounds b
  WHERE
    e.event_timestamp >= TIMESTAMP(b.series_start_date)
    AND e.event_timestamp < TIMESTAMP(b.requested_end_exclusive_date)
),
base_before_series_total AS (
  SELECT
    COALESCE(SUM(e.mrr_change_major), 0.0) AS base_mrr
  FROM events_base e
  CROSS JOIN bounds b
  WHERE
    e.event_timestamp < TIMESTAMP(b.series_start_date)
),
base_before_series_by_customer AS (
  SELECT
    e.customer_id,
    COALESCE(SUM(e.mrr_change_major), 0.0) AS base_mrr
  FROM events_base e
  CROSS JOIN bounds b
  WHERE e.event_timestamp < TIMESTAMP(b.series_start_date)
  GROUP BY e.customer_id
),
customer_bucket_changes AS (
  SELECT
    bu.bucket_start,
    bu.effective_start,
    bu.effective_end_exclusive,
    e.customer_id,
    COALESCE(SUM(e.mrr_change_major), 0.0) AS delta_mrr
  FROM buckets bu
  JOIN events_in_series e
    ON e.event_timestamp >= TIMESTAMP(bu.effective_start)
    AND e.event_timestamp < TIMESTAMP(bu.effective_end_exclusive)
  GROUP BY
    bu.bucket_start,
    bu.effective_start,
    bu.effective_end_exclusive,
    e.customer_id
),
customer_bucket_transitions AS (
  SELECT
    cbc.bucket_start,
    cbc.effective_start,
    cbc.effective_end_exclusive,
    cbc.customer_id,
    COALESCE(base.base_mrr, 0.0)
      + COALESCE(
        SUM(cbc.delta_mrr) OVER (
          PARTITION BY cbc.customer_id
          ORDER BY cbc.bucket_start
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),
        0.0
      ) AS mrr_start,
    COALESCE(base.base_mrr, 0.0)
      + SUM(cbc.delta_mrr) OVER (
        PARTITION BY cbc.customer_id
        ORDER BY cbc.bucket_start
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS mrr_end,
    cbc.delta_mrr AS net_mrr_change
  FROM customer_bucket_changes cbc
  LEFT JOIN base_before_series_by_customer base
    ON base.customer_id = cbc.customer_id
),
bucket_transition_sums AS (
  SELECT
    cbt.bucket_start,
    COALESCE(
      SUM(
        CASE
          WHEN ABS(cbt.mrr_start) <= 1e-9 AND ABS(cbt.mrr_end) > 1e-9
          THEN cbt.net_mrr_change
          ELSE 0.0
        END
      ),
      0.0
    ) AS new_mrr,
    COALESCE(
      SUM(
        CASE
          WHEN ABS(cbt.mrr_start) > 1e-9 AND ABS(cbt.mrr_end) > 1e-9 AND cbt.mrr_end > cbt.mrr_start
          THEN cbt.net_mrr_change
          ELSE 0.0
        END
      ),
      0.0
    ) AS expansion_mrr,
    COALESCE(
      SUM(
        CASE
          WHEN ABS(cbt.mrr_start) > 1e-9 AND ABS(cbt.mrr_end) > 1e-9 AND cbt.mrr_end < cbt.mrr_start
          THEN cbt.net_mrr_change
          ELSE 0.0
        END
      ),
      0.0
    ) AS contraction_mrr,
    COALESCE(
      SUM(
        CASE
          WHEN ABS(cbt.mrr_start) > 1e-9 AND ABS(cbt.mrr_end) <= 1e-9
          THEN cbt.net_mrr_change
          ELSE 0.0
        END
      ),
      0.0
    ) AS churn_mrr
  FROM customer_bucket_transitions cbt
  GROUP BY cbt.bucket_start
),
bucket_net AS (
  SELECT
    cbc.bucket_start,
    COALESCE(SUM(cbc.delta_mrr), 0.0) AS net_mrr_change
  FROM customer_bucket_changes cbc
  GROUP BY cbc.bucket_start
),
bucket_flows AS (
  SELECT
    bu.bucket_start,
    bu.effective_start,
    bu.effective_end_exclusive,
    COALESCE(bts.new_mrr, 0.0) AS new_mrr,
    COALESCE(bts.expansion_mrr, 0.0) AS expansion_mrr,
    COALESCE(bts.contraction_mrr, 0.0) AS contraction_mrr,
    COALESCE(bts.churn_mrr, 0.0) AS churn_mrr,
    COALESCE(bn.net_mrr_change, 0.0) AS net_mrr_change
  FROM buckets bu
  LEFT JOIN bucket_transition_sums bts
    ON bts.bucket_start = bu.bucket_start
  LEFT JOIN bucket_net bn
    ON bn.bucket_start = bu.bucket_start
),
series AS (
  SELECT
    bf.bucket_start,
    bf.effective_start,
    DATE_SUB(bf.effective_end_exclusive, INTERVAL 1 DAY) AS effective_end,
    bf.new_mrr,
    bf.expansion_mrr,
    bf.contraction_mrr,
    bf.churn_mrr,
    bf.net_mrr_change,
    base.base_mrr + SUM(bf.net_mrr_change) OVER (
      ORDER BY bf.bucket_start
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS mrr_end
  FROM bucket_flows bf
  CROSS JOIN base_before_series_total base
)
SELECT
  CASE
    WHEN @grain = 'quarterly'
    THEN CONCAT(CAST(EXTRACT(YEAR FROM bucket_start) AS STRING), '-Q', CAST(EXTRACT(QUARTER FROM bucket_start) AS STRING))
    ELSE FORMAT_DATE('%Y-%m-%d', effective_start)
  END AS period_key,
  CASE
    WHEN @grain = 'daily' THEN FORMAT_DATE('%Y-%m-%d', effective_start)
    WHEN @grain = 'weekly' THEN CONCAT('Week of ', FORMAT_DATE('%Y-%m-%d', effective_start))
    WHEN @grain = 'monthly' THEN FORMAT_DATE('%b %Y', bucket_start)
    ELSE CONCAT('Q', CAST(EXTRACT(QUARTER FROM bucket_start) AS STRING), ' ', CAST(EXTRACT(YEAR FROM bucket_start) AS STRING))
  END AS period_label,
  FORMAT_DATE('%Y-%m-%d', effective_start) AS period_start,
  FORMAT_DATE('%Y-%m-%d', effective_end) AS period_end,
  ROUND(mrr_end, 2) AS mrr_end,
  ROUND(new_mrr, 2) AS new_mrr,
  ROUND(expansion_mrr, 2) AS expansion_mrr,
  ROUND(contraction_mrr, 2) AS contraction_mrr,
  ROUND(churn_mrr, 2) AS churn_mrr,
  ROUND(net_mrr_change, 2) AS net_mrr_change,
  ROUND(
    COALESCE(
      SAFE_DIVIDE(
        mrr_end - LAG(mrr_end) OVER (ORDER BY bucket_start),
        NULLIF(ABS(LAG(mrr_end) OVER (ORDER BY bucket_start)), 0.0)
      ) * 100.0,
      0.0
    ),
    2
  ) AS mrr_growth_rate_pct,
  ROUND(mrr_end * 12.0, 2) AS arr,
  ROUND(
    COALESCE(
      (mrr_end * 12.0) - LAG(mrr_end * 12.0) OVER (ORDER BY bucket_start),
      0.0
    ),
    2
  ) AS arr_growth
FROM series
ORDER BY bucket_start
`;

  const stripeExactPointsQuery = `
WITH bounds AS (
  SELECT
    DATE(@start_date) AS requested_start_date,
    DATE(@end_date) AS requested_end_date,
    DATE_ADD(DATE(@end_date), INTERVAL 1 DAY) AS requested_end_exclusive_date,
    CASE
      WHEN @grain = 'daily' THEN DATE_SUB(DATE(@start_date), INTERVAL 90 DAY)
      WHEN @grain = 'weekly' THEN DATE_SUB(DATE(@start_date), INTERVAL 13 WEEK)
      WHEN @grain = 'monthly' THEN DATE_SUB(DATE(@start_date), INTERVAL 3 MONTH)
      ELSE DATE_SUB(DATE(@start_date), INTERVAL 3 MONTH)
    END AS series_start_date
),
bucket_candidates AS (
  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 DAY) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(b.series_start_date, b.requested_end_date, INTERVAL 1 DAY)) AS d
  WHERE @grain = 'daily'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 WEEK) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.series_start_date, WEEK(MONDAY)),
      DATE_TRUNC(b.requested_end_date, WEEK(MONDAY)),
      INTERVAL 1 WEEK
    )
  ) AS d
  WHERE @grain = 'weekly'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 MONTH) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.series_start_date, MONTH),
      DATE_TRUNC(b.requested_end_date, MONTH),
      INTERVAL 1 MONTH
    )
  ) AS d
  WHERE @grain = 'monthly'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 3 MONTH) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.series_start_date, QUARTER),
      DATE_TRUNC(b.requested_end_date, QUARTER),
      INTERVAL 3 MONTH
    )
  ) AS d
  WHERE @grain = 'quarterly'
),
buckets AS (
  SELECT
    bc.bucket_start,
    GREATEST(bc.bucket_start, b.series_start_date) AS effective_start,
    LEAST(bc.bucket_end_exclusive_raw, b.requested_end_exclusive_date) AS effective_end_exclusive
  FROM bucket_candidates bc
  CROSS JOIN bounds b
  WHERE GREATEST(bc.bucket_start, b.series_start_date) < LEAST(bc.bucket_end_exclusive_raw, b.requested_end_exclusive_date)
),
events_base AS (
  SELECT
    local_event_timestamp,
    COALESCE(NULLIF(TRIM(CAST(customer_id AS STRING)), ''), '(blank)') AS customer_id,
    CAST(COALESCE(mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major
  FROM \`${table}\` AS t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
    AND local_event_timestamp < TIMESTAMP(b.requested_end_exclusive_date)
),
grouped_sub_item_events AS (
  SELECT
    local_event_timestamp,
    customer_id,
    COALESCE(SUM(mrr_change_major), 0.0) AS mrr_change_major
  FROM events_base
  GROUP BY
    local_event_timestamp,
    customer_id
),
grouped_sub_item_events_with_mrr AS (
  SELECT
    local_event_timestamp,
    DATE(local_event_timestamp) AS local_event_date,
    customer_id,
    mrr_change_major,
    SUM(mrr_change_major) OVER (
      PARTITION BY customer_id
      ORDER BY local_event_timestamp ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS mrr,
    COUNTIF(ABS(mrr_change_major) > 1e-9) OVER (
      PARTITION BY customer_id
      ORDER BY local_event_timestamp ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS mrr_change_count
  FROM grouped_sub_item_events
),
grouped_sub_item_events_with_previous_mrr AS (
  SELECT
    local_event_timestamp,
    local_event_date,
    customer_id,
    mrr_change_major,
    mrr,
    COALESCE(
      LAG(mrr) OVER (
        PARTITION BY customer_id
        ORDER BY local_event_timestamp ASC
      ),
      0.0
    ) AS previous_mrr,
    mrr_change_count
  FROM grouped_sub_item_events_with_mrr
),
customer_events AS (
  SELECT
    local_event_timestamp,
    local_event_date,
    customer_id,
    mrr_change_major,
    mrr,
    previous_mrr,
    mrr_change_count,
    CASE
      WHEN ABS(mrr) > 1e-9 AND ABS(previous_mrr) <= 1e-9 AND mrr_change_count = 1 THEN 'ACTIVE_START'
      WHEN ABS(mrr) > 1e-9 AND ABS(previous_mrr) <= 1e-9 AND mrr_change_count > 1 THEN 'REACTIVATE'
      WHEN ABS(mrr) > 1e-9 AND ABS(previous_mrr) > 1e-9 AND mrr > previous_mrr THEN 'ACTIVE_UPGRADE'
      WHEN ABS(mrr) > 1e-9 AND ABS(previous_mrr) > 1e-9 AND mrr < previous_mrr THEN 'ACTIVE_DOWNGRADE'
      WHEN ABS(mrr) <= 1e-9 AND ABS(previous_mrr) > 1e-9 THEN 'ACTIVE_END'
      ELSE 'ACTIVE_NO_CHANGE'
    END AS event_type
  FROM grouped_sub_item_events_with_previous_mrr
),
daily_customer_events AS (
  SELECT
    local_event_date,
    COALESCE(SUM(mrr_change_major), 0.0) AS net_mrr_change,
    COALESCE(SUM(IF(event_type = 'ACTIVE_START', mrr_change_major, 0.0)), 0.0) AS new_mrr,
    COALESCE(SUM(IF(event_type = 'REACTIVATE', mrr_change_major, 0.0)), 0.0) AS reactivation_mrr,
    COALESCE(SUM(IF(event_type = 'ACTIVE_UPGRADE', mrr_change_major, 0.0)), 0.0) AS expansion_mrr,
    COALESCE(SUM(IF(event_type = 'ACTIVE_DOWNGRADE', mrr_change_major, 0.0)), 0.0) AS contraction_mrr,
    COALESCE(SUM(IF(event_type = 'ACTIVE_END', mrr_change_major, 0.0)), 0.0) AS churn_mrr
  FROM customer_events
  GROUP BY local_event_date
),
series_dates AS (
  SELECT
    d AS local_date
  FROM bounds b
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(b.series_start_date, b.requested_end_date, INTERVAL 1 DAY)) AS d
),
base_before_series_total AS (
  SELECT
    COALESCE(SUM(e.mrr_change_major), 0.0) AS base_mrr
  FROM grouped_sub_item_events e
  CROSS JOIN bounds b
  WHERE e.local_event_timestamp < TIMESTAMP(b.series_start_date)
),
daily_series AS (
  SELECT
    sd.local_date,
    COALESCE(dce.new_mrr, 0.0) AS new_mrr,
    COALESCE(dce.reactivation_mrr, 0.0) AS reactivation_mrr,
    COALESCE(dce.expansion_mrr, 0.0) AS expansion_mrr,
    COALESCE(dce.contraction_mrr, 0.0) AS contraction_mrr,
    COALESCE(dce.churn_mrr, 0.0) AS churn_mrr,
    COALESCE(dce.net_mrr_change, 0.0) AS net_mrr_change,
    base.base_mrr
      + SUM(COALESCE(dce.net_mrr_change, 0.0)) OVER (
        ORDER BY sd.local_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS mrr_end
  FROM series_dates sd
  LEFT JOIN daily_customer_events dce
    ON dce.local_event_date = sd.local_date
  CROSS JOIN base_before_series_total base
),
bucket_series AS (
  SELECT
    bu.bucket_start,
    bu.effective_start,
    DATE_SUB(bu.effective_end_exclusive, INTERVAL 1 DAY) AS effective_end,
    COALESCE(SUM(ds.new_mrr), 0.0) AS new_mrr,
    COALESCE(SUM(ds.reactivation_mrr), 0.0) AS reactivation_mrr,
    COALESCE(SUM(ds.expansion_mrr), 0.0) AS expansion_mrr,
    COALESCE(SUM(ds.contraction_mrr), 0.0) AS contraction_mrr,
    COALESCE(SUM(ds.churn_mrr), 0.0) AS churn_mrr,
    COALESCE(SUM(ds.net_mrr_change), 0.0) AS net_mrr_change,
    COALESCE(
      MAX(
        IF(
          ds.local_date = DATE_SUB(bu.effective_end_exclusive, INTERVAL 1 DAY),
          ds.mrr_end,
          NULL
        )
      ),
      0.0
    ) AS mrr_end
  FROM buckets bu
  LEFT JOIN daily_series ds
    ON ds.local_date >= bu.effective_start
    AND ds.local_date < bu.effective_end_exclusive
  GROUP BY
    bu.bucket_start,
    bu.effective_start,
    bu.effective_end_exclusive
)
SELECT
  CASE
    WHEN @grain = 'quarterly'
    THEN CONCAT(CAST(EXTRACT(YEAR FROM bucket_start) AS STRING), '-Q', CAST(EXTRACT(QUARTER FROM bucket_start) AS STRING))
    ELSE FORMAT_DATE('%Y-%m-%d', effective_start)
  END AS period_key,
  CASE
    WHEN @grain = 'daily' THEN FORMAT_DATE('%Y-%m-%d', effective_start)
    WHEN @grain = 'weekly' THEN CONCAT('Week of ', FORMAT_DATE('%Y-%m-%d', effective_start))
    WHEN @grain = 'monthly' THEN FORMAT_DATE('%b %Y', bucket_start)
    ELSE CONCAT('Q', CAST(EXTRACT(QUARTER FROM bucket_start) AS STRING), ' ', CAST(EXTRACT(YEAR FROM bucket_start) AS STRING))
  END AS period_label,
  FORMAT_DATE('%Y-%m-%d', effective_start) AS period_start,
  FORMAT_DATE('%Y-%m-%d', effective_end) AS period_end,
  ROUND(mrr_end, 2) AS mrr_end,
  ROUND(new_mrr, 2) AS new_mrr,
  ROUND(reactivation_mrr, 2) AS reactivation_mrr,
  ROUND(expansion_mrr, 2) AS expansion_mrr,
  ROUND(contraction_mrr, 2) AS contraction_mrr,
  ROUND(churn_mrr, 2) AS churn_mrr,
  ROUND(net_mrr_change, 2) AS net_mrr_change,
  ROUND(
    COALESCE(
      SAFE_DIVIDE(
        mrr_end - LAG(mrr_end) OVER (ORDER BY bucket_start),
        NULLIF(ABS(LAG(mrr_end) OVER (ORDER BY bucket_start)), 0.0)
      ) * 100.0,
      0.0
    ),
    2
  ) AS mrr_growth_rate_pct,
  ROUND(mrr_end * 12.0, 2) AS arr,
  ROUND(
    COALESCE(
      (mrr_end * 12.0) - LAG(mrr_end * 12.0) OVER (ORDER BY bucket_start),
      0.0
    ),
    2
  ) AS arr_growth
FROM bucket_series
ORDER BY bucket_start
`;

  const groupedSeriesQuery =
    groupBy === "none"
      ? null
      : `
WITH bounds AS (
  SELECT
    DATE(@start_date) AS requested_start_date,
    DATE(@end_date) AS requested_end_date,
    DATE_ADD(DATE(@end_date), INTERVAL 1 DAY) AS requested_end_exclusive_date,
    CASE
      WHEN @grain = 'daily' THEN DATE_SUB(DATE(@start_date), INTERVAL 90 DAY)
      WHEN @grain = 'weekly' THEN DATE_SUB(DATE(@start_date), INTERVAL 13 WEEK)
      WHEN @grain = 'monthly' THEN DATE_SUB(DATE(@start_date), INTERVAL 3 MONTH)
      ELSE DATE_SUB(DATE(@start_date), INTERVAL 3 MONTH)
    END AS series_start_date
),
bucket_candidates AS (
  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 DAY) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(b.series_start_date, b.requested_end_date, INTERVAL 1 DAY)) AS d
  WHERE @grain = 'daily'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 WEEK) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.series_start_date, WEEK(MONDAY)),
      DATE_TRUNC(b.requested_end_date, WEEK(MONDAY)),
      INTERVAL 1 WEEK
    )
  ) AS d
  WHERE @grain = 'weekly'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 MONTH) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.series_start_date, MONTH),
      DATE_TRUNC(b.requested_end_date, MONTH),
      INTERVAL 1 MONTH
    )
  ) AS d
  WHERE @grain = 'monthly'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 3 MONTH) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.series_start_date, QUARTER),
      DATE_TRUNC(b.requested_end_date, QUARTER),
      INTERVAL 3 MONTH
    )
  ) AS d
  WHERE @grain = 'quarterly'
),
buckets AS (
  SELECT
    bc.bucket_start,
    GREATEST(bc.bucket_start, b.series_start_date) AS effective_start,
    LEAST(bc.bucket_end_exclusive_raw, b.requested_end_exclusive_date) AS effective_end_exclusive
  FROM bucket_candidates bc
  CROSS JOIN bounds b
  WHERE GREATEST(bc.bucket_start, b.series_start_date) < LEAST(bc.bucket_end_exclusive_raw, b.requested_end_exclusive_date)
),
raw_events AS (
  SELECT
    local_event_timestamp,
    COALESCE(NULLIF(TRIM(CAST(customer_id AS STRING)), ''), '(blank)') AS customer_id,
    CAST(COALESCE(mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major,
    TO_JSON_STRING(t) AS raw_json
  FROM \`${table}\` AS t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
    AND local_event_timestamp < TIMESTAMP(b.requested_end_exclusive_date)
),
parsed_events AS (
  SELECT
    re.local_event_timestamp,
    re.customer_id,
    re.mrr_change_major,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.subscription_id')), ''),
      '(blank)'
    ) AS subscription_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.subscription_item_id')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.subscription_item')), ''),
      '(blank)'
    ) AS subscription_item_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.price_id')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.price.id')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.price')), ''),
      '(blank)'
    ) AS price_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.product_id')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.product.id')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.product')), ''),
      '(blank)'
    ) AS product_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.price_nickname')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.price_description')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.price_name')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.price_display_name')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.price.nickname')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.price.name')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.price.lookup_key')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.price.product_name')), ''),
      '(blank)'
    ) AS price_description_event,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.product_name')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.product_description')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.product.name')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.product.display_name')), ''),
      NULLIF(TRIM(JSON_VALUE(re.raw_json, '$.product.nickname')), ''),
      ''
    ) AS product_description_event
  FROM raw_events re
),
products_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS product_id,
    COALESCE(
      NULLIF(TRIM(CAST(description AS STRING)), ''),
      NULLIF(TRIM(CAST(name AS STRING)), ''),
      '(blank)'
    ) AS product_description_table
  FROM \`${productsTable}\`
),
events_enriched AS (
  SELECT
    pe.local_event_timestamp,
    pe.customer_id,
    pe.mrr_change_major,
    pe.price_id,
    pe.product_id,
    pe.subscription_id,
    pe.subscription_item_id,
    COALESCE(
      NULLIF(TRIM(pl.product_description_table), ''),
      NULLIF(TRIM(pe.product_description_event), ''),
      '(blank)'
    ) AS product_description,
    COALESCE(NULLIF(TRIM(pe.price_description_event), ''), '(blank)') AS price_description
  FROM parsed_events pe
  LEFT JOIN products_lookup pl
    ON pl.product_id = pe.product_id
),
events_with_group AS (
  SELECT
    ee.local_event_timestamp,
    ee.customer_id,
    ee.mrr_change_major,
    ee.product_description,
    ee.price_description,
    ee.price_id,
    ee.product_id,
    ee.subscription_id,
    ee.subscription_item_id,
    ${groupKeyExpr} AS group_key,
    ${groupLabelExpr} AS group_label
  FROM events_enriched ee
),
selected_groups AS (
  SELECT
    e.group_key,
    COALESCE(
      ARRAY_AGG(
        IF(e.group_label = '(blank)' OR e.group_label = '', NULL, e.group_label)
        IGNORE NULLS
        ORDER BY e.local_event_timestamp DESC
        LIMIT 1
      )[SAFE_OFFSET(0)],
      e.group_key
    ) AS group_label,
    COALESCE(SUM(e.mrr_change_major), 0.0) AS current_mrr
  FROM events_with_group e
  GROUP BY e.group_key
  HAVING ABS(COALESCE(SUM(e.mrr_change_major), 0.0)) > 1e-9
  ORDER BY ABS(current_mrr) DESC, group_label ASC
  LIMIT @group_limit
),
events_base AS (
  SELECT
    e.local_event_timestamp,
    e.customer_id,
    sg.group_key,
    sg.group_label,
    e.mrr_change_major
  FROM events_with_group e
  JOIN selected_groups sg
    ON sg.group_key = e.group_key
),
grouped_sub_item_events AS (
  SELECT
    local_event_timestamp,
    customer_id,
    group_key,
    group_label,
    COALESCE(SUM(mrr_change_major), 0.0) AS mrr_change_major
  FROM events_base
  GROUP BY
    local_event_timestamp,
    customer_id,
    group_key,
    group_label
),
grouped_sub_item_events_with_mrr AS (
  SELECT
    local_event_timestamp,
    DATE(local_event_timestamp) AS local_event_date,
    customer_id,
    group_key,
    group_label,
    mrr_change_major,
    SUM(mrr_change_major) OVER (
      PARTITION BY customer_id, group_key
      ORDER BY local_event_timestamp ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS mrr,
    COUNTIF(ABS(mrr_change_major) > 1e-9) OVER (
      PARTITION BY customer_id, group_key
      ORDER BY local_event_timestamp ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS mrr_change_count
  FROM grouped_sub_item_events
),
grouped_sub_item_events_with_previous_mrr AS (
  SELECT
    local_event_timestamp,
    local_event_date,
    customer_id,
    group_key,
    group_label,
    mrr_change_major,
    mrr,
    COALESCE(
      LAG(mrr) OVER (
        PARTITION BY customer_id, group_key
        ORDER BY local_event_timestamp ASC
      ),
      0.0
    ) AS previous_mrr,
    mrr_change_count
  FROM grouped_sub_item_events_with_mrr
),
customer_events AS (
  SELECT
    local_event_timestamp,
    local_event_date,
    customer_id,
    group_key,
    group_label,
    mrr_change_major,
    mrr,
    previous_mrr,
    mrr_change_count,
    CASE
      WHEN ABS(mrr) > 1e-9 AND ABS(previous_mrr) <= 1e-9 AND mrr_change_count = 1 THEN 'ACTIVE_START'
      WHEN ABS(mrr) > 1e-9 AND ABS(previous_mrr) <= 1e-9 AND mrr_change_count > 1 THEN 'REACTIVATE'
      WHEN ABS(mrr) > 1e-9 AND ABS(previous_mrr) > 1e-9 AND mrr > previous_mrr THEN 'ACTIVE_UPGRADE'
      WHEN ABS(mrr) > 1e-9 AND ABS(previous_mrr) > 1e-9 AND mrr < previous_mrr THEN 'ACTIVE_DOWNGRADE'
      WHEN ABS(mrr) <= 1e-9 AND ABS(previous_mrr) > 1e-9 THEN 'ACTIVE_END'
      ELSE 'ACTIVE_NO_CHANGE'
    END AS event_type
  FROM grouped_sub_item_events_with_previous_mrr
),
daily_group_events AS (
  SELECT
    local_event_date,
    group_key,
    group_label,
    COALESCE(SUM(mrr_change_major), 0.0) AS net_mrr_change,
    COALESCE(SUM(IF(event_type = 'ACTIVE_START', mrr_change_major, 0.0)), 0.0) AS new_mrr,
    COALESCE(SUM(IF(event_type = 'REACTIVATE', mrr_change_major, 0.0)), 0.0) AS reactivation_mrr,
    COALESCE(SUM(IF(event_type = 'ACTIVE_UPGRADE', mrr_change_major, 0.0)), 0.0) AS expansion_mrr,
    COALESCE(SUM(IF(event_type = 'ACTIVE_DOWNGRADE', mrr_change_major, 0.0)), 0.0) AS contraction_mrr,
    COALESCE(SUM(IF(event_type = 'ACTIVE_END', mrr_change_major, 0.0)), 0.0) AS churn_mrr
  FROM customer_events
  GROUP BY
    local_event_date,
    group_key,
    group_label
),
series_dates AS (
  SELECT
    d AS local_date
  FROM bounds b
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(b.series_start_date, b.requested_end_date, INTERVAL 1 DAY)) AS d
),
base_before_series_by_group AS (
  SELECT
    e.group_key,
    COALESCE(SUM(e.mrr_change_major), 0.0) AS base_mrr
  FROM grouped_sub_item_events e
  CROSS JOIN bounds b
  WHERE e.local_event_timestamp < TIMESTAMP(b.series_start_date)
  GROUP BY e.group_key
),
daily_series_by_group AS (
  SELECT
    sg.group_key,
    sg.group_label,
    sd.local_date,
    COALESCE(dge.new_mrr, 0.0) AS new_mrr,
    COALESCE(dge.reactivation_mrr, 0.0) AS reactivation_mrr,
    COALESCE(dge.expansion_mrr, 0.0) AS expansion_mrr,
    COALESCE(dge.contraction_mrr, 0.0) AS contraction_mrr,
    COALESCE(dge.churn_mrr, 0.0) AS churn_mrr,
    COALESCE(dge.net_mrr_change, 0.0) AS net_mrr_change,
    COALESCE(base.base_mrr, 0.0)
      + SUM(COALESCE(dge.net_mrr_change, 0.0)) OVER (
        PARTITION BY sg.group_key
        ORDER BY sd.local_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS mrr_end
  FROM selected_groups sg
  CROSS JOIN series_dates sd
  LEFT JOIN daily_group_events dge
    ON dge.group_key = sg.group_key
    AND dge.local_event_date = sd.local_date
  LEFT JOIN base_before_series_by_group base
    ON base.group_key = sg.group_key
),
bucket_group_series AS (
  SELECT
    bu.bucket_start,
    bu.effective_start,
    DATE_SUB(bu.effective_end_exclusive, INTERVAL 1 DAY) AS effective_end,
    dsg.group_key,
    dsg.group_label,
    COALESCE(SUM(dsg.new_mrr), 0.0) AS new_mrr,
    COALESCE(SUM(dsg.reactivation_mrr), 0.0) AS reactivation_mrr,
    COALESCE(SUM(dsg.expansion_mrr), 0.0) AS expansion_mrr,
    COALESCE(SUM(dsg.contraction_mrr), 0.0) AS contraction_mrr,
    COALESCE(SUM(dsg.churn_mrr), 0.0) AS churn_mrr,
    COALESCE(SUM(dsg.net_mrr_change), 0.0) AS net_mrr_change,
    COALESCE(
      MAX(
        IF(
          dsg.local_date = DATE_SUB(bu.effective_end_exclusive, INTERVAL 1 DAY),
          dsg.mrr_end,
          NULL
        )
      ),
      0.0
    ) AS mrr_end
  FROM buckets bu
  JOIN daily_series_by_group dsg
    ON dsg.local_date >= bu.effective_start
    AND dsg.local_date < bu.effective_end_exclusive
  GROUP BY
    bu.bucket_start,
    bu.effective_start,
    bu.effective_end_exclusive,
    dsg.group_key,
    dsg.group_label
)
SELECT
  bgs.group_key,
  bgs.group_label,
  CASE
    WHEN @grain = 'quarterly'
    THEN CONCAT(CAST(EXTRACT(YEAR FROM bgs.bucket_start) AS STRING), '-Q', CAST(EXTRACT(QUARTER FROM bgs.bucket_start) AS STRING))
    ELSE FORMAT_DATE('%Y-%m-%d', bgs.effective_start)
  END AS period_key,
  CASE
    WHEN @grain = 'daily' THEN FORMAT_DATE('%Y-%m-%d', bgs.effective_start)
    WHEN @grain = 'weekly' THEN CONCAT('Week of ', FORMAT_DATE('%Y-%m-%d', bgs.effective_start))
    WHEN @grain = 'monthly' THEN FORMAT_DATE('%b %Y', bgs.bucket_start)
    ELSE CONCAT('Q', CAST(EXTRACT(QUARTER FROM bgs.bucket_start) AS STRING), ' ', CAST(EXTRACT(YEAR FROM bgs.bucket_start) AS STRING))
  END AS period_label,
  FORMAT_DATE('%Y-%m-%d', bgs.effective_start) AS period_start,
  FORMAT_DATE('%Y-%m-%d', bgs.effective_end) AS period_end,
  ROUND(bgs.mrr_end, 2) AS mrr_end,
  ROUND(bgs.new_mrr, 2) AS new_mrr,
  ROUND(bgs.reactivation_mrr, 2) AS reactivation_mrr,
  ROUND(bgs.expansion_mrr, 2) AS expansion_mrr,
  ROUND(bgs.contraction_mrr, 2) AS contraction_mrr,
  ROUND(bgs.churn_mrr, 2) AS churn_mrr,
  ROUND(bgs.net_mrr_change, 2) AS net_mrr_change,
  ROUND(
    COALESCE(
      SAFE_DIVIDE(
        bgs.mrr_end - LAG(bgs.mrr_end) OVER (PARTITION BY bgs.group_key ORDER BY bgs.bucket_start),
        NULLIF(ABS(LAG(bgs.mrr_end) OVER (PARTITION BY bgs.group_key ORDER BY bgs.bucket_start)), 0.0)
      ) * 100.0,
      0.0
    ),
    2
  ) AS mrr_growth_rate_pct,
  ROUND(bgs.mrr_end * 12.0, 2) AS arr,
  ROUND(
    COALESCE(
      (bgs.mrr_end * 12.0) - LAG(bgs.mrr_end * 12.0) OVER (PARTITION BY bgs.group_key ORDER BY bgs.bucket_start),
      0.0
    ),
    2
  ) AS arr_growth
FROM bucket_group_series bgs
ORDER BY bgs.group_label ASC, bgs.bucket_start ASC
`;

  const customerArrQuery = `
WITH bounds AS (
  SELECT
    DATE(@start_date) AS requested_start_date,
    DATE(@end_date) AS requested_end_date,
    DATE_ADD(DATE(@end_date), INTERVAL 1 DAY) AS requested_end_exclusive_date
),
requested_bucket_candidates AS (
  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 DAY) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(b.requested_start_date, b.requested_end_date, INTERVAL 1 DAY)) AS d
  WHERE @grain = 'daily'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 WEEK) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.requested_start_date, WEEK(MONDAY)),
      DATE_TRUNC(b.requested_end_date, WEEK(MONDAY)),
      INTERVAL 1 WEEK
    )
  ) AS d
  WHERE @grain = 'weekly'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 1 MONTH) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.requested_start_date, MONTH),
      DATE_TRUNC(b.requested_end_date, MONTH),
      INTERVAL 1 MONTH
    )
  ) AS d
  WHERE @grain = 'monthly'

  UNION ALL

  SELECT
    d AS bucket_start,
    DATE_ADD(d, INTERVAL 3 MONTH) AS bucket_end_exclusive_raw
  FROM bounds b
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      DATE_TRUNC(b.requested_start_date, QUARTER),
      DATE_TRUNC(b.requested_end_date, QUARTER),
      INTERVAL 3 MONTH
    )
  ) AS d
  WHERE @grain = 'quarterly'
),
requested_buckets AS (
  SELECT
    bc.bucket_start,
    GREATEST(bc.bucket_start, b.requested_start_date) AS effective_start,
    LEAST(bc.bucket_end_exclusive_raw, b.requested_end_exclusive_date) AS effective_end_exclusive
  FROM requested_bucket_candidates bc
  CROSS JOIN bounds b
  WHERE GREATEST(bc.bucket_start, b.requested_start_date) < LEAST(bc.bucket_end_exclusive_raw, b.requested_end_exclusive_date)
),
first_requested_bucket AS (
  SELECT MIN(bucket_start) AS first_bucket_start
  FROM requested_buckets
),
events_base AS (
  SELECT
    event_timestamp,
    COALESCE(NULLIF(TRIM(CAST(customer_id AS STRING)), ''), '(blank)') AS customer_id,
    CAST(COALESCE(mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major
  FROM \`${table}\` AS t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
    AND event_timestamp < TIMESTAMP(b.requested_end_exclusive_date)
),
events_before_requested AS (
  SELECT
    e.customer_id,
    COALESCE(SUM(e.mrr_change_major), 0.0) AS start_mrr
  FROM events_base e
  CROSS JOIN bounds b
  WHERE e.event_timestamp < TIMESTAMP(b.requested_start_date)
  GROUP BY e.customer_id
),
events_in_requested AS (
  SELECT
    e.event_timestamp,
    e.customer_id,
    e.mrr_change_major
  FROM events_base e
  CROSS JOIN bounds b
  WHERE e.event_timestamp >= TIMESTAMP(b.requested_start_date)
),
requested_bucket_changes AS (
  SELECT
    rb.bucket_start,
    er.customer_id,
    COALESCE(SUM(er.mrr_change_major), 0.0) AS delta_mrr
  FROM requested_buckets rb
  JOIN events_in_requested er
    ON er.event_timestamp >= TIMESTAMP(rb.effective_start)
    AND er.event_timestamp < TIMESTAMP(rb.effective_end_exclusive)
  GROUP BY
    rb.bucket_start,
    er.customer_id
),
customer_seed_rows AS (
  SELECT
    eb.customer_id,
    fb.first_bucket_start AS bucket_start,
    0.0 AS delta_mrr
  FROM events_before_requested eb
  CROSS JOIN first_requested_bucket fb
  WHERE ABS(eb.start_mrr) > 1e-9
    AND fb.first_bucket_start IS NOT NULL
),
customer_bucket_deltas AS (
  SELECT
    combined.customer_id,
    combined.bucket_start,
    COALESCE(SUM(combined.delta_mrr), 0.0) AS delta_mrr
  FROM (
    SELECT
      rbc.customer_id,
      rbc.bucket_start,
      rbc.delta_mrr
    FROM requested_bucket_changes rbc
    UNION ALL
    SELECT
      csr.customer_id,
      csr.bucket_start,
      csr.delta_mrr
    FROM customer_seed_rows csr
  ) AS combined
  GROUP BY combined.customer_id, combined.bucket_start
),
customer_bucket_snapshots AS (
  SELECT
    cbd.customer_id,
    cbd.bucket_start,
    COALESCE(ebr.start_mrr, 0.0)
      + SUM(cbd.delta_mrr) OVER (
        PARTITION BY cbd.customer_id
        ORDER BY cbd.bucket_start
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS mrr_end
  FROM customer_bucket_deltas cbd
  LEFT JOIN events_before_requested ebr
    ON ebr.customer_id = cbd.customer_id
)
SELECT
  cbt.customer_id,
  CASE
    WHEN @grain = 'quarterly'
    THEN CONCAT(CAST(EXTRACT(YEAR FROM rb.bucket_start) AS STRING), '-Q', CAST(EXTRACT(QUARTER FROM rb.bucket_start) AS STRING))
    ELSE FORMAT_DATE('%Y-%m-%d', rb.effective_start)
  END AS period_key,
  CASE
    WHEN @grain = 'daily' THEN FORMAT_DATE('%Y-%m-%d', rb.effective_start)
    WHEN @grain = 'weekly' THEN CONCAT('Week of ', FORMAT_DATE('%Y-%m-%d', rb.effective_start))
    WHEN @grain = 'monthly' THEN FORMAT_DATE('%b %Y', rb.bucket_start)
    ELSE CONCAT('Q', CAST(EXTRACT(QUARTER FROM rb.bucket_start) AS STRING), ' ', CAST(EXTRACT(YEAR FROM rb.bucket_start) AS STRING))
  END AS period_label,
  FORMAT_DATE('%Y-%m-%d', rb.effective_start) AS period_start,
  FORMAT_DATE('%Y-%m-%d', DATE_SUB(rb.effective_end_exclusive, INTERVAL 1 DAY)) AS period_end,
  ROUND(cbt.mrr_end * 12.0, 2) AS arr
FROM customer_bucket_snapshots cbt
JOIN requested_buckets rb
  ON rb.bucket_start = cbt.bucket_start
ORDER BY cbt.customer_id ASC, cbt.bucket_start ASC
`;

  const currentMonthProjectionDailyQuery = `
WITH bounds AS (
  SELECT
    DATE(@projection_start_date) AS projection_start_date,
    DATE(@projection_end_date) AS projection_end_date,
    DATE_ADD(DATE(@projection_end_date), INTERVAL 1 DAY) AS projection_end_exclusive_date
),
events_base AS (
  SELECT
    local_event_timestamp,
    COALESCE(NULLIF(TRIM(CAST(customer_id AS STRING)), ''), '(blank)') AS customer_id,
    CAST(COALESCE(mrr_change, 0) AS FLOAT64) / 100.0 AS mrr_change_major
  FROM \`${table}\` AS t
  CROSS JOIN bounds b
  WHERE
    LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
    AND local_event_timestamp < TIMESTAMP(b.projection_end_exclusive_date)
),
grouped_sub_item_events AS (
  SELECT
    local_event_timestamp,
    customer_id,
    COALESCE(SUM(mrr_change_major), 0.0) AS mrr_change_major
  FROM events_base
  GROUP BY
    local_event_timestamp,
    customer_id
),
daily_customer_events AS (
  SELECT
    DATE(local_event_timestamp) AS local_event_date,
    COALESCE(SUM(mrr_change_major), 0.0) AS net_mrr_change
  FROM grouped_sub_item_events
  GROUP BY local_event_date
),
series_dates AS (
  SELECT
    d AS local_date
  FROM bounds b
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(b.projection_start_date, b.projection_end_date, INTERVAL 1 DAY)) AS d
),
base_before_series_total AS (
  SELECT
    COALESCE(SUM(e.mrr_change_major), 0.0) AS base_mrr
  FROM grouped_sub_item_events e
  CROSS JOIN bounds b
  WHERE e.local_event_timestamp < TIMESTAMP(b.projection_start_date)
),
daily_series AS (
  SELECT
    sd.local_date,
    base.base_mrr
      + SUM(COALESCE(dce.net_mrr_change, 0.0)) OVER (
        ORDER BY sd.local_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS mrr_end
  FROM series_dates sd
  LEFT JOIN daily_customer_events dce
    ON dce.local_event_date = sd.local_date
  CROSS JOIN base_before_series_total base
)
SELECT
  FORMAT_DATE('%Y-%m-%d', local_date) AS period_start,
  ROUND(mrr_end, 2) AS mrr_end
FROM daily_series
ORDER BY local_date ASC
`;

  const params: BigQueryNamedParameter[] = [
    { name: "start_date", type: "STRING", value: startDateIso },
    { name: "end_date", type: "STRING", value: endDateIso },
    { name: "grain", type: "STRING", value: grain },
    { name: "target_currency", type: "STRING", value: targetCurrency },
  ];
  const projectionParams: BigQueryNamedParameter[] = [
    { name: "projection_start_date", type: "STRING", value: projectionLookbackStartIso },
    { name: "projection_end_date", type: "STRING", value: projectionCurrentMonthEndIso },
    { name: "target_currency", type: "STRING", value: targetCurrency },
  ];
  const groupedParams: BigQueryNamedParameter[] = [
    ...params,
    { name: "group_limit", type: "INT64", value: "8" },
  ];

  const [stripeExactPointRows, customerArrRawRows, groupedSeriesRawRows, projectionDailyRows] = await Promise.all([
    runBigQueryQueryRows(accessToken, projectId, location, stripeExactPointsQuery, params),
    includeCustomerArrRows
      ? runBigQueryQueryRows(accessToken, projectId, location, customerArrQuery, params)
      : Promise.resolve([] as Record<string, unknown>[]),
    groupedSeriesQuery
      ? runBigQueryQueryRows(accessToken, projectId, location, groupedSeriesQuery, groupedParams)
      : Promise.resolve([] as Record<string, unknown>[]),
    includeCurrentMonthProjection
      ? runBigQueryQueryRows(accessToken, projectId, location, currentMonthProjectionDailyQuery, projectionParams)
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);
  const pointRows =
    stripeExactPointRows.length > 0
      ? stripeExactPointRows
      : await runBigQueryQueryRows(accessToken, projectId, location, pointsQuery, params);

  const allPoints: StripeBillingOverviewPoint[] = pointRows.map((row) => ({
    key: asString(row.period_key),
    label: asString(row.period_label),
    periodStart: asString(row.period_start),
    periodEnd: asString(row.period_end),
    mrrEnd: asNumber(row.mrr_end),
    newMrr: asNumber(row.new_mrr),
    reactivationMrr: asNumber(row.reactivation_mrr),
    expansionMrr: asNumber(row.expansion_mrr),
    contractionMrr: asNumber(row.contraction_mrr),
    churnMrr: asNumber(row.churn_mrr),
    netMrrChange: asNumber(row.net_mrr_change),
    mrrGrowthRatePct: asNumber(row.mrr_growth_rate_pct),
    arr: asNumber(row.arr),
    arrGrowth: asNumber(row.arr_growth),
  }));
  const allStripeExactPoints: StripeBillingOverviewPoint[] = stripeExactPointRows.map((row) => ({
    key: asString(row.period_key),
    label: asString(row.period_label),
    periodStart: asString(row.period_start),
    periodEnd: asString(row.period_end),
    mrrEnd: asNumber(row.mrr_end),
    newMrr: asNumber(row.new_mrr),
    reactivationMrr: asNumber(row.reactivation_mrr),
    expansionMrr: asNumber(row.expansion_mrr),
    contractionMrr: asNumber(row.contraction_mrr),
    churnMrr: asNumber(row.churn_mrr),
    netMrrChange: asNumber(row.net_mrr_change),
    mrrGrowthRatePct: asNumber(row.mrr_growth_rate_pct),
    arr: asNumber(row.arr),
    arrGrowth: asNumber(row.arr_growth),
  }));
  const groupedSeriesByKey = new Map<
    string,
    {
      groupKey: string;
      groupLabel: string;
      allPoints: StripeBillingOverviewPoint[];
    }
  >();
  for (const row of groupedSeriesRawRows) {
    const groupKey = asString(row.group_key) || "(blank)";
    const groupLabel = asString(row.group_label) || groupKey;
    const point: StripeBillingOverviewPoint = {
      key: asString(row.period_key),
      label: asString(row.period_label),
      periodStart: asString(row.period_start),
      periodEnd: asString(row.period_end),
      mrrEnd: asNumber(row.mrr_end),
      newMrr: asNumber(row.new_mrr),
      reactivationMrr: asNumber(row.reactivation_mrr),
      expansionMrr: asNumber(row.expansion_mrr),
      contractionMrr: asNumber(row.contraction_mrr),
      churnMrr: asNumber(row.churn_mrr),
      netMrrChange: asNumber(row.net_mrr_change),
      mrrGrowthRatePct: asNumber(row.mrr_growth_rate_pct),
      arr: asNumber(row.arr),
      arrGrowth: asNumber(row.arr_growth),
    };
    if (!groupedSeriesByKey.has(groupKey)) {
      groupedSeriesByKey.set(groupKey, {
        groupKey,
        groupLabel,
        allPoints: [point],
      });
      continue;
    }
    groupedSeriesByKey.get(groupKey)!.allPoints.push(point);
  }
  const customerArrRows: StripeBillingOverviewCustomerArrRow[] = customerArrRawRows.map((row) => ({
    customerId: asString(row.customer_id),
    periodKey: asString(row.period_key),
    periodLabel: asString(row.period_label),
    periodStart: asString(row.period_start),
    periodEnd: asString(row.period_end),
    arr: asNumber(row.arr),
  }));
  const projectionDailyPoints: StripeDailyMrrPoint[] = projectionDailyRows.map((row) => ({
    date: asString(row.period_start),
    mrrEnd: asNumber(row.mrr_end),
  }));
  const currentMonthProjection = includeCurrentMonthProjection
    ? buildStripeCurrentMonthProjection({
        dailyPoints: projectionDailyPoints,
        requestedEndDateIso: endDateIso,
        todayUtc,
      })
    : null;

  const periodBounds = (point: StripeBillingOverviewPoint) => {
    const start = String(point.periodStart || "").slice(0, 10);
    const end = String(point.periodEnd || point.periodStart || "").slice(0, 10);
    return { start, end };
  };
  const pointIsBeforeRequestedRange = (point: StripeBillingOverviewPoint) => {
    const { end } = periodBounds(point);
    return !!end && end < startDateIso;
  };
  const pointIntersectsRequestedRange = (point: StripeBillingOverviewPoint) => {
    const { start, end } = periodBounds(point);
    if (!start || !end) return false;
    return start <= endDateIso && end >= startDateIso;
  };

  const historyPoints = allPoints.filter(pointIsBeforeRequestedRange);
  const points = allPoints.filter(pointIntersectsRequestedRange);
  const stripeExactHistoryPoints = allStripeExactPoints.filter(pointIsBeforeRequestedRange);
  const stripeExactPoints = allStripeExactPoints.filter(pointIntersectsRequestedRange);
  const groupedSeries: StripeBillingOverviewGroupedSeries[] = Array.from(groupedSeriesByKey.values())
    .map((series) => ({
      groupKey: series.groupKey,
      groupLabel: series.groupLabel,
      historyPoints: series.allPoints.filter(pointIsBeforeRequestedRange),
      points: series.allPoints.filter(pointIntersectsRequestedRange),
    }))
    .filter((series) => series.points.length > 0)
    .sort((a, b) => {
      const aLatestArr = a.points.length ? a.points[a.points.length - 1].arr : 0;
      const bLatestArr = b.points.length ? b.points[b.points.length - 1].arr : 0;
      if (Math.abs(bLatestArr - aLatestArr) > 1e-9) return bLatestArr - aLatestArr;
      return a.groupLabel.localeCompare(b.groupLabel);
    });
  const currentMrr = points.length ? points[points.length - 1].mrrEnd : 0;
  return {
    startDate: startDateIso,
    endDate: endDateIso,
    grain,
    groupBy,
    targetCurrency: targetCurrency.toUpperCase(),
    currentMrr,
    currentArr: Math.round(currentMrr * 12 * 100) / 100,
    historyPoints,
    points,
    stripeExactHistoryPoints,
    stripeExactPoints,
    groupedSeries,
    customerArrRows,
    currentMonthProjection,
  };
}

export async function queryStripeAiSpendFromBigQuery(
  request: StripeAiSpendRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeAiSpendResult> {
  const startDate = parseIsoDateUtc(request.startDate);
  const endDate = parseIsoDateUtc(request.endDate);
  if (!startDate || !endDate) {
    throw new Error("Invalid startDate/endDate");
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("endDate must be >= startDate");
  }

  const startDateIso = startDate.toISOString().slice(0, 10);
  const endDateIso = endDate.toISOString().slice(0, 10);
  const grain = normalizeStripeAiSpendGrain(request.grain);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const topLimit = Math.max(1, Math.min(5000, asInt(request.topLimit || 50)));
  const detailLimit = Math.max(1, Math.min(1000, asInt(request.detailLimit || 200)));
  const excludedCustomerIds = Array.from(
    new Set(
      (request.excludeCustomerIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  const excludedCustomerMonthPairs = Array.from(
    new Set(
      (request.excludeCustomerMonthPairs || [])
        .map((value) => String(value || "").trim())
        .filter((value) => /^\S+\|\d{4}-\d{2}$/.test(value)),
    ),
  );
  const prepaidOffsetByCustomerMonthPairs = Array.from(
    (request.prepaidOffsetByCustomerMonthPairs || [])
      .map((entry) => {
        const pairKey = String(entry?.pairKey || "").trim();
        const prepaidAppliedMajor = Number(entry?.prepaidAppliedMajor || 0);
        if (!/^\S+\|\d{4}-\d{2}$/.test(pairKey)) return null;
        if (!Number.isFinite(prepaidAppliedMajor) || prepaidAppliedMajor <= 0) return null;
        return { pairKey, prepaidAppliedMajor };
      })
      .filter((entry): entry is { pairKey: string; prepaidAppliedMajor: number } => !!entry),
  );

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);

  const excludedCustomersCteSql = excludedCustomerIds.length
    ? `excluded_customers AS (
  SELECT customer_id
  FROM UNNEST([${excludedCustomerIds.map((_, idx) => `@excluded_customer_${idx}`).join(", ")}]) AS customer_id
),`
    : `excluded_customers AS (
  SELECT customer_id
  FROM UNNEST(CAST([] AS ARRAY<STRING>)) AS customer_id
),`;

  const exclusionWhereSql = excludedCustomerIds.length
    ? `    AND COALESCE(NULLIF(TRIM(CAST(i.customer_id AS STRING)), ''), '(blank)') NOT IN (
      SELECT customer_id FROM excluded_customers
    )`
    : "";
  const excludedCustomerMonthPairsCteSql = excludedCustomerMonthPairs.length
    ? `excluded_customer_month_pairs AS (
  SELECT pair_key
  FROM UNNEST([${excludedCustomerMonthPairs.map((_, idx) => `@excluded_customer_month_pair_${idx}`).join(", ")}]) AS pair_key
),`
    : `excluded_customer_month_pairs AS (
  SELECT pair_key
  FROM UNNEST(CAST([] AS ARRAY<STRING>)) AS pair_key
),`;
  const exclusionByMonthWhereSql = excludedCustomerMonthPairs.length
    ? `    AND CONCAT(
      COALESCE(NULLIF(TRIM(CAST(i.customer_id AS STRING)), ''), '(blank)'),
      '|',
      FORMAT_DATE('%Y-%m', DATE(il.period_start))
    ) NOT IN (
      SELECT pair_key FROM excluded_customer_month_pairs
    )`
    : "";
  const prepaidOffsetsCteSql = prepaidOffsetByCustomerMonthPairs.length
    ? `prepaid_offsets AS (
  SELECT
    pair_key,
    CAST(prepaid_applied_major AS FLOAT64) AS prepaid_applied_major
  FROM UNNEST([${prepaidOffsetByCustomerMonthPairs
    .map(
      (_, idx) =>
        `STRUCT(@prepaid_pair_key_${idx} AS pair_key, CAST(@prepaid_pair_amount_${idx} AS FLOAT64) AS prepaid_applied_major)`,
    )
    .join(", ")}])
),`
    : `prepaid_offsets AS (
  SELECT pair_key, prepaid_applied_major
  FROM UNNEST(CAST([] AS ARRAY<STRUCT<pair_key STRING, prepaid_applied_major FLOAT64>>))
),`;

  const baseCte = `
WITH latest_invoice_lines AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      il.*,
      ROW_NUMBER() OVER (
        PARTITION BY il.id
        ORDER BY il.batch_timestamp DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.stripe.invoice_lines\` il
  )
  WHERE rn = 1
),
latest_prices AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      p.*,
      ROW_NUMBER() OVER (
        PARTITION BY p.id
        ORDER BY p.batch_timestamp DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.stripe.prices\` p
  )
  WHERE rn = 1
),
latest_invoices AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      i.*,
      ROW_NUMBER() OVER (
        PARTITION BY i.id
        ORDER BY i.batch_timestamp DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.stripe.invoices\` i
  )
  WHERE rn = 1
),
line_discounts AS (
  SELECT
    invoice_line_item_id,
    SUM(COALESCE(amount, 0)) AS discount_amount
  FROM \`botpress-stripe-data-pipeline.stripe.invoice_line_item_discount_amounts\`
  GROUP BY invoice_line_item_id
),
${excludedCustomersCteSql}
${excludedCustomerMonthPairsCteSql}
${prepaidOffsetsCteSql}
metered_lines_raw AS (
  SELECT
    DATE(il.period_start) AS event_date,
    COALESCE(NULLIF(TRIM(CAST(i.customer_id AS STRING)), ''), '(blank)') AS customer_id,
    COALESCE(
      NULLIF(TRIM(CAST(i.customer_name AS STRING)), ''),
      COALESCE(NULLIF(TRIM(CAST(i.customer_id AS STRING)), ''), '(blank)')
    ) AS customer_name,
    COALESCE(NULLIF(TRIM(CAST(il.id AS STRING)), ''), '(blank)') AS line_item_id,
    COALESCE(NULLIF(TRIM(CAST(il.description AS STRING)), ''), '(blank)') AS line_item_description,
    COALESCE(NULLIF(TRIM(CAST(il.price_id AS STRING)), ''), '(blank)') AS price_id,
    COALESCE(
      NULLIF(TRIM(CAST(p.nickname AS STRING)), ''),
      COALESCE(NULLIF(TRIM(CAST(il.price_id AS STRING)), ''), '(blank)')
    ) AS price_label,
    COALESCE(NULLIF(TRIM(CAST(p.product_id AS STRING)), ''), '(blank)') AS product_id,
    COALESCE(NULLIF(TRIM(CAST(p.product_id AS STRING)), ''), '(blank)') AS product_label,
    CAST(COALESCE(il.amount, 0) - COALESCE(ld.discount_amount, 0) AS FLOAT64) / 100.0 AS revenue_major,
    CAST(COALESCE(il.quantity, 0) AS FLOAT64) AS quantity
  FROM latest_invoice_lines il
  JOIN latest_prices p
    ON p.id = il.price_id
  LEFT JOIN line_discounts ld
    ON ld.invoice_line_item_id = il.id
  LEFT JOIN latest_invoices i
    ON i.id = il.invoice_id
  WHERE
    LOWER(COALESCE(p.recurring_usage_type, '')) = 'metered'
    AND LOWER(COALESCE(il.currency, '')) = @target_currency
    AND DATE(il.period_start) BETWEEN DATE(@start_date) AND DATE(@end_date)
${exclusionWhereSql}
${exclusionByMonthWhereSql}
),
metered_lines_with_offsets AS (
  SELECT
    ml.*,
    CASE
      WHEN
        NULLIF(TRIM(COALESCE(ml.customer_name, '')), '') IS NOT NULL
        AND TRIM(COALESCE(ml.customer_name, '')) != '(blank)'
        AND TRIM(COALESCE(ml.customer_name, '')) != TRIM(COALESCE(ml.customer_id, ''))
      THEN 'salesled'
      ELSE 'selfserve'
    END AS customer_segment,
    COALESCE(po.prepaid_applied_major, 0.0) AS prepaid_applied_major,
    SUM(ml.revenue_major) OVER (
      PARTITION BY ml.customer_id, FORMAT_DATE('%Y-%m', ml.event_date)
      ORDER BY ml.event_date, ml.line_item_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_revenue_major,
    COALESCE(
      SUM(ml.revenue_major) OVER (
        PARTITION BY ml.customer_id, FORMAT_DATE('%Y-%m', ml.event_date)
        ORDER BY ml.event_date, ml.line_item_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0.0
    ) AS prev_running_revenue_major
  FROM metered_lines_raw ml
  LEFT JOIN prepaid_offsets po
    ON po.pair_key = CONCAT(ml.customer_id, '|', FORMAT_DATE('%Y-%m', ml.event_date))
),
metered_lines AS (
  SELECT
    event_date,
    customer_id,
    customer_name,
    line_item_id,
    line_item_description,
    price_id,
    price_label,
    product_id,
    product_label,
    customer_segment,
    GREATEST(
      revenue_major - GREATEST(LEAST(running_revenue_major, prepaid_applied_major) - prev_running_revenue_major, 0.0),
      0.0
    ) AS revenue_major,
    quantity
  FROM metered_lines_with_offsets
  WHERE GREATEST(
    revenue_major - GREATEST(LEAST(running_revenue_major, prepaid_applied_major) - prev_running_revenue_major, 0.0),
    0.0
  ) > 0
)
`;

  const summaryQuery = `
${baseCte}
SELECT
  CASE
    WHEN @grain = 'daily' THEN FORMAT_DATE('%Y-%m-%d', bucket_start)
    WHEN @grain = 'weekly' THEN FORMAT_DATE('%Y-%m-%d', bucket_start)
    WHEN @grain = 'monthly' THEN FORMAT_DATE('%Y-%m', bucket_start)
    ELSE CONCAT(CAST(EXTRACT(YEAR FROM bucket_start) AS STRING), '-Q', CAST(EXTRACT(QUARTER FROM bucket_start) AS STRING))
  END AS period_key,
  CASE
    WHEN @grain = 'daily' THEN FORMAT_DATE('%Y-%m-%d', bucket_start)
    WHEN @grain = 'weekly' THEN CONCAT('Week of ', FORMAT_DATE('%Y-%m-%d', bucket_start))
    WHEN @grain = 'monthly' THEN FORMAT_DATE('%b %Y', bucket_start)
    ELSE CONCAT('Q', CAST(EXTRACT(QUARTER FROM bucket_start) AS STRING), ' ', CAST(EXTRACT(YEAR FROM bucket_start) AS STRING))
  END AS period_label,
  FORMAT_DATE('%Y-%m-%d', bucket_start) AS period_start,
  FORMAT_DATE(
    '%Y-%m-%d',
    CASE
      WHEN @grain = 'daily' THEN bucket_start
      WHEN @grain = 'weekly' THEN DATE_SUB(DATE_ADD(bucket_start, INTERVAL 1 WEEK), INTERVAL 1 DAY)
      WHEN @grain = 'monthly' THEN DATE_SUB(DATE_ADD(bucket_start, INTERVAL 1 MONTH), INTERVAL 1 DAY)
      ELSE DATE_SUB(DATE_ADD(bucket_start, INTERVAL 3 MONTH), INTERVAL 1 DAY)
    END
  ) AS period_end,
  ROUND(SUM(revenue_major), 2) AS revenue,
  COUNT(*) AS line_count,
  COUNT(DISTINCT customer_id) AS customer_count
FROM (
  SELECT
    CASE
      WHEN @grain = 'daily' THEN event_date
      WHEN @grain = 'weekly' THEN DATE_TRUNC(event_date, WEEK(MONDAY))
      WHEN @grain = 'monthly' THEN DATE_TRUNC(event_date, MONTH)
      ELSE DATE_TRUNC(event_date, QUARTER)
    END AS bucket_start,
    revenue_major,
    customer_id
  FROM metered_lines
)
GROUP BY bucket_start
ORDER BY bucket_start ASC
`;

const topCustomersQuery = `
${baseCte}
SELECT
  customer_id AS group_key,
  customer_name AS group_label,
  ROUND(SUM(revenue_major), 2) AS revenue,
  COUNT(*) AS line_count
FROM metered_lines
GROUP BY group_key, group_label
ORDER BY revenue DESC, group_label ASC
`;

  const topProductsQuery = `
${baseCte}
SELECT
  product_id AS group_key,
  product_label AS group_label,
  ROUND(SUM(revenue_major), 2) AS revenue,
  COUNT(*) AS line_count
FROM metered_lines
GROUP BY group_key, group_label
ORDER BY revenue DESC, group_label ASC
LIMIT @top_limit
`;

  const topPricesQuery = `
${baseCte}
SELECT
  price_id,
  price_label,
  product_id,
  product_label,
  ROUND(SUM(revenue_major), 2) AS revenue,
  COUNT(*) AS line_count
FROM metered_lines
GROUP BY price_id, price_label, product_id, product_label
ORDER BY revenue DESC, price_label ASC
LIMIT @top_limit
`;

  const detailQuery = `
${baseCte}
SELECT
  FORMAT_DATE('%Y-%m-%d', event_date) AS invoice_date,
  customer_id,
  customer_name,
  line_item_id,
  line_item_description,
  price_id,
  price_label,
  product_id,
  product_label,
  ROUND(revenue_major, 2) AS revenue,
  quantity
FROM metered_lines
ORDER BY revenue DESC, invoice_date DESC, line_item_id DESC
LIMIT @detail_limit
`;
  const segmentSummaryQuery = `
${baseCte}
SELECT
  ROUND(SUM(CASE WHEN customer_segment = 'salesled' THEN revenue_major ELSE 0 END), 2) AS metered_revenue_salesled,
  ROUND(SUM(CASE WHEN customer_segment = 'selfserve' THEN revenue_major ELSE 0 END), 2) AS metered_revenue_selfserve
FROM metered_lines
`;

  const baseParams: BigQueryNamedParameter[] = [
    { name: "start_date", type: "STRING", value: startDateIso },
    { name: "end_date", type: "STRING", value: endDateIso },
    { name: "target_currency", type: "STRING", value: targetCurrency },
    { name: "grain", type: "STRING", value: grain },
    ...excludedCustomerIds.map(
      (customerId, idx): BigQueryNamedParameter => ({
        name: `excluded_customer_${idx}`,
        type: "STRING",
        value: customerId,
      }),
    ),
    ...excludedCustomerMonthPairs.map(
      (pair, idx): BigQueryNamedParameter => ({
        name: `excluded_customer_month_pair_${idx}`,
        type: "STRING",
        value: pair,
      }),
    ),
    ...prepaidOffsetByCustomerMonthPairs.flatMap(
      (entry, idx): BigQueryNamedParameter[] => [
        {
          name: `prepaid_pair_key_${idx}`,
          type: "STRING",
          value: entry.pairKey,
        },
        {
          name: `prepaid_pair_amount_${idx}`,
          type: "STRING",
          value: String(entry.prepaidAppliedMajor),
        },
      ],
    ),
  ];

  const [summaryRows, topCustomersRows, topProductsRows, topPricesRows, detailRowsRaw, segmentSummaryRows] = await Promise.all([
    runBigQueryQueryRows(accessToken, projectId, location, summaryQuery, baseParams),
    runBigQueryQueryRows(accessToken, projectId, location, topCustomersQuery, baseParams),
    runBigQueryQueryRows(accessToken, projectId, location, topProductsQuery, [
      ...baseParams,
      { name: "top_limit", type: "INT64", value: String(topLimit) },
    ]),
    runBigQueryQueryRows(accessToken, projectId, location, topPricesQuery, [
      ...baseParams,
      { name: "top_limit", type: "INT64", value: String(topLimit) },
    ]),
    runBigQueryQueryRows(accessToken, projectId, location, detailQuery, [
      ...baseParams,
      { name: "detail_limit", type: "INT64", value: String(detailLimit) },
    ]),
    runBigQueryQueryRows(accessToken, projectId, location, segmentSummaryQuery, baseParams),
  ]);

  const pointsBase: StripeAiSpendPoint[] = summaryRows.map((row) => ({
    key: asString(row.period_key),
    label: asString(row.period_label),
    periodStart: asString(row.period_start),
    periodEnd: asString(row.period_end),
    revenue: Math.max(0, asNumber(row.revenue)),
    lineCount: asInt(row.line_count),
    customerCount: asInt(row.customer_count),
  }));
  const points: StripeAiSpendPoint[] = applyFixedAiSpendAdjustmentsToPoints(pointsBase);

  const topCustomers: StripeAiSpendGroupRow[] = topCustomersRows.map((row) => ({
    key: asString(row.group_key) || "(blank)",
    label: asString(row.group_label) || "(blank)",
    revenue: Math.max(0, asNumber(row.revenue)),
    lineCount: asInt(row.line_count),
  }));

  const topProducts: StripeAiSpendGroupRow[] = topProductsRows.map((row) => ({
    key: asString(row.group_key) || "(blank)",
    label: asString(row.group_label) || "(blank)",
    revenue: Math.max(0, asNumber(row.revenue)),
    lineCount: asInt(row.line_count),
  }));

  const topPrices: StripeAiSpendPriceRow[] = topPricesRows.map((row) => ({
    priceId: asString(row.price_id) || "(blank)",
    priceLabel: asString(row.price_label) || "(blank)",
    productId: asString(row.product_id) || "(blank)",
    productLabel: asString(row.product_label) || "(blank)",
    revenue: Math.max(0, asNumber(row.revenue)),
    lineCount: asInt(row.line_count),
  }));

  const detailRows: StripeAiSpendDetailRow[] = detailRowsRaw.map((row) => ({
    invoiceDate: asString(row.invoice_date),
    customerId: asString(row.customer_id),
    customerName: asString(row.customer_name),
    lineItemId: asString(row.line_item_id),
    lineItemDescription: asString(row.line_item_description),
    priceId: asString(row.price_id),
    priceLabel: asString(row.price_label),
    productId: asString(row.product_id),
    productLabel: asString(row.product_label),
    revenue: Math.max(0, asNumber(row.revenue)),
    quantity: asNumber(row.quantity),
  }));
  const segmentSummaryRow = segmentSummaryRows[0] || {};
  const meteredRevenueSalesled = round2(Math.max(0, asNumber(segmentSummaryRow.metered_revenue_salesled)));
  const meteredRevenueSelfserveBase = round2(Math.max(0, asNumber(segmentSummaryRow.metered_revenue_selfserve)));

  const totalRevenue = Math.max(0, points.reduce((sum, point) => sum + point.revenue, 0));
  const baseTotalRevenue = Math.max(0, pointsBase.reduce((sum, point) => sum + point.revenue, 0));
  const fixedAdjustmentDelta = round2(totalRevenue - baseTotalRevenue);
  const meteredRevenueSelfserve = round2(Math.max(0, meteredRevenueSelfserveBase + fixedAdjustmentDelta));

  return {
    startDate: startDateIso,
    endDate: endDateIso,
    grain,
    targetCurrency: targetCurrency.toUpperCase(),
    totalRevenue: round2(totalRevenue),
    meteredRevenueSalesled,
    meteredRevenueSelfserve,
    points,
    topCustomers,
    topProducts,
    topPrices,
    detailRows,
  };
}

export async function queryStripeCustomerBalancesByEmailsFromBigQuery(
  request: StripeCustomerBalanceByEmailRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeCustomerBalanceByEmailRow[]> {
  const emails = Array.from(
    new Set(
      (request.emails || [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => value.includes("@")),
    ),
  );
  if (!emails.length) return [];
  const asOfDate = String(request.asOfDate || "").trim();
  if (asOfDate && !parseIsoDateUtc(asOfDate)) {
    throw new Error("Invalid asOfDate");
  }

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const customersTable = getStripeCustomersTable();

  const query = `
WITH input_emails AS (
  SELECT LOWER(TRIM(email)) AS email
  FROM UNNEST([${emails.map((_, idx) => `@email_${idx}`).join(", ")}]) AS email
),
latest_customers AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        PARTITION BY c.id
        ORDER BY c.batch_timestamp DESC
      ) AS rn
    FROM \`${customersTable}\` c
    WHERE LOWER(TRIM(COALESCE(CAST(c.email AS STRING), ''))) IN (SELECT email FROM input_emails)
      AND (@as_of_date = '' OR c.batch_timestamp < TIMESTAMP(DATE_ADD(DATE(@as_of_date), INTERVAL 1 DAY)))
  )
  WHERE rn = 1
)
SELECT
  COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS customer_id,
  LOWER(TRIM(COALESCE(CAST(email AS STRING), ''))) AS email,
  COALESCE(NULLIF(TRIM(CAST(name AS STRING)), ''), '(blank)') AS name,
  LOWER(TRIM(COALESCE(CAST(currency AS STRING), ''))) AS currency,
  CAST(COALESCE(balance, 0) AS FLOAT64) AS balance_minor,
  CAST(COALESCE(account_balance, 0) AS FLOAT64) AS account_balance_minor,
  COALESCE(CAST(invoice_credit_balance AS STRING), '') AS invoice_credit_balance,
  CAST(batch_timestamp AS STRING) AS batch_timestamp
FROM latest_customers
WHERE LOWER(TRIM(COALESCE(CAST(email AS STRING), ''))) IN (SELECT email FROM input_emails)
`;

  const params: BigQueryNamedParameter[] = emails.map((email, idx) => ({
    name: `email_${idx}`,
    type: "STRING",
    value: email,
  }));
  params.push({
    name: "as_of_date",
    type: "STRING",
    value: asOfDate,
  });
  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);

  return rows.map((row) => ({
    customerId: asString(row.customer_id),
    email: asString(row.email),
    name: asString(row.name),
    currency: asString(row.currency),
    balanceMinor: asNumber(row.balance_minor),
    accountBalanceMinor: asNumber(row.account_balance_minor),
    invoiceCreditBalance: asString(row.invoice_credit_balance),
    batchTimestamp: asString(row.batch_timestamp),
  }));
}

export async function queryStripeCustomerInvoicePrepaidUsageByEmailsFromBigQuery(
  request: StripeCustomerInvoicePrepaidUsageByEmailRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeCustomerInvoicePrepaidUsageByEmailRow[]> {
  const emails = Array.from(
    new Set(
      (request.emails || [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => value.includes("@")),
    ),
  );
  if (!emails.length) return [];

  const monthStartDate = String(request.monthStartDate || "").trim();
  const monthEndDate = String(request.monthEndDate || "").trim();
  const asOfDate = String(request.asOfDate || "").trim();
  if (!parseIsoDateUtc(monthStartDate) || !parseIsoDateUtc(monthEndDate)) {
    throw new Error("Invalid monthStartDate/monthEndDate");
  }
  if (asOfDate && !parseIsoDateUtc(asOfDate)) {
    throw new Error("Invalid asOfDate");
  }
  if (monthEndDate < monthStartDate) {
    throw new Error("monthEndDate must be >= monthStartDate");
  }

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const customersTable = getStripeCustomersTable();

  const query = `
WITH input_emails AS (
  SELECT LOWER(TRIM(email)) AS email
  FROM UNNEST([${emails.map((_, idx) => `@email_${idx}`).join(", ")}]) AS email
),
latest_customers AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        PARTITION BY c.id
        ORDER BY c.batch_timestamp DESC
      ) AS rn
    FROM \`${customersTable}\` c
    WHERE LOWER(TRIM(COALESCE(CAST(c.email AS STRING), ''))) IN (SELECT email FROM input_emails)
      AND (@as_of_date = '' OR c.batch_timestamp < TIMESTAMP(DATE_ADD(DATE(@as_of_date), INTERVAL 1 DAY)))
  )
  WHERE rn = 1
),
latest_invoices AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      i.*,
      ROW_NUMBER() OVER (
        PARTITION BY i.id
        ORDER BY i.batch_timestamp DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.stripe.invoices\` i
    WHERE DATE(i.date) >= DATE(@month_start_date)
      AND DATE(i.date) <= DATE(@month_end_date)
      AND (@as_of_date = '' OR DATE(i.date) <= DATE(@as_of_date))
      AND LOWER(TRIM(COALESCE(CAST(i.status AS STRING), ''))) != 'void'
  )
  WHERE rn = 1
)
SELECT
  COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') AS customer_id,
  LOWER(TRIM(COALESCE(CAST(c.email AS STRING), ''))) AS email,
  COALESCE(NULLIF(TRIM(CAST(c.name AS STRING)), ''), '(blank)') AS name,
  UPPER(TRIM(COALESCE(CAST(c.currency AS STRING), ''))) AS currency,
  COUNT(i.id) AS invoice_count,
  COUNTIF(LEAST(COALESCE(i.starting_balance, 0), COALESCE(i.ending_balance, 0)) < 0) AS credit_invoice_count,
  CAST(
    SUM(
      CASE
        WHEN LEAST(COALESCE(i.starting_balance, 0), COALESCE(i.ending_balance, 0)) < 0
          THEN GREATEST(COALESCE(i.ending_balance, 0) - COALESCE(i.starting_balance, 0), 0)
        ELSE 0
      END
    ) AS FLOAT64
  ) AS prepaid_applied_minor,
  CAST(
    MAX(
      GREATEST(
        -COALESCE(i.starting_balance, 0),
        -COALESCE(i.ending_balance, 0),
        0
      )
    ) AS FLOAT64
  ) AS max_available_credit_minor,
  CAST(MIN(DATE(i.date)) AS STRING) AS invoice_date_start,
  CAST(MAX(DATE(i.date)) AS STRING) AS invoice_date_end
FROM latest_customers c
LEFT JOIN latest_invoices i
  ON i.customer_id = c.id
WHERE LOWER(TRIM(COALESCE(CAST(c.email AS STRING), ''))) IN (SELECT email FROM input_emails)
GROUP BY customer_id, email, name, currency
HAVING
  SUM(
    CASE
      WHEN LEAST(COALESCE(i.starting_balance, 0), COALESCE(i.ending_balance, 0)) < 0
        THEN GREATEST(COALESCE(i.ending_balance, 0) - COALESCE(i.starting_balance, 0), 0)
      ELSE 0
    END
  ) > 0
ORDER BY prepaid_applied_minor DESC, customer_id ASC
`;

  const params: BigQueryNamedParameter[] = emails.map((email, idx) => ({
    name: `email_${idx}`,
    type: "STRING",
    value: email,
  }));
  params.push({ name: "month_start_date", type: "STRING", value: monthStartDate });
  params.push({ name: "month_end_date", type: "STRING", value: monthEndDate });
  params.push({ name: "as_of_date", type: "STRING", value: asOfDate });

  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);

  return rows.map((row) => ({
    customerId: asString(row.customer_id),
    email: asString(row.email),
    name: asString(row.name),
    currency: asString(row.currency),
    invoiceCount: asInt(row.invoice_count),
    creditInvoiceCount: asInt(row.credit_invoice_count),
    prepaidAppliedMinor: asNumber(row.prepaid_applied_minor),
    maxAvailableCreditMinor: asNumber(row.max_available_credit_minor),
    invoiceDateStart: asString(row.invoice_date_start),
    invoiceDateEnd: asString(row.invoice_date_end),
  }));
}

export async function queryStripeSalesLedCustomerInvoicePrepaidUsageFromBigQuery(
  request: StripeSalesLedCustomerInvoicePrepaidUsageRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeSalesLedCustomerInvoicePrepaidUsageRow[]> {
  const monthStartDate = String(request.monthStartDate || "").trim();
  const monthEndDate = String(request.monthEndDate || "").trim();
  const asOfDate = String(request.asOfDate || "").trim();
  if (!parseIsoDateUtc(monthStartDate) || !parseIsoDateUtc(monthEndDate)) {
    throw new Error("Invalid monthStartDate/monthEndDate");
  }
  if (asOfDate && !parseIsoDateUtc(asOfDate)) {
    throw new Error("Invalid asOfDate");
  }
  if (monthEndDate < monthStartDate) {
    throw new Error("monthEndDate must be >= monthStartDate");
  }
  const includedDealstage = String(process.env.INCLUDED_DEALSTAGE || "").trim();
  if (!includedDealstage) {
    throw new Error("Missing INCLUDED_DEALSTAGE");
  }

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const customersTable = getStripeCustomersTable();

  const query = `
WITH latest_contacts AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        PARTITION BY c.id
        ORDER BY c.updatedAt DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.hubspot.contacts\` c
    WHERE LOWER(TRIM(COALESCE(CAST(c.properties_email AS STRING), ''))) LIKE '%@%'
      AND COALESCE(c.archived, FALSE) = FALSE
  )
  WHERE rn = 1
),
latest_companies AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      co.*,
      ROW_NUMBER() OVER (
        PARTITION BY co.id
        ORDER BY co.updatedAt DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.hubspot.companies\` co
    WHERE COALESCE(co.archived, FALSE) = FALSE
  )
  WHERE rn = 1
),
latest_deals AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      d.*,
      ROW_NUMBER() OVER (
        PARTITION BY d.id
        ORDER BY d.updatedAt DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.hubspot.deals\` d
    WHERE COALESCE(d.archived, FALSE) = FALSE
      AND TRIM(COALESCE(CAST(d.properties_dealstage AS STRING), '')) = @included_dealstage
      AND LOWER(TRIM(COALESCE(CAST(d.properties_deployment_type__c AS STRING), ''))) = 'cloud'
      AND COALESCE(
        SAFE_CAST(
          REGEXP_REPLACE(TRIM(COALESCE(CAST(d.properties_current_carr AS STRING), '0')), r'[^0-9.-]', '') AS FLOAT64
        ),
        0
      ) > 0
  )
  WHERE rn = 1
),
included_salesled_companies AS (
  SELECT DISTINCT company_id
  FROM (
    SELECT
      REGEXP_EXTRACT(TRIM(COALESCE(CAST(d.properties_hs_primary_associated_company AS STRING), '')), r'\\d+') AS company_id
    FROM latest_deals d
    UNION ALL
    SELECT
      REGEXP_EXTRACT(company_id_raw, r'\\d+') AS company_id
    FROM latest_deals d
    CROSS JOIN UNNEST(
      CASE
        WHEN d.companies IS NULL THEN CAST([] AS ARRAY<STRING>)
        ELSE JSON_VALUE_ARRAY(d.companies, '$')
      END
    ) AS company_id_raw
  )
  WHERE company_id IS NOT NULL
    AND TRIM(company_id) != ''
),
contact_company_pairs AS (
  SELECT
    LOWER(TRIM(COALESCE(CAST(c.properties_email AS STRING), ''))) AS email,
    REGEXP_EXTRACT(company_id_raw, r'\\d+') AS company_id
  FROM latest_contacts c
  CROSS JOIN UNNEST(
    CASE
      WHEN c.companies IS NULL THEN CAST([] AS ARRAY<STRING>)
      ELSE JSON_VALUE_ARRAY(c.companies, '$')
    END
  ) AS company_id_raw
),
salesled_email_companies AS (
  SELECT
    cp.email,
    ARRAY_AGG(DISTINCT cp.company_id IGNORE NULLS) AS account_ids,
    ARRAY_AGG(
      DISTINCT COALESCE(
        NULLIF(TRIM(CAST(co.properties_name AS STRING)), ''),
        cp.company_id
      ) IGNORE NULLS
    ) AS account_names
  FROM contact_company_pairs cp
  JOIN included_salesled_companies isc
    ON isc.company_id = cp.company_id
  LEFT JOIN latest_companies co
    ON co.id = cp.company_id
  WHERE cp.email != ''
    AND cp.company_id IS NOT NULL
    AND TRIM(cp.company_id) != ''
  GROUP BY cp.email
),
latest_invoices AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      i.*,
      ROW_NUMBER() OVER (
        PARTITION BY i.id
        ORDER BY i.batch_timestamp DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.stripe.invoices\` i
    WHERE DATE(i.date) >= DATE(@month_start_date)
      AND DATE(i.date) <= DATE(@month_end_date)
      AND (@as_of_date = '' OR DATE(i.date) <= DATE(@as_of_date))
      AND LOWER(TRIM(COALESCE(CAST(i.status AS STRING), ''))) != 'void'
  )
  WHERE rn = 1
),
latest_customers AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        PARTITION BY c.id
        ORDER BY c.batch_timestamp DESC
      ) AS rn
    FROM \`${customersTable}\` c
    WHERE LOWER(TRIM(COALESCE(CAST(c.email AS STRING), ''))) IN (
      SELECT email FROM salesled_email_companies
    )
      AND (@as_of_date = '' OR c.batch_timestamp < TIMESTAMP(DATE_ADD(DATE(@as_of_date), INTERVAL 1 DAY)))
  )
  WHERE rn = 1
),
salesled_customers_from_profiles AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') AS customer_id,
    LOWER(TRIM(COALESCE(CAST(c.email AS STRING), ''))) AS email,
    COALESCE(NULLIF(TRIM(CAST(c.name AS STRING)), ''), '(blank)') AS name,
    UPPER(TRIM(COALESCE(CAST(c.currency AS STRING), ''))) AS currency,
    sec.account_ids,
    sec.account_names
  FROM latest_customers c
  JOIN salesled_email_companies sec
    ON sec.email = LOWER(TRIM(COALESCE(CAST(c.email AS STRING), '')))
),
salesled_customers_from_invoices AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(i.customer_id AS STRING)), ''), '(blank)') AS customer_id,
    LOWER(TRIM(COALESCE(CAST(i.customer_email AS STRING), ''))) AS email,
    COALESCE(NULLIF(TRIM(CAST(i.customer_name AS STRING)), ''), '(blank)') AS name,
    UPPER(TRIM(COALESCE(CAST(i.currency AS STRING), ''))) AS currency,
    sec.account_ids,
    sec.account_names
  FROM latest_invoices i
  JOIN salesled_email_companies sec
    ON sec.email = LOWER(TRIM(COALESCE(CAST(i.customer_email AS STRING), '')))
  WHERE COALESCE(NULLIF(TRIM(CAST(i.customer_id AS STRING)), ''), '') != ''
),
salesled_customer_candidates AS (
  SELECT customer_id, email, name, currency, account_ids, account_names
  FROM salesled_customers_from_profiles
  UNION ALL
  SELECT customer_id, email, name, currency, account_ids, account_names
  FROM salesled_customers_from_invoices
),
salesled_customers AS (
  SELECT
    c.customer_id,
    COALESCE(NULLIF(MAX(c.email), ''), '(blank)') AS email,
    COALESCE(MAX(IF(c.name != '(blank)', c.name, NULL)), '(blank)') AS name,
    COALESCE(MAX(NULLIF(c.currency, '')), 'USD') AS currency,
    ARRAY_AGG(DISTINCT account_id IGNORE NULLS) AS account_ids,
    ARRAY_AGG(DISTINCT account_name IGNORE NULLS) AS account_names
  FROM salesled_customer_candidates c
  LEFT JOIN UNNEST(c.account_ids) AS account_id
  LEFT JOIN UNNEST(c.account_names) AS account_name
  WHERE c.customer_id != '(blank)'
  GROUP BY c.customer_id
)
SELECT
  sc.customer_id,
  sc.email,
  sc.name,
  sc.currency,
  sc.account_ids,
  sc.account_names,
  COUNT(i.id) AS invoice_count,
  COUNTIF(LEAST(COALESCE(i.starting_balance, 0), COALESCE(i.ending_balance, 0)) < 0) AS credit_invoice_count,
  CAST(
    SUM(
      CASE
        WHEN LEAST(COALESCE(i.starting_balance, 0), COALESCE(i.ending_balance, 0)) < 0
          THEN GREATEST(COALESCE(i.ending_balance, 0) - COALESCE(i.starting_balance, 0), 0)
        ELSE 0
      END
    ) AS FLOAT64
  ) AS prepaid_applied_minor,
  CAST(
    MAX(
      GREATEST(
        -COALESCE(i.starting_balance, 0),
        -COALESCE(i.ending_balance, 0),
        0
      )
    ) AS FLOAT64
  ) AS max_available_credit_minor,
  CAST(MIN(DATE(i.date)) AS STRING) AS invoice_date_start,
  CAST(MAX(DATE(i.date)) AS STRING) AS invoice_date_end
FROM salesled_customers sc
LEFT JOIN latest_invoices i
  ON i.customer_id = sc.customer_id
GROUP BY sc.customer_id, sc.email, sc.name, sc.currency, sc.account_ids, sc.account_names
HAVING
  SUM(
    CASE
      WHEN LEAST(COALESCE(i.starting_balance, 0), COALESCE(i.ending_balance, 0)) < 0
        THEN GREATEST(COALESCE(i.ending_balance, 0) - COALESCE(i.starting_balance, 0), 0)
      ELSE 0
    END
  ) > 0
ORDER BY prepaid_applied_minor DESC, customer_id ASC
`;

  const params: BigQueryNamedParameter[] = [
    { name: "month_start_date", type: "STRING", value: monthStartDate },
    { name: "month_end_date", type: "STRING", value: monthEndDate },
    { name: "as_of_date", type: "STRING", value: asOfDate },
    { name: "included_dealstage", type: "STRING", value: includedDealstage },
  ];
  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);

  return rows.map((row) => ({
    customerId: asString(row.customer_id),
    email: asString(row.email),
    name: asString(row.name),
    currency: asString(row.currency),
    accountIds: asStringArray(row.account_ids),
    accountNames: asStringArray(row.account_names),
    invoiceCount: asInt(row.invoice_count),
    creditInvoiceCount: asInt(row.credit_invoice_count),
    prepaidAppliedMinor: asNumber(row.prepaid_applied_minor),
    maxAvailableCreditMinor: asNumber(row.max_available_credit_minor),
    invoiceDateStart: asString(row.invoice_date_start),
    invoiceDateEnd: asString(row.invoice_date_end),
  }));
}

export async function queryStripeSalesLedCustomerLatestInvoiceCreditFromBigQuery(
  request: StripeSalesLedCustomerLatestInvoiceCreditRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeSalesLedCustomerLatestInvoiceCreditRow[]> {
  const asOfDate = String(request.asOfDate || "").trim();
  if (asOfDate && !parseIsoDateUtc(asOfDate)) {
    throw new Error("Invalid asOfDate");
  }
  const includedDealstage = String(process.env.INCLUDED_DEALSTAGE || "").trim();
  if (!includedDealstage) {
    throw new Error("Missing INCLUDED_DEALSTAGE");
  }

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const customersTable = getStripeCustomersTable();

  const query = `
WITH latest_contacts AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        PARTITION BY c.id
        ORDER BY c.updatedAt DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.hubspot.contacts\` c
    WHERE LOWER(TRIM(COALESCE(CAST(c.properties_email AS STRING), ''))) LIKE '%@%'
      AND COALESCE(c.archived, FALSE) = FALSE
  )
  WHERE rn = 1
),
latest_companies AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      co.*,
      ROW_NUMBER() OVER (
        PARTITION BY co.id
        ORDER BY co.updatedAt DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.hubspot.companies\` co
    WHERE COALESCE(co.archived, FALSE) = FALSE
  )
  WHERE rn = 1
),
latest_deals AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      d.*,
      ROW_NUMBER() OVER (
        PARTITION BY d.id
        ORDER BY d.updatedAt DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.hubspot.deals\` d
    WHERE COALESCE(d.archived, FALSE) = FALSE
      AND TRIM(COALESCE(CAST(d.properties_dealstage AS STRING), '')) = @included_dealstage
      AND LOWER(TRIM(COALESCE(CAST(d.properties_deployment_type__c AS STRING), ''))) = 'cloud'
      AND COALESCE(
        SAFE_CAST(
          REGEXP_REPLACE(TRIM(COALESCE(CAST(d.properties_current_carr AS STRING), '0')), r'[^0-9.-]', '') AS FLOAT64
        ),
        0
      ) > 0
  )
  WHERE rn = 1
),
included_salesled_companies AS (
  SELECT DISTINCT company_id
  FROM (
    SELECT
      REGEXP_EXTRACT(TRIM(COALESCE(CAST(d.properties_hs_primary_associated_company AS STRING), '')), r'\\d+') AS company_id
    FROM latest_deals d
    UNION ALL
    SELECT
      REGEXP_EXTRACT(company_id_raw, r'\\d+') AS company_id
    FROM latest_deals d
    CROSS JOIN UNNEST(
      CASE
        WHEN d.companies IS NULL THEN CAST([] AS ARRAY<STRING>)
        ELSE JSON_VALUE_ARRAY(d.companies, '$')
      END
    ) AS company_id_raw
  )
  WHERE company_id IS NOT NULL
    AND TRIM(company_id) != ''
),
contact_company_pairs AS (
  SELECT
    LOWER(TRIM(COALESCE(CAST(c.properties_email AS STRING), ''))) AS email,
    REGEXP_EXTRACT(company_id_raw, r'\\d+') AS company_id
  FROM latest_contacts c
  CROSS JOIN UNNEST(
    CASE
      WHEN c.companies IS NULL THEN CAST([] AS ARRAY<STRING>)
      ELSE JSON_VALUE_ARRAY(c.companies, '$')
    END
  ) AS company_id_raw
),
salesled_email_companies AS (
  SELECT
    cp.email,
    ARRAY_AGG(DISTINCT cp.company_id IGNORE NULLS) AS account_ids,
    ARRAY_AGG(
      DISTINCT COALESCE(
        NULLIF(TRIM(CAST(co.properties_name AS STRING)), ''),
        cp.company_id
      ) IGNORE NULLS
    ) AS account_names
  FROM contact_company_pairs cp
  JOIN included_salesled_companies isc
    ON isc.company_id = cp.company_id
  LEFT JOIN latest_companies co
    ON co.id = cp.company_id
  WHERE cp.email != ''
    AND cp.company_id IS NOT NULL
    AND TRIM(cp.company_id) != ''
  GROUP BY cp.email
),
latest_customers AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        PARTITION BY c.id
        ORDER BY c.batch_timestamp DESC
      ) AS rn
    FROM \`${customersTable}\` c
    WHERE (@as_of_date = '' OR c.batch_timestamp < TIMESTAMP(DATE_ADD(DATE(@as_of_date), INTERVAL 1 DAY)))
  )
  WHERE rn = 1
),
latest_customer_emails AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') AS customer_id,
    LOWER(TRIM(COALESCE(CAST(c.email AS STRING), ''))) AS email
  FROM latest_customers c
),
latest_invoices_all AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      i.*,
      ROW_NUMBER() OVER (
        PARTITION BY i.id
        ORDER BY i.batch_timestamp DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.stripe.invoices\` i
    WHERE (@as_of_date = '' OR DATE(i.date) <= DATE(@as_of_date))
      AND LOWER(TRIM(COALESCE(CAST(i.status AS STRING), ''))) != 'void'
  )
  WHERE rn = 1
),
ranked_latest_invoice_by_customer AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(i.customer_id AS STRING)), ''), '(blank)') AS customer_id,
    COALESCE(
      NULLIF(LOWER(TRIM(CAST(i.customer_email AS STRING))), ''),
      NULLIF(lce.email, ''),
      ''
    ) AS email,
    COALESCE(NULLIF(TRIM(CAST(i.customer_name AS STRING)), ''), '(blank)') AS name,
    UPPER(TRIM(COALESCE(CAST(i.currency AS STRING), ''))) AS currency,
    COALESCE(NULLIF(TRIM(CAST(i.id AS STRING)), ''), '(blank)') AS invoice_id,
    CAST(DATE(i.date) AS STRING) AS invoice_date,
    CAST(COALESCE(i.ending_balance, 0) AS FLOAT64) AS ending_balance_minor,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(NULLIF(TRIM(CAST(i.customer_id AS STRING)), ''), '(blank)')
      ORDER BY DATE(i.date) DESC, i.date DESC, i.batch_timestamp DESC, i.id DESC
    ) AS rn
  FROM latest_invoices_all i
  LEFT JOIN latest_customer_emails lce
    ON lce.customer_id = COALESCE(NULLIF(TRIM(CAST(i.customer_id AS STRING)), ''), '(blank)')
  WHERE COALESCE(NULLIF(TRIM(CAST(i.customer_id AS STRING)), ''), '(blank)') != '(blank)'
),
latest_invoice_credit_by_customer AS (
  SELECT
    r.customer_id,
    r.email,
    r.name,
    COALESCE(NULLIF(r.currency, ''), 'USD') AS currency,
    r.invoice_id,
    r.invoice_date,
    GREATEST(-r.ending_balance_minor, 0.0) AS available_credit_minor
  FROM ranked_latest_invoice_by_customer r
  WHERE r.rn = 1
)
SELECT
  lic.customer_id,
  lic.email,
  lic.name,
  lic.currency,
  sec.account_ids,
  sec.account_names,
  lic.invoice_id,
  lic.invoice_date,
  CAST(lic.available_credit_minor AS FLOAT64) AS available_credit_minor
FROM latest_invoice_credit_by_customer lic
JOIN salesled_email_companies sec
  ON sec.email = lic.email
WHERE lic.email != ''
  AND lic.available_credit_minor > 0
ORDER BY available_credit_minor DESC, customer_id ASC
`;
  const params: BigQueryNamedParameter[] = [
    { name: "as_of_date", type: "STRING", value: asOfDate },
    { name: "included_dealstage", type: "STRING", value: includedDealstage },
  ];
  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);

  return rows.map((row) => ({
    customerId: asString(row.customer_id),
    email: asString(row.email),
    name: asString(row.name),
    currency: asString(row.currency),
    accountIds: asStringArray(row.account_ids),
    accountNames: asStringArray(row.account_names),
    invoiceId: asString(row.invoice_id),
    invoiceDate: asString(row.invoice_date),
    availableCreditMinor: asNumber(row.available_credit_minor),
  }));
}

export async function queryStripeSalesLedCustomerCurrentBalanceFromBigQuery(
  request: StripeSalesLedCustomerCurrentBalanceRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeSalesLedCustomerCurrentBalanceRow[]> {
  const asOfDate = String(request.asOfDate || "").trim();
  if (asOfDate && !parseIsoDateUtc(asOfDate)) {
    throw new Error("Invalid asOfDate");
  }
  const includedDealstage = String(process.env.INCLUDED_DEALSTAGE || "").trim();
  if (!includedDealstage) {
    throw new Error("Missing INCLUDED_DEALSTAGE");
  }

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const customersTable = getStripeCustomersTable();

  const query = `
WITH latest_contacts AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        PARTITION BY c.id
        ORDER BY c.updatedAt DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.hubspot.contacts\` c
    WHERE LOWER(TRIM(COALESCE(CAST(c.properties_email AS STRING), ''))) LIKE '%@%'
      AND COALESCE(c.archived, FALSE) = FALSE
  )
  WHERE rn = 1
),
latest_companies AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      co.*,
      ROW_NUMBER() OVER (
        PARTITION BY co.id
        ORDER BY co.updatedAt DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.hubspot.companies\` co
    WHERE COALESCE(co.archived, FALSE) = FALSE
  )
  WHERE rn = 1
),
latest_deals AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      d.*,
      ROW_NUMBER() OVER (
        PARTITION BY d.id
        ORDER BY d.updatedAt DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.hubspot.deals\` d
    WHERE COALESCE(d.archived, FALSE) = FALSE
      AND TRIM(COALESCE(CAST(d.properties_dealstage AS STRING), '')) = @included_dealstage
      AND LOWER(TRIM(COALESCE(CAST(d.properties_deployment_type__c AS STRING), ''))) = 'cloud'
      AND COALESCE(
        SAFE_CAST(
          REGEXP_REPLACE(TRIM(COALESCE(CAST(d.properties_current_carr AS STRING), '0')), r'[^0-9.-]', '') AS FLOAT64
        ),
        0
      ) > 0
  )
  WHERE rn = 1
),
included_salesled_companies AS (
  SELECT DISTINCT company_id
  FROM (
    SELECT
      REGEXP_EXTRACT(TRIM(COALESCE(CAST(d.properties_hs_primary_associated_company AS STRING), '')), r'\\d+') AS company_id
    FROM latest_deals d
    UNION ALL
    SELECT
      REGEXP_EXTRACT(company_id_raw, r'\\d+') AS company_id
    FROM latest_deals d
    CROSS JOIN UNNEST(
      CASE
        WHEN d.companies IS NULL THEN CAST([] AS ARRAY<STRING>)
        ELSE JSON_VALUE_ARRAY(d.companies, '$')
      END
    ) AS company_id_raw
  )
  WHERE company_id IS NOT NULL
    AND TRIM(company_id) != ''
),
contact_company_pairs AS (
  SELECT
    LOWER(TRIM(COALESCE(CAST(c.properties_email AS STRING), ''))) AS email,
    REGEXP_EXTRACT(company_id_raw, r'\\d+') AS company_id
  FROM latest_contacts c
  CROSS JOIN UNNEST(
    CASE
      WHEN c.companies IS NULL THEN CAST([] AS ARRAY<STRING>)
      ELSE JSON_VALUE_ARRAY(c.companies, '$')
    END
  ) AS company_id_raw
),
salesled_email_companies AS (
  SELECT
    cp.email,
    ARRAY_AGG(DISTINCT cp.company_id IGNORE NULLS) AS account_ids,
    ARRAY_AGG(
      DISTINCT COALESCE(
        NULLIF(TRIM(CAST(co.properties_name AS STRING)), ''),
        cp.company_id
      ) IGNORE NULLS
    ) AS account_names
  FROM contact_company_pairs cp
  JOIN included_salesled_companies isc
    ON isc.company_id = cp.company_id
  LEFT JOIN latest_companies co
    ON co.id = cp.company_id
  WHERE cp.email != ''
    AND cp.company_id IS NOT NULL
    AND TRIM(cp.company_id) != ''
  GROUP BY cp.email
),
latest_customers AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        PARTITION BY c.id
        ORDER BY c.batch_timestamp DESC
      ) AS rn
    FROM \`${customersTable}\` c
    WHERE (@as_of_date = '' OR c.batch_timestamp < TIMESTAMP(DATE_ADD(DATE(@as_of_date), INTERVAL 1 DAY)))
  )
  WHERE rn = 1
),
salesled_customer_balances AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') AS customer_id,
    LOWER(TRIM(COALESCE(CAST(c.email AS STRING), ''))) AS email,
    COALESCE(NULLIF(TRIM(CAST(c.name AS STRING)), ''), '(blank)') AS name,
    UPPER(TRIM(COALESCE(CAST(c.currency AS STRING), ''))) AS currency,
    CAST(COALESCE(c.balance, 0) AS FLOAT64) AS current_balance_minor,
    CAST(COALESCE(c.account_balance, 0) AS FLOAT64) AS account_balance_minor,
    COALESCE(CAST(c.invoice_credit_balance AS STRING), '') AS invoice_credit_balance,
    CAST(c.batch_timestamp AS STRING) AS batch_timestamp
  FROM latest_customers c
  WHERE LOWER(TRIM(COALESCE(CAST(c.email AS STRING), ''))) != ''
)
SELECT
  scb.customer_id,
  scb.email,
  scb.name,
  COALESCE(NULLIF(scb.currency, ''), 'USD') AS currency,
  sec.account_ids,
  sec.account_names,
  CAST(scb.current_balance_minor AS FLOAT64) AS current_balance_minor,
  CAST(scb.account_balance_minor AS FLOAT64) AS account_balance_minor,
  scb.invoice_credit_balance,
  CAST(GREATEST(-scb.current_balance_minor, 0.0) AS FLOAT64) AS available_credit_minor,
  scb.batch_timestamp
FROM salesled_customer_balances scb
JOIN salesled_email_companies sec
  ON sec.email = scb.email
WHERE scb.email != ''
  AND scb.customer_id != '(blank)'
  AND GREATEST(-scb.current_balance_minor, 0.0) > 0
ORDER BY available_credit_minor DESC, customer_id ASC
`;
  const params: BigQueryNamedParameter[] = [
    { name: "as_of_date", type: "STRING", value: asOfDate },
    { name: "included_dealstage", type: "STRING", value: includedDealstage },
  ];
  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);

  return rows.map((row) => ({
    customerId: asString(row.customer_id),
    email: asString(row.email),
    name: asString(row.name),
    currency: asString(row.currency),
    accountIds: asStringArray(row.account_ids),
    accountNames: asStringArray(row.account_names),
    currentBalanceMinor: asNumber(row.current_balance_minor),
    accountBalanceMinor: asNumber(row.account_balance_minor),
    invoiceCreditBalance: asString(row.invoice_credit_balance),
    availableCreditMinor: asNumber(row.available_credit_minor),
    batchTimestamp: asString(row.batch_timestamp),
  }));
}

export async function queryStripeCustomerCurrentBalanceByCustomerIdsFromBigQuery(
  request: StripeCustomerCurrentBalanceByCustomerIdsRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeCustomerCurrentBalanceByCustomerIdsRow[]> {
  const customerIds = Array.from(
    new Set(
      (request.customerIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  if (!customerIds.length) return [];

  const asOfDate = String(request.asOfDate || "").trim();
  if (asOfDate && !parseIsoDateUtc(asOfDate)) {
    throw new Error("Invalid asOfDate");
  }

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const customersTable = getStripeCustomersTable();

  const query = `
WITH input_customers AS (
  SELECT customer_id
  FROM UNNEST([${customerIds.map((_, idx) => `@customer_id_${idx}`).join(", ")}]) AS customer_id
),
latest_customers AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        PARTITION BY c.id
        ORDER BY c.batch_timestamp DESC
      ) AS rn
    FROM \`${customersTable}\` c
    WHERE COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') IN (SELECT customer_id FROM input_customers)
      AND (@as_of_date = '' OR c.batch_timestamp < TIMESTAMP(DATE_ADD(DATE(@as_of_date), INTERVAL 1 DAY)))
  )
  WHERE rn = 1
)
SELECT
  COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') AS customer_id,
  LOWER(TRIM(COALESCE(CAST(c.email AS STRING), ''))) AS email,
  COALESCE(NULLIF(TRIM(CAST(c.name AS STRING)), ''), '(blank)') AS name,
  UPPER(TRIM(COALESCE(CAST(c.currency AS STRING), ''))) AS currency,
  CAST(COALESCE(c.balance, 0) AS FLOAT64) AS current_balance_minor,
  CAST(COALESCE(c.account_balance, 0) AS FLOAT64) AS account_balance_minor,
  COALESCE(CAST(c.invoice_credit_balance AS STRING), '') AS invoice_credit_balance,
  CAST(GREATEST(-COALESCE(c.balance, 0), 0.0) AS FLOAT64) AS available_credit_minor,
  CAST(c.batch_timestamp AS STRING) AS batch_timestamp
FROM latest_customers c
WHERE COALESCE(NULLIF(TRIM(CAST(c.id AS STRING)), ''), '(blank)') IN (SELECT customer_id FROM input_customers)
`;

  const params: BigQueryNamedParameter[] = [
    ...customerIds.map((customerId, idx) => ({
      name: `customer_id_${idx}`,
      type: "STRING" as const,
      value: customerId,
    })),
    { name: "as_of_date", type: "STRING", value: asOfDate },
  ];
  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);

  return rows.map((row) => ({
    customerId: asString(row.customer_id),
    email: asString(row.email),
    name: asString(row.name),
    currency: asString(row.currency),
    currentBalanceMinor: asNumber(row.current_balance_minor),
    accountBalanceMinor: asNumber(row.account_balance_minor),
    invoiceCreditBalance: asString(row.invoice_credit_balance),
    availableCreditMinor: asNumber(row.available_credit_minor),
    batchTimestamp: asString(row.batch_timestamp),
  }));
}

export async function queryStripeMeteredUsageByCustomerFromBigQuery(
  request: StripeMeteredUsageByCustomerRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeMeteredUsageByCustomerRow[]> {
  const customerIds = Array.from(
    new Set(
      (request.customerIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  if (!customerIds.length) return [];

  const startDate = parseIsoDateUtc(String(request.startDate || "").trim());
  const endDate = parseIsoDateUtc(String(request.endDate || "").trim());
  if (!startDate || !endDate) {
    throw new Error("Invalid startDate/endDate");
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("endDate must be >= startDate");
  }
  const startDateIso = startDate.toISOString().slice(0, 10);
  const endDateIso = endDate.toISOString().slice(0, 10);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";

  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);

  const query = `
WITH input_customers AS (
  SELECT customer_id
  FROM UNNEST([${customerIds.map((_, idx) => `@customer_id_${idx}`).join(", ")}]) AS customer_id
),
latest_invoice_lines AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      il.*,
      ROW_NUMBER() OVER (
        PARTITION BY il.id
        ORDER BY il.batch_timestamp DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.stripe.invoice_lines\` il
  )
  WHERE rn = 1
),
latest_prices AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      p.*,
      ROW_NUMBER() OVER (
        PARTITION BY p.id
        ORDER BY p.batch_timestamp DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.stripe.prices\` p
  )
  WHERE rn = 1
),
latest_invoices AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      i.*,
      ROW_NUMBER() OVER (
        PARTITION BY i.id
        ORDER BY i.batch_timestamp DESC
      ) AS rn
    FROM \`botpress-stripe-data-pipeline.stripe.invoices\` i
  )
  WHERE rn = 1
),
line_discounts AS (
  SELECT
    invoice_line_item_id,
    SUM(COALESCE(amount, 0)) AS discount_amount
  FROM \`botpress-stripe-data-pipeline.stripe.invoice_line_item_discount_amounts\`
  GROUP BY invoice_line_item_id
)
SELECT
  COALESCE(NULLIF(TRIM(CAST(i.customer_id AS STRING)), ''), '(blank)') AS customer_id,
  ROUND(
    SUM(
      CAST(COALESCE(il.amount, 0) - COALESCE(ld.discount_amount, 0) AS FLOAT64) / 100.0
    ),
    2
  ) AS usage_major,
  COUNT(*) AS line_count
FROM latest_invoice_lines il
JOIN latest_prices p
  ON p.id = il.price_id
LEFT JOIN line_discounts ld
  ON ld.invoice_line_item_id = il.id
LEFT JOIN latest_invoices i
  ON i.id = il.invoice_id
WHERE
  LOWER(COALESCE(p.recurring_usage_type, '')) = 'metered'
  AND LOWER(COALESCE(il.currency, '')) = @target_currency
  AND DATE(il.period_start) BETWEEN DATE(@start_date) AND DATE(@end_date)
  AND COALESCE(NULLIF(TRIM(CAST(i.customer_id AS STRING)), ''), '(blank)') IN (
    SELECT customer_id FROM input_customers
  )
GROUP BY customer_id
HAVING SUM(
  CAST(COALESCE(il.amount, 0) - COALESCE(ld.discount_amount, 0) AS FLOAT64) / 100.0
) > 0
ORDER BY usage_major DESC, customer_id ASC
`;

  const params: BigQueryNamedParameter[] = [
    { name: "start_date", type: "STRING", value: startDateIso },
    { name: "end_date", type: "STRING", value: endDateIso },
    { name: "target_currency", type: "STRING", value: targetCurrency },
    ...customerIds.map((customerId, idx) => ({
      name: `customer_id_${idx}`,
      type: "STRING" as const,
      value: customerId,
    })),
  ];

  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);
  return rows.map((row) => ({
    customerId: asString(row.customer_id),
    usageMajor: Math.max(0, asNumber(row.usage_major)),
    lineCount: asInt(row.line_count),
  }));
}

export async function queryStripeUpcomingCurrentMonthFromBigQuery(
  request: StripeUpcomingCurrentMonthRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeUpcomingCurrentMonthResult> {
  const monthStart = parseIsoDateUtc(request.monthStartDate);
  const nextMonthStart = parseIsoDateUtc(request.nextMonthStartDate);
  if (!monthStart || !nextMonthStart) {
    throw new Error("Invalid monthStartDate/nextMonthStartDate");
  }
  if (nextMonthStart.getTime() <= monthStart.getTime()) {
    throw new Error("nextMonthStartDate must be > monthStartDate");
  }

  const monthStartIso = monthStart.toISOString().slice(0, 10);
  const nextMonthStartIso = nextMonthStart.toISOString().slice(0, 10);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const profile = normalizeProfile(options?.profile);
  const table = getStripeUpcomingSnapshotsTable(profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const snapshotKeyExpr = "CAST(t.snapshot_date AS STRING)";
  const snapshotTsExpr = buildUpcomingSnapshotTimestampSql("t.snapshot_ts", "t.snapshot_date");

  const query = `
WITH table_rows AS (
  SELECT
    t.*,
    ${snapshotKeyExpr} AS snapshot_key,
    ${snapshotTsExpr} AS snapshot_ts_norm
  FROM \`${table}\`
  AS t
),
latest_snapshot AS (
  SELECT snapshot_key, snapshot_batch_ts
  FROM (
    SELECT DISTINCT
      snapshot_key,
      TIMESTAMP_TRUNC(snapshot_ts_norm, MINUTE) AS snapshot_batch_ts
    FROM table_rows
  )
  ORDER BY snapshot_batch_ts DESC, snapshot_key DESC
  LIMIT 1
)
SELECT
  MAX(ls.snapshot_key) AS snapshot_date,
  COUNTIF(t.snapshot_key IS NOT NULL) AS line_count,
  COALESCE(SUM(CAST(t.amount_minor AS FLOAT64)), 0.0) AS amount_minor_sum
FROM latest_snapshot ls
LEFT JOIN table_rows t
  ON t.snapshot_key = ls.snapshot_key
  AND (
    TIMESTAMP_TRUNC(t.snapshot_ts_norm, MINUTE) = ls.snapshot_batch_ts
    OR (t.snapshot_ts_norm IS NULL AND ls.snapshot_batch_ts IS NULL)
  )
  AND t.period_start >= TIMESTAMP(@month_start_date)
  AND t.period_start < TIMESTAMP(@next_month_start_date)
  AND LOWER(COALESCE(CAST(t.currency AS STRING), '')) = @target_currency
`;
  const params: BigQueryNamedParameter[] = [
    { name: "month_start_date", type: "STRING", value: monthStartIso },
    { name: "next_month_start_date", type: "STRING", value: nextMonthStartIso },
    { name: "target_currency", type: "STRING", value: targetCurrency },
  ];
  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);
  const first = rows[0] || {};
  const amountMinorSum = Math.max(0, asNumber(first.amount_minor_sum));

  return {
    snapshotDate: asString(first.snapshot_date),
    lineCount: asInt(first.line_count),
    amountMinorSum,
    amountMajorSum: round2(amountMinorSum / 100),
    targetCurrency: targetCurrency.toUpperCase(),
  };
}

export async function queryStripeUpcomingCurrentMonthDescriptionAmountFromBigQuery(
  request: StripeUpcomingCurrentMonthDescriptionAmountRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeUpcomingCurrentMonthDescriptionAmountResult> {
  const monthStart = parseIsoDateUtc(request.monthStartDate);
  const nextMonthStart = parseIsoDateUtc(request.nextMonthStartDate);
  if (!monthStart || !nextMonthStart) {
    throw new Error("Invalid monthStartDate/nextMonthStartDate");
  }
  if (nextMonthStart.getTime() <= monthStart.getTime()) {
    throw new Error("nextMonthStartDate must be > monthStartDate");
  }

  const monthStartIso = monthStart.toISOString().slice(0, 10);
  const nextMonthStartIso = nextMonthStart.toISOString().slice(0, 10);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const excludedCustomerIds = Array.from(
    new Set(
      (request.excludeCustomerIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  const prepaidOffsetByCustomerIds = Array.from(
    (request.prepaidOffsetByCustomerIds || [])
      .map((entry) => {
        const customerId = String(entry?.customerId || "").trim();
        const prepaidAppliedMajor = Number(entry?.prepaidAppliedMajor || 0);
        if (!customerId) return null;
        if (!Number.isFinite(prepaidAppliedMajor) || prepaidAppliedMajor <= 0) return null;
        return { customerId, prepaidAppliedMajor };
      })
      .filter((entry): entry is { customerId: string; prepaidAppliedMajor: number } => !!entry),
  );
  const includes = Array.from(
    new Set(
      (request.productDescriptionIncludes || [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  if (!includes.length) {
    return {
      snapshotDate: "",
      snapshotTimestampUtc: "",
      lineCount: 0,
      amountMinorSum: 0,
      amountMajorSum: 0,
      targetCurrency: targetCurrency.toUpperCase(),
    };
  }

  const profile = normalizeProfile(options?.profile);
  const table = getStripeUpcomingSnapshotsTable(profile);
  const productsTable = getStripeProductsTable(profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const snapshotKeyExpr = "CAST(t.snapshot_date AS STRING)";
  const snapshotTsExpr = buildUpcomingSnapshotTimestampSql("t.snapshot_ts", "t.snapshot_date");

  const descriptionTermsSql = includes.map(
    (_, idx) => `STRPOS(LOWER(COALESCE(CAST(pl.product_description AS STRING), '')), @desc_${idx}) > 0`,
  );
  const excludedCustomersCteSql = excludedCustomerIds.length
    ? `excluded_customers AS (
  SELECT customer_id
  FROM UNNEST([${excludedCustomerIds.map((_, idx) => `@excluded_customer_${idx}`).join(", ")}]) AS customer_id
),`
    : `excluded_customers AS (
  SELECT customer_id
  FROM UNNEST(CAST([] AS ARRAY<STRING>)) AS customer_id
),`;
  const excludedCustomerWhereSql = excludedCustomerIds.length
    ? `    AND COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') NOT IN (
      SELECT customer_id FROM excluded_customers
    )`
    : "";
  const prepaidOffsetsCteSql = prepaidOffsetByCustomerIds.length
    ? `prepaid_offsets AS (
  SELECT
    customer_id,
    CAST(prepaid_applied_minor AS FLOAT64) AS prepaid_applied_minor
  FROM UNNEST([${prepaidOffsetByCustomerIds
    .map(
      (_, idx) =>
        `STRUCT(@prepaid_customer_${idx} AS customer_id, CAST(@prepaid_customer_amount_minor_${idx} AS FLOAT64) AS prepaid_applied_minor)`,
    )
    .join(", ")}])
),`
    : `prepaid_offsets AS (
  SELECT customer_id, prepaid_applied_minor
  FROM UNNEST(CAST([] AS ARRAY<STRUCT<customer_id STRING, prepaid_applied_minor FLOAT64>>))
),`;
  const query = `
WITH table_rows AS (
  SELECT
    t.*,
    ${snapshotKeyExpr} AS snapshot_key,
    ${snapshotTsExpr} AS snapshot_ts_norm
  FROM \`${table}\` AS t
),
latest_snapshot AS (
  SELECT snapshot_key, snapshot_batch_ts
  FROM (
    SELECT DISTINCT
      snapshot_key,
      TIMESTAMP_TRUNC(snapshot_ts_norm, MINUTE) AS snapshot_batch_ts
    FROM table_rows
  )
  ORDER BY snapshot_batch_ts DESC, snapshot_key DESC
  LIMIT 1
),
matched_snapshot_rows AS (
  SELECT t.*
  FROM latest_snapshot ls
  JOIN table_rows t
    ON t.snapshot_key = ls.snapshot_key
    AND (
      TIMESTAMP_TRUNC(t.snapshot_ts_norm, MINUTE) = ls.snapshot_batch_ts
      OR (t.snapshot_ts_norm IS NULL AND ls.snapshot_batch_ts IS NULL)
    )
),
products_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS product_id,
    COALESCE(
      NULLIF(TRIM(CAST(description AS STRING)), ''),
      NULLIF(TRIM(CAST(name AS STRING)), ''),
      '(blank)'
    ) AS product_description
  FROM \`${productsTable}\`
),
${excludedCustomersCteSql}
${prepaidOffsetsCteSql}
matched_lines AS (
  SELECT
    ls.snapshot_key AS snapshot_date,
    COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') AS customer_id,
    t.amount_minor
  FROM latest_snapshot ls
  JOIN matched_snapshot_rows t
    ON TRUE
    AND t.period_start >= TIMESTAMP(@month_start_date)
    AND t.period_start < TIMESTAMP(@next_month_start_date)
    AND LOWER(COALESCE(CAST(t.currency AS STRING), '')) = @target_currency
${excludedCustomerWhereSql}
  JOIN products_lookup pl
    ON pl.product_id = COALESCE(
      NULLIF(TRIM(CAST(t.product_id AS STRING)), ''),
      NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(t), '$.product_id')), ''),
      '(blank)'
    )
    AND (${descriptionTermsSql.join(" OR ")})
),
customer_totals AS (
  SELECT
    snapshot_date,
    customer_id,
    COUNT(*) AS line_count,
    COALESCE(SUM(CAST(amount_minor AS FLOAT64)), 0.0) AS amount_minor_sum
  FROM matched_lines
  GROUP BY snapshot_date, customer_id
),
net_customer_totals AS (
  SELECT
    ct.snapshot_date,
    ct.customer_id,
    ct.line_count,
    GREATEST(ct.amount_minor_sum - COALESCE(po.prepaid_applied_minor, 0.0), 0.0) AS net_amount_minor_sum
  FROM customer_totals ct
  LEFT JOIN prepaid_offsets po
    ON po.customer_id = ct.customer_id
)
SELECT
  MAX(ls.snapshot_key) AS snapshot_date,
  CAST(MAX(ls.snapshot_batch_ts) AS STRING) AS snapshot_timestamp_utc,
  COALESCE(SUM(nct.line_count), 0) AS line_count,
  COALESCE(SUM(nct.net_amount_minor_sum), 0.0) AS amount_minor_sum
FROM latest_snapshot ls
LEFT JOIN net_customer_totals nct
  ON nct.snapshot_date = ls.snapshot_key
`;
  const params: BigQueryNamedParameter[] = [
    { name: "month_start_date", type: "STRING", value: monthStartIso },
    { name: "next_month_start_date", type: "STRING", value: nextMonthStartIso },
    { name: "target_currency", type: "STRING", value: targetCurrency },
    ...includes.map((term, idx) => ({ name: `desc_${idx}`, type: "STRING" as const, value: term })),
    ...excludedCustomerIds.map((customerId, idx) => ({
      name: `excluded_customer_${idx}`,
      type: "STRING" as const,
      value: customerId,
    })),
    ...prepaidOffsetByCustomerIds.flatMap((entry, idx) => [
      {
        name: `prepaid_customer_${idx}`,
        type: "STRING" as const,
        value: entry.customerId,
      },
      {
        name: `prepaid_customer_amount_minor_${idx}`,
        type: "STRING" as const,
        value: String(Math.round(entry.prepaidAppliedMajor * 100)),
      },
    ]),
  ];
  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);
  const first = rows[0] || {};
  const amountMinorSumBase = asNumber(first.amount_minor_sum);
  const fixedAdjustmentMajor = fixedAiSpendMonthlyAdjustmentMajorForMonth(monthStartIso.slice(0, 7));
  const amountMajorSum = round2((amountMinorSumBase / 100) + fixedAdjustmentMajor);
  const amountMinorSum = Math.round(amountMajorSum * 100);

  return {
    snapshotDate: asString(first.snapshot_date),
    snapshotTimestampUtc: asString(first.snapshot_timestamp_utc),
    lineCount: asInt(first.line_count),
    amountMinorSum,
    amountMajorSum,
    targetCurrency: targetCurrency.toUpperCase(),
  };
}

export async function queryStripeLatestUpcomingSnapshotDateFromBigQuery(
  options?: StripeBigQueryOptions,
): Promise<string> {
  const profile = normalizeProfile(options?.profile);
  const table = getStripeUpcomingSnapshotsTable(profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const snapshotKeyExpr = "CAST(t.snapshot_date AS STRING)";
  const snapshotTsExpr = buildUpcomingSnapshotTimestampSql("t.snapshot_ts", "t.snapshot_date");

  const rows = await runBigQueryQueryRows(
    accessToken,
    projectId,
    location,
    `
WITH table_rows AS (
  SELECT
    ${snapshotKeyExpr} AS snapshot_key,
    ${snapshotTsExpr} AS snapshot_ts
  FROM \`${table}\` AS t
),
latest_snapshot AS (
  SELECT snapshot_key, snapshot_batch_ts
  FROM (
    SELECT DISTINCT
      snapshot_key,
      TIMESTAMP_TRUNC(snapshot_ts, MINUTE) AS snapshot_batch_ts
    FROM table_rows
  )
  ORDER BY snapshot_batch_ts DESC, snapshot_key DESC
  LIMIT 1
)
SELECT snapshot_key AS snapshot_date
FROM latest_snapshot
`,
    [],
  );

  return asString(rows[0]?.snapshot_date);
}

export async function queryStripeAiSpendCurrentMonthFromUpcomingFromBigQuery(
  request: StripeAiSpendCurrentMonthFromUpcomingRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeAiSpendCurrentMonthFromUpcomingResult> {
  const startDate = parseIsoDateUtc(request.startDate);
  const endDate = parseIsoDateUtc(request.endDate);
  if (!startDate || !endDate) {
    throw new Error("Invalid startDate/endDate");
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("endDate must be >= startDate");
  }

  const startDateIso = startDate.toISOString().slice(0, 10);
  const endDateIso = endDate.toISOString().slice(0, 10);
  const monthStartUtc = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1, 0, 0, 0, 0));
  const nextMonthStartUtc = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  const monthStartIso = monthStartUtc.toISOString().slice(0, 10);
  const nextMonthStartIso = nextMonthStartUtc.toISOString().slice(0, 10);
  const grain = normalizeStripeAiSpendGrain(request.grain);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const topLimit = Math.max(1, Math.min(5000, asInt(request.topLimit || 50)));
  const detailLimit = Math.max(1, Math.min(1000, asInt(request.detailLimit || 200)));
  const includes = Array.from(
    new Set(
      (request.productDescriptionIncludes || [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const excludedCustomerIds = Array.from(
    new Set(
      (request.excludeCustomerIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  const prepaidOffsetByCustomerIds = Array.from(
    (request.prepaidOffsetByCustomerIds || [])
      .map((entry) => {
        const customerId = String(entry?.customerId || "").trim();
        const prepaidAppliedMajor = Number(entry?.prepaidAppliedMajor || 0);
        if (!customerId) return null;
        if (!Number.isFinite(prepaidAppliedMajor) || prepaidAppliedMajor <= 0) return null;
        return { customerId, prepaidAppliedMajor };
      })
      .filter((entry): entry is { customerId: string; prepaidAppliedMajor: number } => !!entry)
      .reduce((acc, entry) => {
        acc.set(entry.customerId, (acc.get(entry.customerId) || 0) + entry.prepaidAppliedMajor);
        return acc;
      }, new Map<string, number>()),
  ).map(([customerId, prepaidAppliedMajor]) => ({
    customerId,
    prepaidAppliedMajor: round2(prepaidAppliedMajor),
  }));

  const empty: StripeAiSpendCurrentMonthFromUpcomingResult = {
    snapshotDate: "",
    startDate: startDateIso,
    endDate: endDateIso,
    grain,
    targetCurrency: targetCurrency.toUpperCase(),
    totalRevenue: 0,
    meteredRevenueSalesled: 0,
    meteredRevenueSelfserve: 0,
    points: [],
    topCustomers: [],
    topProducts: [],
    topPrices: [],
    detailRows: [],
  };
  if (!includes.length) return empty;

  const profile = normalizeProfile(options?.profile);
  const table = getStripeUpcomingSnapshotsTable(profile);
  const productsTable = getStripeProductsTable(profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const snapshotKeyExpr = "CAST(t.snapshot_date AS STRING)";
  const snapshotTsExpr = buildUpcomingSnapshotTimestampSql("t.snapshot_ts", "t.snapshot_date");

  const latestSnapshotRows = await runBigQueryQueryRows(
    accessToken,
    projectId,
    location,
    `
WITH table_rows AS (
  SELECT
    ${snapshotKeyExpr} AS snapshot_key,
    ${snapshotTsExpr} AS snapshot_ts
  FROM \`${table}\` AS t
),
latest_snapshot AS (
  SELECT snapshot_key, snapshot_batch_ts
  FROM (
    SELECT DISTINCT
      snapshot_key,
      TIMESTAMP_TRUNC(snapshot_ts, MINUTE) AS snapshot_batch_ts
    FROM table_rows
  )
  ORDER BY snapshot_batch_ts DESC, snapshot_key DESC
  LIMIT 1
)
SELECT snapshot_key AS snapshot_date FROM latest_snapshot
`,
    [],
  );
  const snapshotDate = asString(latestSnapshotRows[0]?.snapshot_date);
  if (!snapshotDate) return empty;

  const descriptionTermsSql = includes.map(
    (_, idx) => `STRPOS(LOWER(COALESCE(CAST(pl.product_description AS STRING), '')), @desc_${idx}) > 0`,
  );
  const excludedCustomersCteSql = excludedCustomerIds.length
    ? `excluded_customers AS (
  SELECT customer_id
  FROM UNNEST([${excludedCustomerIds.map((_, idx) => `@excluded_customer_${idx}`).join(", ")}]) AS customer_id
),`
    : `excluded_customers AS (
  SELECT customer_id
  FROM UNNEST(CAST([] AS ARRAY<STRING>)) AS customer_id
),`;
  const excludedCustomerWhereSql = excludedCustomerIds.length
    ? `    AND COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') NOT IN (
      SELECT customer_id FROM excluded_customers
    )`
    : "";
  const prepaidOffsetsCteSql = prepaidOffsetByCustomerIds.length
    ? `prepaid_offsets AS (
  SELECT
    customer_id,
    CAST(prepaid_applied_major AS FLOAT64) AS prepaid_applied_major
  FROM UNNEST([${prepaidOffsetByCustomerIds
    .map(
      (_, idx) =>
        `STRUCT(@prepaid_customer_${idx} AS customer_id, CAST(@prepaid_customer_amount_${idx} AS FLOAT64) AS prepaid_applied_major)`,
    )
    .join(", ")}])
),`
    : `prepaid_offsets AS (
  SELECT customer_id, prepaid_applied_major
  FROM UNNEST(CAST([] AS ARRAY<STRUCT<customer_id STRING, prepaid_applied_major FLOAT64>>))
),`;

  const baseCte = `
WITH table_rows AS (
  SELECT
    t.*,
    ${snapshotKeyExpr} AS snapshot_key,
    ${snapshotTsExpr} AS snapshot_ts_norm
  FROM \`${table}\` AS t
),
latest_snapshot AS (
  SELECT snapshot_key, snapshot_batch_ts
  FROM (
    SELECT DISTINCT
      snapshot_key,
      TIMESTAMP_TRUNC(snapshot_ts_norm, MINUTE) AS snapshot_batch_ts
    FROM table_rows
  )
  ORDER BY snapshot_batch_ts DESC, snapshot_key DESC
  LIMIT 1
),
matched_snapshot_rows AS (
  SELECT t.*
  FROM latest_snapshot ls
  JOIN table_rows t
    ON t.snapshot_key = ls.snapshot_key
    AND (
      TIMESTAMP_TRUNC(t.snapshot_ts_norm, MINUTE) = ls.snapshot_batch_ts
      OR (t.snapshot_ts_norm IS NULL AND ls.snapshot_batch_ts IS NULL)
    )
),
products_lookup AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS product_id,
    COALESCE(
      NULLIF(TRIM(CAST(description AS STRING)), ''),
      NULLIF(TRIM(CAST(name AS STRING)), ''),
      '(blank)'
    ) AS product_description
  FROM \`${productsTable}\`
),
${excludedCustomersCteSql}
${prepaidOffsetsCteSql}
matched_lines_raw AS (
  SELECT
    DATE(t.period_start) AS event_date,
    COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') AS customer_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(t), '$.customer_name')), ''),
      COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)')
    ) AS customer_name,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(t), '$.line_item_id')), ''),
      NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(t), '$.id')), ''),
      CONCAT('snapshot-line-', CAST(ABS(FARM_FINGERPRINT(TO_JSON_STRING(t))) AS STRING))
    ) AS line_item_id,
    COALESCE(
      NULLIF(TRIM(CAST(t.description AS STRING)), ''),
      NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(t), '$.line_item_description')), ''),
      '(blank)'
    ) AS line_item_description,
    COALESCE(NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(t), '$.price_id')), ''), '(blank)') AS price_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(t), '$.price_nickname')), ''),
      NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(t), '$.price_label')), ''),
      COALESCE(NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(t), '$.price_id')), ''), '(blank)')
    ) AS price_label,
    COALESCE(
      NULLIF(TRIM(CAST(t.product_id AS STRING)), ''),
      NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(t), '$.product_id')), ''),
      '(blank)'
    ) AS product_id,
    COALESCE(NULLIF(TRIM(CAST(pl.product_description AS STRING)), ''), '(blank)') AS product_label,
    GREATEST(
      CAST(COALESCE(t.amount_minor, 0) AS FLOAT64) -
      COALESCE(
        (
          SELECT
            SUM(COALESCE(SAFE_CAST(JSON_VALUE(discount_item, '$.amount') AS FLOAT64), 0.0))
          FROM UNNEST(
            COALESCE(
              JSON_QUERY_ARRAY(t.raw_json, '$.discount_amounts'),
              CAST([] AS ARRAY<STRING>)
            )
          ) AS discount_item
        ),
        0.0
      ),
      0.0
    ) / 100.0 AS revenue_major,
    CAST(
      COALESCE(
        SAFE_CAST(NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(t), '$.quantity')), '') AS FLOAT64),
        1.0
      ) AS FLOAT64
    ) AS quantity
  FROM latest_snapshot ls
  JOIN matched_snapshot_rows t
    ON TRUE
    AND t.period_start >= TIMESTAMP(@month_start_date)
    AND t.period_start < TIMESTAMP(@next_month_start_date)
    AND DATE(t.period_start) BETWEEN DATE(@start_date) AND DATE(@end_date)
    AND LOWER(COALESCE(CAST(t.currency AS STRING), '')) = @target_currency
${excludedCustomerWhereSql}
  JOIN products_lookup pl
    ON pl.product_id = COALESCE(
      NULLIF(TRIM(CAST(t.product_id AS STRING)), ''),
      NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(t), '$.product_id')), ''),
      '(blank)'
    )
    AND (${descriptionTermsSql.join(" OR ")})
),
matched_lines_with_offsets AS (
  SELECT
    ml.*,
    CASE
      WHEN
        NULLIF(TRIM(COALESCE(ml.customer_name, '')), '') IS NOT NULL
        AND TRIM(COALESCE(ml.customer_name, '')) != '(blank)'
        AND TRIM(COALESCE(ml.customer_name, '')) != TRIM(COALESCE(ml.customer_id, ''))
      THEN 'salesled'
      ELSE 'selfserve'
    END AS customer_segment,
    COALESCE(po.prepaid_applied_major, 0.0) AS prepaid_applied_major,
    SUM(ml.revenue_major) OVER (
      PARTITION BY ml.customer_id
      ORDER BY ml.event_date, ml.line_item_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_revenue_major,
    COALESCE(
      SUM(ml.revenue_major) OVER (
        PARTITION BY ml.customer_id
        ORDER BY ml.event_date, ml.line_item_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0.0
    ) AS prev_running_revenue_major
  FROM matched_lines_raw ml
  LEFT JOIN prepaid_offsets po
    ON po.customer_id = ml.customer_id
),
matched_lines AS (
  SELECT
    event_date,
    customer_id,
    customer_name,
    line_item_id,
    line_item_description,
    price_id,
    price_label,
    product_id,
    product_label,
    customer_segment,
    GREATEST(
      revenue_major - GREATEST(LEAST(running_revenue_major, prepaid_applied_major) - prev_running_revenue_major, 0.0),
      0.0
    ) AS revenue_major,
    quantity
  FROM matched_lines_with_offsets
  WHERE GREATEST(
    revenue_major - GREATEST(LEAST(running_revenue_major, prepaid_applied_major) - prev_running_revenue_major, 0.0),
    0.0
  ) > 0
)
`;

  const summaryQuery = `
${baseCte}
SELECT
  CASE
    WHEN @grain = 'daily' THEN FORMAT_DATE('%Y-%m-%d', bucket_start)
    WHEN @grain = 'weekly' THEN FORMAT_DATE('%Y-%m-%d', bucket_start)
    WHEN @grain = 'monthly' THEN FORMAT_DATE('%Y-%m', bucket_start)
    ELSE CONCAT(CAST(EXTRACT(YEAR FROM bucket_start) AS STRING), '-Q', CAST(EXTRACT(QUARTER FROM bucket_start) AS STRING))
  END AS period_key,
  CASE
    WHEN @grain = 'daily' THEN FORMAT_DATE('%Y-%m-%d', bucket_start)
    WHEN @grain = 'weekly' THEN CONCAT('Week of ', FORMAT_DATE('%Y-%m-%d', bucket_start))
    WHEN @grain = 'monthly' THEN FORMAT_DATE('%b %Y', bucket_start)
    ELSE CONCAT('Q', CAST(EXTRACT(QUARTER FROM bucket_start) AS STRING), ' ', CAST(EXTRACT(YEAR FROM bucket_start) AS STRING))
  END AS period_label,
  FORMAT_DATE('%Y-%m-%d', bucket_start) AS period_start,
  FORMAT_DATE(
    '%Y-%m-%d',
    CASE
      WHEN @grain = 'daily' THEN bucket_start
      WHEN @grain = 'weekly' THEN DATE_SUB(DATE_ADD(bucket_start, INTERVAL 1 WEEK), INTERVAL 1 DAY)
      WHEN @grain = 'monthly' THEN DATE_SUB(DATE_ADD(bucket_start, INTERVAL 1 MONTH), INTERVAL 1 DAY)
      ELSE DATE_SUB(DATE_ADD(bucket_start, INTERVAL 3 MONTH), INTERVAL 1 DAY)
    END
  ) AS period_end,
  ROUND(SUM(revenue_major), 2) AS revenue,
  COUNT(*) AS line_count,
  COUNT(DISTINCT customer_id) AS customer_count
FROM (
  SELECT
    CASE
      WHEN @grain = 'daily' THEN event_date
      WHEN @grain = 'weekly' THEN DATE_TRUNC(event_date, WEEK(MONDAY))
      WHEN @grain = 'monthly' THEN DATE_TRUNC(event_date, MONTH)
      ELSE DATE_TRUNC(event_date, QUARTER)
    END AS bucket_start,
    revenue_major,
    customer_id
  FROM matched_lines
)
GROUP BY bucket_start
ORDER BY bucket_start ASC
`;

const topCustomersQuery = `
${baseCte}
SELECT
  customer_id AS group_key,
  customer_name AS group_label,
  ROUND(SUM(revenue_major), 2) AS revenue,
  COUNT(*) AS line_count
FROM matched_lines
GROUP BY group_key, group_label
ORDER BY revenue DESC, group_label ASC
`;

  const topProductsQuery = `
${baseCte}
SELECT
  product_id AS group_key,
  product_label AS group_label,
  ROUND(SUM(revenue_major), 2) AS revenue,
  COUNT(*) AS line_count
FROM matched_lines
GROUP BY group_key, group_label
ORDER BY revenue DESC, group_label ASC
LIMIT @top_limit
`;

  const topPricesQuery = `
${baseCte}
SELECT
  price_id,
  price_label,
  product_id,
  product_label,
  ROUND(SUM(revenue_major), 2) AS revenue,
  COUNT(*) AS line_count
FROM matched_lines
GROUP BY price_id, price_label, product_id, product_label
ORDER BY revenue DESC, price_label ASC
LIMIT @top_limit
`;

  const detailQuery = `
${baseCte}
SELECT
  FORMAT_DATE('%Y-%m-%d', event_date) AS invoice_date,
  customer_id,
  customer_name,
  line_item_id,
  line_item_description,
  price_id,
  price_label,
  product_id,
  product_label,
  ROUND(revenue_major, 2) AS revenue,
  quantity
FROM matched_lines
ORDER BY revenue DESC, invoice_date DESC, line_item_id DESC
LIMIT @detail_limit
`;
  const segmentSummaryQuery = `
${baseCte}
SELECT
  ROUND(SUM(CASE WHEN customer_segment = 'salesled' THEN revenue_major ELSE 0 END), 2) AS metered_revenue_salesled,
  ROUND(SUM(CASE WHEN customer_segment = 'selfserve' THEN revenue_major ELSE 0 END), 2) AS metered_revenue_selfserve
FROM matched_lines
`;

  const baseParams: BigQueryNamedParameter[] = [
    { name: "start_date", type: "STRING", value: startDateIso },
    { name: "end_date", type: "STRING", value: endDateIso },
    { name: "month_start_date", type: "STRING", value: monthStartIso },
    { name: "next_month_start_date", type: "STRING", value: nextMonthStartIso },
    { name: "target_currency", type: "STRING", value: targetCurrency },
    { name: "grain", type: "STRING", value: grain },
    ...includes.map((term, idx) => ({ name: `desc_${idx}`, type: "STRING" as const, value: term })),
    ...excludedCustomerIds.map((customerId, idx) => ({
      name: `excluded_customer_${idx}`,
      type: "STRING" as const,
      value: customerId,
    })),
    ...prepaidOffsetByCustomerIds.flatMap((entry, idx) => [
      {
        name: `prepaid_customer_${idx}`,
        type: "STRING" as const,
        value: entry.customerId,
      },
      {
        name: `prepaid_customer_amount_${idx}`,
        type: "STRING" as const,
        value: String(entry.prepaidAppliedMajor),
      },
    ]),
  ];

  const [summaryRows, topCustomersRows, topProductsRows, topPricesRows, detailRowsRaw, segmentSummaryRows] = await Promise.all([
    runBigQueryQueryRows(accessToken, projectId, location, summaryQuery, baseParams),
    runBigQueryQueryRows(accessToken, projectId, location, topCustomersQuery, baseParams),
    runBigQueryQueryRows(accessToken, projectId, location, topProductsQuery, [
      ...baseParams,
      { name: "top_limit", type: "INT64", value: String(topLimit) },
    ]),
    runBigQueryQueryRows(accessToken, projectId, location, topPricesQuery, [
      ...baseParams,
      { name: "top_limit", type: "INT64", value: String(topLimit) },
    ]),
    runBigQueryQueryRows(accessToken, projectId, location, detailQuery, [
      ...baseParams,
      { name: "detail_limit", type: "INT64", value: String(detailLimit) },
    ]),
    runBigQueryQueryRows(accessToken, projectId, location, segmentSummaryQuery, baseParams),
  ]);

  const pointsBase: StripeAiSpendPoint[] = summaryRows.map((row) => ({
    key: asString(row.period_key),
    label: asString(row.period_label),
    periodStart: asString(row.period_start),
    periodEnd: asString(row.period_end),
    revenue: Math.max(0, asNumber(row.revenue)),
    lineCount: asInt(row.line_count),
    customerCount: asInt(row.customer_count),
  }));
  const points: StripeAiSpendPoint[] = applyFixedAiSpendAdjustmentsToPoints(pointsBase);

  const topCustomers: StripeAiSpendGroupRow[] = topCustomersRows.map((row) => ({
    key: asString(row.group_key) || "(blank)",
    label: asString(row.group_label) || "(blank)",
    revenue: Math.max(0, asNumber(row.revenue)),
    lineCount: asInt(row.line_count),
  }));

  const topProducts: StripeAiSpendGroupRow[] = topProductsRows.map((row) => ({
    key: asString(row.group_key) || "(blank)",
    label: asString(row.group_label) || "(blank)",
    revenue: Math.max(0, asNumber(row.revenue)),
    lineCount: asInt(row.line_count),
  }));

  const topPrices: StripeAiSpendPriceRow[] = topPricesRows.map((row) => ({
    priceId: asString(row.price_id) || "(blank)",
    priceLabel: asString(row.price_label) || "(blank)",
    productId: asString(row.product_id) || "(blank)",
    productLabel: asString(row.product_label) || "(blank)",
    revenue: Math.max(0, asNumber(row.revenue)),
    lineCount: asInt(row.line_count),
  }));

  const detailRows: StripeAiSpendDetailRow[] = detailRowsRaw.map((row) => ({
    invoiceDate: asString(row.invoice_date),
    customerId: asString(row.customer_id),
    customerName: asString(row.customer_name),
    lineItemId: asString(row.line_item_id),
    lineItemDescription: asString(row.line_item_description),
    priceId: asString(row.price_id),
    priceLabel: asString(row.price_label),
    productId: asString(row.product_id),
    productLabel: asString(row.product_label),
    revenue: Math.max(0, asNumber(row.revenue)),
    quantity: asNumber(row.quantity),
  }));
  const segmentSummaryRow = segmentSummaryRows[0] || {};
  const meteredRevenueSalesled = round2(Math.max(0, asNumber(segmentSummaryRow.metered_revenue_salesled)));
  const meteredRevenueSelfserveBase = round2(Math.max(0, asNumber(segmentSummaryRow.metered_revenue_selfserve)));

  const totalRevenue = Math.max(0, points.reduce((sum, point) => sum + point.revenue, 0));
  const baseTotalRevenue = Math.max(0, pointsBase.reduce((sum, point) => sum + point.revenue, 0));
  const fixedAdjustmentDelta = round2(totalRevenue - baseTotalRevenue);
  const meteredRevenueSelfserve = round2(Math.max(0, meteredRevenueSelfserveBase + fixedAdjustmentDelta));

  return {
    snapshotDate,
    startDate: startDateIso,
    endDate: endDateIso,
    grain,
    targetCurrency: targetCurrency.toUpperCase(),
    totalRevenue,
    meteredRevenueSalesled,
    meteredRevenueSelfserve,
    points,
    topCustomers,
    topProducts,
    topPrices,
    detailRows,
  };
}

export async function queryStripeAiSpendDailyAnnualizedFromUpcomingSnapshotsFromBigQuery(
  request: StripeAiSpendDailyAnnualizedFromUpcomingSnapshotsRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeAiSpendDailyAnnualizedFromUpcomingSnapshotsResult> {
  const startDate = parseIsoDateUtc(request.startDate);
  const endDate = parseIsoDateUtc(request.endDate);
  if (!startDate || !endDate) {
    throw new Error("Invalid startDate/endDate");
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("endDate must be >= startDate");
  }

  const startDateIso = startDate.toISOString().slice(0, 10);
  const endDateIso = endDate.toISOString().slice(0, 10);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const includes = Array.from(
    new Set(
      (request.productDescriptionIncludes || [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const excludedCustomerMonthPairs = Array.from(
    new Set(
      (request.excludeCustomerMonthPairs || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  const prepaidOffsetByCustomerMonthPairs = Array.from(
    (request.prepaidOffsetByCustomerMonthPairs || [])
      .map((entry) => {
        const pairKey = String(entry?.pairKey || "").trim();
        const prepaidAppliedMajor = Number(entry?.prepaidAppliedMajor || 0);
        if (!pairKey) return null;
        if (!Number.isFinite(prepaidAppliedMajor) || prepaidAppliedMajor <= 0) return null;
        return { pairKey, prepaidAppliedMajor };
      })
      .filter((entry): entry is { pairKey: string; prepaidAppliedMajor: number } => !!entry)
      .reduce((acc, entry) => {
        acc.set(entry.pairKey, (acc.get(entry.pairKey) || 0) + entry.prepaidAppliedMajor);
        return acc;
      }, new Map<string, number>()),
  ).map(([pairKey, prepaidAppliedMajor]) => ({
    pairKey,
    prepaidAppliedMajor: round2(prepaidAppliedMajor),
  }));

  if (!includes.length) {
    return {
      startDate: startDateIso,
      endDate: endDateIso,
      targetCurrency: targetCurrency.toUpperCase(),
      points: [],
    };
  }

  const profile = normalizeProfile(options?.profile);
  const table = getStripeUpcomingSnapshotsTable(profile);
  const productsTable = getStripeProductsTable(profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const descriptionTermsSql = includes.map(
    (_, idx) => `STRPOS(line_description_norm, @desc_${idx}) > 0`,
  );
  const productTermsSql = includes.map(
    (_, idx) => `STRPOS(LOWER(COALESCE(CAST(description AS STRING), CAST(name AS STRING), '')), @desc_${idx}) > 0`,
  );
  const excludedPairsCteSql = excludedCustomerMonthPairs.length
    ? `excluded_pairs AS (
  SELECT pair_key
  FROM UNNEST([${excludedCustomerMonthPairs.map((_, idx) => `@excluded_pair_${idx}`).join(", ")}]) AS pair_key
),`
    : `excluded_pairs AS (
  SELECT pair_key
  FROM UNNEST(CAST([] AS ARRAY<STRING>)) AS pair_key
),`;
  const excludedPairsWhereSql = excludedCustomerMonthPairs.length
    ? `    AND ml.pair_key NOT IN (SELECT pair_key FROM excluded_pairs)`
    : "";
  const prepaidOffsetsCteSql = prepaidOffsetByCustomerMonthPairs.length
    ? `prepaid_offsets AS (
  SELECT
    pair_key,
    CAST(prepaid_applied_major AS FLOAT64) AS prepaid_applied_major
  FROM UNNEST([${prepaidOffsetByCustomerMonthPairs
    .map(
      (_, idx) =>
        `STRUCT(@prepaid_pair_${idx} AS pair_key, CAST(@prepaid_pair_amount_${idx} AS FLOAT64) AS prepaid_applied_major)`,
    )
    .join(", ")}])
),`
    : `prepaid_offsets AS (
  SELECT pair_key, prepaid_applied_major
  FROM UNNEST(CAST([] AS ARRAY<STRUCT<pair_key STRING, prepaid_applied_major FLOAT64>>))
),`;

  const query = `
WITH table_rows AS (
  SELECT
    t.snapshot_date,
    TIMESTAMP_TRUNC(
      COALESCE(
        CAST(t.snapshot_ts AS TIMESTAMP),
        TIMESTAMP(CAST(t.snapshot_date AS DATE))
      ),
      MINUTE
    ) AS snapshot_batch_ts,
    COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') AS customer_id,
    LOWER(COALESCE(CAST(t.description AS STRING), '')) AS line_description_norm,
    COALESCE(NULLIF(TRIM(CAST(t.product_id AS STRING)), ''), '(blank)') AS product_id,
    GREATEST(
      CAST(COALESCE(t.amount_minor, 0) AS FLOAT64) -
      COALESCE(
        (
          SELECT
            SUM(COALESCE(SAFE_CAST(JSON_VALUE(discount_item, '$.amount') AS FLOAT64), 0.0))
          FROM UNNEST(
            COALESCE(
              JSON_QUERY_ARRAY(t.raw_json, '$.discount_amounts'),
              CAST([] AS ARRAY<STRING>)
            )
          ) AS discount_item
        ),
        0.0
      ),
      0.0
    ) / 100.0 AS amount_major,
    CAST(t.period_start AS TIMESTAMP) AS period_start,
    CAST(t.period_end AS TIMESTAMP) AS period_end
  FROM \`${table}\` AS t
  WHERE
    t.snapshot_date BETWEEN DATE(@start_date) AND DATE(@end_date)
    AND LOWER(COALESCE(CAST(t.currency AS STRING), '')) = @target_currency
    AND CAST(COALESCE(t.amount_minor, 0) AS FLOAT64) > 0
    AND t.period_start IS NOT NULL
    AND t.period_end IS NOT NULL
),
latest_snapshot_by_day AS (
  SELECT
    CAST(snapshot_date AS STRING) AS snapshot_date,
    MAX(snapshot_batch_ts) AS snapshot_batch_ts
  FROM table_rows
  GROUP BY snapshot_date
),
ai_products AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS product_id
  FROM \`${productsTable}\`
  WHERE ${productTermsSql.join(" OR ")}
),
${excludedPairsCteSql}
${prepaidOffsetsCteSql}
matched_lines_raw AS (
  SELECT
    ls.snapshot_date,
    ls.snapshot_batch_ts,
    t.customer_id,
    t.amount_major,
    t.line_description_norm,
    t.period_start,
    t.period_end,
    CONCAT(t.customer_id, '|', SUBSTR(ls.snapshot_date, 1, 7)) AS pair_key
  FROM latest_snapshot_by_day ls
  JOIN table_rows t
    ON CAST(t.snapshot_date AS STRING) = ls.snapshot_date
    AND t.snapshot_batch_ts = ls.snapshot_batch_ts
  LEFT JOIN ai_products ap
    ON ap.product_id = t.product_id
  WHERE ((${descriptionTermsSql.join(" OR ")}) OR ap.product_id IS NOT NULL)
),
matched_lines_with_offsets AS (
  SELECT
    ml.*,
    COALESCE(po.prepaid_applied_major, 0.0) AS prepaid_applied_major,
    SUM(ml.amount_major) OVER (
      PARTITION BY ml.snapshot_date, ml.customer_id
      ORDER BY ml.period_start, ml.period_end, ml.amount_major DESC, ml.line_description_norm
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_amount_major,
    COALESCE(
      SUM(ml.amount_major) OVER (
        PARTITION BY ml.snapshot_date, ml.customer_id
        ORDER BY ml.period_start, ml.period_end, ml.amount_major DESC, ml.line_description_norm
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0.0
    ) AS prev_running_amount_major
  FROM matched_lines_raw ml
  LEFT JOIN prepaid_offsets po
    ON po.pair_key = ml.pair_key
  WHERE TRUE
${excludedPairsWhereSql}
),
line_with_multiplier AS (
  SELECT
    snapshot_date,
    snapshot_batch_ts,
    customer_id,
    amount_major AS amount_major_without_exclusions,
    GREATEST(
      amount_major - GREATEST(LEAST(running_amount_major, prepaid_applied_major) - prev_running_amount_major, 0.0),
      0.0
    ) AS amount_major_with_exclusions,
    CASE
      WHEN period_end <= period_start THEN 0.0
      WHEN TIMESTAMP(DATETIME_ADD(DATETIME(period_start, 'UTC'), INTERVAL 1 YEAR), 'UTC') = period_end THEN 1.0
      WHEN REGEXP_CONTAINS(
        TRIM(REGEXP_REPLACE(line_description_norm, r'\\s+', ' ')),
        r'ai tokens'
      )
      OR TRIM(REGEXP_REPLACE(line_description_norm, r'\\s+', ' ')) = 'web search and crawl' THEN 12.0
      WHEN TIMESTAMP(DATETIME_ADD(DATETIME(period_start, 'UTC'), INTERVAL 1 MONTH), 'UTC') = period_end THEN 12.0
      ELSE 12.0 * SAFE_DIVIDE(
        CAST(
          TIMESTAMP_DIFF(
            TIMESTAMP(DATE_ADD(DATE_TRUNC(DATE(period_start, 'UTC'), MONTH), INTERVAL 1 MONTH), 'UTC'),
            TIMESTAMP(DATE_TRUNC(DATE(period_start, 'UTC'), MONTH), 'UTC'),
            MILLISECOND
          ) AS FLOAT64
        ),
        NULLIF(CAST(TIMESTAMP_DIFF(period_end, period_start, MILLISECOND) AS FLOAT64), 0.0)
      )
    END AS annualization_multiplier
  FROM matched_lines_with_offsets
  WHERE amount_major > 0
)
SELECT
  snapshot_date,
  CAST(snapshot_batch_ts AS STRING) AS snapshot_timestamp_utc,
  ROUND(COALESCE(SUM(amount_major_without_exclusions * annualization_multiplier), 0.0), 2) AS annualized_arr_without_exclusions,
  ROUND(COALESCE(SUM(amount_major_with_exclusions * annualization_multiplier), 0.0), 2) AS annualized_arr,
  ROUND(
    GREATEST(
      COALESCE(SUM(amount_major_without_exclusions * annualization_multiplier), 0.0)
      - COALESCE(SUM(amount_major_with_exclusions * annualization_multiplier), 0.0),
      0.0
    ),
    2
  ) AS annualized_arr_excluded,
  COUNT(*) AS line_count,
  COUNT(DISTINCT customer_id) AS customer_count
FROM line_with_multiplier
GROUP BY snapshot_date, snapshot_batch_ts
ORDER BY snapshot_date ASC
`;

  const params: BigQueryNamedParameter[] = [
    { name: "start_date", type: "STRING", value: startDateIso },
    { name: "end_date", type: "STRING", value: endDateIso },
    { name: "target_currency", type: "STRING", value: targetCurrency },
    ...includes.map((term, idx) => ({ name: `desc_${idx}`, type: "STRING" as const, value: term })),
    ...excludedCustomerMonthPairs.map((pairKey, idx) => ({
      name: `excluded_pair_${idx}`,
      type: "STRING" as const,
      value: pairKey,
    })),
    ...prepaidOffsetByCustomerMonthPairs.flatMap((entry, idx) => [
      {
        name: `prepaid_pair_${idx}`,
        type: "STRING" as const,
        value: entry.pairKey,
      },
      {
        name: `prepaid_pair_amount_${idx}`,
        type: "STRING" as const,
        value: String(entry.prepaidAppliedMajor),
      },
    ]),
  ];
  const rows = await runBigQueryQueryRows(accessToken, projectId, location, query, params);
  const points: StripeAiSpendDailyAnnualizedFromUpcomingSnapshotsPoint[] = rows.map((row) => ({
    snapshotDate: asString(row.snapshot_date),
    snapshotTimestampUtc: asString(row.snapshot_timestamp_utc),
    annualizedArrWithoutExclusions: Math.max(0, asNumber(row.annualized_arr_without_exclusions)),
    annualizedArr: Math.max(0, asNumber(row.annualized_arr)),
    annualizedArrExcluded: Math.max(0, asNumber(row.annualized_arr_excluded)),
    lineCount: asInt(row.line_count),
    customerCount: asInt(row.customer_count),
  })).map((point) => {
    const annualizedAdjustment = fixedAiSpendAnnualizedAdjustmentForSnapshotDate(point.snapshotDate);
    if (Math.abs(annualizedAdjustment) <= 1e-9) return point;
    return {
      ...point,
      annualizedArrWithoutExclusions: round2(point.annualizedArrWithoutExclusions + annualizedAdjustment),
      annualizedArr: round2(point.annualizedArr + annualizedAdjustment),
      annualizedArrExcluded: round2(Math.max(0, point.annualizedArrExcluded)),
    };
  });

  return {
    startDate: startDateIso,
    endDate: endDateIso,
    targetCurrency: targetCurrency.toUpperCase(),
    points,
  };
}

export async function queryStripeAiSpendDailyAnnualizedCustomerBreakdownFromUpcomingSnapshotsFromBigQuery(
  request: StripeAiSpendDailyAnnualizedCustomerBreakdownRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeAiSpendDailyAnnualizedCustomerBreakdownResult> {
  const startDate = parseIsoDateUtc(request.startDate);
  const endDate = parseIsoDateUtc(request.endDate);
  if (!startDate || !endDate) {
    throw new Error("Invalid startDate/endDate");
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("endDate must be >= startDate");
  }

  const startDateIso = startDate.toISOString().slice(0, 10);
  const endDateIso = endDate.toISOString().slice(0, 10);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const includes = Array.from(
    new Set(
      (request.productDescriptionIncludes || [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const excludedCustomerMonthPairs = Array.from(
    new Set(
      (request.excludeCustomerMonthPairs || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  const prepaidOffsetByCustomerMonthPairs = Array.from(
    (request.prepaidOffsetByCustomerMonthPairs || [])
      .map((entry) => {
        const pairKey = String(entry?.pairKey || "").trim();
        const prepaidAppliedMajor = Number(entry?.prepaidAppliedMajor || 0);
        if (!pairKey) return null;
        if (!Number.isFinite(prepaidAppliedMajor) || prepaidAppliedMajor <= 0) return null;
        return { pairKey, prepaidAppliedMajor };
      })
      .filter((entry): entry is { pairKey: string; prepaidAppliedMajor: number } => !!entry)
      .reduce((acc, entry) => {
        acc.set(entry.pairKey, (acc.get(entry.pairKey) || 0) + entry.prepaidAppliedMajor);
        return acc;
      }, new Map<string, number>()),
  ).map(([pairKey, prepaidAppliedMajor]) => ({
    pairKey,
    prepaidAppliedMajor: round2(prepaidAppliedMajor),
  }));

  if (!includes.length) {
    return {
      startDate: startDateIso,
      endDate: endDateIso,
      targetCurrency: targetCurrency.toUpperCase(),
      rows: [],
    };
  }

  const profile = normalizeProfile(options?.profile);
  const table = getStripeUpcomingSnapshotsTable(profile);
  const productsTable = getStripeProductsTable(profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const descriptionTermsSql = includes.map(
    (_, idx) => `STRPOS(line_description_norm, @desc_${idx}) > 0`,
  );
  const productTermsSql = includes.map(
    (_, idx) => `STRPOS(LOWER(COALESCE(CAST(description AS STRING), CAST(name AS STRING), '')), @desc_${idx}) > 0`,
  );
  const excludedPairsCteSql = excludedCustomerMonthPairs.length
    ? `excluded_pairs AS (
  SELECT pair_key
  FROM UNNEST([${excludedCustomerMonthPairs.map((_, idx) => `@excluded_pair_${idx}`).join(", ")}]) AS pair_key
),`
    : `excluded_pairs AS (
  SELECT pair_key
  FROM UNNEST(CAST([] AS ARRAY<STRING>)) AS pair_key
),`;
  const excludedPairsWhereSql = excludedCustomerMonthPairs.length
    ? `    AND ml.pair_key NOT IN (SELECT pair_key FROM excluded_pairs)`
    : "";
  const prepaidOffsetsCteSql = prepaidOffsetByCustomerMonthPairs.length
    ? `prepaid_offsets AS (
  SELECT
    pair_key,
    CAST(prepaid_applied_major AS FLOAT64) AS prepaid_applied_major
  FROM UNNEST([${prepaidOffsetByCustomerMonthPairs
    .map(
      (_, idx) =>
        `STRUCT(@prepaid_pair_${idx} AS pair_key, CAST(@prepaid_pair_amount_${idx} AS FLOAT64) AS prepaid_applied_major)`,
    )
    .join(", ")}])
),`
    : `prepaid_offsets AS (
  SELECT pair_key, prepaid_applied_major
  FROM UNNEST(CAST([] AS ARRAY<STRUCT<pair_key STRING, prepaid_applied_major FLOAT64>>))
),`;

  const query = `
WITH table_rows AS (
  SELECT
    t.snapshot_date,
    TIMESTAMP_TRUNC(
      COALESCE(
        CAST(t.snapshot_ts AS TIMESTAMP),
        TIMESTAMP(CAST(t.snapshot_date AS DATE))
      ),
      MINUTE
    ) AS snapshot_batch_ts,
    COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)') AS customer_id,
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(TO_JSON_STRING(t), '$.customer_name')), ''),
      COALESCE(NULLIF(TRIM(CAST(t.customer_id AS STRING)), ''), '(blank)')
    ) AS customer_name,
    LOWER(COALESCE(CAST(t.description AS STRING), '')) AS line_description_norm,
    COALESCE(NULLIF(TRIM(CAST(t.product_id AS STRING)), ''), '(blank)') AS product_id,
    GREATEST(
      CAST(COALESCE(t.amount_minor, 0) AS FLOAT64) -
      COALESCE(
        (
          SELECT
            SUM(COALESCE(SAFE_CAST(JSON_VALUE(discount_item, '$.amount') AS FLOAT64), 0.0))
          FROM UNNEST(
            COALESCE(
              JSON_QUERY_ARRAY(t.raw_json, '$.discount_amounts'),
              CAST([] AS ARRAY<STRING>)
            )
          ) AS discount_item
        ),
        0.0
      ),
      0.0
    ) / 100.0 AS amount_major,
    CAST(t.period_start AS TIMESTAMP) AS period_start,
    CAST(t.period_end AS TIMESTAMP) AS period_end
  FROM \`${table}\` AS t
  WHERE
    t.snapshot_date BETWEEN DATE(@start_date) AND DATE(@end_date)
    AND LOWER(COALESCE(CAST(t.currency AS STRING), '')) = @target_currency
    AND CAST(COALESCE(t.amount_minor, 0) AS FLOAT64) > 0
    AND t.period_start IS NOT NULL
    AND t.period_end IS NOT NULL
),
latest_snapshot_by_day AS (
  SELECT
    CAST(snapshot_date AS STRING) AS snapshot_date,
    MAX(snapshot_batch_ts) AS snapshot_batch_ts
  FROM table_rows
  GROUP BY snapshot_date
),
ai_products AS (
  SELECT
    COALESCE(NULLIF(TRIM(CAST(id AS STRING)), ''), '(blank)') AS product_id
  FROM \`${productsTable}\`
  WHERE ${productTermsSql.join(" OR ")}
),
${excludedPairsCteSql}
${prepaidOffsetsCteSql}
matched_lines_raw AS (
  SELECT
    ls.snapshot_date,
    ls.snapshot_batch_ts,
    t.customer_id,
    t.customer_name,
    t.amount_major,
    t.line_description_norm,
    t.period_start,
    t.period_end,
    CONCAT(t.customer_id, '|', SUBSTR(ls.snapshot_date, 1, 7)) AS pair_key
  FROM latest_snapshot_by_day ls
  JOIN table_rows t
    ON CAST(t.snapshot_date AS STRING) = ls.snapshot_date
    AND t.snapshot_batch_ts = ls.snapshot_batch_ts
  LEFT JOIN ai_products ap
    ON ap.product_id = t.product_id
  WHERE ((${descriptionTermsSql.join(" OR ")}) OR ap.product_id IS NOT NULL)
),
matched_lines_with_offsets AS (
  SELECT
    ml.*,
    COALESCE(po.prepaid_applied_major, 0.0) AS prepaid_applied_major,
    SUM(ml.amount_major) OVER (
      PARTITION BY ml.snapshot_date, ml.customer_id
      ORDER BY ml.period_start, ml.period_end, ml.amount_major DESC, ml.line_description_norm
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_amount_major,
    COALESCE(
      SUM(ml.amount_major) OVER (
        PARTITION BY ml.snapshot_date, ml.customer_id
        ORDER BY ml.period_start, ml.period_end, ml.amount_major DESC, ml.line_description_norm
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0.0
    ) AS prev_running_amount_major
  FROM matched_lines_raw ml
  LEFT JOIN prepaid_offsets po
    ON po.pair_key = ml.pair_key
  WHERE TRUE
${excludedPairsWhereSql}
),
line_with_multiplier AS (
  SELECT
    snapshot_date,
    snapshot_batch_ts,
    customer_id,
    customer_name,
    amount_major AS amount_major_without_exclusions,
    GREATEST(
      amount_major - GREATEST(LEAST(running_amount_major, prepaid_applied_major) - prev_running_amount_major, 0.0),
      0.0
    ) AS amount_major_with_exclusions,
    CASE
      WHEN period_end <= period_start THEN 0.0
      WHEN TIMESTAMP(DATETIME_ADD(DATETIME(period_start, 'UTC'), INTERVAL 1 YEAR), 'UTC') = period_end THEN 1.0
      WHEN REGEXP_CONTAINS(
        TRIM(REGEXP_REPLACE(line_description_norm, r'\\s+', ' ')),
        r'ai tokens'
      )
      OR TRIM(REGEXP_REPLACE(line_description_norm, r'\\s+', ' ')) = 'web search and crawl' THEN 12.0
      WHEN TIMESTAMP(DATETIME_ADD(DATETIME(period_start, 'UTC'), INTERVAL 1 MONTH), 'UTC') = period_end THEN 12.0
      ELSE 12.0 * SAFE_DIVIDE(
        CAST(
          TIMESTAMP_DIFF(
            TIMESTAMP(DATE_ADD(DATE_TRUNC(DATE(period_start, 'UTC'), MONTH), INTERVAL 1 MONTH), 'UTC'),
            TIMESTAMP(DATE_TRUNC(DATE(period_start, 'UTC'), MONTH), 'UTC'),
            MILLISECOND
          ) AS FLOAT64
        ),
        NULLIF(CAST(TIMESTAMP_DIFF(period_end, period_start, MILLISECOND) AS FLOAT64), 0.0)
      )
    END AS annualization_multiplier
  FROM matched_lines_with_offsets
  WHERE amount_major > 0
)
SELECT
  snapshot_date,
  CAST(snapshot_batch_ts AS STRING) AS snapshot_timestamp_utc,
  customer_id,
  customer_name,
  ROUND(COALESCE(SUM(amount_major_without_exclusions * annualization_multiplier), 0.0), 2) AS annualized_arr_without_exclusions,
  ROUND(COALESCE(SUM(amount_major_with_exclusions * annualization_multiplier), 0.0), 2) AS annualized_arr,
  ROUND(
    GREATEST(
      COALESCE(SUM(amount_major_without_exclusions * annualization_multiplier), 0.0)
      - COALESCE(SUM(amount_major_with_exclusions * annualization_multiplier), 0.0),
      0.0
    ),
    2
  ) AS annualized_arr_excluded,
  COUNT(*) AS line_count
FROM line_with_multiplier
GROUP BY snapshot_date, snapshot_batch_ts, customer_id, customer_name
ORDER BY snapshot_date ASC, annualized_arr DESC, customer_id ASC
`;

  const params: BigQueryNamedParameter[] = [
    { name: "start_date", type: "STRING", value: startDateIso },
    { name: "end_date", type: "STRING", value: endDateIso },
    { name: "target_currency", type: "STRING", value: targetCurrency },
    ...includes.map((term, idx) => ({ name: `desc_${idx}`, type: "STRING" as const, value: term })),
    ...excludedCustomerMonthPairs.map((pairKey, idx) => ({
      name: `excluded_pair_${idx}`,
      type: "STRING" as const,
      value: pairKey,
    })),
    ...prepaidOffsetByCustomerMonthPairs.flatMap((entry, idx) => [
      {
        name: `prepaid_pair_${idx}`,
        type: "STRING" as const,
        value: entry.pairKey,
      },
      {
        name: `prepaid_pair_amount_${idx}`,
        type: "STRING" as const,
        value: String(entry.prepaidAppliedMajor),
      },
    ]),
  ];
  const rowsRaw = await runBigQueryQueryRows(accessToken, projectId, location, query, params);
  const baseRows: StripeAiSpendDailyAnnualizedCustomerBreakdownRow[] = rowsRaw.map((row) => ({
    snapshotDate: asString(row.snapshot_date),
    snapshotTimestampUtc: asString(row.snapshot_timestamp_utc),
    customerId: asString(row.customer_id) || "(blank)",
    customerName: asString(row.customer_name) || "(blank)",
    annualizedArrWithoutExclusions: Math.max(0, asNumber(row.annualized_arr_without_exclusions)),
    annualizedArr: Math.max(0, asNumber(row.annualized_arr)),
    annualizedArrExcluded: Math.max(0, asNumber(row.annualized_arr_excluded)),
    lineCount: asInt(row.line_count),
  }));
  const rows = baseRows;

  return {
    startDate: startDateIso,
    endDate: endDateIso,
    targetCurrency: targetCurrency.toUpperCase(),
    rows,
  };
}

export async function queryStripeUpcomingProjectedArrFromBigQuery(
  request: StripeUpcomingProjectedArrRequest,
  options?: StripeBigQueryOptions,
): Promise<StripeUpcomingProjectedArrResult> {
  const monthStart = parseIsoDateUtc(request.monthStartDate);
  const nextMonthStart = parseIsoDateUtc(request.nextMonthStartDate);
  if (!monthStart || !nextMonthStart) {
    throw new Error("Invalid monthStartDate/nextMonthStartDate");
  }
  if (nextMonthStart.getTime() <= monthStart.getTime()) {
    throw new Error("nextMonthStartDate must be > monthStartDate");
  }

  const monthStartIso = monthStart.toISOString().slice(0, 10);
  const nextMonthStartIso = nextMonthStart.toISOString().slice(0, 10);
  const targetCurrency = String(request.targetCurrency || "usd").trim().toLowerCase() || "usd";
  const profile = normalizeProfile(options?.profile);
  const table = getStripeUpcomingSnapshotsTable(profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const snapshotKeyExpr = "CAST(t.snapshot_date AS STRING)";
  const snapshotTsExpr = buildUpcomingSnapshotTimestampSql("t.snapshot_ts", "t.snapshot_date");

  const latestSnapshotRows = await runBigQueryQueryRows(
    accessToken,
    projectId,
    location,
    `
WITH table_rows AS (
  SELECT
    ${snapshotKeyExpr} AS snapshot_key,
    ${snapshotTsExpr} AS snapshot_ts
  FROM \`${table}\` AS t
),
latest_snapshot AS (
  SELECT snapshot_key, snapshot_batch_ts
  FROM (
    SELECT DISTINCT
      snapshot_key,
      TIMESTAMP_TRUNC(snapshot_ts, MINUTE) AS snapshot_batch_ts
    FROM table_rows
  )
  ORDER BY snapshot_batch_ts DESC, snapshot_key DESC
  LIMIT 1
)
SELECT
  snapshot_key AS snapshot_date,
  CAST(snapshot_batch_ts AS STRING) AS snapshot_batch_ts
FROM latest_snapshot
`,
    [],
  );
  const snapshotDate = asString(latestSnapshotRows[0]?.snapshot_date);
  const snapshotBatchTs = asString(latestSnapshotRows[0]?.snapshot_batch_ts);
  if (!snapshotDate) {
    return {
      snapshotDate: "",
      lineCount: 0,
      amountMajorSum: 0,
      projectedArr: 0,
      targetCurrency: targetCurrency.toUpperCase(),
    };
  }

  const lineQuery = `
SELECT
  CAST(amount_minor AS FLOAT64) AS amount_minor,
  CAST(description AS STRING) AS description,
  CAST(UNIX_MILLIS(period_start) AS INT64) AS period_start_ts,
  CAST(UNIX_MILLIS(period_end) AS INT64) AS period_end_ts
FROM \`${table}\`
WHERE
  CAST(snapshot_date AS STRING) = @snapshot_date
  AND (
    TIMESTAMP_TRUNC(${buildUpcomingSnapshotTimestampSql("snapshot_ts", "snapshot_date")}, MINUTE) =
      SAFE_CAST(@snapshot_batch_ts AS TIMESTAMP)
    OR (
      ${buildUpcomingSnapshotTimestampSql("snapshot_ts", "snapshot_date")} IS NULL
      AND @snapshot_batch_ts = ''
    )
  )
  AND period_start >= TIMESTAMP(@month_start_date)
  AND period_start < TIMESTAMP(@next_month_start_date)
  AND LOWER(COALESCE(CAST(currency AS STRING), '')) = @target_currency
`;
  const params: BigQueryNamedParameter[] = [
    { name: "snapshot_date", type: "STRING", value: snapshotDate },
    { name: "snapshot_batch_ts", type: "STRING", value: snapshotBatchTs },
    { name: "month_start_date", type: "STRING", value: monthStartIso },
    { name: "next_month_start_date", type: "STRING", value: nextMonthStartIso },
    { name: "target_currency", type: "STRING", value: targetCurrency },
  ];
  const rows = await runBigQueryQueryRows(accessToken, projectId, location, lineQuery, params);

  let amountMajorSum = 0;
  let projectedArr = 0;
  for (const row of rows) {
    const amountMajor = asNumber(row.amount_minor) / 100;
    const periodStartTs = asNumber(row.period_start_ts);
    const periodEndTs = asNumber(row.period_end_ts);
    const multiplier = annualizationMultiplierForUpcomingLine(
      periodStartTs,
      periodEndTs,
      asString(row.description),
      profile,
    );
    amountMajorSum += amountMajor;
    projectedArr += amountMajor * multiplier;
  }

  return {
    snapshotDate,
    lineCount: rows.length,
    amountMajorSum: round2(amountMajorSum),
    projectedArr: round2(projectedArr),
    targetCurrency: targetCurrency.toUpperCase(),
  };
}

export async function cleanupStripeUpcomingSnapshotsForDay(
  request: StripeUpcomingSnapshotsCleanupRequest = {},
  options?: StripeBigQueryOptions,
): Promise<StripeUpcomingSnapshotsCleanupResult> {
  const profile = normalizeProfile(options?.profile);
  const table = getStripeUpcomingSnapshotsTable(profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);

  const nowUtc = new Date();
  const targetDateUtc = request.targetDate
    ? parseIsoDateUtc(request.targetDate)
    : new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 0, 0, 0, 0));
  if (!targetDateUtc) {
    throw new Error("Invalid targetDate (expected YYYY-MM-DD)");
  }
  const targetDate = isoDateFromUtcDate(targetDateUtc);
  const dryRun = !!request.dryRun;

  const snapshotKeyExpr = "CAST(snapshot_date AS STRING)";
  const snapshotTsExpr = buildUpcomingSnapshotTimestampSql("snapshot_ts", "snapshot_date");
  const snapshotBatchExpr = `TIMESTAMP_TRUNC(${snapshotTsExpr}, MINUTE)`;
  const snapshotDayExpr = `COALESCE(
  DATE(${snapshotBatchExpr}),
  DATE(${snapshotTsExpr}),
  SAFE.PARSE_DATE('%Y%m%d', ${snapshotKeyExpr}),
  SAFE_CAST(${snapshotKeyExpr} AS DATE)
)`;

  const latestSnapshotQuery = `
SELECT snapshot_key, CAST(snapshot_batch_ts AS STRING) AS snapshot_batch_ts
FROM (
  SELECT DISTINCT
    ${snapshotKeyExpr} AS snapshot_key,
    ${snapshotBatchExpr} AS snapshot_batch_ts,
    ${snapshotDayExpr} AS snapshot_day
  FROM \`${table}\`
)
WHERE snapshot_day = @target_date
ORDER BY snapshot_batch_ts DESC, snapshot_key DESC
LIMIT 1
`;
  const latestSnapshotRows = await runBigQueryQueryRows(accessToken, projectId, location, latestSnapshotQuery, [
    { name: "target_date", type: "STRING", value: targetDate },
  ]);
  const latestSnapshotKey = asString(latestSnapshotRows[0]?.snapshot_key);
  const latestSnapshotBatchTs = asString(latestSnapshotRows[0]?.snapshot_batch_ts);

  if (!latestSnapshotKey) {
    return {
      profile,
      table,
      targetDate,
      latestSnapshotKey: "",
      candidateRows: 0,
      deletedRows: 0,
      dryRun,
    };
  }

  const params: BigQueryNamedParameter[] = [
    { name: "target_date", type: "STRING", value: targetDate },
    { name: "latest_snapshot_key", type: "STRING", value: latestSnapshotKey },
    { name: "latest_snapshot_batch_ts", type: "STRING", value: latestSnapshotBatchTs },
  ];

  const candidateCountQuery = `
SELECT COUNT(*) AS row_count
FROM \`${table}\`
WHERE
  ${snapshotDayExpr} = @target_date
  AND (
    ${snapshotKeyExpr} != @latest_snapshot_key
    OR NOT (
      ${snapshotBatchExpr} = SAFE_CAST(@latest_snapshot_batch_ts AS TIMESTAMP)
      OR (${snapshotBatchExpr} IS NULL AND @latest_snapshot_batch_ts = '')
    )
  )
`;
  const candidateRows = await runBigQueryQueryRows(accessToken, projectId, location, candidateCountQuery, params);
  const candidateCount = asInt(candidateRows[0]?.row_count);

  if (!dryRun && candidateCount > 0) {
    const deleteQuery = `
DELETE FROM \`${table}\`
WHERE
  ${snapshotDayExpr} = @target_date
  AND (
    ${snapshotKeyExpr} != @latest_snapshot_key
    OR NOT (
      ${snapshotBatchExpr} = SAFE_CAST(@latest_snapshot_batch_ts AS TIMESTAMP)
      OR (${snapshotBatchExpr} IS NULL AND @latest_snapshot_batch_ts = '')
    )
  )
`;
    await runBigQueryQueryRows(accessToken, projectId, location, deleteQuery, params);
  }

  return {
    profile,
    table,
    targetDate,
    latestSnapshotKey,
    candidateRows: candidateCount,
    deletedRows: dryRun ? 0 : candidateCount,
    dryRun,
  };
}

export async function loadStripeLineItemsFromBigQuery(
  startTsMs: number,
  endTsMs: number,
  filters?: StripeBigQueryFilters,
  options?: StripeBigQueryOptions,
): Promise<SyncedStripeLineItem[]> {
  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");

  const sourceConfig = getBigQuerySourceConfig(profile);
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const rangeStart = toQueryTimestamp(startTsMs, sourceConfig);
  const rangeEnd = toQueryTimestamp(endTsMs, sourceConfig);

  const accessToken = await getAccessToken(sa);
  const built = sourceConfig.servingTable
    ? sourceConfig.servingSchemaMode === "int"
      ? buildServingQueryIntColumns(sourceConfig.servingTable, filters)
      : buildServingQueryTimestampColumns(sourceConfig.servingTable, filters)
    : { query: buildQuery(sourceConfig.table), filterParams: [] as BigQueryNamedParameter[] };
  const query = built.query;
  const extraParams = built.filterParams;
  const queryParams: BigQueryNamedParameter[] = [
    { name: "range_start_ts", type: "INT64", value: String(rangeStart) },
    { name: "range_end_ts", type: "INT64", value: String(rangeEnd) },
    ...extraParams,
  ];

  const out: SyncedStripeLineItem[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;

  while (true) {
    let json = await fetchBigQueryResultsPage(
      accessToken,
      projectId,
      location,
      query,
      queryParams,
      pageToken,
    );
    if (!json.jobComplete && json.jobReference?.jobId) {
      const jobProjectId = json.jobReference.projectId || projectId;
      const jobLocation = json.jobReference.location || location;
      json = await waitForJobCompletion(accessToken, jobProjectId, json.jobReference.jobId, jobLocation);
    }

    const fields = (json.schema?.fields || []).map((f) => f.name);
    for (const row of json.rows || []) {
      const obj = rowToObject(fields, row);
      const item = mapBigQueryRowToSyncedItem(obj, sourceConfig.tsMultiplier);
      const dedupeKey = [
        item.invoiceId,
        item.lineItemId,
        String(item.periodStartTs),
        String(item.periodEndTs),
        String(item.amountMinor),
      ].join("|");
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push(item);
    }

    if (!json.pageToken) break;
    pageToken = json.pageToken;
  }

  return out;
}

export type BigQuerySqlParameter = {
  name: string;
  type: "INT64" | "STRING";
  value: string;
};

export async function runBigQuerySqlRows(
  query: string,
  params: BigQuerySqlParameter[] = [],
  options?: StripeBigQueryOptions,
) {
  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  return runBigQueryQueryRows(accessToken, projectId, location, query, params);
}

export async function runBigQuerySqlStatement(
  query: string,
  params: BigQuerySqlParameter[] = [],
  options?: StripeBigQueryOptions,
) {
  await runBigQuerySqlRows(query, params, options);
}

export type BigQueryStartedJob = {
  projectId: string;
  jobId: string;
  location: string;
};

export async function startBigQuerySqlStatement(
  query: string,
  params: BigQuerySqlParameter[] = [],
  options?: StripeBigQueryOptions,
): Promise<BigQueryStartedJob> {
  const profile = normalizeProfile(options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const location = readEnv("BIGQUERY_LOCATION", profile) || "US";
  const accessToken = await getAccessToken(sa);
  const queryParameters = params.map((parameter) => ({
    name: parameter.name,
    parameterType: { type: parameter.type },
    parameterValue: { value: parameter.value },
  }));

  const response = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/jobs`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobReference: { projectId, location },
        configuration: {
          query: {
            query,
            useLegacySql: false,
            parameterMode: "NAMED",
            queryParameters,
          },
        },
      }),
      cache: "no-store",
    },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`BigQuery start job error ${response.status}: ${text}`);
  const payload = JSON.parse(text) as {
    jobReference?: { projectId?: string; jobId?: string; location?: string };
    status?: { errorResult?: { message?: string } };
  };
  if (payload.status?.errorResult) {
    throw new Error(payload.status.errorResult.message || "BigQuery rejected the query job");
  }
  const jobId = String(payload.jobReference?.jobId || "").trim();
  if (!jobId) throw new Error("BigQuery did not return a job ID");
  return {
    projectId: String(payload.jobReference?.projectId || projectId),
    jobId,
    location: String(payload.jobReference?.location || location),
  };
}

export async function insertBigQueryRows(params: {
  projectId?: string;
  dataset: string;
  table: string;
  rows: Array<Record<string, unknown>>;
  options?: StripeBigQueryOptions;
}) {
  const profile = normalizeProfile(params.options?.profile);
  const sa = getServiceAccount(profile);
  const projectId = String(params.projectId || "").trim() || readEnv("BIGQUERY_PROJECT_ID", profile) || sa.project_id;
  if (!projectId) throw new Error("Missing BIGQUERY_PROJECT_ID (or project_id in service account JSON)");
  const accessToken = await getAccessToken(sa);

  const response = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(params.dataset)}/tables/${encodeURIComponent(params.table)}/insertAll`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: "bigquery#tableDataInsertAllRequest",
        skipInvalidRows: false,
        ignoreUnknownValues: false,
        rows: (params.rows || []).map((row, idx) => ({
          insertId: `${Date.now()}-${idx}`,
          json: row,
        })),
      }),
      cache: "no-store",
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`BigQuery insertAll error ${response.status}: ${text}`);
  }
  const parsed = text ? (JSON.parse(text) as { insertErrors?: Array<{ errors?: Array<{ message?: string }> }> }) : {};
  const errors = Array.isArray(parsed.insertErrors) ? parsed.insertErrors : [];
  if (errors.length > 0) {
    const message = errors
      .flatMap((entry) => entry.errors || [])
      .map((entry) => String(entry.message || "").trim())
      .filter(Boolean)
      .join("; ");
    throw new Error(`BigQuery insertAll reported row errors${message ? `: ${message}` : ""}`);
  }
}
