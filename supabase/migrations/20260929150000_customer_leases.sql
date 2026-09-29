-- Per-customer leases: GitHub account linking takes the same per-customer turn as Paddle events and
-- reconcile jobs.
--
-- The inbox worker processes one customer's events and reconcile jobs one at a time (claim_webhook_events),
-- but linking a GitHub account ran outside it. Relinking removes the previous account, replaces the link and
-- grants the new account; a reconcile job running meanwhile could read the previous link and add the previous
-- account back, and once the link was replaced nothing knew about that account, so it kept its access for
-- good.
--
-- acquire_customer_lease inserts a locked inbox row for the customer, a lease, unless one of the customer's
-- events is locked already (being processed). While the lease is held, claim_webhook_events hands out none of
-- the customer's events, as it already does for a customer whose event is being processed. Linking takes the
-- lease for its whole run and releases it (release_customer_lease), which completes the row. A lease whose
-- holder died expires with its lock; the worker then claims the row and completes it as a no-op.
--
-- Both functions lock the inbox table (share row exclusive, which does not block reads) for their short
-- transaction, so taking a lease and claiming events cannot interleave.

create or replace function public.claim_webhook_events(p_limit integer, p_lock_seconds integer)
returns setof public.webhook_inbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialises claims with acquire_customer_lease, so a claim cannot hand out a customer's event while a
  -- lease for them is being taken, or the other way round.
  lock table public.webhook_inbox in share row exclusive mode;

  return query
  with candidates as (
    select i.event_id
    from public.webhook_inbox i
    where i.status = 'pending'
      and i.next_attempt_at <= now()
      and (i.locked_until is null or i.locked_until < now())
      and not exists (
        select 1
        from public.webhook_inbox o
        where o.customer_id = i.customer_id
          and o.status = 'pending'
          and o.event_id <> i.event_id
          and (
            o.occurred_at < i.occurred_at
            or (o.occurred_at = i.occurred_at and o.event_id < i.event_id)
            or o.locked_until > now()
          )
      )
    order by i.occurred_at, i.event_id
    limit p_limit
    for update skip locked
  )
  update public.webhook_inbox i
  set locked_until = now() + make_interval(secs => p_lock_seconds),
      attempts = i.attempts + 1
  from candidates c
  where i.event_id = c.event_id
  returning i.*;
end
$$;


-- Takes a lease on the customer for p_seconds and returns its id, or null if one of the customer's events is
-- being processed or another lease is held (try again shortly).
create or replace function public.acquire_customer_lease(p_customer_id text, p_seconds integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease_id text := 'lease_' || p_customer_id || '_' || gen_random_uuid();
begin
  lock table public.webhook_inbox in share row exclusive mode;

  if exists (
    select 1
    from public.webhook_inbox i
    where i.customer_id = p_customer_id
      and i.status = 'pending'
      and i.locked_until > now()
  ) then
    return null;
  end if;

  insert into public.webhook_inbox (event_id, event_type, occurred_at, customer_id, payload, locked_until)
  values (
    lease_id,
    'tenantry.customer_lease',
    now(),
    p_customer_id,
    jsonb_build_object('event_id', lease_id, 'event_type', 'tenantry.customer_lease'),
    now() + make_interval(secs => p_seconds)
  );

  return lease_id;
end
$$;

-- Releases a lease: the customer's events can be claimed again.
create or replace function public.release_customer_lease(p_lease_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.webhook_inbox
  set status = 'done', locked_until = null, processed_at = now()
  where event_id = p_lease_id and event_type = 'tenantry.customer_lease';
$$;

revoke all on function public.acquire_customer_lease(text, integer) from public, anon, authenticated;
revoke all on function public.release_customer_lease(text) from public, anon, authenticated;
grant execute on function public.acquire_customer_lease(text, integer) to service_role;
grant execute on function public.release_customer_lease(text) to service_role;
