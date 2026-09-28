-- Recoverable licence issuance (implementation plan 6.5).
--
-- Issuing a licence can fail after the customer's access has been recorded (signing, or storing the
-- token). Reconcile retries it until it succeeds, so nothing waits on a new purchase or renewal. This table
-- records each customer whose licence is currently failing: when the failures started, how many attempts
-- have failed, and the last error. A row exists only while issuance is failing and is deleted once a
-- licence matching the customer's access exists. The operator is alerted once per run of failures (when
-- the row is created), not on every retry.
--
-- The errors are internal, so customers cannot read this table: RLS is on and there is no policy.

create table public.licence_failures (
  customer_id text not null,
  failing_since timestamp with time zone not null default now(),
  attempts integer not null default 1,
  last_error text not null,
  last_attempt_at timestamp with time zone not null default now(),
  constraint licence_failures_pkey primary key (customer_id),
  constraint licence_failures_customer_id_fkey foreign key (customer_id) references public.customers (customer_id)
);

alter table public.licence_failures enable row level security;

-- Records a failed attempt and returns true if it starts a run of failures (the one to alert on).
create or replace function public.record_licence_failure(p_customer_id text, p_error text)
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

revoke all on function public.record_licence_failure(text, text) from public, anon, authenticated;
grant execute on function public.record_licence_failure(text, text) to service_role;
