create or replace view public.crm_wa_first_in with (security_invoker = true) as
select distinct on (lead_id) lead_id, body, sent_at
from public.crm_wa_messages
where direction = 'incoming' and lead_id is not null
order by lead_id, sent_at;

revoke all on public.crm_wa_first_in from anon, authenticated;
