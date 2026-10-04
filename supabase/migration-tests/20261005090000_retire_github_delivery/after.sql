-- What 20261005090000_retire_github_delivery.sql made of before.sql's rows. Run by scripts/test-migrations.sh, after
-- every later migration too.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(12);

select hasnt_table('public', 'github_links', 'github_links is dropped');
select hasnt_column('public', 'active_subscriptions', 'github_state', 'active_subscriptions.github_state is dropped');
select hasnt_column('public', 'active_subscriptions', 'github_invited_at',
  'active_subscriptions.github_invited_at is dropped');
select results_eq(
  $$select customer_id, access_status, run_started_at, months_paid from public.active_subscriptions
    order by customer_id$$,
  $$values
    ('ctm_invited'::text, 'grace'::text, null::timestamptz, 0),
    ('ctm_linked_lapsed', 'lapsed', null, 0),
    ('ctm_member', 'active', '2026-09-01 00:00+00', 2),
    ('ctm_unlinked', 'active', null, 0)$$,
  'each customer keeps their access and current run');
select results_eq(
  $$select customer_id, vested_through from public.vested_entitlements$$,
  $$values ('ctm_linked_lapsed'::text, '2026-01-01 00:00+00'::timestamptz)$$,
  'vested entitlements are kept');
select results_eq($$select customer_id, name from public.feed_tokens$$, $$values ('ctm_member'::text, 'laptop'::text)$$,
  'feed tokens are kept');

select results_eq($$select id from public.customer_jobs order by id$$, $$values ('reconcile_ctm_member_1'::text)$$,
  'leases are deleted, held or finished, and the job a held lease was holding back is kept');
select results_eq($$select id from public.claim_customer_jobs(10, 60)$$, $$values ('reconcile_ctm_member_1'::text)$$,
  'and is handed out at once');
select throws_ok(
  $$insert into public.customer_jobs (id, kind, customer_id, occurred_at) values ('lease_x', 'lease', 'ctm_member', now())$$,
  '23514', null, 'a lease can no longer be queued');
select hasnt_function('public', 'acquire_customer_lease', 'acquire_customer_lease is dropped');

select is(public.customers_to_reconcile(), array['ctm_invited', 'ctm_member', 'ctm_unlinked'],
  'reconcile no longer checks a customer for a GitHub link alone (ctm_linked_lapsed)');
select is(public.set_customer_entitlement('ctm_invited', '{"access_status": "lapsed"}', '[]', '{}'), 'grace',
  'set_customer_entitlement stores a migrated customer''s state and returns the access it replaced');

select * from finish();
rollback;
