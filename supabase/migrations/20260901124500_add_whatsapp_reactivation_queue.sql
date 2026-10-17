create table if not exists public.crm_wa_identities (
  lead_id uuid primary key references public.crm_leads(id) on delete cascade,
  phone text not null,
  remote_lid text not null unique,
  evidence text not null default '',
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_wa_identities enable row level security;

alter table public.crm_wa_outbox
  add column if not exists remote_lid text not null default '',
  add column if not exists expected_last_outbound_id text not null default '',
  add column if not exists expected_last_outbound_timestamp bigint,
  add column if not exists scheduled_at timestamptz,
  add column if not exists evidence jsonb not null default '{}'::jsonb;

create index if not exists crm_wa_outbox_scheduled_idx
  on public.crm_wa_outbox (status, kind, scheduled_at);

insert into public.crm_app_config (key, value)
values ('whatsapp_reactivation_enabled', 'false')
on conflict (key) do nothing;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'crm-whatsapp-reactivations' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'crm-whatsapp-reactivations',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/crm-whatsapp-webhook?cron=reactivations',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-whatsapp-secret', (select value from public.crm_app_config where key = 'whatsapp_webhook_secret')
    ),
    body := '{}'::jsonb
  );
  $job$
);
