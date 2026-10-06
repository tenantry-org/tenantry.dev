-- A record of the package feed's downloads, kept for 90 days, so a token that is shared or misused can be seen.
--
--   feed_downloads  one row each time the feed hands out a package file (a redirect to the signed storage URL): the
--                   token, the package and version, when, and the client's network rather than its address (an IPv4
--                   address's /24, an IPv6 address's /48). Only the service role reads or writes it, as pro_packages.
--                   The daily reconcile run deletes rows older than 90 days (src/server/db/package-feed.ts:
--                   deleteFeedDownloadsBefore), the period the privacy policy states.
--   feed_customer   returns the token's id too, for the record.
--
-- There is no down migration, and no migration test: it adds a table and changes a function's columns, with no rows to
-- carry over.

create table public.feed_downloads (
  id bigint generated always as identity primary key,
  token_id uuid not null references public.feed_tokens on delete cascade,
  lower_id text not null,
  version text not null,
  client_network cidr,
  downloaded_at timestamp with time zone not null default now(),
  foreign key (lower_id, version) references public.pro_packages
);

create index feed_downloads_token_id_idx on public.feed_downloads (token_id, downloaded_at);
create index feed_downloads_downloaded_at_idx on public.feed_downloads (downloaded_at);

alter table public.feed_downloads enable row level security;
revoke all on public.feed_downloads from anon, authenticated;

-- As in 20261005100000_feed_access.sql, with the token's id.
drop function public.feed_customer(text);

create function public.feed_customer(p_token_hash text)
returns table (
  token_id uuid,
  customer_id text,
  access_status text,
  grace_ends_at timestamp with time zone,
  vested_through timestamp with time zone
)
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
    token.id,
    token.customer_id,
    coalesce(s.access_status, 'lapsed'),
    s.grace_ends_at,
    public.vested_through(token.customer_id)
  from (select 1) one
  left join public.active_subscriptions s on s.customer_id = token.customer_id;
end
$$;

revoke all on function public.feed_customer(text) from public, anon, authenticated;
grant execute on function public.feed_customer(text) to service_role;
