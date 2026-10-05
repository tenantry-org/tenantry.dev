-- An annual term vests when it is paid, as the EULA's section 2 grants it: a yearly payment kept in full vests
-- the releases published up to its term's end from the start of its billing period, and any refund, credit or
-- chargeback of it withdraws that (src/server/billing/entitlement-policy.ts). No grant waits for its term to end any
-- more, so:
--   vested_entitlements.status          is confirmed or withdrawn. A conditional row whose payment is recorded with no
--                                       refund, credit or chargeback against it is confirmed from its start, as the
--                                       next recompute of its customer would store it. Any other conditional row is
--                                       deleted: computed rows are only ever the recompute's, so the customer's next
--                                       recompute (reconcile visits them while the term's billing period lasts) stores
--                                       it as the ledger says, withdrawn if money was returned. Until then it vests
--                                       nothing.
--   active_subscriptions.conditional_through  goes: nothing is waiting to be confirmed.
--   set_customer_entitlement            no longer reads it.
--   customers_to_reconcile              no longer looks for conditional rows. A customer whose annual term has not
--                                       ended is still visited while its payment's billing period lasts
--                                       (20261005130000_reconcile_paid_time.sql).
-- There is no down migration. supabase/migration-tests/20261005160000_annual_term_vests_when_paid tests it against
-- rows of the schema before it.

update public.vested_entitlements v
set status = 'confirmed', confirmed_at = v.started_at, updated_at = now()
where v.status = 'conditional'
  and exists (select 1 from public.payments p where p.transaction_id = v.transaction_id)
  and not exists (
    select 1
    from public.payment_adjustments a
    where a.transaction_id = v.transaction_id
      and a.action in ('refund', 'credit', 'chargeback', 'refund_reverse', 'credit_reverse', 'chargeback_reverse')
      and a.status in ('approved', 'reversed')
  );

delete from public.vested_entitlements where status = 'conditional';

alter table public.vested_entitlements
  drop constraint vested_entitlements_status_check,
  add constraint vested_entitlements_status_check check (status in ('confirmed', 'withdrawn'));

alter table public.active_subscriptions drop column conditional_through;

-- As in 20261005100000_feed_access.sql, without conditional_through: stores a customer's derived state in one
-- transaction and returns the access status it replaced ('lapsed' for a customer seen for the first time).
--   p_state  access_status, grace_ends_at, run_started_at, paid_through, months_paid, vests_at
create or replace function public.set_customer_entitlement(
  p_customer_id text,
  p_state jsonb,
  p_grants jsonb,
  p_payment_statuses jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous text;
begin
  insert into public.active_subscriptions (customer_id) values (p_customer_id)
  on conflict (customer_id) do nothing;

  select s.access_status into previous
  from public.active_subscriptions s
  where s.customer_id = p_customer_id
  for update;

  update public.active_subscriptions s
  set access_status = p_state ->> 'access_status',
      grace_ends_at = (p_state ->> 'grace_ends_at')::timestamptz,
      run_started_at = (p_state ->> 'run_started_at')::timestamptz,
      paid_through = (p_state ->> 'paid_through')::timestamptz,
      months_paid = coalesce((p_state ->> 'months_paid')::integer, 0),
      vests_at = (p_state ->> 'vests_at')::timestamptz,
      updated_at = now()
  where s.customer_id = p_customer_id;

  delete from public.vested_entitlements v
  where v.customer_id = p_customer_id
    and v.kind <> 'operator'
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_grants, '[]')) g
      where g ->> 'kind' = v.kind and (g ->> 'started_at')::timestamptz = v.started_at
    );

  insert into public.vested_entitlements as v (
    customer_id, kind, started_at, vested_through, status, confirmed_at, transaction_id, withdrawn_reason
  )
  select
    p_customer_id,
    g ->> 'kind',
    (g ->> 'started_at')::timestamptz,
    (g ->> 'vested_through')::timestamptz,
    g ->> 'status',
    (g ->> 'confirmed_at')::timestamptz,
    g ->> 'transaction_id',
    g ->> 'withdrawn_reason'
  from jsonb_array_elements(coalesce(p_grants, '[]')) g
  where g ->> 'kind' <> 'operator'
  on conflict (customer_id, kind, started_at) do update
    set vested_through = excluded.vested_through,
        status = excluded.status,
        confirmed_at = excluded.confirmed_at,
        transaction_id = excluded.transaction_id,
        withdrawn_reason = excluded.withdrawn_reason,
        updated_at = now()
    where (v.vested_through, v.status, v.confirmed_at, v.transaction_id, v.withdrawn_reason)
      is distinct from
      (excluded.vested_through, excluded.status, excluded.confirmed_at, excluded.transaction_id,
       excluded.withdrawn_reason);

  update public.payments p
  set status = s.value, updated_at = now()
  from jsonb_each_text(coalesce(p_payment_statuses, '{}')) s
  where p.transaction_id = s.key and p.customer_id = p_customer_id and p.status <> s.value;

  return previous;
end
$$;

-- As in 20261005130000_reconcile_paid_time.sql, without the conditional grants.
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
  ) customers
$$;
