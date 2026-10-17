create table if not exists public.crm_meta_lead_event_queue (
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  stage text not null check (stage in ('Lead', 'Qualified', 'Booked')),
  event_time timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'expired')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text not null default '',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lead_id, stage)
);

create index if not exists crm_meta_lead_event_queue_retry_idx
  on public.crm_meta_lead_event_queue (status, next_attempt_at)
  where status in ('pending', 'failed');

alter table public.crm_meta_lead_event_queue enable row level security;

create or replace function public.crm_queue_meta_lead_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare changed boolean := true;
begin
  if coalesce(new.source, '') not in ('facebook', 'instagram') then return new; end if;
  if tg_op = 'UPDATE' then
    changed := new.status is distinct from old.status;
  else
    insert into public.crm_meta_lead_event_queue (lead_id, stage, event_time)
    values (new.id, 'Lead', coalesce(new.created_at, now()))
    on conflict do nothing;
  end if;
  if changed and new.status in ('in_progress', 'pushing', 'won') then
    insert into public.crm_meta_lead_event_queue (lead_id, stage) values (new.id, 'Qualified')
    on conflict do nothing;
  end if;
  if changed and new.status = 'won' then
    insert into public.crm_meta_lead_event_queue (lead_id, stage) values (new.id, 'Booked')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.crm_queue_meta_lead_event() from public;

drop trigger if exists crm_leads_queue_meta_lead_event on public.crm_leads;
create trigger crm_leads_queue_meta_lead_event
  after insert or update of status on public.crm_leads
  for each row execute function public.crm_queue_meta_lead_event();

insert into public.crm_meta_lead_event_queue (lead_id, stage, event_time)
select id, 'Lead', created_at from public.crm_leads
where source in ('facebook', 'instagram') and created_at > now() - interval '6 days'
on conflict do nothing;

insert into public.crm_meta_lead_event_queue (lead_id, stage, event_time)
select l.id, s.stage, l.status_changed_at
from public.crm_leads l
cross join (values ('Qualified'), ('Booked')) s(stage)
where l.source in ('facebook', 'instagram')
  and l.status in ('in_progress', 'pushing', 'won')
  and (s.stage = 'Qualified' or l.status = 'won')
  and l.status_changed_at > now() - interval '6 days'
on conflict do nothing;
