-- An entitlement is in grace exactly when it records when grace started, and every entitlement is a subscription's.
-- Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(5);

insert into public.customers (customer_id, email) values ('ctm_1', 'buyer@example.com');
insert into public.subscriptions (subscription_id, status, customer_id) values
  ('sub_1', 'past_due', 'ctm_1'),
  ('sub_2', 'active', 'ctm_1');

select throws_ok(
  $$insert into public.entitlements (customer_id, status) values ('ctm_1', 'active')$$,
  '23502', null,
  'rejects an entitlement without a subscription');

select lives_ok(
  $$insert into public.entitlements (customer_id, subscription_id, status, grace_started_at)
    values ('ctm_1', 'sub_1', 'grace', now())$$,
  'a past-due entitlement in grace with its start');
select lives_ok(
  $$insert into public.entitlements (customer_id, subscription_id, status)
    values ('ctm_1', 'sub_2', 'active')$$,
  'an active entitlement without one');
select throws_ok(
  $$update public.entitlements set grace_started_at = null where subscription_id = 'sub_1'$$,
  '23514', null,
  'rejects grace without its start');
select throws_ok(
  $$update public.entitlements set grace_started_at = now() where subscription_id = 'sub_2'$$,
  '23514', null,
  'rejects a grace start on an entitlement that is not in grace');

select * from finish();
rollback;
