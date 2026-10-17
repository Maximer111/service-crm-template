# Service-business CRM template

> A cleaned copy of a CRM that runs a cleaning company in production. Keys, webhook URLs,
> account IDs, client data and staff names are removed; owner and staff names in prompts are
> fictional (Alex = owner, Maria and Ivan = team leads). Code comments were stripped
> because they referenced real incidents. Business logic, prompts and pricing rules are left
> as written, so rewrite them for your own business before going live.

A standalone, AI-powered CRM driven from Telegram + a web dashboard. Leads land as client cards automatically from every channel: Facebook through a
Make scenario, the website form straight from a Cloudflare Pages Function, and
email through a Gmail script (the Make and Gmail scripts are not included). All of them go through one normaliser, so the card
looks the same whatever the source. A direct Meta webhook is also built and
deployed, but not switched on yet. Paste a WhatsApp chat and Claude summarizes it, updates the card,
and schedules the follow-up call. Close deals, track master payouts and ad spend,
and see real profit per campaign.

Its own tables, bot and dashboard on Supabase, Telegram and Cloudflare. No servers to run.

## What it does

- **Auto-capture leads** - Facebook Lead Ads webhook -> Supabase -> a card is created
  and posted to Telegram with status buttons (New -> In progress -> Follow-up ->
  Pushing -> Won / Lost).
- **AI chat analysis** - reply to a lead card with a pasted WhatsApp conversation (or
  paste it on the dashboard). Claude returns a summary, sets the status, captures the
  quoted/agreed price, and **auto-creates a follow-up task** with a due date.
- **Natural-language tasks** - "перезвонить через 3 дня", "напомни завтра в 15:00" ->
  a task is created; the bot pings you in Telegram when it's due.
- **Close deals** - record amount, master (with % payout), extra costs (gas, materials)
  with a free note. Net margin computed automatically.
- **Money / P&L** - profit per campaign (revenue - master - ad spend), CPL, CAC, ROAS;
  and per-master totals.
- **Meta Ads sync** - campaign spend, impressions, clicks and Meta leads are pulled
  automatically; CSV paste remains available as a fallback.
- **CSV export** - leads and deals.

## Architecture

```
Facebook Lead Ad ──webhook──► Edge Fn: crm-fb-webhook
                                 │  (verify + signature + Graph API lead fetch)
                                 ▼
                              Edge Fn: crm-lead-intake ──► crm_* tables ──► Telegram card (buttons)

Telegram  ──webhook──► Edge Fn: crm-bot  (buttons, /commands, free-text → Claude)
                          │                 ▲ pg_cron ?cron=reminders (due-task pings)
                          ▼
                       Supabase Postgres (public schema, crm_* tables)
                          ▲
              Edge Fn: crm-dashboard (board / card / money / masters / import-export)
                          ▲  Cloudflare Worker (re-serves HTML as text/html; CSV download)
                       browser

Meta Marketing API ──daily──► Edge Fn: crm-meta-ads-sync ──► crm_ad_spend
                                                               │
                                                               ▼
                                                     crm-notion-report ──► Notion
```

All tables live in one Supabase project, `public` schema, `crm_` prefix.

| Path | What it is |
|------|------------|
| `supabase/migrations/0001_crm_schema.sql` | 7 tables + config seed (`crm_*`) |
| `supabase/functions/crm-fb-webhook/` | Facebook Lead Ads webhook (verify, Graph fetch) |
| `supabase/functions/crm-lead-intake/` | Normalize a lead + create card + Telegram post |
| `supabase/functions/crm-bot/` | Telegram bot (buttons, AI, tasks, reminders) |
| `supabase/functions/crm-dashboard/` | Web CRM (board, card, money, import/export) |
| `supabase/functions/crm-meta-ads-sync/` | Daily Meta Ads Insights import |
| `supabase/functions/crm-notion-report/` | Deterministic daily Notion report |
| `cloudflare/dashboard-proxy/` | Re-serves the dashboard as text/html + CSV |

## Setup

### 1. Database
Apply every file in `supabase/migrations/` in order to your Supabase project. Replace `YOUR_PROJECT_REF` in the migrations, `tools/deploy.sh` and `cloudflare/dashboard-proxy/worker.js` with your project ref, and the placeholder rows in `20261011180000_city_split.sql` with your own page, account and form IDs.
`0004_schema_catchup.sql` is the one that brings a fresh database up to what production
actually runs (logins and roles, expenses, job photos, hourly pay, master assignment);
it is idempotent, so re-running it on a live database changes nothing.

