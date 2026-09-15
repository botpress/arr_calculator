This is a Next.js ARR dashboard.

## Routes

- `/` HubSpot ARR report
- `/stripe` Stripe ARR report
- `/stripe-arr-correct` Stripe ARR (Correct) report
- `/combined-all-subs` Combined ARR by customer (HubSpot cloud C-ARR + Stripe through-MRR merge)
- `/tofu` Monthly TOFU ARR bridge (Beginning/New/Expansion/Contraction/Churn/Ending)
- `/quickbooks` QuickBooks OAuth + data access page
- `POST /api/report` HubSpot report API
- `GET|POST /api/stripe-report` Stripe report API
- `GET /api/stripe-report/export` Stripe full CSV export API (all filtered/grouped rows)
- `GET|POST /api/stripe-arr-correct-report` Stripe ARR (Correct) API (BigQuery profile)
- `GET /api/stripe-arr-correct-report/export` Stripe ARR (Correct) CSV export API
- `GET|POST /api/combined-all-subs-report` Combined HubSpot+Stripe customer ARR API
- `GET|POST /api/tofu-report` Monthly TOFU ARR bridge API based on Combined All Subs
- `GET|POST /api/hubspot-current-metrics-sync` Push current ARR/contracted ARR values into HubSpot deal properties
- `GET|POST /api/stripe-sync` Stripe sync API
- `GET /api/stripe-sync/status` Stripe sync health/status API
- `GET|POST /api/stripe-bigquery-refresh` Rebuild Stripe external BigQuery tables from GCS bucket folders
- `GET|POST /api/stripe-upcoming-sync` Trigger Cloud Run upcoming-invoice snapshot sync job
- `GET|POST /api/stripe-upcoming-snapshots-cleanup` Delete older same-day upcoming-invoice snapshots in BigQuery (keep latest snapshot for the day)
- `GET /api/quickbooks/connect` Start Intuit OAuth
- `GET /api/quickbooks/callback` Intuit OAuth callback
- `GET /api/quickbooks/status` QuickBooks connection status
- `GET /api/quickbooks/keepalive` Refresh QuickBooks tokens (for cron keepalive)
- `GET /api/quickbooks/company-info` Fetch QuickBooks CompanyInfo
- `POST /api/quickbooks/query` Run a QuickBooks SQL-like query
- `POST /api/quickbooks/disconnect` Clear saved QuickBooks tokens
- `GET|POST /api/slack/daily-arr-summary` Send daily Projected ARR metrics to Slack (DM/channel)

## Automatic Stripe Sync

Vercel cron runs Stripe sync automatically every 5 minutes:

- `*/5 * * * *` (`/api/stripe-sync`)
- `0 1-23/2 * * *` (`/api/stripe-bigquery-refresh`) refresh of bucket-backed external Stripe tables every 2 hours
- `10 */2 * * *` (`/api/stripe-upcoming-sync`) trigger upcoming invoice snapshot Cloud Run job every 2 hours
- `55 23 * * *` (`/api/stripe-upcoming-snapshots-cleanup`) end-of-day cleanup: keep only latest same-day upcoming snapshot
- `5 * * * *` (`/api/hubspot-current-metrics-sync`) hourly HubSpot deal metric property update
- `0 */6 * * *` (`/api/quickbooks/keepalive`) QuickBooks OAuth token keepalive

`/api/stripe-sync` accepts:

```json
{
  "startDate": "2025-01-01",
  "endDate": "2026-01-31",
  "force": false,
  "iterations": 12,
  "reset": false
}
```

`reset: true` clears existing sync state before backfilling again.

Use `/api/stripe-sync/status` to verify live progress. It returns:

- `stats.storage` (`vercel_blob` or `local_tmp`)
- `stats.itemCount`
- `stats.rangeExhausted`
- `secondsSinceUpdate`
- `healthy`

`/api/stripe-bigquery-refresh` accepts:

```json
{
  "dryRun": false
}
```

The route is cron-authenticated with `CRON_SECRET` (same pattern as `/api/stripe-sync`) and can also be triggered manually.

`/api/stripe-upcoming-snapshots-cleanup` accepts:

```json
{
  "dryRun": false,
  "targetDate": "2026-03-24",
  "profile": "stripe_arr_correct"
}
```

Notes:

- `targetDate` is optional (`YYYY-MM-DD`, UTC). If omitted, current UTC date is used.
- `profile` supports `stripe_arr_correct` (default) or `default`.
- The cleanup keeps the latest snapshot key for the target day and deletes other rows for that same day.

`/api/stripe-upcoming-sync` accepts:

