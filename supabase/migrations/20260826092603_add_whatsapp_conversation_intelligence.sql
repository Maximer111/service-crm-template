create table if not exists public.crm_wa_messages (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'evolution',
  account_id text not null default '',
  external_message_id text not null,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  direction text not null check (direction in ('incoming','outgoing')),
  message_type text not null default 'text',
  body text not null default '',
  sent_at timestamptz not null,
  raw_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, account_id, external_message_id)
);
create index if not exists crm_wa_messages_lead_time_idx
  on public.crm_wa_messages (lead_id, sent_at desc);
alter table public.crm_wa_messages enable row level security;

create table if not exists public.crm_wa_insights (
  lead_id uuid primary key references public.crm_leads(id) on delete cascade,
  summary text not null default '',
  objection text not null default '',
  loss_reason text not null default '',
  sentiment text not null default '',
  next_action text not null default '',
  suggested_reply text not null default '',
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  last_message_at timestamptz,
  analyzed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_wa_insights_loss_reason_idx
  on public.crm_wa_insights (loss_reason) where loss_reason <> '';
alter table public.crm_wa_insights enable row level security;

insert into public.crm_app_config (key, value) values
  ('whatsapp_webhook_secret', 'CHANGE_ME'),
  ('whatsapp_account_id', ''),
  ('deepgram_api_key', '')
on conflict (key) do nothing;
