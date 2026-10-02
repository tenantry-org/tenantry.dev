-- The site's database: Paddle's customers and subscriptions as its notifications describe them, the entitlements and
-- customer access derived from them, GitHub links, licences, and the queue of per-customer jobs that keeps them in
-- line. This one file creates the whole schema; later changes are migrations after it.
--
-- Who writes: the server, with the service-role key, which bypasses row level security. Signed-in users only read:
-- every table has RLS, the customer tables have an owner policy for SELECT and no other, and the tables that are the
-- server's own (licence_failures, customer_jobs) have no policy at all. The functions are security definer and
-- callable only by the service role, except two in the private schema: confirmed_email, which the owner policies call,
-- and the customers trigger's normalise_customer_email. supabase/tests/database/access_boundaries.test.sql checks
-- this for every table and every security definer function.

-- ---------------------------------------------------------------------------------------------------------------------
-- Ownership: a signed-in user owns the Paddle customer whose email is their confirmed email.
-- ---------------------------------------------------------------------------------------------------------------------

-- Not exposed through the API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- The signed-in user's email, lowercased, or null unless it is confirmed: an unconfirmed address proves nothing, so
-- anyone could sign up with a purchaser's address. Security definer, because the authenticated role cannot read
-- auth.users.
create function private.confirmed_email()
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

-- ---------------------------------------------------------------------------------------------------------------------
-- customers: Paddle's customers. Paddle keeps an address as the buyer typed it and Supabase Auth stores it lowercased,
-- so the email is stored lowercased and trimmed (the trigger normalises every write) and is unique case-insensitively.
-- last_event_at is when the newest customer event applied occurred (record_customer_event).
-- ---------------------------------------------------------------------------------------------------------------------

