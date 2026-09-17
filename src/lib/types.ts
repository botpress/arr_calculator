// lib/types.ts

export type HubspotSearchResponse<T> = {
  results: T[];
  paging?: { next?: { after?: string } };
};

export type HubspotDeal = {
  id: string;
  properties?: Record<string, unknown>;
};

export type HubspotCompany = {
  id: string;
  properties?: Record<string, unknown>;
};

export type HubspotContact = {
  id: string;
  properties?: Record<string, unknown>;
};

export type HubspotLineItem = {
  id: string;
  properties?: HubspotLineItemProps;
};

export type HubspotLineItemProps = {
  hs_recurring_billing_start_date?: unknown;
  hs_recurring_billing_end_date?: unknown;
  hs_billing_period_start_date?: unknown;
  hs_billing_period_end_date?: unknown;
  hs_term_in_months?: unknown;
  hs_recurring_billing_period?: unknown;
  hs_recurring_billing_number_of_payments?: unknown;
  hs_recurring_billing_terms?: unknown;

  amount?: unknown;
  net_price?: unknown;
  quantity?: unknown;

  recurringbillingfrequency?: unknown;
  name?: unknown;
  description?: unknown;
  hs_product_name?: unknown;
  hs_sku?: unknown;
};

export type HubspotPlan = "enterprise" | "managed" | "team" | "other";

export type ReportMode = "arr" | "contracted";
export type Grain = "daily" | "monthly" | "quarterly" | "annually";

export type ReportRequest = {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  mode: ReportMode;
  grain: Grain;
  contractedIncludeAllDeals?: boolean;
};

export type ReportRow = {
  dealName: string;
  dealId: string;
  lineItemId: string;

  valueUsd: number; // ARR or Contracted ARR in USD for the line item (annualized)
  dealCurrency: string;
  fxRate: number | null;
  fxDateUsed: string;

  dealType?: string;
  plan?: HubspotPlan;
  closeDate?: string;

  windowStart?: string;
  windowEnd?: string; // "OPEN" or date string
  isOpenEnded: boolean;

  recurringbillingfrequency: string;
  termMonths: number | null;
  amount: number | null;
  netPrice: number | null;
  quantity: number;

  valuesByPeriod: Record<string, number>;
  deploymentType?: string;
  accountId?: string;
  accountName?: string;
  workspaceId?: string;
  deliveryStage?: string;
  territory?: string;
  country?: string;
  companyCountry?: string;
  industry?: string;
  companySegment?: string;
  primaryProjectType?: string;
  customerSupportApplication?: string;
  lineItemDescription?: string;
  groupValues?: Record<string, string>;

};

export type ReportResponse = {
  periods: { key: string; label: string }[];
  totalsByPeriod: { key: string; label: string; total: number }[];
  mrrChangeTotalsByPeriod?: { key: string; label: string; total: number }[];
  rows: ReportRow[];
  pagination?: {
    page: number;
    pageSize: number;
    returnedRows: number;
    sourceReturnedRows?: number;
    totalRows?: number;
    totalPages?: number;
    hasMore?: boolean;
    sourcePaged: boolean;
  };
};
