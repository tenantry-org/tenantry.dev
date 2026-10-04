-- The private package feed: Tenantry Pro's NuGet v3 feed, served by the site (src/app/feed/v3), which shows each
-- customer only the releases they may use (src/server/billing/entitlement-policy.ts: mayUseRelease).
--
--   feed_tokens   each customer's named feed credentials, stored as SHA-256 hashes (the token is shown once), used as
--                 the password of NuGet's basic authentication. Separate from the licence key, which ships inside
--                 customers' applications and so must never unlock downloads.
--   pro_packages  each package file of each release (pro_releases), with the metadata the feed serves; the .nupkg
--                 itself is in the private storage bucket pro-packages, downloaded through short-lived signed URLs.
--
-- As in the baseline: owners read their own feed_tokens through an owner policy; pro_packages and the bucket have no
-- policy, so only the service role reads or writes them; the functions are callable only by the service role.

-- ---------------------------------------------------------------------------------------------------------------------
-- feed_tokens
-- ---------------------------------------------------------------------------------------------------------------------

create table public.feed_tokens (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references public.customers,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- Hex SHA-256 of the token.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- The token's first characters, so the customer can tell their tokens apart.
  prefix text not null,
  created_at timestamp with time zone not null default now(),
  -- Updated at most hourly.
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone
);

create index feed_tokens_customer_id_idx on public.feed_tokens (customer_id);

alter table public.feed_tokens enable row level security;

create policy "Feed tokens are readable by their owner"
  on public.feed_tokens as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );

-- Records a new token for the customer and returns its id. A customer holds at most 10 tokens that are not revoked;
-- the customer row is locked so two concurrent creations cannot both pass that check.
create function public.create_feed_token(p_customer_id text, p_name text, p_token_hash text, p_prefix text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created uuid;
begin
  perform 1 from public.customers c where c.customer_id = p_customer_id for update;

  if (select count(*) from public.feed_tokens t where t.customer_id = p_customer_id and t.revoked_at is null) >= 10 then
    raise exception 'Customer % already has 10 feed tokens', p_customer_id using errcode = '23514';
  end if;

  insert into public.feed_tokens (customer_id, name, token_hash, prefix)
  values (p_customer_id, btrim(p_name), p_token_hash, p_prefix)
  returning id into created;

  return created;
end
$$;

-- Revokes one of the customer's tokens and returns whether it did (false for another customer's token, or one already
-- revoked).
create function public.revoke_feed_token(p_customer_id text, p_token_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with revoked as (
    update public.feed_tokens t
    set revoked_at = now()
    where t.id = p_token_id and t.customer_id = p_customer_id and t.revoked_at is null
    returning 1
  )
  select exists (select 1 from revoked)
$$;

-- The customer a feed token belongs to, with what the feed needs to decide what they may restore: their access
-- (active_subscriptions.access_status; lapsed if never recorded) and their vested-through date. No row for an unknown
-- or revoked token. Records the use, at most once an hour.
create function public.feed_customer(p_token_hash text)
returns table (customer_id text, access_status text, vested_through timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  token public.feed_tokens%rowtype;
begin
  select * into token from public.feed_tokens t where t.token_hash = p_token_hash and t.revoked_at is null;
  if not found then
    return;
  end if;

  if token.last_used_at is null or token.last_used_at < now() - interval '1 hour' then
    update public.feed_tokens t set last_used_at = now() where t.id = token.id;
  end if;

  return query
  select
    token.customer_id,
    coalesce((select s.access_status from public.active_subscriptions s where s.customer_id = token.customer_id),
      'lapsed'),
    public.vested_through(token.customer_id);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- pro_packages: one row per package of a release. package_id is as packed (Tenantry.Pro.EfCore); lower_id is how the
-- NuGet API addresses it. sha512 is the base64 SHA-512 of the .nupkg, as NuGet's lock files record it.
-- dependency_groups are the nuspec's, as the registration resource serves them: an array of
-- { targetFramework, dependencies: [{ id, range }] }.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.pro_packages (
  lower_id text not null,
  version text not null references public.pro_releases,
  package_id text not null,
  storage_path text not null unique,
  size bigint not null check (size > 0),
  sha512 text not null,
  nuspec text not null,
  description text,
  authors text,
  dependency_groups jsonb not null default '[]',
  created_at timestamp with time zone not null default now(),
  primary key (lower_id, version),
  constraint pro_packages_lower_id_check check (lower_id = lower(package_id)),
  constraint pro_packages_id_check check (package_id ~ '^Tenantry\.Pro(\.[A-Za-z0-9]+)*$')
);

alter table public.pro_packages enable row level security;

-- The private bucket the packages are stored in. No storage policy: only the service role reads or writes it.
insert into storage.buckets (id, name, public) values ('pro-packages', 'pro-packages', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- Only the service role calls the functions above.
-- ---------------------------------------------------------------------------------------------------------------------

revoke all on function public.create_feed_token(text, text, text, text) from public, anon, authenticated;
revoke all on function public.revoke_feed_token(text, uuid) from public, anon, authenticated;
revoke all on function public.feed_customer(text) from public, anon, authenticated;

grant execute on function public.create_feed_token(text, text, text, text) to service_role;
grant execute on function public.revoke_feed_token(text, uuid) to service_role;
grant execute on function public.feed_customer(text) to service_role;
