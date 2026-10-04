-- Perpetual entitlement, and one record of each customer's state. 12 consecutive paid months, or a served annual term,
-- earn a perpetual licence to the releases published up to a date (the vested-through date); the feed serves each
-- customer the releases they may use by comparing that date with each release's entitlement date (pro_releases).
--
-- The facts are recorded as Paddle reports them: subscriptions (now also their current period, when they went past due
-- and when they ended), and the ledger of Pro payments and their adjustments (payments, payment_adjustments). What a
-- customer may access is derived from those facts by one pure module (src/server/billing/entitlement-policy.ts) and
-- stored by set_customer_entitlement in one transaction: active_subscriptions (current access, GitHub provisioning and
-- the progress of the current run, one row per customer) and vested_entitlements (what they own for good). These
-- replace entitlements and customer_access, which held the same facts per subscription and per customer.
--
-- Who writes and who reads follows the baseline: the service role writes, owners read their own rows through owner
-- policies, and the server's own tables (payment_adjustments, pro_releases) have no policy.
--
-- Licences are no longer revoked: a key cannot be revoked offline, and a lapsed customer keeps the key they were
-- given, so the revoked flag goes.
--
-- What this migration drops, and what follows:
--   entitlements          its period end and grace start move to subscriptions (backfilled below)
--   customer_access       its access status and GitHub state move to active_subscriptions (backfilled below; revoked
--                         becomes lapsed)
--   set_customer_access   replaced by set_customer_entitlement
--   licences.revoked      every key stays, so keys revoked before this migration become visible on their customer's
--                         dashboard again (none had been issued when it was written)
-- There is no down migration: going back means restoring a backup taken before it. Payments made before it are not in
-- the ledger; reconcile records the completed ones Paddle lists for the last 90 days (paddle-assumptions.ts).
-- supabase/migration-tests/20261004120000_entitlement_ledger tests it against rows of the schema before it.

