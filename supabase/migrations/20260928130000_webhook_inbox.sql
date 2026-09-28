-- Durable, ordered Paddle webhook ingestion.
--
-- The webhook used to process each notification inside the request, deduplicating with a read-then-write
-- on processed_webhook_events: two concurrent deliveries of one event could both pass the read, a slow
-- GitHub call could outlast Paddle's 5-second timeout, and nothing stored when an event occurred, so a
-- late subscription.updated(active) could re-grant access after a cancellation.
--
-- Now the webhook verifies the signature and inserts the event into webhook_inbox. The primary key makes
-- a duplicate delivery a no-op, including a concurrent one. It then answers, and a worker processes the
-- inbox:
--   * claim_webhook_events hands out due events one customer at a time, oldest first, so a customer's
--     events are never processed concurrently or out of order;
--   * record_subscription_event applies a subscription event only if it is not older than the last one
--     applied (subscriptions.last_event_at), as Paddle recommends, since delivery order is not guaranteed;
--   * a failed event is retried later with backoff. That includes a subscription event that arrived before
--     its customer, which fails the customers foreign key until customer.created is processed.

create table public.webhook_inbox (
  event_id text not null,
  event_type text not null,
  occurred_at timestamp with time zone not null,
  customer_id text null,
  subscription_id text null,
  payload jsonb not null,
  received_at timestamp with time zone not null default now(),
  -- pending until processed (done) or given up on (failed); a claimed event stays pending with locked_until
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamp with time zone not null default now(),
  locked_until timestamp with time zone null,
  last_error text null,
  processed_at timestamp with time zone null,
  constraint webhook_inbox_pkey primary key (event_id),
  constraint webhook_inbox_status_check check (status in ('pending', 'done', 'failed'))
);

create index webhook_inbox_due_idx on public.webhook_inbox (next_attempt_at) where status = 'pending';
create index webhook_inbox_customer_idx on public.webhook_inbox (customer_id, occurred_at) where status = 'pending';

-- Written and read only with the service-role key.
alter table public.webhook_inbox enable row level security;

-- Keep deduplicating events processed before the inbox existed.
insert into public.webhook_inbox (event_id, event_type, occurred_at, payload, status, processed_at)
select event_id, event_type, processed_at, '{}'::jsonb, 'done', processed_at
from public.processed_webhook_events
on conflict (event_id) do nothing;

drop table public.processed_webhook_events;

alter table public.subscriptions add column last_event_at timestamp with time zone null;

-- Claims up to p_limit due events and locks them for p_lock_seconds. For each customer it returns at most
-- their oldest pending event, and nothing while one of their events is locked by another worker.
create or replace function public.claim_webhook_events(p_limit integer, p_lock_seconds integer)
returns setof public.webhook_inbox
language plpgsql
security definer
set search_path = ''
as $$
begin
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

-- Records a subscription event unless a newer one has already been applied. Returns whether it was
-- applied. Raises a foreign-key violation if the customer does not exist yet.
create or replace function public.record_subscription_event(
  p_subscription_id text,
  p_customer_id text,
  p_status text,
  p_price_id text,
  p_product_id text,
  p_scheduled_change text,
  p_occurred_at timestamp with time zone
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  applied boolean;
begin
  insert into public.subscriptions as s (
    subscription_id, customer_id, subscription_status, price_id, product_id, scheduled_change, last_event_at, updated_at
  )
  values (
    p_subscription_id, p_customer_id, p_status, p_price_id, p_product_id, p_scheduled_change, p_occurred_at, now()
  )
  on conflict (subscription_id) do update
    set customer_id = excluded.customer_id,
        subscription_status = excluded.subscription_status,
        price_id = excluded.price_id,
        product_id = excluded.product_id,
        scheduled_change = excluded.scheduled_change,
        last_event_at = excluded.last_event_at,
        updated_at = now()
    where s.last_event_at is null or s.last_event_at <= excluded.last_event_at
  returning true into applied;

  return coalesce(applied, false);
end
$$;

revoke all on function public.claim_webhook_events(integer, integer) from public, anon, authenticated;
revoke all on function public.record_subscription_event(text, text, text, text, text, text, timestamp with time zone)
  from public, anon, authenticated;
grant execute on function public.claim_webhook_events(integer, integer) to service_role;
grant execute on function public.record_subscription_event(text, text, text, text, text, text, timestamp with time zone)
  to service_role;