create table public.customers (
  customer_id text primary key,
  email text not null,
  last_event_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index customers_email_lower_key on public.customers (lower(email));

create function private.normalise_customer_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end
$$;

create trigger customers_normalise_email
  before insert or update of email on public.customers
  for each row execute function private.normalise_customer_email();

alter table public.customers enable row level security;

-- `(select …)` evaluates the function once per statement rather than once per row.
create policy "Customers are readable by their owner"
  on public.customers as permissive for select to authenticated
  using (email = (select private.confirmed_email()));

-- Records a customer's email from a customer event unless a newer event has already been applied, and returns whether
-- it was applied. Paddle does not guarantee delivery order, and the email decides which signed-in account owns the
-- customer, so a late customer.updated must not restore an older address.
create function public.record_customer_event(
  p_customer_id text,
  p_email text,
  p_occurred_at timestamp with time zone
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  applied boolean;
begin
  insert into public.customers as c (customer_id, email, last_event_at, updated_at)
  values (p_customer_id, p_email, p_occurred_at, now())
  on conflict (customer_id) do update
    set email = excluded.email,
        last_event_at = excluded.last_event_at,
        updated_at = now()
    where c.last_event_at is null or c.last_event_at <= excluded.last_event_at
  returning true into applied;

  return coalesce(applied, false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- subscriptions: Paddle's subscriptions as their newest event left them. status is Paddle's subscription status. A
-- scheduled change (cancel, pause or resume, as Paddle reports it) takes effect at scheduled_change_at.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.subscriptions (
  subscription_id text primary key,
  customer_id text not null references public.customers,
  status text not null,
  price_id text,
  product_id text,
  scheduled_change_at timestamp with time zone,
  scheduled_change_action text,
  last_event_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.subscriptions enable row level security;

create policy "Subscriptions are readable by their owner"
  on public.subscriptions as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );

-- Records a subscription event unless a newer one has already been applied, as Paddle recommends, since delivery order
-- is not guaranteed: a late subscription.updated(active) must not undo a cancellation. Returns whether it was applied.
-- Raises a foreign-key violation if the customer does not exist yet, so the job is retried after customer.created.
create function public.record_subscription_event(
  p_subscription_id text,
  p_customer_id text,
  p_status text,
  p_price_id text,
  p_product_id text,
  p_scheduled_change_at timestamp with time zone,
  p_scheduled_change_action text,
  p_occurred_at timestamp with time zone
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  applied boolean;
begin
  insert into public.subscriptions as s (
    subscription_id, customer_id, status, price_id, product_id, scheduled_change_at, scheduled_change_action,
    last_event_at, updated_at
  )
  values (
    p_subscription_id, p_customer_id, p_status, p_price_id, p_product_id, p_scheduled_change_at,
    p_scheduled_change_action, p_occurred_at, now()
  )
  on conflict (subscription_id) do update
    set customer_id = excluded.customer_id,
        status = excluded.status,
        price_id = excluded.price_id,
        product_id = excluded.product_id,
        scheduled_change_at = excluded.scheduled_change_at,
        scheduled_change_action = excluded.scheduled_change_action,
        last_event_at = excluded.last_event_at,
        updated_at = now()
    where s.last_event_at is null or s.last_event_at <= excluded.last_event_at
  returning true into applied;

  return coalesce(applied, false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- entitlements: what each Pro subscription entitles its customer to, following Paddle's status: active while it is
-- active or trialing; grace while it is past due, from its first past-due event (grace_started_at); revoked otherwise.
-- The row stays grace until Paddle's status changes: whether the grace period has run out is decided when access is
-- derived (src/server/billing/access-policy.ts). current_period_ends_at is the end of the current billing period.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  -- One entitlement per subscription, so applying an event upserts on it.
  subscription_id text not null unique references public.subscriptions,
  customer_id text not null references public.customers,
  status text not null check (status in ('active', 'grace', 'revoked')),
  current_period_ends_at timestamp with time zone,
  grace_started_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint entitlements_grace_started_check check ((status = 'grace') = (grace_started_at is not null))
);

create index entitlements_customer_id_idx on public.entitlements (customer_id);

alter table public.entitlements enable row level security;

create policy "Entitlements are readable by their owner"
  on public.entitlements as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );

-- ---------------------------------------------------------------------------------------------------------------------
-- customer_access: a customer's access as a whole, derived from all their entitlements. GitHub access and the licence
-- belong to the customer, so access starts when the first entitlement is active or in grace and ends only when none
-- is; 'revoked' also means never entitled. github_state is where their GitHub access stands:
--   none     no grant attempted (not entitled, not linked, or provisioning is manual)
--   invited  an org invitation is pending since github_invited_at; reconcile promotes it once it is accepted, and
--            invites again once GitHub has dropped it (after 7 days)
--   active   a member of the team
--   failed   the last grant failed; reconcile retries it
-- ---------------------------------------------------------------------------------------------------------------------

create table public.customer_access (
  customer_id text primary key references public.customers,
  status text not null default 'revoked' check (status in ('active', 'grace', 'revoked')),
  github_state text not null default 'none' check (github_state in ('none', 'invited', 'active', 'failed')),
  github_invited_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  constraint customer_access_github_invited_check check ((github_state = 'invited') = (github_invited_at is not null))
);

alter table public.customer_access enable row level security;

create policy "Customer access is readable by its owner"
  on public.customer_access as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );

-- Records a customer's access and returns the status it replaced ('revoked' for a customer seen for the
-- first time). The row lock makes concurrent calls for one customer run one after the other, so exactly
-- one of them sees each change. Ending access resets the GitHub state: the caller then removes the account
-- from the team (or cancels its invitation), and reconcile retries that removal if it fails.
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
      github_state = case when p_status = 'revoked' then 'none' else a.github_state end,
      github_invited_at = case when p_status = 'revoked' then null else a.github_invited_at end,
      updated_at = now()
  where a.customer_id = p_customer_id;

  return previous;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- github_links: the GitHub account each customer linked, by its durable id; the login is as last looked up, since
-- accounts can be renamed. One account per customer, and one customer per account.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.github_links (
  customer_id text primary key references public.customers,
  github_id bigint not null,
  github_login text not null,
  linked_at timestamp with time zone not null default now()
);

create unique index github_links_github_id_key on public.github_links (github_id);

alter table public.github_links enable row level security;

create policy "GitHub links are readable by their owner"
  on public.github_links as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );

