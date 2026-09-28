-- Ordered customer events.
--
-- customer.created and customer.updated overwrote customers.email whatever their age. Paddle does not
-- guarantee delivery order, and the inbox only orders the events it holds at once, so a customer.updated
-- delivered late (after a newer email change was applied) restored the previous email. customers.email
-- decides which signed-in account owns the customer (confirmed-email ownership), so that handed the
-- subscriptions, licence and GitHub link back to the previous address's account.
--
-- record_customer_event now applies a customer event only if it is not older than the last one applied
-- (customers.last_event_at), as record_subscription_event does for subscriptions.

alter table public.customers add column last_event_at timestamp with time zone null;

-- Records a customer's email from a customer event unless a newer event has already been applied. Returns
-- whether it was applied. The email is normalised by the customers_normalise_email trigger.
create or replace function public.record_customer_event(
  p_customer_id text,
  p_email text,
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
  insert into public.customers as c (customer_id, email, last_event_at, updated_at)
  values (p_customer_id, p_email, p_occurred_at, now())
  on conflict (customer_id) do update
    set email = excluded.email,
        last_event_at = excluded.last_event_at,
        updated_at = now()
    where c.last_event_at is null or c.last_event_at <= excluded.last_event_at
  returning true into applied;

  return coalesce(applied, false);
end
$$;

revoke all on function public.record_customer_event(text, text, timestamp with time zone)
  from public, anon, authenticated;
grant execute on function public.record_customer_event(text, text, timestamp with time zone) to service_role;
