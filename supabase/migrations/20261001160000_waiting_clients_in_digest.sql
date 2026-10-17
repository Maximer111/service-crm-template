create or replace function public.crm_waiting_clients(p_min_hours int default 2, p_days int default 5)
returns table(lead_id uuid, name text, phone text, hours int, body text)
language sql stable security definer set search_path = public as $fn$
  with last as (
    select distinct on (m.lead_id) m.lead_id, m.direction, m.body, m.sent_at
    from crm_wa_messages m where m.sent_at > now() - make_interval(days => p_days)
    order by m.lead_id, m.sent_at desc)
  select l.id, l.name, l.phone, (extract(epoch from now() - last.sent_at) / 3600)::int, left(last.body, 160)
  from last join crm_leads l on l.id = last.lead_id
  where last.direction = 'incoming'
    and last.sent_at < now() - make_interval(hours => p_min_hours)
    and l.source <> 'job_application' and l.status not in ('junk', 'lost')
    and (last.body like '%?%' or length(last.body) > 60)
  order by last.sent_at
$fn$;

create or replace function public.crm_unrecorded_orders_alert()
returns int language plpgsql security definer set search_path = public as $fn$
declare
  v_token text; v_chat text; v_orders text := ''; v_wait text := ''; v_n int := 0; v_w int := 0; r record; v_text text := '';
  clean constant text := '[<>&]';
begin
  select value into v_token from crm_app_config where key = 'telegram_bot_token';
  select value into v_chat from crm_app_config where key = 'owner_tg_id';
  if v_token is null or v_chat is null then return 0; end if;
  for r in
    select u.* from crm_unrecorded_orders(72) u
    where not exists (select 1 from crm_timeline t where t.lead_id = u.lead_id and t.kind = 'unrecorded_order_alert' and t.created_at > now() - interval '24 hours')
    limit 10
  loop
    v_n := v_n + 1;
    v_orders := v_orders || E'\n\n<b>' || regexp_replace(coalesce(r.name, 'без имени'), clean, '', 'g') || '</b> ' || coalesce(r.phone, '')
      || case when r.theirs is not null then E'\nКлиент: ' || regexp_replace(left(r.theirs, 120), clean, '', 'g') else '' end
      || case when r.ours is not null then E'\nМы: ' || regexp_replace(left(r.ours, 120), clean, '', 'g') else '' end;
    insert into crm_timeline (lead_id, kind, body) values (r.lead_id, 'unrecorded_order_alert', 'Напомнил Алексу: в чате похоже на договорённость, а заказа в CRM нет');
  end loop;
  for r in select w.* from crm_waiting_clients(2, 5) w limit 12 loop
    v_w := v_w + 1;
    v_wait := v_wait || E'\n\n<b>' || regexp_replace(coalesce(r.name, 'без имени'), clean, '', 'g') || '</b> ' || coalesce(r.phone, '')
      || ', ждёт ' || case when r.hours >= 48 then (r.hours / 24) || ' дн' else r.hours || ' ч' end
      || E'\n' || regexp_replace(left(r.body, 140), clean, '', 'g');
  end loop;
  if v_n = 0 and v_w = 0 then return 0; end if;
  if v_w > 0 then v_text := '⏳ <b>Клиенты ждут ответа (' || v_w || ')</b>' || v_wait; end if;
  if v_n > 0 then
    v_text := v_text || case when v_w > 0 then E'\n\n' else '' end
      || '🔎 <b>Похоже на договорённость, а заказа в CRM нет (' || v_n || ')</b>' || E'\nПроверь и выпиши заказ, если клиент подтвердил.' || v_orders;
  end if;
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('chat_id', v_chat, 'parse_mode', 'HTML', 'disable_web_page_preview', true, 'text', left(v_text, 3900)),
    timeout_milliseconds := 15000);
  return v_n + v_w;
end $fn$;
