-- Customer ownership by confirmed, case-insensitive email.
--
-- The owner policies matched a signed-in user to a Paddle customer with customers.email = auth.email(),
-- which is the JWT's email claim. Two problems:
--   * the address did not have to be confirmed, so anyone who signed up with a purchaser's address could
--     read that purchaser's licence, subscriptions and GitHub link;
--   * the comparison was case-sensitive, although Paddle keeps the address as the buyer typed it and
--     Supabase Auth stores it lowercased, so a mixed-case purchase never matched its account.
--
-- Now customers.email is stored lowercased and trimmed (a trigger normalises every write) and is unique
-- case-insensitively, and the policies compare it with private.confirmed_email(): the signed-in user's
-- email, only once it is confirmed.
--
-- If existing rows differ only in case, the unique index cannot be created and this migration fails;
-- merge those customers first.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- The signed-in user's email, lowercased, or null unless it is confirmed. Security definer, because the
-- authenticated role cannot read auth.users. The private schema is not exposed through the API.
create or replace function private.confirmed_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email)
  from auth.users u
  where u.id = auth.uid()
    and u.email_confirmed_at is not null
$$;

revoke all on function private.confirmed_email() from public;
grant execute on function private.confirmed_email() to authenticated;

create or replace function private.normalise_customer_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end
$$;

update public.customers
set email = lower(btrim(email))
where email <> lower(btrim(email));

create trigger customers_normalise_email
  before insert or update of email on public.customers
  for each row execute function private.normalise_customer_email();

create unique index customers_email_lower_key on public.customers (lower(email));

-- The owner policies, now keyed on the confirmed email. `(select …)` evaluates the function once per
-- statement rather than once per row.

drop policy "Customers are readable by their owner" on public.customers;
create policy "Customers are readable by their owner"
  on public.customers as permissive for select to authenticated
  using (email = (select private.confirmed_email()));

drop policy "Subscriptions are readable by their owner" on public.subscriptions;
create policy "Subscriptions are readable by their owner"
  on public.subscriptions as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );

drop policy "GitHub links are readable by their owner" on public.github_links;
create policy "GitHub links are readable by their owner"
  on public.github_links as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );

drop policy "Entitlements are readable by their owner" on public.entitlements;
create policy "Entitlements are readable by their owner"
  on public.entitlements as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );

drop policy "Licences are readable by their owner" on public.licences;
create policy "Licences are readable by their owner"
  on public.licences as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );
