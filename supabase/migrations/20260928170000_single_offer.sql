-- One Pro offer (D10): there are no tiers. A customer is entitled to Pro or not, so the tier recorded on
-- each entitlement, on the customer's access and on each licence is dropped, and set_customer_access no
-- longer takes one. Which Paddle product is Pro is configuration (PADDLE_PRO_PRODUCT_ID).

alter table public.entitlements drop column tier;
alter table public.customer_access drop column tier;
alter table public.licences drop column tier;

drop function public.set_customer_access(text, text, text);

-- Records a customer's access and returns the status it replaced ('revoked' for a customer seen for the
-- first time). The row lock makes concurrent calls for one customer run one after the other, so exactly
-- one of them sees each change. Ending access clears github_granted: the caller then removes the account
-- from the team, and reconcile retries that removal if it fails.
create function public.set_customer_access(p_customer_id text, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous text;
begin
  insert into public.customer_access (customer_id) values (p_customer_id)
  on conflict (customer_id) do nothing;

  select a.status into previous
  from public.customer_access a
  where a.customer_id = p_customer_id
  for update;

  update public.customer_access a
  set status = p_status,
      github_granted = a.github_granted and p_status <> 'revoked',
      updated_at = now()
  where a.customer_id = p_customer_id;

  return previous;
end
$$;

revoke all on function public.set_customer_access(text, text) from public, anon, authenticated;
grant execute on function public.set_customer_access(text, text) to service_role;
