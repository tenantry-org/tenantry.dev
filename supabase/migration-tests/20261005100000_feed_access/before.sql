-- Rows as the schema after 20261005090000_retire_github_delivery.sql held them, loaded before
-- 20261005100000_feed_access.sql runs. scripts/test-migrations.sh runs this, the migrations after it, then after.sql.
-- Not a transaction: the rows must still be there when the migration runs.
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(1);

insert into public.customers (customer_id, email) values
  ('ctm_active', 'active@example.com'),
  ('ctm_grace', 'grace@example.com'),
  ('ctm_grace_two', 'grace-two@example.com'),
  ('ctm_grace_unknown', 'grace-unknown@example.com'),
  ('ctm_lapsed', 'lapsed@example.com');

insert into public.subscriptions (subscription_id, customer_id, status, product_id, grace_started_at, last_event_at)
values
  ('sub_active', 'ctm_active', 'active', 'pro_01', null, '2026-10-01 00:00+00'),
  ('sub_grace', 'ctm_grace', 'past_due', 'pro_01', '2026-10-01 00:00+00', '2026-10-01 00:00+00'),
  -- Two past-due subscriptions: grace lasts until the later one's ends.
  ('sub_grace_a', 'ctm_grace_two', 'past_due', 'pro_01', '2026-09-20 00:00+00', '2026-09-20 00:00+00'),
  ('sub_grace_b', 'ctm_grace_two', 'past_due', 'pro_01', '2026-09-25 00:00+00', '2026-09-25 00:00+00'),
  ('sub_lapsed', 'ctm_lapsed', 'canceled', 'pro_01', null, '2026-09-01 00:00+00');

insert into public.active_subscriptions (customer_id, access_status) values
  ('ctm_active', 'active'),
  ('ctm_grace', 'grace'),
  ('ctm_grace_two', 'grace'),
  -- Recorded in grace with no past-due subscription to take a date from.
  ('ctm_grace_unknown', 'grace'),
  ('ctm_lapsed', 'lapsed');

insert into public.feed_tokens (customer_id, name, token_hash, prefix) values
  ('ctm_grace', 'CI', encode(sha256('tpf_grace'), 'hex'), 'tpf_grac');

select pass('the rows of the schema before the grace end are loaded');
select * from finish();
