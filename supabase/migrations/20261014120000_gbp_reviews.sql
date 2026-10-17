create table if not exists public.crm_gbp_reviews (
  review_id text primary key,
  reviewer_name text not null default '',
  stars smallint,
  comment text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz,
  reply_comment text,
  reply_updated_at timestamptz,
  draft_reply text,
  draft_at timestamptz,
  notified_at timestamptz,
  published_at timestamptz,
  fetched_at timestamptz not null default now()
);
alter table public.crm_gbp_reviews enable row level security;

select cron.schedule(
  'crm-gbp-reviews',
  '17 */3 * * *',
  $job$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/crm-bot?cron=gbp',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-reminder-secret', (select value from public.crm_app_config where key = 'reminder_secret')),
    body := '{}'::jsonb
  );
  $job$
);
