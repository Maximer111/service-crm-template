create table if not exists public.crm_wa_reply_queue (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  phone text not null,
  remote_lid text not null default '',
  inbound_message_id text not null unique,
  inbound_timestamp bigint not null,
  inbound_body text not null default '',
  message_type text not null default 'text',
  reply_body text not null default '',
  status text not null default 'pending'
    check (status in ('pending','sent','skipped','failed','needs_owner')),
  reason text not null default '',
  attempts integer not null default 0,
  outbound_message_id text not null default '',
  scheduled_at timestamptz not null default (now() + interval '90 seconds'),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists crm_wa_reply_queue_pending_idx
  on public.crm_wa_reply_queue (status, scheduled_at);
create index if not exists crm_wa_reply_queue_lead_idx
  on public.crm_wa_reply_queue (lead_id, created_at desc);

alter table public.crm_wa_reply_queue enable row level security;

insert into public.crm_app_config (key, value)
values
  ('whatsapp_conversation_autoreply_enabled', 'false'),
  ('whatsapp_conversation_rollout_after', '0')
on conflict (key) do nothing;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'crm-whatsapp-conversation-autoreplies' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'crm-whatsapp-conversation-autoreplies',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/crm-whatsapp-webhook?cron=autoreplies',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-whatsapp-secret', (select value from public.crm_app_config where key = 'whatsapp_webhook_secret')
    ),
    body := '{}'::jsonb
  );
  $job$
);
