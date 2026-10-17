alter table public.crm_leads
  add column if not exists attribution jsonb not null default '{}'::jsonb;

comment on column public.crm_leads.attribution is
  'First-touch traffic source captured by the site middleware. Written on insert, before AI enrichment, so it can never be overwritten.';

create index if not exists crm_leads_attribution_utm_source_idx
  on public.crm_leads ((attribution->>'utm_source'));
