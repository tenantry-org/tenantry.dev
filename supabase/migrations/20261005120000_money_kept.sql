-- Vesting follows the money kept (the owner's decision of 4 October 2026): a payment counts for the part of its billing
-- period that the money still kept from it pays for (src/server/billing/entitlement-policy.ts). That needs what each
-- payment charged and what each adjustment returned, on one basis: before tax.
--   payments.tax                  Paddle's details.totals.tax, so total less tax is what was charged before tax, after
--                                 any discount
--   payment_adjustments.subtotal  Paddle's totals.subtotal, what it returned before tax (0 for a tax-only correction)
--   payment_adjustments.currency_code
--
-- Nothing is backfilled: the amounts of rows recorded before this migration are not known. Until a replay of their
-- Paddle notification fills them in, the rules take an adjustment of unknown amount to return everything (unless it is
-- tax only), and a payment of unknown tax to have charged its subtotal less its discount. Only sandbox rows exist when
-- this is written.
--
-- record_payment and record_payment_adjustment take the new arguments; their old forms are dropped. There is no down
-- migration.

alter table public.payments add column tax bigint;
alter table public.payment_adjustments
  add column subtotal bigint check (subtotal is null or subtotal >= 0),
  add column currency_code text;

drop function public.record_payment(
  text, text, text, text, text, text, integer, timestamp with time zone, timestamp with time zone, bigint, bigint,
  bigint, text, timestamp with time zone
);

-- As before, with the tax.
create function public.record_payment(
  p_transaction_id text,
  p_customer_id text,
  p_subscription_id text,
  p_origin text,
  p_price_id text,
  p_billing_interval text,
  p_billing_frequency integer,
  p_period_starts_at timestamp with time zone,
  p_period_ends_at timestamp with time zone,
  p_subtotal bigint,
  p_discount bigint,
  p_total bigint,
  p_currency_code text,
  p_tax bigint,
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
  insert into public.payments as p (
    transaction_id, customer_id, subscription_id, origin, price_id, billing_interval, billing_frequency,
    period_starts_at, period_ends_at, subtotal, discount, total, currency_code, tax, completed_at, last_event_at
  )
  values (
    p_transaction_id, p_customer_id, p_subscription_id, p_origin, p_price_id, p_billing_interval,
    p_billing_frequency, p_period_starts_at, p_period_ends_at, p_subtotal, p_discount, p_total, p_currency_code, p_tax,
    p_occurred_at, p_occurred_at
  )
  on conflict (transaction_id) do update
    set customer_id = excluded.customer_id,
        subscription_id = excluded.subscription_id,
        origin = excluded.origin,
        price_id = excluded.price_id,
        billing_interval = excluded.billing_interval,
        billing_frequency = excluded.billing_frequency,
        period_starts_at = excluded.period_starts_at,
        period_ends_at = excluded.period_ends_at,
        subtotal = excluded.subtotal,
        discount = excluded.discount,
        total = excluded.total,
        currency_code = excluded.currency_code,
        tax = coalesce(excluded.tax, p.tax),
        last_event_at = excluded.last_event_at,
        updated_at = now()
    where p.last_event_at <= excluded.last_event_at
  returning true into applied;

  return coalesce(applied, false);
end
$$;

drop function public.record_payment_adjustment(
  text, text, text, text, text, text, text[], text, timestamp with time zone, timestamp with time zone,
  timestamp with time zone
);

-- As before, with the amount returned before tax and its currency. An amount, once known, is kept: an adjustment's
-- amount does not change, so an event that lacks it does not clear it, and a replay of an event that has it fills it
-- in.
create function public.record_payment_adjustment(
  p_adjustment_id text,
  p_transaction_id text,
  p_customer_id text,
  p_subscription_id text,
  p_action text,
  p_type text,
  p_item_types text[],
  p_status text,
  p_subtotal bigint,
  p_currency_code text,
  p_created_at timestamp with time zone,
  p_updated_at timestamp with time zone,
  p_occurred_at timestamp with time zone
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  applied boolean;
  approved timestamp with time zone :=
    case p_status when 'approved' then p_updated_at when 'reversed' then p_created_at end;
  reversed timestamp with time zone := case when p_status = 'reversed' then p_updated_at end;
begin
  insert into public.payment_adjustments as a (
    adjustment_id, transaction_id, customer_id, subscription_id, action, type, item_types, status, subtotal,
    currency_code, approved_at, reversed_at, last_event_at
  )
  values (
    p_adjustment_id, p_transaction_id, p_customer_id, p_subscription_id, p_action, p_type,
    coalesce(p_item_types, '{}'), p_status, p_subtotal, p_currency_code, approved, reversed, p_occurred_at
  )
  on conflict (adjustment_id) do update
    set status = case when a.last_event_at <= excluded.last_event_at then excluded.status else a.status end,
        item_types = case when a.last_event_at <= excluded.last_event_at then excluded.item_types else a.item_types end,
        subtotal = coalesce(a.subtotal, excluded.subtotal),
        currency_code = coalesce(a.currency_code, excluded.currency_code),
        approved_at = coalesce(a.approved_at, excluded.approved_at),
        reversed_at = coalesce(a.reversed_at, excluded.reversed_at),
        last_event_at = greatest(a.last_event_at, excluded.last_event_at),
        updated_at = now()
    where a.last_event_at <= excluded.last_event_at
      or (a.approved_at is null and excluded.approved_at is not null)
      or (a.reversed_at is null and excluded.reversed_at is not null)
      or (a.subtotal is null and excluded.subtotal is not null)
  returning true into applied;

  return coalesce(applied, false);
end
$$;

revoke all on function public.record_payment(
  text, text, text, text, text, text, integer, timestamp with time zone, timestamp with time zone, bigint, bigint,
  bigint, text, bigint, timestamp with time zone
) from public, anon, authenticated;
revoke all on function public.record_payment_adjustment(
  text, text, text, text, text, text, text[], text, bigint, text, timestamp with time zone, timestamp with time zone,
  timestamp with time zone
) from public, anon, authenticated;

grant execute on function public.record_payment(
  text, text, text, text, text, text, integer, timestamp with time zone, timestamp with time zone, bigint, bigint,
  bigint, text, bigint, timestamp with time zone
) to service_role;
grant execute on function public.record_payment_adjustment(
  text, text, text, text, text, text, text[], text, bigint, text, timestamp with time zone, timestamp with time zone,
  timestamp with time zone
) to service_role;
