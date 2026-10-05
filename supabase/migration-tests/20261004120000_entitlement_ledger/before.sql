-- Rows as the baseline schema (20261002120000) held them, loaded before 20261004120000_entitlement_ledger.sql runs.
-- scripts/test-migrations.sh runs this, the migrations after the baseline, then after.sql. Not a transaction: the rows
-- must still be there when the migration runs.
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(1);

insert into public.customers (customer_id, email) values
  ('ctm_active', 'active@example.com'),
  ('ctm_grace', 'grace@example.com'),
  ('ctm_expired', 'expired@example.com'),
  ('ctm_no_entitlement', 'no-entitlement@example.com'),
  ('ctm_lapsed', 'lapsed@example.com'),
  ('ctm_paused', 'paused@example.com'),
  ('ctm_scheduled', 'scheduled@example.com');

insert into public.subscriptions (subscription_id, customer_id, status, product_id, last_event_at) values
  ('sub_active', 'ctm_active', 'active', 'pro_01', '2026-10-01 00:00+00'),
  ('sub_grace', 'ctm_grace', 'past_due', 'pro_01', '2026-10-01 00:05+00'),
  ('sub_expired', 'ctm_expired', 'past_due', 'pro_01', '2026-08-01 00:05+00'),
  ('sub_no_entitlement', 'ctm_no_entitlement', 'past_due', 'pro_01', '2026-09-15 00:00+00'),
  ('sub_lapsed', 'ctm_lapsed', 'canceled', 'pro_01', '2026-09-01 00:00+00');
-- Paused, and cancelled with the scheduled change it was cancelled by still recorded, with later events after it.
insert into public.subscriptions (
  subscription_id, customer_id, status, product_id, scheduled_change_at, scheduled_change_action, last_event_at
) values
  ('sub_paused', 'ctm_paused', 'paused', 'pro_01', null, null, '2026-09-10 00:00+00'),
  ('sub_scheduled', 'ctm_scheduled', 'canceled', 'pro_01', '2026-09-20 00:00+00', 'cancel', '2026-09-25 00:00+00');

insert into public.entitlements (customer_id, subscription_id, status, current_period_ends_at, grace_started_at, revoked_at)
values
  ('ctm_active', 'sub_active', 'active', '2026-11-01 00:00+00', null, null),
  ('ctm_grace', 'sub_grace', 'grace', '2026-11-01 00:00+00', '2026-10-01 00:05+00', null),
  -- Past due, but its entitlement was revoked (as the old code did when a subscription stopped being Pro): the old
  -- schema keeps no grace start for it.
  ('ctm_expired', 'sub_expired', 'revoked', '2026-09-01 00:00+00', null, '2026-08-31 04:00+00'),
  ('ctm_lapsed', 'sub_lapsed', 'revoked', null, null, '2026-09-01 00:00+00');

insert into public.customer_access (customer_id, status, github_state, github_invited_at) values
  ('ctm_active', 'active', 'invited', '2026-10-01 00:00+00'),
  ('ctm_grace', 'grace', 'active', null),
  ('ctm_lapsed', 'revoked', 'none', null);

insert into public.licences (customer_id, jwt, revoked) values
  ('ctm_active', 'active-key', false),
  ('ctm_lapsed', 'lapsed-key', true);

select pass('the baseline schema''s rows are loaded');
select * from finish();
