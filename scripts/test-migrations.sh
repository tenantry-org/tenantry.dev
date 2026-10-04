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
  supabase db reset --local --version "$previous" >/dev/null
  supabase test db --local "$dir/before.sql"
  supabase migration up --local >/dev/null
  supabase test db --local "$dir/after.sql"
}

status=0
test_migration 20261004120000_entitlement_ledger 20261002120000 || status=1

supabase db reset --local >/dev/null
exit $status