-- ---------------------------------------------------------------------------------------------------------------------
-- licences: the signed licence keys (ES256 JWTs) issued to customers, which the dashboard shows. A customer is issued
-- one when their access starts and keeps it, since licences do not expire; ending access revokes their licences, and
-- a customer whose access starts again is issued a new one.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.licences (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references public.customers,
  jwt text not null,
  revoked boolean not null default false,
  issued_at timestamp with time zone not null default now()
);

create index licences_customer_id_idx on public.licences (customer_id);

alter table public.licences enable row level security;

create policy "Licences are readable by their owner"
  on public.licences as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );

-- ---------------------------------------------------------------------------------------------------------------------
-- licence_failures: each customer whose licence cannot currently be issued (signing, or storing the token), while it
-- keeps failing: when the failures started, how many attempts failed, and the last error. Reconcile retries until a
-- licence is issued, and the row is then deleted. The operator is alerted once per run of failures, when the row is
-- created. The errors are internal: RLS is on, and there is no policy.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.licence_failures (
  customer_id text primary key references public.customers,
  failing_since timestamp with time zone not null default now(),
  attempts integer not null default 1,
  last_error text not null,
  last_attempt_at timestamp with time zone not null default now()
);

alter table public.licence_failures enable row level security;

-- Records a failed attempt and returns true if it starts a run of failures (the one to alert on).
create function public.record_licence_failure(p_customer_id text, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt integer;
begin
  insert into public.licence_failures as f (customer_id, last_error)
  values (p_customer_id, p_error)
  on conflict (customer_id) do update
    set attempts = f.attempts + 1,
        last_error = excluded.last_error,
        last_attempt_at = now()
  returning f.attempts into attempt;

  return attempt = 1;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- customer_jobs: the work that changes a customer's access, run one customer at a time and in order. The worker
-- (src/server/jobs/worker.ts) claims due jobs with claim_customer_jobs, which hands out each customer's oldest pending
-- job and nothing more of theirs while one is locked, so a customer's jobs never run concurrently or out of order. A
-- failed job is retried later with backoff (next_attempt_at) and, after its last attempt, marked failed. A job is:
--   paddle_event  a verified Paddle notification, stored once each: its id is Paddle's event id, so a duplicate
--                 delivery, even a concurrent one, adds nothing. A subscription event that arrives before its customer
--                 fails the customers foreign key and waits for customer.created.
--   reconcile     checking one customer's access, GitHub membership and licence against their entitlements, queued
--                 by the reconcile run for every customer who may need it.
--   lease         no work: a turn held by work that runs outside the worker (linking a GitHub account), so none of the
--                 customer's other jobs runs meanwhile (acquire_customer_lease).
-- A customer's jobs run in order of occurred_at: when the event occurred, or when the job was queued.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.customer_jobs (
  id text primary key,
  kind text not null check (kind in ('paddle_event', 'reconcile', 'lease')),
  -- Null only for a Paddle event that concerns no customer, which then waits for nothing.
  customer_id text,
  occurred_at timestamp with time zone not null,
  event_type text,
  payload jsonb,
  -- pending until done or given up on (failed); a claimed job stays pending, with locked_until.
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamp with time zone not null default now(),
  locked_until timestamp with time zone,
  last_error text,
  created_at timestamp with time zone not null default now(),
  processed_at timestamp with time zone,
  -- A Paddle event has its type and body; a reconcile job or a lease has neither, and always has a customer.
  constraint customer_jobs_shape_check check (
    case
      when kind = 'paddle_event' then event_type is not null and payload is not null
      else event_type is null and payload is null and customer_id is not null
    end
  )
);

create index customer_jobs_due_idx on public.customer_jobs (next_attempt_at) where status = 'pending';
create index customer_jobs_customer_idx on public.customer_jobs (customer_id, occurred_at) where status = 'pending';

alter table public.customer_jobs enable row level security;