-- ---------------------------------------------------------------------------------------------------------------------
-- subscriptions: as Paddle's newest event left them, now with what entitlements held per subscription.
--   current_period_ends_at  the end of the current billing period
--   grace_started_at        when a past-due subscription first became past due; null in any other status. Whether
--                           its grace has run out is decided when access is derived (entitlement-policy.ts).
--   ended_at                when a cancelled or paused subscription ended (Paddle's canceled_at or paused_at); a paid
--                           period counts only until then.
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.subscriptions
  add column current_period_ends_at timestamp with time zone,
  add column grace_started_at timestamp with time zone,
  add column ended_at timestamp with time zone;

-- A past-due subscription keeps its entitlement's grace start. The old schema kept none for an entitlement it had
-- revoked, so such a one is given a start whose 30 days ended when it was revoked, and one with no entitlement row the
-- time of its last event: never none, which access would read as grace without end (entitlement-policy.ts: graceEndFor
-- treats a missing start as grace already over in any case).
update public.subscriptions s
set current_period_ends_at = e.current_period_ends_at,
    grace_started_at = case
      when s.status = 'past_due' then coalesce(e.grace_started_at, e.revoked_at - interval '30 days', s.last_event_at)
    end
from public.subscriptions s2
left join public.entitlements e on e.subscription_id = s2.subscription_id
where s2.subscription_id = s.subscription_id;

-- When a cancelled or paused subscription ended, as near as the old schema knows it: the cancellation or pause it had
-- scheduled, if that is still recorded, else its last event (the one that ended it, or a later one). A period is
-- counted only until then, so a subscription cancelled at once does not count as having served its whole period.
update public.subscriptions s
set ended_at = coalesce(
      case when s.scheduled_change_action in ('cancel', 'pause') then s.scheduled_change_at end,
      s.last_event_at,
      s.updated_at
    )
where s.status in ('canceled', 'paused');

alter table public.subscriptions
  add constraint subscriptions_grace_started_check check (grace_started_at is null or status = 'past_due');

drop function public.record_subscription_event(
  text, text, text, text, text, timestamp with time zone, text, timestamp with time zone
);

-- Records a subscription event unless a newer one has already been applied, as Paddle recommends, since delivery order
-- is not guaranteed: a late subscription.updated(active) must not undo a cancellation. Returns whether it was applied.
-- A past-due subscription keeps the grace start of its first past-due event; any other status clears it. Raises a
-- foreign-key violation if the customer does not exist yet, so the job is retried after customer.created.
create function public.record_subscription_event(
  p_subscription_id text,
  p_customer_id text,
  p_status text,
  p_price_id text,
  p_product_id text,
  p_scheduled_change_at timestamp with time zone,
  p_scheduled_change_action text,
  p_current_period_ends_at timestamp with time zone,
  p_ended_at timestamp with time zone,
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
    current_period_ends_at, grace_started_at, ended_at, last_event_at, updated_at
  )
  values (
    p_subscription_id, p_customer_id, p_status, p_price_id, p_product_id, p_scheduled_change_at,
    p_scheduled_change_action, p_current_period_ends_at, case when p_status = 'past_due' then p_occurred_at end,
    p_ended_at, p_occurred_at, now()
  )
  on conflict (subscription_id) do update
    set customer_id = excluded.customer_id,
        status = excluded.status,
        price_id = excluded.price_id,
        product_id = excluded.product_id,
        scheduled_change_at = excluded.scheduled_change_at,
        scheduled_change_action = excluded.scheduled_change_action,
        current_period_ends_at = excluded.current_period_ends_at,
        grace_started_at = case
          when excluded.status = 'past_due' then coalesce(s.grace_started_at, excluded.grace_started_at)
        end,
        ended_at = excluded.ended_at,
        last_event_at = excluded.last_event_at,
        updated_at = now()
    where s.last_event_at is null or s.last_event_at <= excluded.last_event_at
  returning true into applied;

  return coalesce(applied, false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- active_subscriptions: the ActiveSubscription side, one row per customer, derived from their subscriptions and
-- payments (entitlement-policy.ts) and written only by set_customer_entitlement. Replaces customer_access.
--   access_status        active while a Pro subscription is active or trialing; grace while the only ones that
--                        entitle are past due and within their grace period; lapsed otherwise (also: never entitled)
--   github_state         where the customer's GitHub team access stands, as customer_access had it:
--                          none     no grant attempted (not entitled, not linked, or provisioning is manual)
--                          invited  an org invitation is pending since github_invited_at; reconcile promotes it once
--                                   accepted, and invites again once GitHub has dropped it (after 7 days)
--                          active   a member of the team
--                          failed   the last grant failed; reconcile retries it
--   run_started_at, paid_through, months_paid, vests_at
--                        the current qualifying run, while the customer has access and their payments continue it:
--                        its first paid period's start, the end of its latest, the whole months between, and when it
--                        reaches 12 months (in the past once it has)
--   conditional_through  the term end of an annual grant not yet confirmed
-- ---------------------------------------------------------------------------------------------------------------------

create table public.active_subscriptions (
  customer_id text primary key references public.customers,
  access_status text not null default 'lapsed' check (access_status in ('active', 'grace', 'lapsed')),
  github_state text not null default 'none' check (github_state in ('none', 'invited', 'active', 'failed')),
  github_invited_at timestamp with time zone,
  run_started_at timestamp with time zone,
  paid_through timestamp with time zone,
  months_paid integer not null default 0 check (months_paid >= 0),
  vests_at timestamp with time zone,
  conditional_through timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  constraint active_subscriptions_github_invited_check check ((github_state = 'invited') = (github_invited_at is not null)),
  constraint active_subscriptions_run_check check (
    (run_started_at is null) = (paid_through is null)
    and (run_started_at is null) = (vests_at is null)
    and (run_started_at is not null or months_paid = 0)
  )
);

insert into public.active_subscriptions (customer_id, access_status, github_state, github_invited_at)
select customer_id, case status when 'revoked' then 'lapsed' else status end, github_state, github_invited_at
from public.customer_access;

alter table public.active_subscriptions enable row level security;

create policy "Active subscriptions are readable by their owner"
  on public.active_subscriptions as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );

drop function public.set_customer_access(text, text);
drop table public.customer_access;
drop table public.entitlements;

-- ---------------------------------------------------------------------------------------------------------------------
-- licences: one key per customer, kept for good. Ending access no longer revokes it.
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.licences drop column revoked;

-- ---------------------------------------------------------------------------------------------------------------------
-- payments: each completed Paddle transaction that pays a billing period of a Pro subscription
-- (transaction.completed with a billing_period and a Pro price). Amounts are Paddle's details.totals, in the currency's
-- lowest unit. status follows the payment's adjustments, as the entitlement recompute derives it:
--   paid                no refund or chargeback applies
--   partially_refunded  an approved partial refund or credit that is not tax-only
--   refunded            an approved full refund
--   charged_back        an approved chargeback that has not been reversed
-- subscription_id has no foreign key: a payment can be recorded before its subscription's first event is applied.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.payments (
  transaction_id text primary key,
  customer_id text not null references public.customers,
  subscription_id text not null,
  origin text not null,
  price_id text not null,
  billing_interval text not null check (billing_interval in ('day', 'week', 'month', 'year')),
  billing_frequency integer not null check (billing_frequency > 0),
  period_starts_at timestamp with time zone not null,
  period_ends_at timestamp with time zone not null,
  subtotal bigint not null,
  discount bigint not null,
  total bigint not null,
  currency_code text not null,
  status text not null default 'paid'
    check (status in ('paid', 'partially_refunded', 'refunded', 'charged_back')),
  completed_at timestamp with time zone not null,
  last_event_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint payments_period_check check (period_ends_at > period_starts_at)
);

