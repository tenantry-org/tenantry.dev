-- GitHub invitation state (implementation plan 6.7).
--
-- Adding a customer who is not yet in the org to the team sends them an org invitation: their membership
-- is pending until they accept it, and GitHub drops the invitation after 7 days. github_granted recorded a
-- grant as done as soon as the invitation was sent, so the portal said "added" to customers who had not
-- accepted, and an expired invitation was never sent again.
--
-- github_state now records where the customer's GitHub access stands:
--   none     no grant attempted (not entitled, not linked, or provisioning is manual)
--   invited  an invitation is pending since github_invited_at; reconcile promotes it once accepted, and
--            invites again once GitHub has dropped it
--   active   the customer is a member of the team
--   failed   the last grant attempt failed; reconcile retries it

alter table public.customer_access
  add column github_state text not null default 'none',
  add column github_invited_at timestamp with time zone null;

-- Existing grants were recorded without knowing whether the invitation was accepted: treat them as
-- invitations, so the next reconcile checks the membership and promotes or re-sends them.
update public.customer_access
set github_state = 'invited', github_invited_at = updated_at
where github_granted;

alter table public.customer_access
  drop column github_granted,
  add constraint customer_access_github_state_check
    check (github_state in ('none', 'invited', 'active', 'failed')),
  add constraint customer_access_github_invited_check
    check ((github_state = 'invited') = (github_invited_at is not null));

-- Records a customer's access and returns the status it replaced ('revoked' for a customer seen for the
-- first time). The row lock makes concurrent calls for one customer run one after the other, so exactly
-- one of them sees each change. Ending access resets the GitHub state: the caller then removes the account
-- from the team (or cancels its invitation), and reconcile retries that removal if it fails.
create or replace function public.set_customer_access(p_customer_id text, p_status text)
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
      github_state = case when p_status = 'revoked' then 'none' else a.github_state end,
      github_invited_at = case when p_status = 'revoked' then null else a.github_invited_at end,
      updated_at = now()
  where a.customer_id = p_customer_id;

  return previous;
end
$$;
