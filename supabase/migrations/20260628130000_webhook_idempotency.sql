-- Webhook idempotency (LAUNCH-PLAN.md §10 Phase 6).
--
-- Paddle delivers notifications at least once. Handlers already upsert idempotently, but recording
-- each processed event id lets the webhook skip duplicates entirely — avoiding redundant licence
-- issuance (which would otherwise insert a new licence row per delivery) and redundant GitHub API
-- calls.

create table
  public.processed_webhook_events (
    event_id text not null,
    event_type text not null,
    processed_at timestamp with time zone not null default now(),
    constraint processed_webhook_events_pkey primary key (event_id)
  ) tablespace pg_default;

-- Written only by the webhook handler via the service-role key; never read by end users.
alter table public.processed_webhook_events enable row level security;
