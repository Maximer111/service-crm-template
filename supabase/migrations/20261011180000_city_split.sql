create table if not exists public.crm_city_sources (
  kind text not null check (kind in ('business','fb_page','ig_account','ad_account','dataset','wa_instance','form_label')),
  value text not null,
  city text not null check (city in ('budapest','toronto','makati','orlando')),
  note text not null default '',
  primary key (kind, value)
);
alter table public.crm_city_sources enable row level security;
revoke all on public.crm_city_sources from anon, authenticated;

insert into public.crm_city_sources (kind, value, city, note) values
  ('fb_page',     'YOUR_FB_PAGE_ID',    'budapest', 'Facebook page'),
  ('ig_account',  'YOUR_IG_ACCOUNT_ID', 'budapest', 'Instagram account'),
  ('ad_account',  'YOUR_AD_ACCOUNT_ID', 'budapest', 'Meta ad account'),
  ('wa_instance', 'your-wa-instance',   'budapest', 'Evolution instance'),
  ('form_label',  '(Toronto)',          'toronto',  'website form label')
on conflict (kind, value) do nothing;

create or replace function public.crm_city_of(p_attr jsonb, p_campaign text, p_country text)
returns text language sql stable as $$
  select coalesce(
    (select s.city from public.crm_city_sources s
      where s.kind in ('fb_page','ig_account','ad_account','wa_instance')
        and s.value = any (array[
          regexp_replace(p_attr->>'ad_account_id', '^act_', ''),
          p_attr->>'meta_account_id', p_attr->>'page_id',
          p_attr->>'ig_account_id', p_attr->>'wa_instance'])
      limit 1),
    (select s.city from public.crm_city_sources s
      where s.kind = 'form_label' and position(lower(s.value) in lower(coalesce(p_campaign, ''))) > 0
      order by length(s.value) desc limit 1),
    case p_country when 'CA' then 'toronto' when 'PH' then 'makati' when 'US' then 'orlando' when 'HU' then 'budapest' end,
    case
      when coalesce(p_campaign, '') ~* '\mtoronto\M|\mcanada\M|\montario\M' then 'toronto'
      when coalesce(p_campaign, '') ~* '\mmakati\M|\mmanila\M|philippin' then 'makati'
      when coalesce(p_campaign, '') ~* '\morlando\M|windermere' then 'orlando'
    end,
    'budapest')
$$;

alter table public.crm_leads add column if not exists city text;
alter table public.crm_leads disable trigger crm_leads_touch_updated_at;
update public.crm_leads set city = public.crm_city_of(attribution, campaign, country) where city is null;
alter table public.crm_leads enable trigger crm_leads_touch_updated_at;

create or replace function public.crm_leads_city_fill() returns trigger language plpgsql as $$
begin
  if new.city is null then new.city := public.crm_city_of(new.attribution, new.campaign, new.country); end if;
  return new;
end $$;
drop trigger if exists crm_leads_city_fill on public.crm_leads;
create trigger crm_leads_city_fill before insert on public.crm_leads
  for each row execute function public.crm_leads_city_fill();

alter table public.crm_deals add column if not exists city text;
update public.crm_deals d set city = coalesce(l.city, 'budapest')
  from public.crm_leads l where l.id = d.lead_id and d.city is null;
update public.crm_deals set city = 'budapest' where city is null;

create or replace function public.crm_deals_city_fill() returns trigger language plpgsql as $$
begin
  if new.city is null then
    select l.city into new.city from public.crm_leads l where l.id = new.lead_id;
    new.city := coalesce(new.city, 'budapest');
  end if;
  return new;
end $$;
drop trigger if exists crm_deals_city_fill on public.crm_deals;
create trigger crm_deals_city_fill before insert on public.crm_deals
  for each row execute function public.crm_deals_city_fill();

alter table public.crm_masters add column if not exists city text;
update public.crm_masters set city = case when coalesce(district, '') ~* 'toronto' then 'toronto' else 'budapest' end
  where city is null;
alter table public.crm_masters alter column city set default 'budapest';

alter table public.crm_expenses add column if not exists city text;
update public.crm_expenses e set city = coalesce(
    (select l.city from public.crm_leads l where l.id = e.lead_id),
    (select m.city from public.crm_masters m where m.id = e.master_id),
    'budapest')
  where city is null;

create or replace function public.crm_expenses_city_fill() returns trigger language plpgsql as $$
begin
  if new.city is null then
    new.city := coalesce(
      (select l.city from public.crm_leads l where l.id = new.lead_id),
      (select m.city from public.crm_masters m where m.id = new.master_id),
      'budapest');
  end if;
  return new;
end $$;
drop trigger if exists crm_expenses_city_fill on public.crm_expenses;
create trigger crm_expenses_city_fill before insert on public.crm_expenses
  for each row execute function public.crm_expenses_city_fill();

alter table public.crm_ad_spend add column if not exists city text;
update public.crm_ad_spend
  set city = public.crm_city_of(jsonb_build_object('ad_account_id', meta_account_id), campaign, null)
  where city is null;

create or replace function public.crm_ad_spend_city_fill() returns trigger language plpgsql as $$
begin
  if new.city is null then
    new.city := public.crm_city_of(jsonb_build_object('ad_account_id', new.meta_account_id), new.campaign, null);
  end if;
  return new;
end $$;
drop trigger if exists crm_ad_spend_city_fill on public.crm_ad_spend;
create trigger crm_ad_spend_city_fill before insert on public.crm_ad_spend
  for each row execute function public.crm_ad_spend_city_fill();

do $$
declare t text;
begin
  foreach t in array array['crm_leads','crm_deals','crm_masters','crm_expenses','crm_ad_spend'] loop
    execute format('alter table public.%I alter column city set not null', t);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_city_check');
    execute format($f$alter table public.%I add constraint %I check (city in ('budapest','toronto','makati','orlando'))$f$, t, t || '_city_check');
  end loop;
end $$;

alter table public.crm_users add column if not exists city text;
alter table public.crm_users drop constraint if exists crm_users_city_check;
alter table public.crm_users add constraint crm_users_city_check
  check (city is null or city in ('budapest','toronto','makati','orlando'));
