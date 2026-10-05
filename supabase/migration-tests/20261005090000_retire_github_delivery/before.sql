-- Rows as the schema after 20261004130000_package_feed.sql held them, loaded before
-- 20261005090000_retire_github_delivery.sql runs. scripts/test-migrations.sh runs this, the migrations after it, then
-- after.sql. Not a transaction: the rows must still be there when the migration runs.
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(1);

insert into public.customers (customer_id, email) values
  ('ctm_member', 'member@example.com'),
  ('ctm_invited', 'invited@example.com'),
  ('ctm_linked_lapsed', 'linked-lapsed@example.com'),
  ('ctm_unlinked', 'unlinked@example.com');

insert into public.github_links (customer_id, github_id, github_login) values
  ('ctm_member', 101, 'member-gh'),
  ('ctm_invited', 102, 'invited-gh'),
  ('ctm_linked_lapsed', 103, 'lapsed-gh');

insert into public.active_subscriptions (
  customer_id, access_status, github_state, github_invited_at, run_started_at, paid_through, months_paid, vests_at
) values
  ('ctm_member', 'active', 'active', null, '2026-09-01 00:00+00', '2026-11-01 00:00+00', 2, '2027-09-01 00:00+00'),
  ('ctm_invited', 'grace', 'invited', '2026-10-01 00:00+00', null, null, 0, null),
  ('ctm_linked_lapsed', 'lapsed', 'none', null, null, null, 0, null),
  ('ctm_unlinked', 'active', 'failed', null, null, null, 0, null);

insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, confirmed_at) values
  ('ctm_linked_lapsed', 'qualifying_run', '2025-01-01 00:00+00', '2026-01-01 00:00+00', 'confirmed',
   '2026-01-01 00:00+00');

insert into public.feed_tokens (customer_id, name, token_hash, prefix) values
  ('ctm_member', 'laptop', repeat('a', 64), 'tpf_abcd');

-- A lease held by a GitHub connection, the customer's job it was holding back, and a lease long finished.
insert into public.customer_jobs (id, kind, customer_id, occurred_at, locked_until) values
  ('lease_ctm_member_1', 'lease', 'ctm_member', '2026-10-04 12:00+00', now() + interval '1 minute');
insert into public.customer_jobs (id, kind, customer_id, occurred_at) values
  ('reconcile_ctm_member_1', 'reconcile', 'ctm_member', '2026-10-04 12:01+00');
insert into public.customer_jobs (id, kind, customer_id, occurred_at, status, processed_at) values
  ('lease_ctm_invited_1', 'lease', 'ctm_invited', '2026-10-01 12:00+00', 'done', '2026-10-01 12:00+00');

select pass('the rows of the schema before the GitHub retirement are loaded');
select * from finish();
