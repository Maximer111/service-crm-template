insert into public.crm_app_config (key, value)
values ('whatsapp_followup_enabled', 'false')
on conflict (key) do nothing;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'crm-whatsapp-followups' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'crm-whatsapp-followups',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/crm-whatsapp-webhook?cron=followups',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-whatsapp-secret', (select value from public.crm_app_config where key = 'whatsapp_webhook_secret')
    ),
    body := '{}'::jsonb
  );
  $job$
);
