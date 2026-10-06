-- The daily reconcile run queues a job for every customer customers_to_reconcile returns, and drains for 45
-- seconds; the jobs it does not reach stay pending, for later drains. A new Paddle event, such as a new buyer's
-- payment, must not wait behind them, and a run must not add a second job for a customer whose job from an earlier
-- run is still pending.
--   customer_jobs            a customer has at most one pending reconcile job (customer_jobs_one_pending_reconcile).
--                            Pending duplicates are deleted first, keeping each customer's oldest.
--   enqueue_reconcile_jobs   queues a reconcile job for each customer who has none pending, and nothing for the
--                            others. The run calls it instead of an upsert, which cannot skip on a partial index.
--   claim_customer_jobs      hands out due Paddle events before due reconcile jobs, each oldest first. A customer's own
--                            jobs still run one at a time, in order: only their oldest pending job can be claimed. So
--                            a reconcile job that one of its customer's Paddle events waits for goes with the events.
-- There is no down migration. supabase/migration-tests/20261006090000_reconcile_backlog tests it against rows of the
-- schema before it.

delete from public.customer_jobs j
where j.kind = 'reconcile'
  and j.status = 'pending'
  and exists (
    select 1
    from public.customer_jobs o
    where o.kind = 'reconcile'
      and o.status = 'pending'
      and o.customer_id = j.customer_id
      and (o.occurred_at < j.occurred_at or (o.occurred_at = j.occurred_at and o.id < j.id))
  );

create unique index customer_jobs_one_pending_reconcile on public.customer_jobs (customer_id)
  where kind = 'reconcile' and status = 'pending';

-- Queues a reconcile job for each of these customers, as of p_occurred_at: it runs after their jobs that occurred
-- before. A customer who already has one pending, from an earlier run or still being run, gets no other.
create function public.enqueue_reconcile_jobs(p_customer_ids text[], p_occurred_at timestamp with time zone)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.customer_jobs (id, kind, customer_id, occurred_at)
  select 'reconcile_' || c.customer_id || '_' || gen_random_uuid(), 'reconcile', c.customer_id, p_occurred_at
  from (select distinct unnest(p_customer_ids) as customer_id) c
  on conflict do nothing;
$$;

-- As in 20261002120000_baseline.sql, with Paddle events first: claims up to p_limit due jobs and locks them for
-- p_lock_seconds, counting an attempt. For each customer it returns at most their oldest pending job, and nothing while
-- one of their jobs is locked (being run). Due Paddle events, and reconcile jobs that a Paddle event of their customer
-- waits for, come before other due reconcile jobs, each oldest first.
create or replace function public.claim_customer_jobs(p_limit integer, p_lock_seconds integer)
returns setof public.customer_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Claims run one at a time. Share row exclusive does not block reads.
  lock table public.customer_jobs in share row exclusive mode;

  return query
  with candidates as (
    select j.id
    from public.customer_jobs j
    where j.status = 'pending'
      and j.next_attempt_at <= now()
      and (j.locked_until is null or j.locked_until < now())
      and not exists (
        select 1
        from public.customer_jobs o
        where o.customer_id = j.customer_id
          and o.status = 'pending'
          and o.id <> j.id
          and (
            o.occurred_at < j.occurred_at
            or (o.occurred_at = j.occurred_at and o.id < j.id)
            or o.locked_until > now()
          )
      )
    order by
      j.kind = 'reconcile' and not exists (
        select 1
        from public.customer_jobs e
        where e.customer_id = j.customer_id
          and e.kind = 'paddle_event'
          and e.status = 'pending'
      ),
      j.occurred_at,
      j.id
    limit p_limit
    for update skip locked
  )
  update public.customer_jobs j
  set locked_until = now() + make_interval(secs => p_lock_seconds),
      attempts = j.attempts + 1
  from candidates c
  where j.id = c.id
  returning j.*;
end
$$;

revoke all on function public.enqueue_reconcile_jobs(text[], timestamp with time zone) from public, anon, authenticated;
grant execute on function public.enqueue_reconcile_jobs(text[], timestamp with time zone) to service_role;
