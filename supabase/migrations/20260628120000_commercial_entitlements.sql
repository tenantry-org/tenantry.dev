-- Commercial entitlement schema (LAUNCH-PLAN.md §5, Appendix B).
--
-- Adds the tables the provisioning service needs to drive
--   Paddle subscription  ->  GitHub access + signed licence
-- and tightens RLS on the existing tables so an authenticated user can only ever
-- read their OWN rows (the starter kit shipped `using (true)`, which exposed every
-- customer's rows to any signed-in user — see LAUNCH-PLAN.md §11 risk row).
--
-- Auth model: an authenticated Supabase user is matched to a Paddle customer by
-- email (customers.email = auth.email()). All writes are performed by the webhook /
-- provisioning service using the service-role key, which bypasses RLS; therefore the
-- policies below are SELECT-only and there are intentionally no INSERT/UPDATE/DELETE
-- policies for the `authenticated` role.

-- ---------------------------------------------------------------------------
-- 1. Tighten RLS on the existing tables (enable RLS + replace `using (true)`)
-- ---------------------------------------------------------------------------

alter table public.customers enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "Enable read access for authenticated users to customers" on public.customers;
drop policy if exists "Enable read access for authenticated users to subscriptions" on public.subscriptions;

-- A user may read only the customer row matching their own email.
create policy "Customers are readable by their owner"
  on public.customers as permissive for select to authenticated
  using (email = auth.email());

-- A user may read only subscriptions belonging to their own customer record.
create policy "Subscriptions are readable by their owner"
  on public.subscriptions as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = auth.email()
    )
  );

-- ---------------------------------------------------------------------------
-- 2. github_links — maps a Paddle customer to their linked GitHub identity
--    (populated by the "Connect GitHub" OAuth flow, LAUNCH-PLAN.md §5.4)
-- ---------------------------------------------------------------------------

create table
  public.github_links (
    customer_id text not null,
    github_login text not null,
    github_id bigint not null,
    linked_at timestamp with time zone not null default now(),
    constraint github_links_pkey primary key (customer_id),
    constraint github_links_customer_id_fkey foreign key (customer_id) references public.customers (customer_id)
  ) tablespace pg_default;

create unique index github_links_github_id_key on public.github_links (github_id);

alter table public.github_links enable row level security;

create policy "GitHub links are readable by their owner"
  on public.github_links as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = auth.email()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. entitlements — the source of truth for "what access does this customer have"
--    (driven by Paddle webhooks: activated/updated -> active, canceled/past_due
--     past grace -> revoked; LAUNCH-PLAN.md §5.2)
-- ---------------------------------------------------------------------------

create table
  public.entitlements (
    id uuid not null default gen_random_uuid(),
    customer_id text not null,
    subscription_id text null,
    tier text not null,
    status text not null, -- active | grace | revoked
    github_granted boolean not null default false,
    granted_at timestamp with time zone null,
    revoked_at timestamp with time zone null,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint entitlements_pkey primary key (id),
    constraint entitlements_customer_id_fkey foreign key (customer_id) references public.customers (customer_id),
    constraint entitlements_subscription_id_fkey foreign key (subscription_id) references public.subscriptions (subscription_id),
    constraint entitlements_status_check check (status in ('active', 'grace', 'revoked')),
    -- One entitlement per subscription so webhook handlers can upsert idempotently on subscription_id.
    -- (Postgres treats NULLs as distinct, so manually-created entitlements without a subscription are allowed.)
    constraint entitlements_subscription_id_key unique (subscription_id)
  ) tablespace pg_default;

create index entitlements_customer_id_idx on public.entitlements (customer_id);

alter table public.entitlements enable row level security;

create policy "Entitlements are readable by their owner"
  on public.entitlements as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = auth.email()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. licences — signed ES256 JWT licence tokens issued to a customer
--    (minted by the licence issuer, re-issued on renewal; LAUNCH-PLAN.md §5.5)
--    The JWT is surfaced to the customer for download, so owner-read is intended.
-- ---------------------------------------------------------------------------

create table
  public.licences (
    id uuid not null default gen_random_uuid(),
    customer_id text not null,
    jwt text not null,
    tier text not null,
    expires_at timestamp with time zone not null,
    issued_at timestamp with time zone not null default now(),
    revoked boolean not null default false,
    constraint licences_pkey primary key (id),
    constraint licences_customer_id_fkey foreign key (customer_id) references public.customers (customer_id)
  ) tablespace pg_default;

create index licences_customer_id_idx on public.licences (customer_id);

alter table public.licences enable row level security;

create policy "Licences are readable by their owner"
  on public.licences as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = auth.email()
    )
  );
