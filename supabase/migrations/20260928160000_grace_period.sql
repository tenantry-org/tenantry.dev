-- Dunning cutoff (implementation plan 6.6).
--
-- A past-due subscription's entitlement is 'grace' from its first past-due event, recorded in
-- grace_started_at; a recovered payment (or any other status) clears it. Grace lasts 30 days, matching
-- Paddle's default payment recovery, which cancels an unrecovered subscription after 30 days. After that
-- the entitlement no longer entitles the customer (customer-access.ts decides this at the time it runs,
-- so the row keeps mirroring Paddle's status), and the daily reconcile ends the customer's access even if
-- the cancellation never arrives. A past-due customer's licence runs only to the end of grace.

alter table public.entitlements add column grace_started_at timestamp with time zone null;

-- Existing past-due entitlements: their grace starts at their last update, the best record there is.
update public.entitlements set grace_started_at = updated_at where status = 'grace';

alter table public.entitlements
  add constraint entitlements_grace_started_check check ((status = 'grace') = (grace_started_at is not null));
