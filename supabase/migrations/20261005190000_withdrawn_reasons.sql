-- A grant is withdrawn only by money returned: vested_entitlements.withdrawn_reason is refund or chargeback.
-- term_not_completed (an annual term whose subscription ended before the term did) has not been produced since vesting
-- follows the money kept (20261005120000_money_kept.sql), and an annual term now vests when it is paid
-- (20261005160000_annual_term_vests_when_paid.sql). A row still saying so is a computed row: it is deleted, and the
-- customer's next recompute stores what the ledger says. A withdrawn row vests nothing, so nothing is lost meanwhile.
-- There is no down migration. supabase/migration-tests/20261005190000_withdrawn_reasons tests it against rows of the
-- schema before it.

delete from public.vested_entitlements where withdrawn_reason = 'term_not_completed';

alter table public.vested_entitlements
  drop constraint vested_entitlements_withdrawn_reason_check,
  add constraint vested_entitlements_withdrawn_reason_check check (withdrawn_reason in ('refund', 'chargeback'));