-- Claims up to p_limit due jobs and locks them for p_lock_seconds, counting an attempt. For each customer it returns at
-- most their oldest pending job, and nothing while one of their jobs is locked: being run, or a lease.
create function public.claim_customer_jobs(p_limit integer, p_lock_seconds integer)
returns setof public.customer_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialises claims with acquire_customer_lease, so a claim cannot hand out a customer's job while a lease for them
  -- is being taken, or the other way round. Share row exclusive does not block reads.
  lock table public.customer_jobs in share row exclusive mode;

  return query
  with candidates as (
    select j.id
    from public.customer_jobs j
    where j.status = 'pending'
      and j.next_attempt_at <= now()
      and (j.locked_until is null or j.locked_until < now())
      and not exists (
        select 1
        from public.customer_jobs o
        where o.customer_id = j.customer_id
          and o.status = 'pending'
          and o.id <> j.id
          and (
            o.occurred_at < j.occurred_at
            or (o.occurred_at = j.occurred_at and o.id < j.id)
            or o.locked_until > now()
          )
      )
    order by j.occurred_at, j.id
    limit p_limit
    for update skip locked
  )
  update public.customer_jobs j
  set locked_until = now() + make_interval(secs => p_lock_seconds),
      attempts = j.attempts + 1
  from candidates c
  where j.id = c.id
  returning j.*;
end
$$;

-- Takes a lease on the customer for p_seconds and returns its id, or null if one of the customer's jobs is locked
-- (being run, or another lease): try again shortly. The lease is a locked job, so claim_customer_jobs hands out none
-- of the customer's jobs until it is released. A lease whose holder died expires with its lock; the worker then claims
-- it and completes it as a no-op.
create function public.acquire_customer_lease(p_customer_id text, p_seconds integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease_id text := 'lease_' || p_customer_id || '_' || gen_random_uuid();
begin
  lock table public.customer_jobs in share row exclusive mode;

  if exists (
    select 1
    from public.customer_jobs j
    where j.customer_id = p_customer_id
      and j.status = 'pending'
      and j.locked_until > now()
  ) then
    return null;
  end if;

  insert into public.customer_jobs (id, kind, customer_id, occurred_at, locked_until)
  values (lease_id, 'lease', p_customer_id, now(), now() + make_interval(secs => p_seconds));

  return lease_id;
end
$$;

-- Releases a lease, which completes it: the customer's jobs can be claimed again.
create function public.release_customer_lease(p_lease_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.customer_jobs
  set status = 'done', locked_until = null, processed_at = now()
  where id = p_lease_id and kind = 'lease';
$$;

-- Every customer the reconcile run must check, as one array: a single value, which the API's max_rows (1000) does not
-- cut short. Anyone entitled (by recorded access or by an entitlement), linked to GitHub, or holding a live licence.
create function public.customers_to_reconcile()
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

-- ---------------------------------------------------------------------------------------------------------------------
-- Only the service role calls the functions above.
-- ---------------------------------------------------------------------------------------------------------------------

revoke all on function public.record_customer_event(text, text, timestamp with time zone)
  from public, anon, authenticated;
revoke all on function public.record_subscription_event(
  text, text, text, text, text, timestamp with time zone, text, timestamp with time zone
) from public, anon, authenticated;
revoke all on function public.set_customer_access(text, text) from public, anon, authenticated;
revoke all on function public.record_licence_failure(text, text) from public, anon, authenticated;
revoke all on function public.claim_customer_jobs(integer, integer) from public, anon, authenticated;
revoke all on function public.acquire_customer_lease(text, integer) from public, anon, authenticated;
revoke all on function public.release_customer_lease(text) from public, anon, authenticated;
revoke all on function public.customers_to_reconcile() from public, anon, authenticated;

grant execute on function public.record_customer_event(text, text, timestamp with time zone) to service_role;
grant execute on function public.record_subscription_event(
  text, text, text, text, text, timestamp with time zone, text, timestamp with time zone
) to service_role;
grant execute on function public.set_customer_access(text, text) to service_role;
grant execute on function public.record_licence_failure(text, text) to service_role;
grant execute on function public.claim_customer_jobs(integer, integer) to service_role;
grant execute on function public.acquire_customer_lease(text, integer) to service_role;
grant execute on function public.release_customer_lease(text) to service_role;
grant execute on function public.customers_to_reconcile() to service_role;
