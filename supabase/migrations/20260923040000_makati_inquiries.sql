create table if not exists public.crm_makati_inquiries (
  id uuid primary key default gen_random_uuid(),
  branch text not null default 'makati' check (branch = 'makati'),
  source text not null default 'website',
  name text not null default '', phone text not null, email text not null default '',
  contact_method text not null default 'phone', service text not null default '',
  campaign text not null default '', raw_text text not null default '',
  attribution jsonb not null default '{}'::jsonb,
  status text not null default 'new' check(status in ('new','contacted','booked','completed','lost')),
  owner_notes text not null default '',
  content_hash text not null unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.crm_makati_inquiries enable row level security;
revoke all on public.crm_makati_inquiries from anon, authenticated;
grant all on public.crm_makati_inquiries to service_role;
create index if not exists crm_makati_inquiries_created_idx on public.crm_makati_inquiries(created_at desc);
