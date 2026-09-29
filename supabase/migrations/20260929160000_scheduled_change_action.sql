-- 6.17: the customer's billing card says when a subscription ends, and offers to keep it, only when the
-- scheduled change is a cancellation. subscriptions.scheduled_change held only when a change takes effect,
-- not what it is, so the action is stored beside it (cancel, pause or resume, as Paddle reports it).

alter table public.subscriptions add column scheduled_change_action text null;

drop function public.record_subscription_event(text, text, text, text, text, text, timestamp with time zone);

-- Records a subscription event unless a newer one has already been applied. Returns whether it was
-- applied. Raises a foreign-key violation if the customer does not exist yet.
create function public.record_subscription_event(
  p_subscription_id text,
  p_customer_id text,
  p_status text,
  p_price_id text,
  p_product_id text,
  p_scheduled_change text,
  p_scheduled_change_action text,
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
    subscription_id, customer_id, subscription_status, price_id, product_id, scheduled_change,
    scheduled_change_action, last_event_at, updated_at
  )
  values (
    p_subscription_id, p_customer_id, p_status, p_price_id, p_product_id, p_scheduled_change,
    p_scheduled_change_action, p_occurred_at, now()
  )
  on conflict (subscription_id) do update
    set customer_id = excluded.customer_id,
        subscription_status = excluded.subscription_status,
        price_id = excluded.price_id,
        product_id = excluded.product_id,
        scheduled_change = excluded.scheduled_change,
        scheduled_change_action = excluded.scheduled_change_action,
        last_event_at = excluded.last_event_at,
        updated_at = now()
    where s.last_event_at is null or s.last_event_at <= excluded.last_event_at
  returning true into applied;

  return coalesce(applied, false);
end
$$;

revoke all on function public.record_subscription_event(text, text, text, text, text, text, text, timestamp with time zone)
  from public, anon, authenticated;
grant execute on function public.record_subscription_event(text, text, text, text, text, text, text, timestamp with time zone)
  to service_role;