```json
{
  "projectId": "botpress-stripe-data-pipeline",
  "region": "northamerica-northeast1",
  "jobName": "stripe-upcoming-line-sync"
}
```

Notes:

- All fields are optional; defaults come from env vars:
  - `STRIPE_UPCOMING_SYNC_PROJECT_ID`
  - `STRIPE_UPCOMING_SYNC_REGION`
  - `STRIPE_UPCOMING_SYNC_JOB`
- Route is cron-authenticated with `CRON_SECRET` and triggers Cloud Run Jobs API using `GOOGLE_SERVICE_ACCOUNT_JSON` credentials.

`/api/hubspot-current-metrics-sync` accepts:

```json
{
  "asOfDate": "2026-03-21",
  "dryRun": false,
  "contractedArrField": "contracted_arr",
  "currentArrField": "current_arr",
  "syncedAtField": "arr_sync_date"
}
```

Notes:

- `contractedArrField` defaults to `contracted_arr` (or `HUBSPOT_CONTRACTED_ARR_FIELD`)
- `currentArrField` is optional (`HUBSPOT_CURRENT_ARR_FIELD`)
- `syncedAtField` is optional (`HUBSPOT_ARR_SYNC_DATE_FIELD`)
- Uses the same `INCLUDED_DEALSTAGE` filter as HubSpot report calculations

`/api/slack/daily-arr-summary` accepts:

```json
{
  "dryRun": false
}
```

Required env vars for Slack:

- `SLACK_BOT_TOKEN`
- `SLACK_DAILY_USER_IDS` (comma-separated DM targets; ignored if `SLACK_ARR_DAILY_CHANNEL_ID` is set)

Optional:

- `SLACK_ARR_DAILY_CHANNEL_ID` (post to a channel instead of DM)
- `SLACK_HANY_USER_ID` (legacy single DM fallback if `SLACK_DAILY_USER_IDS` is not set)

## Persistence Across Redeployments

Stripe sync state is persisted in Vercel Blob when configured.

Required for persistent shared storage:

- `ARRP_READ_WRITE_TOKEN` or `AARP_READ_WRITE_TOKEN` or `BLOB_READ_WRITE_TOKEN`

Optional blob key path:

- `STRIPE_SYNC_BLOB_PATH` (default `arr/stripe-sync-store-v1.json`)
- `BLOB_STORE_ACCESS` (`private` default, set `public` only if you intentionally use a public store)

If blob token is missing, local `/tmp` fallback is used (not persistent across redeploys/instances).

## QuickBooks OAuth Setup

1. In the Intuit app dashboard, set your redirect URI to:
   - `https://YOUR_DOMAIN/api/quickbooks/callback`
2. In Vercel, configure:
   - `QUICKBOOKS_CLIENT_ID`
   - `QUICKBOOKS_CLIENT_SECRET`
   - `QUICKBOOKS_REDIRECT_URI`
3. Optional:
   - `QUICKBOOKS_ENV` (`production` default, `sandbox` supported)
   - `QUICKBOOKS_SCOPES` (default `com.intuit.quickbooks.accounting`)
   - `QUICKBOOKS_MINOR_VERSION` (default `75`)
   - `QUICKBOOKS_TOKEN_BLOB_PATH` (default `arr/quickbooks/tokens-v1.json`)
   - `QUICKBOOKS_TOKEN_STORE_PATH` (default `/tmp/arr-quickbooks-tokens-v1.json`)

Fallback env names are also accepted:

- client id: `INTUIT_CLIENT_ID`, `QB_CLIENT_ID`, `CLIENT_ID`
- client secret: `INTUIT_CLIENT_SECRET`, `QB_CLIENT_SECRET`, `CLIENT_SECRET`
- redirect URI: `INTUIT_REDIRECT_URI`, `QB_REDIRECT_URI`, `REDIRECT_URI`

## BigQuery Source (Optional)

You can read Stripe line items directly from BigQuery without removing blob sync.
Blob persistence code remains in place and can be switched back at any time.

Set:

- `STRIPE_DATA_SOURCE=bigquery`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (or `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`)
- `BIGQUERY_PROJECT_ID` (optional if present in service account JSON)
- `BIGQUERY_STRIPE_TABLE` (full table id: `project.dataset.table`)
- `BIGQUERY_LOCATION` (optional, default `US`)
- `BIGQUERY_TS_UNIT` (`milliseconds` default, or `seconds`)
- `BIGQUERY_SCHEMA_MODE` (`int_ts` default, use `timestamp` for tables with TIMESTAMP columns like `period_start`/`period_end`)
- `BIGQUERY_STRIPE_SERVING_TABLE` (optional but recommended for speed; full table id with standardized int timestamp columns)
- `BIGQUERY_SERVING_TS_UNIT` (`milliseconds` default, or `seconds`; used only with `BIGQUERY_STRIPE_SERVING_TABLE`)

