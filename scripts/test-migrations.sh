#!/usr/bin/env bash
# Tests a migration against rows of the schema before it: resets the local database to the migration before, loads
# supabase/migration-tests/<migration>/before.sql, applies the remaining migrations, and runs after.sql (pgTAP). Ends
# by resetting the local database to every migration, as `supabase db start` leaves it.
#
# Run from the repository root with this project's local stack running (`supabase start` or `supabase db start`). It
# only ever uses --local.
set -euo pipefail

cd "$(dirname "$0")/.."

test_migration() {
  local migration="$1" previous="$2"
  local dir="supabase/migration-tests/$migration"
  echo "== $migration, from $previous"
  # Called on the left of ||, where bash suspends set -e, so each step returns on failure itself.
  supabase db reset --local --version "$previous" >/dev/null || return 1
  supabase test db --local "$dir/before.sql" || return 1
  # Only the migration under test, and those after it.
  supabase migration up --local >/dev/null || return 1
  supabase test db --local "$dir/after.sql"
}

status=0
# Every folder in supabase/migration-tests, named after the migration it tests, from the migration before that one.
for dir in supabase/migration-tests/*/; do
  migration="$(basename "$dir")"
  if [[ ! -f "supabase/migrations/$migration.sql" ]]; then
    echo "== $migration: no such migration in supabase/migrations" >&2
    status=1
    continue
  fi
  previous=""
  for file in supabase/migrations/*.sql; do
    version="$(basename "$file")"
    version="${version%%_*}"
    if [[ "$version" < "${migration%%_*}" ]]; then previous="$version"; fi
  done
  if [[ -z "$previous" ]]; then
    echo "== $migration: no migration before it to start from" >&2
    status=1
    continue
  fi
  test_migration "$migration" "$previous" || status=1
done

supabase db reset --local >/dev/null
exit $status
