-- Whether an adjustment has been acted on (a cancellation, or an alert to the operator), so a retried job acts on what
-- an earlier attempt recorded, and an adjustment is not acted on twice by reconcile and the webhook.
--
--   payment_adjustments.consequences_applied_at  when the server last acted on the adjustment in its recorded status
--                                                (src/server/billing/apply-paddle-event.ts: actOnRecordedAdjustments);
--                                                null while that is still to do
--
-- record_payment_adjustment clears it when an event changes the recorded status, so an approval or a reversal is acted
-- on again. Rows recorded before this migration were acted on when they were recorded, so they are marked with their
-- updated_at. There is no down migration.

alter table public.payment_adjustments add column consequences_applied_at timestamp with time zone;

update public.payment_adjustments set consequences_applied_at = updated_at;

-- As in 20261005120000_money_kept.sql, clearing consequences_applied_at when the status changes.
create or replace function public.record_payment_adjustment(
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
        consequences_applied_at = case
          when a.last_event_at <= excluded.last_event_at and a.status <> excluded.status then null
          else a.consequences_applied_at
        end,
        updated_at = now()
    where a.last_event_at <= excluded.last_event_at
      or (a.approved_at is null and excluded.approved_at is not null)
      or (a.reversed_at is null and excluded.reversed_at is not null)
      or (a.subtotal is null and excluded.subtotal is not null)
  returning true into applied;

  return coalesce(applied, false);
end
$$;