### 2. Secrets (in `crm_app_config`)
```sql
update crm_app_config set value = encode(gen_random_bytes(24),'hex')
  where key in ('bot_webhook_secret','intake_secret','reminder_secret','fb_verify_token');
update crm_app_config set value = encode(gen_random_bytes(16),'hex') where key = 'dashboard_secret';
update crm_app_config set value = '<CRM bot token from @BotFather>' where key = 'telegram_bot_token';
update crm_app_config set value = '<anthropic api key>'             where key = 'anthropic_api_key';
update crm_app_config set value = '<chat/group id for lead cards>'  where key = 'cards_chat_id';
-- Facebook (step 6):
update crm_app_config set value = '<Meta app secret>'              where key = 'fb_app_secret';
update crm_app_config set value = '<long-lived Page access token>'  where key = 'fb_page_token';
-- Meta Ads statistics (step 7): token must be able to read this ad account
update crm_app_config set value = '<Meta Ads access token>'         where key = 'meta_ads_access_token';
update crm_app_config set value = '<numeric ad account id>'         where key = 'meta_ad_account_id';
-- after the Cloudflare worker is deployed:
update crm_app_config set value = 'https://<worker>.<sub>.workers.dev' where key = 'dashboard_public_base';
```

### 3. Edge functions (deploy with `--no-verify-jwt`; they do their own auth)
```bash
supabase functions deploy crm-fb-webhook  --no-verify-jwt
supabase functions deploy crm-lead-intake --no-verify-jwt
supabase functions deploy crm-bot         --no-verify-jwt
supabase functions deploy crm-dashboard   --no-verify-jwt
supabase functions deploy crm-meta-ads-sync --no-verify-jwt
supabase functions deploy crm-notion-report --no-verify-jwt
```

### 4. Telegram bot
Create the CRM bot via **@BotFather**, store the token (step 2), then set its webhook:
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<PROJECT_REF>.supabase.co/functions/v1/crm-bot",
       "secret_token":"<bot_webhook_secret>","allowed_updates":["message","callback_query"]}'
```
Add the bot to the group where cards should be posted and set `cards_chat_id` to that
chat id. Message the bot once in private to lock yourself in as the owner.

### 5. Cloudflare proxy (dashboard hosting)
Workers & Pages -> create a Worker -> paste `cloudflare/dashboard-proxy/worker.js`
(set `SUPABASE_PROJECT` to your project ref). Deploy. Put its origin
in `dashboard_public_base` (step 2). Dashboard URL:
`https://<worker>.<sub>.workers.dev/?key=<dashboard_secret>`

### 6. Facebook Lead Ads webhook (the lead source, no Make)
1. **Meta app**: at developers.facebook.com use your business app (or create one). Add
   the **Webhooks** and **Facebook Login for Business** / Pages products.
2. **App secret**: Settings -> Basic -> copy the App Secret into `fb_app_secret`.
3. **Page access token**: generate a long-lived Page token for the page
   with the `leads_retrieval`, `pages_show_list`, and
   `pages_manage_metadata` permissions. Put it in `fb_page_token`.
   - Public (non-admin) leads require **Advanced Access** to `leads_retrieval`
     (App Review + Business Verification). Admin/tester leads work immediately for testing.
4. **Webhook**: Webhooks product -> subscribe to **Page** -> field **leadgen**.
   - Callback URL: `https://<PROJECT_REF>.supabase.co/functions/v1/crm-fb-webhook`
   - Verify token: the value you put in `fb_verify_token`.
5. **Subscribe the page**: subscribe your Page to the app's `leadgen` field (Graph API
   `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`).
6. Submit a test lead from the Lead Ads Testing Tool to confirm a card appears.

### 7. Automatic Meta Ads statistics
Apply `20260826090000_add_meta_ads_sync.sql`, fill `meta_ads_access_token` and
`meta_ad_account_id`, deploy `crm-meta-ads-sync`, and call it with
`x-reminder-secret`. The migration contains a commented daily pg_cron example.
Schedule the sync before `crm-notion-report` (for example 06:45 and 07:00 Budapest).
On failure the owner gets a Telegram warning; the report also flags data older than
36 hours. Manual CSV rows are kept as historical fallback and are not double-counted
when API data exists for the same campaign and month.

### 8. Task reminders (optional)
Enable `pg_cron` + `pg_net` and schedule the pinger (see the commented block at the
bottom of `0001_crm_schema.sql`). Fires every 15 min, messages you for due tasks.

## Daily use

- New lead -> card appears in Telegram + on the board. Tap a status button anytime.
- Client replied on WhatsApp? Copy the chat, **reply to the card** with it -> bot
  summarizes, updates status, schedules the call-back.
- Closed a job? Reply to the card: `закрыли на 30000 мастер Даша +5000 бензин`, or use
  the "Close deal" form on the dashboard.
- `/stats` for the funnel + money; open the dashboard for the board, P&L and exports.

## Notes
- Edge functions read `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from the platform env.
- Ad spend in EUR/USD is converted to HUF via `fx_eur_huf` / `fx_usd_huf` in config.
- Secrets are never committed; they live in `crm_app_config`.
- Optional env vars: `META_PIXEL_ID`, `GBP_ACCOUNT_ID`, `GBP_LOCATION_ID` (Google reviews), `TEST_AUTOREPLY_PHONE`.
- The UI and bot replies are mostly in Russian, with English and Hungarian client-facing text.
```
