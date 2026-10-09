export const TEAM_SCORECARD_KEYS = [
  "engineering",
  "product",
  "sales",
  "account-management",
  "delivery",
  "support",
  "marketing",
  "finance",
  "people-ops",
] as const;

export type TeamScorecardKey = (typeof TEAM_SCORECARD_KEYS)[number];

export type TeamScorecardMetricDefinition = {
  id: string;
  label: string;
  target: string;
  owner: string;
  frequency: string;
  financeTracking: string;
  notes: string;
};

export type TeamScorecardDefinition = {
  key: TeamScorecardKey;
  name: string;
  description: string;
  metrics: TeamScorecardMetricDefinition[];
};

const metric = (
  id: string,
  label: string,
  frequency: string,
  financeTracking: string,
  options: Partial<Pick<TeamScorecardMetricDefinition, "target" | "owner" | "notes">> = {},
): TeamScorecardMetricDefinition => ({
  id,
  label,
  target: options.target || "",
  owner: options.owner || "",
  frequency,
  financeTracking,
  notes: options.notes || "",
});

export const TEAM_SCORECARD_DEFINITIONS: TeamScorecardDefinition[] = [
  {
    key: "engineering",
    name: "Engineering",
    description: "Reliability, delivery velocity, and infrastructure efficiency.",
    metrics: [
      metric("platform-uptime", "Platform uptime", "Monthly", "no"),
      metric("incident-count", "Incident count by severity", "Monthly", "no"),
      metric("mttr", "Mean time to recovery (MTTR)", "Monthly", "no"),
      metric("cycle-time", "Cycle time (commit → production)", "Monthly", "no"),
      metric("customer-bugs", "Bugs reported by customers", "Monthly", "no"),
      metric("infra-cost-per-workspace", "Infra cost per active workspace by plan", "Monthly", "yes"),
      metric("infra-software-percent-revenue", "Infrastructure software cost as % of revenue", "", ""),
      metric("infra-engineering-software-percent-revenue", "Infrastructure and engineering software cost as % of revenue", "Monthly", "yes"),
      metric("llm-cost-per-bot", "LLM cost per bot, and avg per plan", "Monthly", "yes", { notes: "Siya to calculate" }),
    ],
  },
  {
    key: "product",
    name: "Product",
    description: "Activation, product engagement, automated resolution, and retention.",
    metrics: [
      metric("selfserve-activation", "selfserve Activation rate", "Monthly", "need to define", { notes: "number of support tickets" }),
      metric("auto-resolution", "Average auto-resolution rate", "Monthly", "no", { notes: "recording it is messy right now, but useful metric" }),
      metric("churn-by-motion", "Churn - show by Product Led, Sales Led -> ARR + logos", "Monthly", "yes", { notes: "types of bot created (ADK, managed, viber, studio, otto)" }),
      metric("active-workspace", "Daily Active Workspace % at 30/60/90 days", "Monthly", "yes", { notes: "not important, because as were moving upmarket we may have less customers" }),
      metric("selfserve-nrr", "Selfserve NRR", "", ""),
      metric("net-revenue-retention", "Net Revenue Retention", "Monthly", "yes"),
      metric("selfserve-resolution", "Self Serve - Conversation Resolution Rate", "Realtime", ""),
    ],
  },
  {
    key: "sales",
    name: "Sales",
    description: "ARR production, pipeline creation, conversion, and ISR execution.",
    metrics: [
      metric("arr-new-expansion", "ARR (new + expansion) vs plan", "Daily", "yes"),
      metric("pipeline-generated", "Pipeline generated (deals created and total ARR)", "Weekly", "yes"),
      metric("isr-quota-attainment", "ISR quota attainment", "Monthly", "yes"),
      metric("sales-led-close-rate", "Close rate on sales-led pipeline", "Monthly", "yes"),
      metric("meetings-booked", "Meetings booked (inbound and then outbound)", "Weekly", "not sure"),
      metric("mql-to-sql", "MQL → SQL conversion rate", "Weekly", "yes"),
      metric("lead-to-close", "Lead to close cycle", "Monthly", "not sure"),
      metric("desk-pipeline-customers", "Desk pipeline + paying customers vs 100 target", "Monthly", "yes"),
      metric("ai-workflow-pipeline", "AI Workflow pipeline generated (voice/chatbot/after-hours)", "Monthly", "not sure"),
      metric("isr-activity", "ISR activity (total touches, speed to lead, multi-threading/contacts added)", "Monthly", "not sure"),
    ],
  },
  {
    key: "account-management",
    name: "Account Management",
    description: "Renewals, book coverage, expansion, and net revenue retention.",
    metrics: [
      metric("renewal-rate", "Renewal Rate", "Monthly", "yes"),
      metric("accounts-arr-per-am", "Accounts/ARR per AM", "Monthly", "yes"),
      metric("sales-led-expansion", "Salesled Expansion Revenue", "Monthly", "yes"),
      metric("nrr-by-am", "NRR for book of business -> by rep + aggregate team book", "Monthly", "yes"),
    ],
  },
  {
    key: "delivery",
    name: "Delivery",
    description: "Implementation speed, scope discipline, activation, quality, and margin.",
    metrics: [
      metric("bot-delivery-time", "Avg time of delivery for a bot", "Monthly", "no"),
      metric("scope-creep", "Scope Creep Rate (% of projects exceeding estimated hours)", "Monthly", "no", { notes: "needs time tracking..." }),
      metric("sales-led-activation-rate", "Sales led -> % of customer activated", "Monthly", "need to defined activated customer", { notes: "who owns enterprise activation? which team?" }),
      metric("sales-led-activation-time", "Sales led - time to activation", "Monthly", "need to defined activated customer"),
      metric("delivery-margin", "Delivery Margin", "Monthly", "yes"),
      metric("rework-rate", "Rework rate (bots needing significant fixes within 60 days of launch)", "Monthly", "no"),
      metric("sales-led-resolution", "sales-led -> conversation resolution rate", "Monthly", "", { notes: "or should this be Delivery?" }),
    ],
  },
  {
    key: "support",
    name: "Support",
    description: "AI deflection, response and resolution speed, and support efficiency.",
    metrics: [
      metric("ai-ticket-deflection", "Number of tickets resolved by AI/ AI deflection rate %", "Monthly", "no"),
      metric("median-first-response", "Median First Response Time", "Monthly", "no"),
      metric("resolution-time", "Resolution Time", "Monthly", "no"),
      metric("support-cost-per-ticket", "Support cost per ticket", "Monthly", "yes"),
    ],
  },
  {
    key: "marketing",
    name: "Marketing",
    description: "Category visibility, conversion, pipeline, brand demand, and proof points.",
    metrics: [
      metric("llm-citation-share", "Lane-HoS LLM citation share (Profound bucket)", "Monthly", "no", { target: "0% → 25%+ by EOQ4", owner: "Head of Organic Growth" }),
      metric("cs-trial-to-paid", "CS-segment free-trial → paid (Plus or Team)", "Weekly", "yes", { target: "14% → 18% by EOQ4 (to validate baseline)", owner: "Mathieu" }),
      metric("marketing-desk-pipeline", "Marketing-sourced ICP-qualified Botpress Desk pipeline", "Weekly", "no", { target: "$XM by EOQ4 (placeholder pending Finance)", owner: "Eva" }),
      metric("brand-search-clicks", "Brand-search clicks (organic floor defense)", "Weekly", "no", { target: "20K floor; 25K by EOQ4", owner: "Head of Organic Growth" }),
      metric("new-channel-pipeline-share", "% of Marketing-sourced pipeline from new channels (non-organic, non-paid baseline)", "Monthly", "no", { target: "30%+ by EOQ4", owner: "Eva / Mathieu" }),
      metric("support-case-studies", "Heads-of-Support-named case studies in market", "Quarterly", "no", { target: "6 by EOQ3", owner: "Mathieu" }),
    ],
  },
  {
    key: "finance",
    name: "Finance",
    description: "Close execution, planning accuracy, working-capital cycles, and reporting discipline.",
    metrics: [
      metric("monthly-close-cycle", "Monthly close cycle (business days)", "Monthly", "yes", { target: "≤5 bd", owner: "Controller" }),
      metric("bva-delivery-day", "BvA delivered by (day of month)", "Monthly", "yes", { target: "≤10th", owner: "Siya" }),
      metric("cash-forecast-updated", "Cash forecast updated", "Weekly", "yes", { target: "Weekly", owner: "Controller" }),
      metric("arr-forecast-accuracy", "Forecast accuracy — ARR variance (%)", "Monthly", "yes", { target: "±10%", owner: "Frank" }),
      metric("ar-collection-cycle", "AR collection cycle (DSO, days)", "Monthly", "yes", { target: "TBD", owner: "Khai" }),
      metric("ap-cycle-time", "AP cycle time (days)", "Monthly", "yes", { target: "TBD", owner: "Khai" }),
      metric("payroll-commissions-cycle-accuracy", "Payroll & Commissions cycle accuracy (errors/payout)", "Quarterly", "yes", { target: "0 errors", owner: "Khai" }),
      metric("dashboards-up-to-date", "Dashboards published and up to date", "Weekly", "yes", { target: "Weekly", owner: "Siya" }),
    ],
  },
  {
    key: "people-ops",
    name: "People Ops",
    description: "Hiring effectiveness, employee retention, manager enablement, and legal operations.",
    metrics: [
      metric("offer-acceptance-rate", "Offer acceptance rate", "monthly + YTD", "no", { owner: "Vlad" }),
      metric("employee-retention-regrettable-attrition", "Employee retention rate + regrettable attrition", "monthly + YTD", "yes", { owner: "Vlad/Lauren/Mathilde" }),
      metric("enps", "eNPS", "semi-annual", "no", { owner: "Mathilde" }),
      metric("manager-training-completion", "% of managers who completed training", "monthly + YTD", "no", { owner: "Lauren" }),
      metric("legal-questions-volume", "Inbound legal questions volume", "Weekly", "no", { owner: "Mathilde" }),
      metric("contract-turnaround-time", "Contract turnaround time", "Monthly", "no", { owner: "Mathilde" }),
    ],
  },
];

export function isTeamScorecardKey(value: unknown): value is TeamScorecardKey {
  return TEAM_SCORECARD_KEYS.includes(String(value || "").trim().toLowerCase() as TeamScorecardKey);
}

export function getTeamScorecardDefinition(value: TeamScorecardKey) {
  return TEAM_SCORECARD_DEFINITIONS.find((team) => team.key === value)!;
}
