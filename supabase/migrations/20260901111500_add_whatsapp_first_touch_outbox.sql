create table if not exists public.crm_wa_outbox (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  kind text not null default 'first_touch',
  phone text not null,
  body text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  external_message_id text not null default '',
  error text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (lead_id, kind)
);

create index if not exists crm_wa_outbox_status_created_idx
  on public.crm_wa_outbox (status, created_at);

alter table public.crm_wa_outbox enable row level security;

insert into public.crm_app_config (key, value)
values ('whatsapp_first_touch_enabled', 'false')
on conflict (key) do nothing;
