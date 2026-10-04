-- Tenantry Pro is no longer delivered through GitHub: customers restore it from the package feed with feed tokens
-- (20261004130000_package_feed.sql), and no customer's GitHub account is added to a team any more. GitHub stays a way
-- to sign in, which Supabase Auth keeps in its own tables.
--
-- What this migration drops, and what follows:
--   github_links                         the GitHub account each customer connected for team access; the rows go
--   active_subscriptions.github_state,   where each customer's team membership stood; set_customer_entitlement and
--   active_subscriptions.github_invited_at  customers_to_reconcile no longer read or write them
--   acquire_customer_lease,              the per-customer turn that connecting a GitHub account took beside the
--   release_customer_lease, and the      customer's jobs; nothing else takes one, so the kind goes, with any lease
--   customer_jobs kind 'lease'           left pending
-- Nothing a customer can do or see depends on them. There is no down migration: going back means restoring a backup
-- taken before it. supabase/migration-tests/20261005090000_retire_github_delivery tests it against rows of the schema
-- before it.

drop table public.github_links;

alter table public.active_subscriptions
  drop constraint active_subscriptions_github_invited_check,
  drop column github_state,
  drop column github_invited_at;

-- As in 20261004120000_entitlement_ledger.sql, without the GitHub state: stores a customer's derived state in one
-- transaction and returns the access status it replaced ('lapsed' for a customer seen for the first time). The row lock
-- makes concurrent calls for one customer run one after the other, so exactly one of them sees each change of access.
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
      run_started_at = (p_state ->> 'run_started_at')::timestamptz,
      paid_through = (p_state ->> 'paid_through')::timestamptz,
      months_paid = coalesce((p_state ->> 'months_paid')::integer, 0),
      vests_at = (p_state ->> 'vests_at')::timestamptz,
      conditional_through = (p_state ->> 'conditional_through')::timestamptz,
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

-- Every customer the reconcile run must check: anyone with access recorded or a subscription that may entitle them,
-- whose licence is failing, or whose entitlement can change with time alone (a current run, or an annual grant waiting
-- for its term to end).
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
  ) customers
$$;

-- Leases: only connecting a GitHub account took one.
drop function public.acquire_customer_lease(text, integer);
drop function public.release_customer_lease(text);

delete from public.customer_jobs where kind = 'lease';

alter table public.customer_jobs
  drop constraint customer_jobs_kind_check,
  add constraint customer_jobs_kind_check check (kind in ('paddle_event', 'reconcile'));
