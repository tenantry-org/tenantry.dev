-- Every customer the reconcile run must check, in one call.
--
-- Reconcile found its customers with four API queries (entitled access, entitled subscriptions, GitHub
-- links, live licences). The API returns at most max_rows (1000) rows per query, so beyond that some
-- customers were never queued: their grace expiry, licence recovery and GitHub cleanup waited forever.
-- This function returns them as one array, a single value that max_rows does not cut short.

create or replace function public.customers_to_reconcile()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(customer_id order by customer_id), '{}')
  from (
    select customer_id from public.customer_access where status in ('active', 'grace')
    union
    select customer_id from public.entitlements where status in ('active', 'grace')
    union
    select customer_id from public.github_links
    union
    select customer_id from public.licences where not revoked
  ) customers
$$;

revoke all on function public.customers_to_reconcile() from public, anon, authenticated;
grant execute on function public.customers_to_reconcile() to service_role;
