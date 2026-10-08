-- Reconcile visits a customer with a recorded refund, credit or chargeback not yet acted on
-- (payment_adjustments.consequences_applied_at is null), so a lapsed customer whose adjustment job failed for good
-- still has it acted on and their entitlement recomputed. Each adjustment is marked acted on once that succeeds, so the
-- customer is visited only until then. There is no down migration.

-- As in 20261005160000_annual_term_vests_when_paid.sql, with customers who have an adjustment still to act on.
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
    select customer_id from public.payments where period_ends_at > now() - interval '2 days'
    union
    select customer_id from public.payment_adjustments where consequences_applied_at is null
  ) customers
$$;
