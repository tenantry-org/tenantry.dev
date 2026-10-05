-- Release candidates on the package feed: Tenantry Pro's release process tags candidates X.Y.Z-rc.N (N from 1) on the
-- release branch before X.Y.Z, and the feed publishes them like any release (src/server/feed/publish.ts).
--   pro_releases.rc   the candidate's number, or null for a release. The version is major.minor.patch, with -rc.N for a
--                     candidate. One row per major, minor, patch and rc, a release (rc null) included.
--   security          only a release can be a security patch, never a candidate.
--   entitlement_at    a candidate is dated when it was published, as any release that is not a security patch. A
--                     security patch takes the date of its minor's X.Y.0 release, never of a candidate of it, and a
--                     corrected X.Y.0 date carries to the security patches only from that release.
-- Existing rows are releases: rc stays null and nothing else changes. There is no down migration.
-- supabase/migration-tests/20261005170000_release_candidates tests it against rows of the schema before it.

alter table public.pro_releases
  add column rc integer check (rc is null or rc >= 1),
  drop constraint pro_releases_version_check,
  add constraint pro_releases_version_check
    check (version = major || '.' || minor || '.' || patch || coalesce('-rc.' || rc, '')),
  drop constraint pro_releases_security_check,
  add constraint pro_releases_security_check check (not security or (patch > 0 and rc is null)),
  drop constraint pro_releases_minor_key,
  add constraint pro_releases_version_key unique nulls not distinct (major, minor, patch, rc);

-- As in 20261004120000_entitlement_ledger.sql, taking a security patch's date from its minor's X.Y.0 release only.
create or replace function private.set_release_entitlement_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- An X.Y.0 or a candidate marked as a security patch is left to pro_releases_security_check to refuse.
  if not new.security or new.patch = 0 or new.rc is not null then
    new.entitlement_at := new.published_at;
    return new;
  end if;

  select r.published_at into new.entitlement_at
  from public.pro_releases r
  where r.major = new.major and r.minor = new.minor and r.patch = 0 and r.rc is null;

  if new.entitlement_at is null then
    raise exception 'Security patch % has no recorded %.%.0 release to take its date from',
      new.version, new.major, new.minor
      using errcode = '23503';
  end if;

  return new;
end
$$;

drop trigger pro_releases_entitlement_at on public.pro_releases;
create trigger pro_releases_entitlement_at
  before insert or update of published_at, security, major, minor, patch, rc, entitlement_at on public.pro_releases
  for each row execute function private.set_release_entitlement_at();

-- A corrected X.Y.0 release date carries to its security patches; a candidate's does not.
drop trigger pro_releases_security_patch_dates on public.pro_releases;
create trigger pro_releases_security_patch_dates
  after update of published_at on public.pro_releases
  for each row
  when (new.patch = 0 and new.rc is null and new.published_at is distinct from old.published_at)
  execute function private.carry_release_date_to_security_patches();