create index payments_customer_id_idx on public.payments (customer_id);

alter table public.payments enable row level security;

create policy "Payments are readable by their owner"
  on public.payments as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );

-- Records a completed transaction's payment unless a newer event for it has already been applied, and returns whether
-- it was applied. A repeated delivery of the same event stores the same values again. The status is left as the last
-- recompute derived it. Raises a foreign-key violation if the customer does not exist yet, so the job is retried after
-- customer.created.
create function public.record_payment(
  p_transaction_id text,
  p_customer_id text,
  p_subscription_id text,
  p_origin text,
  p_price_id text,
  p_billing_interval text,
  p_billing_frequency integer,
  p_period_starts_at timestamp with time zone,
  p_period_ends_at timestamp with time zone,
  p_subtotal bigint,
  p_discount bigint,
  p_total bigint,
  p_currency_code text,
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
  insert into public.payments as p (
    transaction_id, customer_id, subscription_id, origin, price_id, billing_interval, billing_frequency,
    period_starts_at, period_ends_at, subtotal, discount, total, currency_code, completed_at, last_event_at
  )
  values (
    p_transaction_id, p_customer_id, p_subscription_id, p_origin, p_price_id, p_billing_interval,
    p_billing_frequency, p_period_starts_at, p_period_ends_at, p_subtotal, p_discount, p_total, p_currency_code,
    p_occurred_at, p_occurred_at
  )
  on conflict (transaction_id) do update
    set customer_id = excluded.customer_id,
        subscription_id = excluded.subscription_id,
        origin = excluded.origin,
        price_id = excluded.price_id,
        billing_interval = excluded.billing_interval,
        billing_frequency = excluded.billing_frequency,
        period_starts_at = excluded.period_starts_at,
        period_ends_at = excluded.period_ends_at,
        subtotal = excluded.subtotal,
        discount = excluded.discount,
        total = excluded.total,
        currency_code = excluded.currency_code,
        last_event_at = excluded.last_event_at,
        updated_at = now()
    where p.last_event_at <= excluded.last_event_at
  returning true into applied;

  return coalesce(applied, false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- payment_adjustments: every Paddle adjustment (refund, credit, chargeback and their reversals) on a customer's
-- transactions, as its newest event left it. item_types are its items' types (full, partial, tax, proration), so a
-- tax-only correction can be told apart. approved_at is when it was approved (Paddle's updated_at on the approving
-- event; created_at for one first seen reversed, since chargebacks are created approved), and reversed_at when Paddle
-- marked it reversed. transaction_id has no foreign key: an adjustment can arrive before its transaction.completed, and
-- applies once the payment is recorded. Internal: RLS is on, and there is no policy; payments.status is what owners
-- read.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.payment_adjustments (
  adjustment_id text primary key,
  transaction_id text not null,
  customer_id text not null references public.customers,
  subscription_id text,
  action text not null,
  type text not null,
  item_types text[] not null default '{}',
  status text not null,
  approved_at timestamp with time zone,
  reversed_at timestamp with time zone,
  last_event_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index payment_adjustments_customer_id_idx on public.payment_adjustments (customer_id);

alter table public.payment_adjustments enable row level security;

-- Records an adjustment as of one of its events unless a newer one has already been applied, and returns whether it
-- was applied. approved_at and reversed_at, once set, keep their first value, so an older event delivered late cannot
-- move them.
create function public.record_payment_adjustment(
  p_adjustment_id text,
  p_transaction_id text,
  p_customer_id text,
  p_subscription_id text,
  p_action text,
  p_type text,
  p_item_types text[],
  p_status text,
  p_created_at timestamp with time zone,
  p_updated_at timestamp with time zone,
  p_occurred_at timestamp with time zone
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  applied boolean;
  approved timestamp with time zone :=
    case p_status when 'approved' then p_updated_at when 'reversed' then p_created_at end;
  reversed timestamp with time zone := case when p_status = 'reversed' then p_updated_at end;
begin
  insert into public.payment_adjustments as a (
    adjustment_id, transaction_id, customer_id, subscription_id, action, type, item_types, status, approved_at,
    reversed_at, last_event_at
  )
  values (
    p_adjustment_id, p_transaction_id, p_customer_id, p_subscription_id, p_action, p_type,
    coalesce(p_item_types, '{}'), p_status, approved, reversed, p_occurred_at
  )
  on conflict (adjustment_id) do update
    set status = case when a.last_event_at <= excluded.last_event_at then excluded.status else a.status end,
        item_types = case when a.last_event_at <= excluded.last_event_at then excluded.item_types else a.item_types end,
        approved_at = coalesce(a.approved_at, excluded.approved_at),
        reversed_at = coalesce(a.reversed_at, excluded.reversed_at),
        last_event_at = greatest(a.last_event_at, excluded.last_event_at),
        updated_at = now()
    where a.last_event_at <= excluded.last_event_at
      or (a.approved_at is null and excluded.approved_at is not null)
      or (a.reversed_at is null and excluded.reversed_at is not null)
  returning true into applied;

  return coalesce(applied, false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- vested_entitlements: the VestedEntitlement side, owned indefinitely. One row per grant:
--   qualifying_run  a run of consecutive paid periods that reached 12 months; started_at is the run's start and
--                   vested_through the end of its last served period (or its 12-month mark)
--   annual_term     an annual payment's term, granted when paid (conditional) and confirmed when served;
--                   transaction_id is the payment
--   operator        added by hand, with a note saying why (for example merging two Paddle customers)
-- status is conditional (an annual term not yet served), confirmed, or withdrawn (withdrawn_reason: refund,
-- chargeback, or term_not_completed). The customer's perpetual rights cover every release whose entitlement date is
-- on or before their latest confirmed vested_through (vested_through()). The computed rows are replaced by
-- set_customer_entitlement; operator rows are never touched by it.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.vested_entitlements (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references public.customers,
  kind text not null check (kind in ('qualifying_run', 'annual_term', 'operator')),
  started_at timestamp with time zone not null,
  vested_through timestamp with time zone not null,
  status text not null check (status in ('conditional', 'confirmed', 'withdrawn')),
  confirmed_at timestamp with time zone,
  transaction_id text,
  withdrawn_reason text check (withdrawn_reason in ('refund', 'chargeback', 'term_not_completed')),
  note text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint vested_entitlements_grant_key unique (customer_id, kind, started_at),
  constraint vested_entitlements_withdrawn_check check ((status = 'withdrawn') = (withdrawn_reason is not null)),
  constraint vested_entitlements_confirmed_check check ((status = 'confirmed') = (confirmed_at is not null)),
  constraint vested_entitlements_annual_check check ((kind = 'annual_term') = (transaction_id is not null)),
  constraint vested_entitlements_operator_check check (kind <> 'operator' or (note is not null and note <> ''))
);

alter table public.vested_entitlements enable row level security;

create policy "Vested entitlements are readable by their owner"
  on public.vested_entitlements as permissive for select to authenticated
  using (
    customer_id in (
      select customer_id from public.customers where email = (select private.confirmed_email())
    )
  );

-- The customer's vested-through date: the latest confirmed grant's, or null if they hold none.
create function public.vested_through(p_customer_id text)
returns timestamp with time zone
language sql
stable
security definer
set search_path = ''
as $$
  select max(v.vested_through)
  from public.vested_entitlements v
  where v.customer_id = p_customer_id and v.status = 'confirmed'
$$;

-- Stores a customer's derived state in one transaction and returns the access status it replaced ('lapsed' for a
-- customer seen for the first time): their active_subscriptions row, every computed vested_entitlements row (rows for
-- grants no longer computed are deleted; operator rows are kept), and each payment's status. The row lock makes
-- concurrent calls for one customer run one after the other, so exactly one of them sees each change of access.
-- Ending access resets the GitHub state: the caller then removes the account from the team (or cancels its
-- invitation), and reconcile retries that removal if it fails.
--   p_state             access_status, run_started_at, paid_through, months_paid, vests_at, conditional_through
--   p_grants            an array of kind, started_at, vested_through, status, confirmed_at, transaction_id,
--                       withdrawn_reason
--   p_payment_statuses  transaction id to status
create function public.set_customer_entitlement(
  p_customer_id text,
  p_state jsonb,
  p_grants jsonb,
  p_payment_statuses jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous text;
  access text := p_state ->> 'access_status';
begin
  insert into public.active_subscriptions (customer_id) values (p_customer_id)
  on conflict (customer_id) do nothing;

  select s.access_status into previous
  from public.active_subscriptions s
  where s.customer_id = p_customer_id
  for update;

  update public.active_subscriptions s
  set access_status = access,
      github_state = case when access = 'lapsed' then 'none' else s.github_state end,
      github_invited_at = case when access = 'lapsed' then null else s.github_invited_at end,
      run_started_at = (p_state ->> 'run_started_at')::timestamptz,
      paid_through = (p_state ->> 'paid_through')::timestamptz,
      months_paid = coalesce((p_state ->> 'months_paid')::integer, 0),
      vests_at = (p_state ->> 'vests_at')::timestamptz,
      conditional_through = (p_state ->> 'conditional_through')::timestamptz,
      updated_at = now()
  where s.customer_id = p_customer_id;

  delete from public.vested_entitlements v
  where v.customer_id = p_customer_id
    and v.kind <> 'operator'
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_grants, '[]')) g
      where g ->> 'kind' = v.kind and (g ->> 'started_at')::timestamptz = v.started_at
    );

  insert into public.vested_entitlements as v (
    customer_id, kind, started_at, vested_through, status, confirmed_at, transaction_id, withdrawn_reason
  )
  select
    p_customer_id,
    g ->> 'kind',
    (g ->> 'started_at')::timestamptz,
    (g ->> 'vested_through')::timestamptz,
    g ->> 'status',
    (g ->> 'confirmed_at')::timestamptz,
    g ->> 'transaction_id',
    g ->> 'withdrawn_reason'
  from jsonb_array_elements(coalesce(p_grants, '[]')) g
  where g ->> 'kind' <> 'operator'
  on conflict (customer_id, kind, started_at) do update
    set vested_through = excluded.vested_through,
        status = excluded.status,
        confirmed_at = excluded.confirmed_at,
        transaction_id = excluded.transaction_id,
        withdrawn_reason = excluded.withdrawn_reason,
        updated_at = now()
    where (v.vested_through, v.status, v.confirmed_at, v.transaction_id, v.withdrawn_reason)
      is distinct from
      (excluded.vested_through, excluded.status, excluded.confirmed_at, excluded.transaction_id,
       excluded.withdrawn_reason);

  update public.payments p
  set status = s.value, updated_at = now()
  from jsonb_each_text(coalesce(p_payment_statuses, '{}')) s
  where p.transaction_id = s.key and p.customer_id = p_customer_id and p.status <> s.value;

  return previous;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- pro_releases: each Tenantry Pro version the feed serves, and when it was published. entitlement_at is the date a
-- vested customer's vested_through is compared with: published_at, or for a security patch the published_at of its
-- minor's X.Y.0, so everyone vested on that minor can install the fix. A trigger sets it, and refuses a security
-- patch whose X.Y.0 is not recorded. Written by the feed's publish step; read by the feed with the service role.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.pro_releases (
  version text primary key,
  major integer not null check (major >= 0),
  minor integer not null check (minor >= 0),
  patch integer not null check (patch >= 0),
  published_at timestamp with time zone not null,
  security boolean not null default false,
  entitlement_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  constraint pro_releases_version_check check (version = major || '.' || minor || '.' || patch),
  constraint pro_releases_security_check check (not security or patch > 0),
  constraint pro_releases_minor_key unique (major, minor, patch)
);

alter table public.pro_releases enable row level security;

create function private.set_release_entitlement_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- An X.Y.0 marked as a security patch is left to pro_releases_security_check to refuse.
  if not new.security or new.patch = 0 then
    new.entitlement_at := new.published_at;
    return new;
  end if;

  select r.published_at into new.entitlement_at
  from public.pro_releases r
  where r.major = new.major and r.minor = new.minor and r.patch = 0;

  if new.entitlement_at is null then
    raise exception 'Security patch % has no recorded %.%.0 release to take its date from',
      new.version, new.major, new.minor
      using errcode = '23503';
  end if;

  return new;
end
$$;

-- entitlement_at is in the column list so that setting it directly is undone.
create trigger pro_releases_entitlement_at
  before insert or update of published_at, security, major, minor, patch, entitlement_at on public.pro_releases
  for each row execute function private.set_release_entitlement_at();

-- A corrected X.Y.0 date carries to its security patches: touching their entitlement_at re-runs the trigger above,
-- which takes the X.Y.0's new date.
create function private.carry_release_date_to_security_patches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.pro_releases r
  set entitlement_at = new.published_at
  where r.major = new.major and r.minor = new.minor and r.security and r.patch > 0;
  return null;
end
$$;

create trigger pro_releases_security_patch_dates
  after update of published_at on public.pro_releases
  for each row
  when (new.patch = 0 and new.published_at is distinct from old.published_at)
  execute function private.carry_release_date_to_security_patches();

-- ---------------------------------------------------------------------------------------------------------------------
-- customers_to_reconcile: every customer the reconcile run must check, as one array (not cut at the API's max_rows):
-- anyone with access recorded or a subscription that may entitle them, linked to GitHub, or whose licence is failing;
-- and anyone whose entitlement can change with time alone: a current run (vesting is confirmed at the 12-month mark
-- and at each later period end) or an annual grant waiting for its term to end. A licence no longer marks a customer:
-- every customer keeps theirs.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.customers_to_reconcile()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(customer_id order by customer_id), '{}')
  from (
    select customer_id from public.active_subscriptions
    where access_status in ('active', 'grace') or run_started_at is not null
    union
    select customer_id from public.subscriptions where status in ('active', 'trialing', 'past_due')
    union
    select customer_id from public.github_links
    union
    select customer_id from public.licence_failures
    union
    select customer_id from public.vested_entitlements where status = 'conditional'
  ) customers
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Only the service role calls the functions above.
-- ---------------------------------------------------------------------------------------------------------------------

revoke all on function public.record_subscription_event(
  text, text, text, text, text, timestamp with time zone, text, timestamp with time zone, timestamp with time zone,
  timestamp with time zone
) from public, anon, authenticated;
revoke all on function public.record_payment(
  text, text, text, text, text, text, integer, timestamp with time zone, timestamp with time zone, bigint, bigint,
  bigint, text, timestamp with time zone
) from public, anon, authenticated;
revoke all on function public.record_payment_adjustment(
  text, text, text, text, text, text, text[], text, timestamp with time zone, timestamp with time zone,
  timestamp with time zone
) from public, anon, authenticated;
revoke all on function public.vested_through(text) from public, anon, authenticated;
revoke all on function public.set_customer_entitlement(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.customers_to_reconcile() from public, anon, authenticated;
revoke all on function private.set_release_entitlement_at() from public, anon, authenticated;
revoke all on function private.carry_release_date_to_security_patches() from public, anon, authenticated;

grant execute on function public.record_subscription_event(
  text, text, text, text, text, timestamp with time zone, text, timestamp with time zone, timestamp with time zone,
  timestamp with time zone
) to service_role;
grant execute on function public.record_payment(
  text, text, text, text, text, text, integer, timestamp with time zone, timestamp with time zone, bigint, bigint,
  bigint, text, timestamp with time zone
) to service_role;
grant execute on function public.record_payment_adjustment(
  text, text, text, text, text, text, text[], text, timestamp with time zone, timestamp with time zone,
  timestamp with time zone
) to service_role;
grant execute on function public.vested_through(text) to service_role;
grant execute on function public.set_customer_entitlement(text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.customers_to_reconcile() to service_role;
