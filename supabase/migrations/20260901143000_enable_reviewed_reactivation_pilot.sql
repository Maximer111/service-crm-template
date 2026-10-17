insert into public.crm_app_config (key, value)
values ('whatsapp_reactivation_review_enabled', 'true')
on conflict (key) do update set value = excluded.value;

insert into public.crm_app_config (key, value)
values ('whatsapp_reactivation_enabled', 'false')
on conflict (key) do update set value = excluded.value;
