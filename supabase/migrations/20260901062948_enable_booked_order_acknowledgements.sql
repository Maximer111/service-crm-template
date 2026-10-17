insert into public.crm_app_config (key, value)
values ('whatsapp_booked_ack_enabled', 'true')
on conflict (key) do update set value = excluded.value;
