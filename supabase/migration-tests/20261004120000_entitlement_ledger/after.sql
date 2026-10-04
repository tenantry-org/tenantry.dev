-- What 20261004120000_entitlement_ledger.sql made of before.sql's rows. Run by scripts/test-migrations.sh.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(10);

select results_eq(
  $$select subscription_id, current_period_ends_at, grace_started_at from public.subscriptions order by subscription_id$$,
  $$values
    ('sub_active'::text, '2026-11-01 00:00+00'::timestamptz, null::timestamptz),
    ('sub_expired', '2026-09-01 00:00+00', '2026-08-01 04:00+00'),
    ('sub_grace', '2026-11-01 00:00+00', '2026-10-01 00:05+00'),
    ('sub_lapsed', null, null),
    ('sub_no_entitlement', null, '2026-09-15 00:00+00'),
    ('sub_paused', null, null),
    ('sub_scheduled', null, null)$$,
  'each subscription takes its entitlement''s period end and grace start');
select ok(
  (select grace_started_at + interval '30 days' <= '2026-08-31 04:00+00'
   from public.subscriptions where subscription_id = 'sub_expired'),
  'a past-due subscription whose entitlement was revoked has a grace start whose grace had ended by then');
select is(
  (select count(*)::int from public.subscriptions where status = 'past_due' and grace_started_at is null), 0,
  'no past-due subscription is left without a grace start');

select results_eq(
  $$select subscription_id, ended_at from public.subscriptions order by subscription_id$$,
  $$values
    ('sub_active'::text, null::timestamptz),
    ('sub_expired', null),
    ('sub_grace', null),
    ('sub_lapsed', '2026-09-01 00:00+00'),
    ('sub_no_entitlement', null),
    ('sub_paused', '2026-09-10 00:00+00'),
    ('sub_scheduled', '2026-09-20 00:00+00')$$,
  'a cancelled or paused subscription ended at its scheduled change, if recorded, or at its last event; others run');

select results_eq(
  $$select customer_id, access_status, github_state, github_invited_at from public.active_subscriptions
    order by customer_id$$,
  $$values
    ('ctm_active'::text, 'active'::text, 'invited'::text, '2026-10-01 00:00+00'::timestamptz),
    ('ctm_grace', 'grace', 'active', null),
    ('ctm_lapsed', 'lapsed', 'none', null)$$,
  'customer access becomes active_subscriptions, revoked as lapsed, with the GitHub state');
select is((select count(*)::int from public.active_subscriptions where run_started_at is not null), 0,
  'no run is recorded until the first recompute');

select hasnt_table('public', 'entitlements', 'entitlements is dropped');
select hasnt_table('public', 'customer_access', 'customer_access is dropped');
select hasnt_column('public', 'licences', 'revoked', 'licences.revoked is dropped');
select results_eq(
  $$select customer_id, jwt from public.licences order by customer_id$$,
  $$values ('ctm_active'::text, 'active-key'::text), ('ctm_lapsed', 'lapsed-key')$$,
  'every key is kept, a revoked one included');

select * from finish();
rollback;
