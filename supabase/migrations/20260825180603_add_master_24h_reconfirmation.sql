alter table public.crm_leads
  add column if not exists master_24h_for_scheduled_at timestamptz;

comment on column public.crm_leads.master_24h_for_scheduled_at is
  'scheduled_at value for which the assigned master received the 24h reconfirmation request';
