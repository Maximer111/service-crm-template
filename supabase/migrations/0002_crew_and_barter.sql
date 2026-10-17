alter table crm_leads add column if not exists crew jsonb not null default '[]'::jsonb;
comment on column crm_leads.crew is
  'Доп. мастера на том же заказе. Массив {m:master_id, brief, sum, pay, sent, ok}.';

alter table crm_deals drop constraint if exists crm_deals_amount_check;
alter table crm_deals add constraint crm_deals_amount_check check (amount >= 0);
