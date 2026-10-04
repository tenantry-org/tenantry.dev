-- Every price Tenantry Pro has been offered at. A payment counts towards vesting only at one of them
-- (src/server/billing/entitlement-policy.ts), and a subscriber keeps paying the price they subscribed at after the
-- offer prices change. So the set only grows: before it evaluates a customer, the site adds the configured
-- PADDLE_PRICE_MONTHLY and _YEARLY if they are missing (billing-store.ts: recordOfferedPrices, an upsert that ignores
-- rows already there), and nothing removes a row. Only the service role reads or writes it: row level security is on,
-- with no policy.

create table public.offered_prices (
  price_id text primary key,
  first_seen_at timestamp with time zone not null default now()
);

alter table public.offered_prices enable row level security;

comment on table public.offered_prices is
  'Every Paddle price Tenantry Pro has been offered at: a payment counts towards vesting only at one of them. Rows '
  'are only added (by the site, from its configured prices), never removed.';
