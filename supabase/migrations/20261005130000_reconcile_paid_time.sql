-- Reconcile visits every customer whose entitlement can still change with time alone. Vesting follows the money kept
-- (20261005120000_money_kept.sql), so a payment kept in full counts for its whole period even after the subscription
-- ended: a customer cancelled at once in their 12th paid month vests when that month has been served, while lapsed.
-- customers_to_reconcile therefore adds anyone with a payment whose billing period ends after now less two days (a
-- day's margin either side of the daily run). A payment's counted time never ends after its billing period does, so
-- once every period has been served for two days, time alone changes nothing more.
--
-- The rest is customers_to_reconcile as 20261005090000_retire_github_delivery.sql left it.

create or replace function public.customers_to_reconcile()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(customer_id order by customer_id), '{}')
  from (
    select customer_id from public.active_subscriptions
    where access_status in ('active', 'grace') or run_started_at is not null
    union
    select customer_id from public.subscriptions where status in ('active', 'trialing', 'past_due')
    union
    select customer_id from public.licence_failures
    union
    select customer_id from public.vested_entitlements where status = 'conditional'
    union
    select customer_id from public.payments where period_ends_at > now() - interval '2 days'
  ) customers
$$;

create index payments_period_ends_at_idx on public.payments (period_ends_at);
