with notes as (
  select t.lead_id, t.created_at as at,
         coalesce(nullif(regexp_replace(t.body, '^🔁 Повторная заявка( · )?', ''), ''), '') as campaign
  from crm_timeline t
  where t.body like '🔁 Повторная заявка%'
),
agg as (
  select l.id,
         jsonb_build_object(
           'campaign', coalesce(l.campaign, ''),
           'at', to_char(least(l.created_at, coalesce(l.received_at, l.created_at)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'source', coalesce(l.source, '')
         ) || case when l.attribution ? 'meta_lead_id'
                   then jsonb_build_object('meta_lead_id', l.attribution->>'meta_lead_id')
                   else '{}'::jsonb end as first_entry,
         jsonb_agg(jsonb_build_object(
           'campaign', n.campaign,
           'at', to_char(n.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
         ) order by n.at) as repeats,
         (array_agg(n.campaign order by n.at desc))[1] as last_campaign
  from crm_leads l
  join notes n on n.lead_id = l.id
  where not (coalesce(l.attribution, '{}'::jsonb) ? 'campaigns')
  group by l.id, l.campaign, l.source, l.created_at, l.received_at, l.attribution
)
update crm_leads l
   set attribution = coalesce(l.attribution, '{}'::jsonb)
                     || jsonb_build_object('campaigns', agg.first_entry || agg.repeats),
       campaign = case when agg.last_campaign <> '' then agg.last_campaign else l.campaign end,
       updated_at = now()
  from agg
 where l.id = agg.id;
