create table if not exists public.crm_wa_autoreply_test_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'evolution',
  account_id text not null default '',
  external_message_id text not null,
  phone text not null,
  direction text not null check (direction in ('incoming', 'outgoing')),
  message_type text not null default 'text',
  body text not null default '',
  sent_at timestamptz not null,
  remote_lid text not null default '',
  auto_reply_status text not null default 'not_applicable',
  auto_reply_text text not null default '',
  auto_reply_message_id text not null default '',
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, account_id, external_message_id)
);

create index if not exists crm_wa_autoreply_test_phone_time_idx
  on public.crm_wa_autoreply_test_events (phone, sent_at desc);

alter table public.crm_wa_autoreply_test_events enable row level security;
