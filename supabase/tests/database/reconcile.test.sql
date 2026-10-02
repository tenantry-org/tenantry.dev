-- customers_to_reconcile: everyone the reconcile run must check, as one array (not cut at max_rows).
-- Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(2);

insert into public.customers (customer_id, email)
select 'ctm_' || lpad(n::text, 4, '0'), 'buyer' || n || '@example.com' from generate_series(1, 1500) n;
insert into public.customers (customer_id, email) values
  ('ctm_access', 'access@example.com'), ('ctm_entitled', 'entitled@example.com'),
  ('ctm_linked', 'linked@example.com'), ('ctm_licensed', 'licensed@example.com'),
  ('ctm_lapsed', 'lapsed@example.com');

-- 1500 entitled customers, more than the API's max_rows.
insert into public.subscriptions (subscription_id, status, customer_id)
select 'sub_' || customer_id, 'active', customer_id from public.customers where customer_id ~ '^ctm_[0-9]+$';
insert into public.entitlements (customer_id, subscription_id, status)
select customer_id, 'sub_' || customer_id, 'active' from public.customers where customer_id ~ '^ctm_[0-9]+$';

insert into public.customer_access (customer_id, status) values ('ctm_access', 'grace'), ('ctm_lapsed', 'revoked');
insert into public.subscriptions (subscription_id, status, customer_id) values
  ('sub_entitled', 'past_due', 'ctm_entitled'), ('sub_lapsed', 'canceled', 'ctm_lapsed');
insert into public.entitlements (customer_id, subscription_id, status, grace_started_at) values
  ('ctm_entitled', 'sub_entitled', 'grace', now());
insert into public.entitlements (customer_id, subscription_id, status) values ('ctm_lapsed', 'sub_lapsed', 'revoked');
insert into public.github_links (customer_id, github_login, github_id) values ('ctm_linked', 'octocat', 1);
insert into public.licences (customer_id, jwt) values ('ctm_licensed', 'jwt');
insert into public.licences (customer_id, jwt, revoked) values ('ctm_lapsed', 'jwt', true);

select is(
  (select count(*)::int from unnest(public.customers_to_reconcile()) id where id ~ '^ctm_[0-9]{4}$'),
  1500, 'every entitled customer, past the 1000 rows an API query returns');
select ok(
  public.customers_to_reconcile() @> array['ctm_access', 'ctm_entitled', 'ctm_linked', 'ctm_licensed']
    and not public.customers_to_reconcile() @> array['ctm_lapsed'],
  'found by recorded access, entitlement, GitHub link and live licence; a lapsed customer is not');

select * from finish();
rollback;
