-- Customer-level access (implementation plan 6.4).
--
-- A customer can hold several subscriptions, each with its own entitlement. GitHub access and the
-- licence belong to the customer, so they follow the customer as a whole: access starts when the first
-- entitlement becomes active (or grace) and ends only when none is left. customer_access records that
-- aggregate, which the app derives from all of the customer's entitlements after each subscription
-- event; set_customer_access returns the status it replaced, so access is granted, revoked and emailed
-- about only when it actually starts or ends.
--
-- Whether the customer's GitHub account is in the team is also a customer-level fact (one link per
-- customer), so github_granted moves here from entitlements.

create table public.customer_access (
  customer_id text not null,
  status text not null default 'revoked', -- active | grace | revoked (revoked also means never entitled)
  tier text null, -- the highest tier among the customer's active and grace entitlements
  github_granted boolean not null default false,
  updated_at timestamp with time zone not null default now(),
  constraint customer_access_pkey primary key (customer_id),
  constraint customer_access_customer_id_fkey foreign key (customer_id) references public.customers (customer_id),
  constraint customer_access_status_check check (status in ('active', 'grace', 'revoked'))
);

alter table public.customer_access enable row level security;

create policy "Customer access is readable by its owner"
  on public.customer_access as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );

-- Carry over existing customers: entitled if any entitlement is, at their highest entitled tier, and
-- granted if any entitled subscription recorded the grant.
insert into public.customer_access (customer_id, status, tier, github_granted)
select
  e.customer_id,
  case
    when bool_or(e.status = 'active') then 'active'
    when bool_or(e.status = 'grace') then 'grace'
    else 'revoked'
  end,
  (array_agg(e.tier order by array_position(array['starter', 'pro', 'advanced'], e.tier) desc nulls last)
    filter (where e.status in ('active', 'grace')))[1],
  coalesce(bool_or(e.github_granted) filter (where e.status in ('active', 'grace')), false)
from public.entitlements e
group by e.customer_id;

alter table public.entitlements
  drop column github_granted,
  drop column granted_at,
  -- The end of the subscription's current billing period: the licence runs to the latest of these.
  add column current_period_ends_at timestamp with time zone null;

-- Records a customer's access and returns the status it replaced ('revoked' for a customer seen for the
-- first time). The row lock makes concurrent calls for one customer run one after the other, so exactly
-- one of them sees each change. Ending access clears github_granted: the caller then removes the account
-- from the team, and reconcile retries that removal if it fails.
create or replace function public.set_customer_access(p_customer_id text, p_status text, p_tier text)
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
      tier = p_tier,
      github_granted = a.github_granted and p_status <> 'revoked',
      updated_at = now()
  where a.customer_id = p_customer_id;

  return previous;
end
$$;

revoke all on function public.set_customer_access(text, text, text) from public, anon, authenticated;
grant execute on function public.set_customer_access(text, text, text) to service_role;
