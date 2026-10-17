create table if not exists public.crm_app_config (
  key text primary key,
  value text not null default ''
);
alter table public.crm_app_config enable row level security;

create table if not exists public.crm_masters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  default_pct numeric(5,2) not null default 30 check (default_pct >= 0 and default_pct <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.crm_masters enable row level security;

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'new'
    check (status in ('new','in_progress','follow_up','pushing','won','lost')),
  name text not null default '',
  phone text not null default '',
  language text not null default '',
  service text not null default '',
  what_to_clean text not null default '',
  area text not null default '',
  budget text not null default '',
  when_text text not null default '',
  contact_method text not null default '',
  gift text not null default '',
  extra_services text not null default '',
  campaign text not null default '',
  source text not null default 'facebook',
  answers jsonb not null default '{}'::jsonb,
  raw_text text not null default '',
  notes text not null default '',
  tg_chat_id bigint,
  tg_message_id bigint,
  content_hash text,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_leads_status_idx      on public.crm_leads (status);
create index if not exists crm_leads_campaign_idx     on public.crm_leads (campaign);
create index if not exists crm_leads_created_at_idx   on public.crm_leads (created_at desc);
create index if not exists crm_leads_phone_idx        on public.crm_leads (phone);
create index if not exists crm_leads_content_hash_idx on public.crm_leads (content_hash);
alter table public.crm_leads enable row level security;

create or replace function public.crm_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists crm_leads_touch_updated_at on public.crm_leads;
create trigger crm_leads_touch_updated_at before update on public.crm_leads
  for each row execute function public.crm_touch_updated_at();

create table if not exists public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  master_id uuid references public.crm_masters(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'HUF',
  master_pct numeric(5,2),
  master_payout numeric(14,2) not null default 0 check (master_payout >= 0),
  extra_costs numeric(14,2) not null default 0 check (extra_costs >= 0),
  extra_costs_note text not null default '',
  service_done text not null default '',
  job_date date,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists crm_deals_lead_id_idx    on public.crm_deals (lead_id);
create index if not exists crm_deals_master_id_idx   on public.crm_deals (master_id);
create index if not exists crm_deals_job_date_idx    on public.crm_deals (job_date);
create index if not exists crm_deals_created_at_idx  on public.crm_deals (created_at desc);
alter table public.crm_deals enable row level security;

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.crm_leads(id) on delete cascade,
  title text not null,
  due_at timestamptz,
  done boolean not null default false,
  done_at timestamptz,
  source text not null default 'manual' check (source in ('manual','ai')),
  reason text not null default '',
  notified boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists crm_tasks_due_open_idx on public.crm_tasks (due_at) where done = false;
create index if not exists crm_tasks_lead_id_idx   on public.crm_tasks (lead_id);
alter table public.crm_tasks enable row level security;

create table if not exists public.crm_timeline (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  kind text not null,
  body text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists crm_timeline_lead_id_idx on public.crm_timeline (lead_id, created_at desc);
alter table public.crm_timeline enable row level security;

create table if not exists public.crm_ad_spend (
  id uuid primary key default gen_random_uuid(),
  campaign text not null,
  date_start date,
  date_stop date,
  spend numeric(14,2) not null default 0,
  currency text not null default 'HUF',
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  leads_reported int not null default 0,
  source_file text not null default '',
  imported_at timestamptz not null default now(),
  unique nulls not distinct (campaign, date_start, date_stop)
);
create index if not exists crm_ad_spend_campaign_idx on public.crm_ad_spend (campaign);
alter table public.crm_ad_spend enable row level security;

insert into public.crm_app_config (key, value) values
  ('telegram_bot_token', ''),
  ('bot_webhook_secret', 'CHANGE_ME'),
  ('intake_secret', 'CHANGE_ME'),
  ('dashboard_secret', 'CHANGE_ME'),
  ('reminder_secret', 'CHANGE_ME'),
  ('fb_verify_token', 'CHANGE_ME'),
  ('fb_app_secret', ''),
  ('fb_page_token', ''),
  ('fb_graph_version', 'v21.0'),
  ('anthropic_api_key', ''),
  ('owner_tg_id', ''),
  ('cards_chat_id', ''),
  ('dashboard_public_base', ''),
  ('timezone', 'Europe/Budapest'),
  ('base_currency', 'HUF'),
  ('default_master_pct', '30'),
  ('fx_eur_huf', '395'),
  ('fx_usd_huf', '360')
on conflict (key) do nothing;
