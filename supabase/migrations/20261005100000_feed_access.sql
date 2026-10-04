-- What the Pro access page and the package feed need to agree on a customer's access, and to show feed tokens safely.
--
--   active_subscriptions.grace_ends_at  when a customer in grace loses access if no payment recovers. A customer whose
--                                       grace has ended is lapsed from that moment for the feed and the dashboard
--                                       (src/server/billing/entitlement-policy.ts: currentAccess), even before the
--                                       daily reconcile records it, so neither serves a day longer than the other.
--                                       set_customer_entitlement writes it; set only while access_status is grace.
--   feed_customer                       returns grace_ends_at too, for the same rule.
--   feed_tokens                         a signed-in owner reads every column but token_hash: the hash is of no use to
--                                       them, and nothing a browser can reach should hold it.
--
-- supabase/migration-tests/20261005100000_feed_access tests the backfill against rows of the schema before it.

alter table public.active_subscriptions add column grace_ends_at timestamp with time zone;

-- A customer recorded in grace takes the latest grace end of their past-due subscriptions, as accessFor computes it
-- (the first past-due event plus 30 days), or now if none is recorded, so a missing date never extends access.
update public.active_subscriptions a
set grace_ends_at = coalesce(
      (select max(s.grace_started_at) + interval '30 days'
       from public.subscriptions s
       where s.customer_id = a.customer_id and s.status = 'past_due'),
      now()
    )
where a.access_status = 'grace';

alter table public.active_subscriptions
  add constraint active_subscriptions_grace_check check ((access_status = 'grace') = (grace_ends_at is not null));

-- As in 20261005090000_retire_github_delivery.sql, with the grace end: stores a customer's derived state in one
-- transaction and returns the access status it replaced ('lapsed' for a customer seen for the first time).
--   p_state  access_status, grace_ends_at, run_started_at, paid_through, months_paid, vests_at, conditional_through
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

-- The customer a feed token belongs to, with what the feed needs to decide what they may restore: their recorded
-- access (lapsed if never recorded), when a grace period ends, and their vested-through date. No row for an unknown or
-- revoked token. Records the use, at most once an hour.
drop function public.feed_customer(text);

create function public.feed_customer(p_token_hash text)
returns table (
  customer_id text,
  access_status text,
  grace_ends_at timestamp with time zone,
  vested_through timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  token public.feed_tokens%rowtype;
begin
  select * into token from public.feed_tokens t where t.token_hash = p_token_hash and t.revoked_at is null;
  if not found then
    return;
  end if;

  if token.last_used_at is null or token.last_used_at < now() - interval '1 hour' then
    update public.feed_tokens t set last_used_at = now() where t.id = token.id;
  end if;

  return query
  select
    token.customer_id,
    coalesce(s.access_status, 'lapsed'),
    s.grace_ends_at,
    public.vested_through(token.customer_id)
  from (select 1) one
  left join public.active_subscriptions s on s.customer_id = token.customer_id;
end
$$;

revoke all on function public.feed_customer(text) from public, anon, authenticated;
grant execute on function public.feed_customer(text) to service_role;

-- A signed-in owner reads their tokens without the hash (the owner policy still limits the rows).
revoke select on public.feed_tokens from anon, authenticated;
grant select (id, customer_id, name, prefix, created_at, last_used_at, revoked_at) on public.feed_tokens
  to authenticated;
