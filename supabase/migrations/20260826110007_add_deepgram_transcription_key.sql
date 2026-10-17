insert into public.crm_app_config (key, value)
values ('deepgram_api_key', '')
on conflict (key) do nothing;
