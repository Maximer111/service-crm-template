alter table public.crm_wa_reply_queue
  alter column scheduled_at set default (now() + interval '25 seconds');