To keep Blob as source (default), set:

- `STRIPE_DATA_SOURCE=blob`

### Stripe ARR (Correct) BigQuery Profile

`/stripe-arr-correct` is pinned to BigQuery and uses profile-specific env vars when present.
Defaults are pinned to avoid inheriting old Stripe settings:

- table: `botpress-stripe-data-pipeline.stripe.invoice_lines_helper`
- schema mode: `int_ts`
- ts unit: `milliseconds`
- target currency: `USD`
- serving table: disabled unless `BIGQUERY_STRIPE_ARR_CORRECT_SERVING_TABLE` is explicitly set

Set these for the corrected source:

- `BIGQUERY_STRIPE_ARR_CORRECT_PROJECT_ID`
- `BIGQUERY_STRIPE_ARR_CORRECT_LOCATION` (optional, default fallback `BIGQUERY_LOCATION` then `US`)
- `BIGQUERY_STRIPE_ARR_CORRECT_TABLE` (full table id: `project.dataset.table`)
- `BIGQUERY_STRIPE_ARR_CORRECT_SERVING_TABLE` (optional)
- `BIGQUERY_STRIPE_ARR_CORRECT_SCHEMA_MODE` (optional; default fallback `BIGQUERY_SCHEMA_MODE`)
- `BIGQUERY_STRIPE_ARR_CORRECT_TS_UNIT` (optional; default fallback `BIGQUERY_TS_UNIT`)
- `BIGQUERY_STRIPE_ARR_CORRECT_SERVING_SCHEMA_MODE` (optional; default fallback `BIGQUERY_SERVING_SCHEMA_MODE`)
- `BIGQUERY_STRIPE_ARR_CORRECT_SERVING_TS_UNIT` (optional; default fallback `BIGQUERY_SERVING_TS_UNIT`)

Optional profile-specific credential and currency overrides:

- `GOOGLE_SERVICE_ACCOUNT_JSON_STRIPE_ARR_CORRECT` (or `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64_STRIPE_ARR_CORRECT`)
- `STRIPE_ARR_CORRECT_TARGET_CURRENCY`
- `STRIPE_ARR_CORRECT_DATA_SOURCE` (`bigquery` or `blob`; route currently forces BigQuery)

Expected BigQuery columns (or aliases in a view):

- `customer_id`, `invoice_id`
- `line_item_id`, `line_item_description`
- `amount_minor`, `currency`, `quantity`
- `period_start_ts`, `period_end_ts`, `invoice_created_ts`

If using raw TIMESTAMP columns (`amount`, `id`, `description`, `period_start`, `period_end`, `invoice_id`, `currency`, `quantity`), set:

- `BIGQUERY_SCHEMA_MODE=timestamp`

For fastest performance and to avoid timeout on large ranges, use a serving table (`BIGQUERY_STRIPE_SERVING_TABLE`) that already contains the standardized columns above.

### Create One Stripe Table Per `livemode` Folder

If your Stripe lake is in GCS (for example `gs://YOUR_BUCKET/livemode/<folder>/...`) and you want one BigQuery table per folder in `project.stripe`, run:

```bash
cd arr_calculator
GCS_BUCKET=YOUR_BUCKET \
BQ_PROJECT_ID=YOUR_PROJECT_ID \
BQ_DATASET=stripe \
BQ_LOCATION=US \
SOURCE_FORMAT=PARQUET \
GOOGLE_SERVICE_ACCOUNT_JSON="$(cat /path/to/service-account.json)" \
node scripts/create-livemode-folder-tables.mjs
```

Optional env vars:

- `LIVEMODE_PREFIX` (default `livemode/`)
- `GCS_FILE_GLOB` (default `*`; example `*.parquet`)
- `DRY_RUN=true` (prints SQL without creating tables)

This script creates/replaces **external tables** named from each immediate child folder under `livemode/`.

### Two-hour Bucket -> BigQuery Refresh

If your Stripe lake lands in GCS and BigQuery tables are external tables over those folders, this app now includes a 2-hour cron:

- `0 1-23/2 * * *` -> `GET /api/stripe-bigquery-refresh`
- `10 */2 * * *` -> `GET /api/stripe-upcoming-sync` (trigger upcoming invoice snapshot writer)
- `55 23 * * *` -> `GET /api/stripe-upcoming-snapshots-cleanup` (daily prune to keep latest same-day snapshot)

Required env vars for this job:

