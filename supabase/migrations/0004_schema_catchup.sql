create table if not exists public.crm_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  role text not null default 'master'
    check (role in ('full','marketer','supervisor','master')),
  master_id uuid references public.crm_masters(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null,
  amount numeric not null,
  note text default '',
  created_at timestamptz default now()
);
create index if not exists crm_expenses_spent_on_idx on public.crm_expenses (spent_on);

create table if not exists public.crm_job_photos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.crm_leads(id) on delete cascade,
  master_id uuid references public.crm_masters(id) on delete set null,
  path text not null,
  phase text not null default 'after',
  tg_file_id text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists crm_job_photos_lead on public.crm_job_photos (lead_id);

create table if not exists public.crm_inbox_chunks (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  body text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists crm_inbox_chunks_chat_created on public.crm_inbox_chunks (chat_id, created_at);

alter table public.crm_masters
  add column if not exists pay_type text not null default 'percent',
  add column if not exists hourly_rate numeric(12,2) not null default 0,
  add column if not exists tg_chat_id bigint,
  add column if not exists work_days integer[] not null default '{}',
  add column if not exists language text not null default '',
  add column if not exists district text not null default '',
  add column if not exists availability_note text not null default '',
  add column if not exists experience text not null default 'none';

do $$ begin
  alter table public.crm_masters add constraint crm_masters_pay_type_check
    check (pay_type in ('percent','hourly'));
exception when duplicate_object then null; end $$;

alter table public.crm_deals
  add column if not exists hours numeric(6,2),
  add column if not exists master_name text not null default '';
create index if not exists crm_deals_job_date_idx on public.crm_deals (job_date);

alter table public.crm_leads
  add column if not exists assigned_master_id uuid references public.crm_masters(id) on delete set null,
  add column if not exists scheduled_at timestamptz,
  add column if not exists address text not null default '',
  add column if not exists reactivated_at timestamptz,
  add column if not exists last_contact_at timestamptz,
  add column if not exists status_changed_at timestamptz default now(),
  add column if not exists review_requested_at timestamptz,
  add column if not exists feedback_asked_at timestamptz,
  add column if not exists master_brief text,
  add column if not exists master_notified_at timestamptz,
  add column if not exists master_confirmed_at timestamptz,
  add column if not exists silent_nudged_at timestamptz;
create index if not exists crm_leads_assigned_idx on public.crm_leads (assigned_master_id);

alter table public.crm_leads drop constraint if exists crm_leads_status_check;
alter table public.crm_leads add constraint crm_leads_status_check
  check (status in ('new','contacted','in_progress','follow_up','pushing','won','lost','junk','screening','trial','no_show'));
