alter table public.crm_ad_spend
  add column if not exists meta_campaign_id text,
  add column if not exists meta_account_id text,
  add column if not exists reach bigint not null default 0;

create index if not exists crm_ad_spend_meta_campaign_idx
  on public.crm_ad_spend (meta_campaign_id, date_start)
  where meta_campaign_id is not null;

insert into public.crm_app_config (key, value) values
  ('meta_ads_access_token', ''),
  ('meta_ad_account_id', ''),
  ('meta_ads_lookback_days', '45'),
  ('meta_ads_last_sync_at', ''),
  ('meta_ads_last_sync_error', '')
on conflict (key) do nothing;
