alter table public.crm_meta_conversion_queue
  add column if not exists sent_amount numeric,
  add column if not exists sent_currency text;

create or replace function public.crm_queue_meta_conversion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare ready timestamptz;
begin
  if new.closed_at is not null then
    ready := now();
  else
    ready := greatest(now(), coalesce(new.job_date::timestamptz, new.created_at) + interval '2 days');
  end if;

  if tg_op = 'INSERT' then
    insert into public.crm_meta_conversion_queue (deal_id, next_attempt_at)
    values (new.id, ready)
    on conflict (deal_id) do nothing;
    return new;
  end if;

  update public.crm_meta_conversion_queue
  set next_attempt_at = ready, updated_at = now()
  where deal_id = new.id and status in ('pending', 'failed') and next_attempt_at <> ready;
  return new;
end;
$$;

revoke all on function public.crm_queue_meta_conversion() from public;

drop trigger if exists crm_deals_settle_meta_conversion on public.crm_deals;
create trigger crm_deals_settle_meta_conversion
  after update of closed_at, job_date on public.crm_deals
  for each row execute function public.crm_queue_meta_conversion();

create table if not exists public.crm_meta_conversion_drift (
  id bigserial primary key,
  deal_id uuid not null,
  lead_id uuid,
  kind text not null check (kind in ('amount', 'deleted')),
  sent_amount numeric,
  new_amount numeric,
  currency text,
  noted_at timestamptz not null default now(),
  notified_at timestamptz
);

create index if not exists crm_meta_conversion_drift_todo_idx
  on public.crm_meta_conversion_drift (noted_at) where notified_at is null;

alter table public.crm_meta_conversion_drift enable row level security;

create or replace function public.crm_note_meta_conversion_drift()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare q record;
begin
  if tg_op = 'DELETE' then
    select * into q from public.crm_meta_conversion_queue
      where deal_id = old.id and status = 'sent';
    if found then
      insert into public.crm_meta_conversion_drift (deal_id, lead_id, kind, sent_amount, currency)
      values (old.id, old.lead_id, 'deleted', q.sent_amount, coalesce(q.sent_currency, old.currency));
    end if;
    return old;
  end if;
  select * into q from public.crm_meta_conversion_queue
    where deal_id = new.id and status = 'sent';
  if found and q.sent_amount is distinct from new.amount then
    insert into public.crm_meta_conversion_drift (deal_id, lead_id, kind, sent_amount, new_amount, currency)
    values (new.id, new.lead_id, 'amount', q.sent_amount, new.amount, coalesce(q.sent_currency, new.currency));
  end if;
  return new;
end;
$$;

revoke all on function public.crm_note_meta_conversion_drift() from public;

drop trigger if exists crm_deals_note_meta_drift_delete on public.crm_deals;
create trigger crm_deals_note_meta_drift_delete
  before delete on public.crm_deals
  for each row execute function public.crm_note_meta_conversion_drift();

drop trigger if exists crm_deals_note_meta_drift_amount on public.crm_deals;
create trigger crm_deals_note_meta_drift_amount
  after update of amount on public.crm_deals
  for each row execute function public.crm_note_meta_conversion_drift();

update public.crm_meta_conversion_queue q
set sent_amount = d.amount, sent_currency = d.currency
from public.crm_deals d
where d.id = q.deal_id and q.status = 'sent' and q.sent_amount is null;
