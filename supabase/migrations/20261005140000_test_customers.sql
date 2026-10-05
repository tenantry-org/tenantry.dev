-- A test customer: one the operator keeps for checks, such as Tenantry Pro's release check, whose feed token restores
-- every release through an operator grant dated far in the future (LAUNCH-SETUP.md, the feed step). The site sends it
-- no emails and the operator no alerts about it (customer-access.ts, the dashboard's feed token action). Only the
-- service role writes customers, so no customer can mark itself, and only an operator, by hand, sets it.

alter table public.customers
  add column is_test boolean not null default false;

comment on column public.customers.is_test is
  'A customer the operator keeps for checks: no emails are sent to it and no alerts about it. Set by hand only.';
