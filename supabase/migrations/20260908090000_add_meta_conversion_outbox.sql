create table if not exists public.crm_meta_conversion_queue (
  deal_id uuid primary key references public.crm_deals(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text not null default '',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_meta_conversion_queue_retry_idx
  on public.crm_meta_conversion_queue (status, next_attempt_at)
  where status in ('pending', 'failed');

alter table public.crm_meta_conversion_queue enable row level security;

create or replace function public.crm_queue_meta_conversion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.crm_meta_conversion_queue (deal_id)
  values (new.id)
  on conflict (deal_id) do nothing;
  return new;
end;
$$;

revoke all on function public.crm_queue_meta_conversion() from public;

drop trigger if exists crm_deals_queue_meta_conversion on public.crm_deals;
create trigger crm_deals_queue_meta_conversion
  after insert on public.crm_deals
  for each row execute function public.crm_queue_meta_conversion();

do $$
declare existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'crm-meta-conversions'
  limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'crm-meta-conversions',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/crm-meta-conversions',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-reminder-secret', (select value from public.crm_app_config where key = 'reminder_secret')
    ),
    body := '{}'::jsonb
  );
  $job$
);
