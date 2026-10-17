create table if not exists public.crm_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('messenger','instagram')),
  account_id text not null,
  contact_id text not null,
  external_id text not null,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  direction text not null check (direction in ('incoming','outgoing')),
  body text not null default '',
  sent_at timestamptz not null,
  referral jsonb,
  created_at timestamptz not null default now(),
  unique (channel, account_id, external_id)
);

alter table public.crm_messages add column if not exists city text;
update public.crm_messages set city = public.crm_city_of(jsonb_build_object('page_id', account_id), null, null) where city is null;
create or replace function public.crm_messages_city_fill() returns trigger language plpgsql as $$
begin
  if new.city is null then new.city := public.crm_city_of(jsonb_build_object('page_id', new.account_id), null, null); end if;
  return new;
end $$;
drop trigger if exists crm_messages_city_fill on public.crm_messages;
create trigger crm_messages_city_fill before insert on public.crm_messages
  for each row execute function public.crm_messages_city_fill();
alter table public.crm_messages alter column city set not null;
alter table public.crm_messages drop constraint if exists crm_messages_city_check;
alter table public.crm_messages add constraint crm_messages_city_check check (city in ('budapest','toronto','makati','orlando'));

create index if not exists crm_messages_lead_time_idx on public.crm_messages (lead_id, sent_at desc);
create index if not exists crm_messages_contact_time_idx on public.crm_messages (channel, account_id, contact_id, sent_at desc);

alter table public.crm_messages enable row level security;
revoke all on public.crm_messages from anon, authenticated;
