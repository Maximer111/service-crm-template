insert into public.crm_app_config (key, value) values
  ('callmebot_telegram_user', '')
on conflict (key) do nothing;
