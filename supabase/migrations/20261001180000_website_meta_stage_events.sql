create or replace function public.crm_queue_meta_lead_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare changed boolean := true;
begin
  if coalesce(new.source, '') not in ('facebook', 'instagram', 'website') then return new; end if;
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
