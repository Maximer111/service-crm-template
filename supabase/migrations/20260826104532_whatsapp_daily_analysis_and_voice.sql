insert into public.crm_app_config (key, value)
values ('openai_api_key', '')
on conflict (key) do nothing;

select cron.unschedule(jobid)
from cron.job
where jobname = 'crm-whatsapp-analyze';

select cron.schedule(
  'crm-whatsapp-analyze',
  '50 4 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/crm-whatsapp-webhook?cron=analyze',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-whatsapp-secret', (
        select value from public.crm_app_config where key = 'whatsapp_webhook_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