- `GOOGLE_SERVICE_ACCOUNT_JSON` (or `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`)
- `GCS_BUCKET`
- `BQ_PROJECT_ID` (optional if present in service account JSON)

Optional env vars:

- `BQ_DATASET` (default `stripe`)
- `BQ_LOCATION` (default `US`)
- `STRIPE_BQ_SNAPSHOT_MODE` (default `livemode`; set to `testmode` if needed)
- `STRIPE_BQ_SNAPSHOT` (optional explicit snapshot like `2026031309`; normally auto-detected)
- `GCS_FILE_GLOB` (default `*`)
- `SOURCE_FORMAT` (default `PARQUET`)
- `STRIPE_BQ_BUCKET_REFRESH_DRY_RUN` (`true/false`, default `false`)

Behavior:

- Each run finds the latest snapshot folder in `gs://<GCS_BUCKET>/` that contains `<snapshot>/<mode>/...`.
- It then rebuilds external tables to point at that snapshot.
- Folder `invoice_line_items` is mapped to table `invoice_lines` so existing app queries keep working.

### Stripe Discount Handling (BigQuery)

If invoice discounts are stored at invoice level (not per line), use a serving view that:

- computes *realized* invoice discount from `invoices_view` totals (`subtotal + tax - total`)
- ignores discount codes that did not reduce money (`realized_discount = 0`)
- allocates realized discount proportionally across recurring discountable lines

SQL script (for this project):

- `sql/stripe_arr_serving_net_discount_v1.sql`

Recommended env values:

- `BIGQUERY_LOCATION=northamerica-northeast1`
- `BIGQUERY_STRIPE_TABLE=orbital-lantern-330119.stripe_views.stripe_arr_serving_net_discount_v1`
- `BIGQUERY_SCHEMA_MODE=int_ts`
- `BIGQUERY_TS_UNIT=milliseconds`

## Required Environment Variables

HubSpot:

- `HUBSPOT_PRIVATE_APP_TOKEN`
- `INCLUDED_DEALSTAGE`
- `HUBSPOT_TRANSACTIONAL_STAGE_ID` (optional, used by sales-assist matching on Stripe Through MRR; overrides label lookup)
- `HUBSPOT_TRANSACTIONAL_STAGE_LABEL` (optional fallback label, default `Closed Won (Transactional Pipeline)`)
- `FX_TARGET_CURRENCY`
- `HUBSPOT_CONTRACTED_ARR_FIELD` (optional, default `contracted_arr`)
- `HUBSPOT_CURRENT_ARR_FIELD` (optional)
- `HUBSPOT_ARR_SYNC_DATE_FIELD` (optional)

Authentication (Google SSO):

- `AUTH_SECRET` (required for Auth.js session signing)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_ALLOWED_DOMAINS` (comma-separated company domains, e.g. `botpress.com,example.com`)
- `AUTH_ADMIN_EMAILS` (optional comma-separated admin email allowlist)

Stripe:

- `STRIPE_SECRET_KEY`
- `STRIPE_INVOICE_STATUS` (optional, default `paid`)
- `STRIPE_TARGET_CURRENCY` (optional, default `USD`)
- `ARRP_READ_WRITE_TOKEN` or `AARP_READ_WRITE_TOKEN` or `BLOB_READ_WRITE_TOKEN` (required for persistent sync store)

QuickBooks:

- `QUICKBOOKS_CLIENT_ID`
- `QUICKBOOKS_CLIENT_SECRET`
- `QUICKBOOKS_REDIRECT_URI`

## Optional Tuning

- `CRON_SECRET` (recommended)
- `CURRENCYLAYER_ACCESS_KEY` (required for Currencylayer FX conversion on the secondary CAC chart)
- `CURRENCYLAYER_BASE_URL` (optional, default `https://api.currencylayer.com`)
- `STRIPE_LINE_FETCH_CONCURRENCY` (default `8`)
- `STRIPE_REPORT_CACHE_TTL_MS` (default `300000`)
- `STRIPE_REPORT_AUTO_SYNC` (default `false`)
- `STRIPE_SYNC_FRESHNESS_MS` (default `900000`)
- `STRIPE_SYNC_MAX_HISTORY_DAYS` (default `800`)
- `STRIPE_SYNC_MAX_INVOICES_PER_RUN` (default `120`)
- `STRIPE_SYNC_CRON_ITERATIONS` (default `12`)
- `STRIPE_SYNC_MAX_RUNTIME_MS` (default `40000`)
- `STRIPE_SYNC_STORE_PATH` (local fallback path, default `/tmp/arr-stripe-sync-store.json`)
- `BLOB_STORE_ACCESS` (default `private`; set `public` if your Blob store is still public)
