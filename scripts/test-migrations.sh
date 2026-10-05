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
  # Only the migration under test, and those after it.
  supabase migration up --local >/dev/null
  supabase test db --local "$dir/after.sql"
}

status=0
test_migration 20261004120000_entitlement_ledger 20261002120000 || status=1
test_migration 20261005090000_retire_github_delivery 20261004130000 || status=1
test_migration 20261005100000_feed_access 20261005090000 || status=1
test_migration 20261005120000_money_kept 20261005100000 || status=1
test_migration 20261005140000_test_customers 20261005130000 || status=1
test_migration 20261005160000_annual_term_vests_when_paid 20261005150000 || status=1
test_migration 20261005170000_release_candidates 20261005160000 || status=1
test_migration 20261005180000_patches_take_their_minor_date 20261005170000 || status=1

supabase db reset --local >/dev/null
exit $status
