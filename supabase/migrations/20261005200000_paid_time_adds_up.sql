-- Paid time adds up across gaps (the owner's decision of 5 October 2026): every payment's kept share of its billing
-- period counts towards 12 months, whatever the time between subscriptions, and once 12 months are served the customer
-- is vested through the end of the paid time served (src/server/billing/entitlement-policy.ts). There is no qualifying
-- period any more, so a gap no longer starts one afresh.
--   vested_entitlements.kind   'qualifying_run' becomes 'paid_time': one grant per customer for their paid time. Rows
--                              are renamed in place; their dates are the old rule's until the recompute below.
--   customer_jobs              a reconcile job is queued for every customer with a recorded payment, so each is
--                              recomputed under the new rule: a customer with paid time either side of a gap may now
--                              be vested, and one vested before has a later vested-through date. The daily reconcile
--                              would not visit a customer who lapsed long ago.
-- active_subscriptions keeps its columns: run_started_at, paid_through, months_paid and vests_at now describe the
-- customer's paid time (when it started, the end of the latest paid period, its whole months, and when it reaches 12
-- months), stored while the customer has access, as before. set_customer_entitlement and customers_to_reconcile are
-- unchanged. There is no down migration. supabase/migration-tests/20261005200000_paid_time_adds_up tests it against rows
-- of the schema before it.

alter table public.vested_entitlements drop constraint vested_entitlements_kind_check;

update public.vested_entitlements set kind = 'paid_time', updated_at = now() where kind = 'qualifying_run';

alter table public.vested_entitlements
  add constraint vested_entitlements_kind_check check (kind in ('paid_time', 'annual_term', 'operator'));

insert into public.customer_jobs (id, kind, customer_id, occurred_at)
select 'reconcile_' || c.customer_id || '_paid_time_adds_up', 'reconcile', c.customer_id, now()
from public.customers c
where exists (select 1 from public.payments p where p.customer_id = c.customer_id)
on conflict (id) do nothing;
