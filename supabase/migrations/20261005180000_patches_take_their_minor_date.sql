-- Every patch release vests with its minor version (the owner's decision of 5 October 2026: any patch of a version
-- available in the vesting window is vested for good). A patch release, X.Y.Z with Z above 0 and no release
-- candidate number, takes the date of its minor's X.Y.0 release as its entitlement date, whenever it is published and
-- whether or not it is a security fix. Before, only a security patch did.
--   entitlement_at   for a patch release, the published_at of its X.Y.0 release; for an X.Y.0 release or a release
--                    candidate (X.Y.Z-rc.N, of a minor or of a patch), its own published_at. A candidate inherits
--                    nothing.
--   inserting        a patch release whose X.Y.0 release is not recorded is refused (23503), as a security patch was.
--   correcting       a corrected X.Y.0 release date carries to every patch release of its minor.
--   security         still recorded, and still refused on an X.Y.0 or a candidate, but it no longer changes any date.
-- Existing patch releases take their X.Y.0 release's date. One whose X.Y.0 release is not recorded keeps its own date
-- (none exists on the feed when this is written); changing its date or version later is refused until that X.Y.0 is
-- recorded. There is no down migration. supabase/migration-tests/20261005180000_patches_take_their_minor_date tests it
-- against rows of the schema before it.

create or replace function private.set_release_entitlement_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.patch = 0 or new.rc is not null then
    new.entitlement_at := new.published_at;
    return new;
  end if;

  select r.published_at into new.entitlement_at
  from public.pro_releases r
  where r.major = new.major and r.minor = new.minor and r.patch = 0 and r.rc is null;

  if new.entitlement_at is null then
    raise exception 'Patch release % has no recorded %.%.0 release to take its date from',
      new.version, new.major, new.minor
      using errcode = '23503';
  end if;

  return new;
end
$$;

-- A corrected X.Y.0 release date carries to every patch release of its minor: touching their entitlement_at re-runs
-- the trigger above.
create function private.carry_release_date_to_patches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.pro_releases r
  set entitlement_at = new.published_at
  where r.major = new.major and r.minor = new.minor and r.patch > 0 and r.rc is null;
  return null;
end
$$;

drop trigger pro_releases_security_patch_dates on public.pro_releases;
drop function private.carry_release_date_to_security_patches();

create trigger pro_releases_patch_dates
  after update of published_at on public.pro_releases
  for each row
  when (new.patch = 0 and new.rc is null and new.published_at is distinct from old.published_at)
  execute function private.carry_release_date_to_patches();

revoke all on function private.carry_release_date_to_patches() from public, anon, authenticated;

-- Existing patch releases whose X.Y.0 release is recorded: the trigger sets their date from it.
update public.pro_releases r
set entitlement_at = x.published_at
from public.pro_releases x
where x.major = r.major and x.minor = r.minor and x.patch = 0 and x.rc is null
  and r.patch > 0 and r.rc is null;
