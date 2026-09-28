-- An entitlement is in grace exactly when it records when grace started (implementation plan 6.6).
-- Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.customers (customer_id, email) values ('ctm_1', 'buyer@example.com');
insert into public.subscriptions (subscription_id, subscription_status, customer_id) values
  ('sub_1', 'past_due', 'ctm_1'),
  ('sub_2', 'active', 'ctm_1');

select has_column('public', 'entitlements', 'grace_started_at', 'entitlements record when grace started');

select lives_ok(
  $$insert into public.entitlements (customer_id, subscription_id, tier, status, grace_started_at)
    values ('ctm_1', 'sub_1', 'pro', 'grace', now())$$,
  'a past-due entitlement in grace with its start');
select lives_ok(
  $$insert into public.entitlements (customer_id, subscription_id, tier, status)
    values ('ctm_1', 'sub_2', 'pro', 'active')$$,
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
