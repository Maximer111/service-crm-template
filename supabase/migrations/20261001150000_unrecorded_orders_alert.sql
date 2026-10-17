create or replace function public.crm_unrecorded_orders(p_hours int default 72)
returns table(lead_id uuid, name text, phone text, status text, last_at timestamptz, ours text, theirs text)
language sql stable security definer set search_path = public as $fn$
  with recent as (
    select m.lead_id, m.direction, m.body, m.sent_at
    from crm_wa_messages m
    where m.sent_at > now() - make_interval(hours => p_hours) and coalesce(m.body,'') <> ''
  ),
  ours as (
    select distinct on (lead_id) lead_id, body, sent_at from recent
    where direction = 'outgoing' and body ~* '(\mbook(ed|ing)?\M|see you|we all set|all set|\mok(ay)?\M[^.!?\n]{0,12}\m(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\M|забронир|записал|договорились|ждите|будем у вас|lefoglal|rendben)'
    order by lead_id, sent_at desc
  ),
  theirs as (
    select distinct on (lead_id) lead_id, body, sent_at from recent
    where direction = 'incoming'
      and body ~* '(\m(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\M|завтра|сегодня|понедельник|вторник|сред[ауы]|четверг|пятниц|суббот|воскресен|holnap|hétfő|kedd|szerda|csütörtök|péntek|szombat|vasárnap)'
      and body ~* '(\m\d{1,2}([:.]\d{2})?\s*(am|pm|h|óra|час)?\M)'
    order by lead_id, sent_at desc
  )
  select l.id, l.name, l.phone, l.status,
    greatest(coalesce(o.sent_at, 'epoch'), coalesce(t.sent_at, 'epoch')),
    left(o.body, 140), left(t.body, 140)
  from crm_leads l
  left join ours o on o.lead_id = l.id
  left join theirs t on t.lead_id = l.id
  where (o.lead_id is not null or t.lead_id is not null)
    and l.source <> 'job_application' and l.status not in ('junk', 'lost')
    and not exists (select 1 from crm_deals d where d.lead_id = l.id and d.job_date >= current_date - 1)
    and (l.scheduled_at is null or l.scheduled_at < now() - interval '1 day')
  order by 5 desc
$fn$;
create or replace function public.crm_unrecorded_orders_alert()
returns int language plpgsql security definer set search_path = public as $fn$
declare
  v_token text; v_chat text; v_text text := ''; v_n int := 0; r record;
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
    v_text := v_text || E'\n\n<b>' || replace(replace(coalesce(r.name, 'без имени'), '<', ''), '>', '') || '</b> ' || coalesce(r.phone, '')
      || case when r.theirs is not null then E'\nКлиент: ' || replace(replace(left(r.theirs, 120), '<', ''), '>', '') else '' end
      || case when r.ours is not null then E'\nМы: ' || replace(replace(left(r.ours, 120), '<', ''), '>', '') else '' end;
    insert into crm_timeline (lead_id, kind, body) values (r.lead_id, 'unrecorded_order_alert', 'Напомнил Алексу: в чате похоже на договорённость, а заказа в CRM нет');
  end loop;
  if v_n = 0 then return 0; end if;
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('chat_id', v_chat, 'parse_mode', 'HTML', 'disable_web_page_preview', true,
      'text', '🔎 <b>Похоже на договорённость, а заказа в CRM нет (' || v_n || ')</b>' || E'\nПроверь и выпиши заказ, если клиент подтвердил.' || v_text),
    timeout_milliseconds := 15000);
  return v_n;
end $fn$;

select cron.schedule('crm-unrecorded-orders', '0 6,12,18 * * *', $$select public.crm_unrecorded_orders_alert()$$);
