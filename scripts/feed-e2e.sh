#!/usr/bin/env bash
# End-to-end test of the package feed (src/server/feed) and the Pro access page's feed tokens, with a real NuGet client
# and the site's own server code: packs a small probe package in three releases, publishes them with `dotnet nuget push`
# and scripts/feed-publish.sh, signs customers in, creates their feed tokens with the Access page's server action, then
# restores as each of them and checks what NuGet resolves, downloads and refuses.
#
#   Tenantry.Pro.FeedProbe<run> 1.<n>.0      released 20 seconds before the run started
#   Tenantry.Pro.FeedProbe<run> 1.<n>.1      a patch release (not a security fix), released 5 seconds before, after the
#                                            vested customer's date, and dated as 1.<n>.0
#   Tenantry.Pro.FeedProbe<run> 1.<n+1>.0    released when the run started
#   Tenantry.Pro.FeedProbe<run> 1.<n+2>.0-rc.1  a release candidate, released when the run started
#
# <run> is the run's start time and <n> grows with it, so each run publishes packages and releases of its own to the
# same database, later than every earlier run's (the feed refuses a release dated before an earlier version's, or more
# than a few days before now).
#
#   computed  lapsed, with 12 paid months that scripts/rehearse.mjs backdates and /api/reconcile vests; then a
#             chargeback withdraws the vesting and `undo` removes what the script wrote
#   active    a subscriber: restores 1.<n+1>.0 for 1.*, not the release candidate, which 1.*-* and its own version
#             restore; with a lock file whose hash matches the package, and a
#             locked-mode restore from an empty package folder downloads it again through the redirect; a second token
#             restores until it is revoked through the Access page's action, and then fails
#   vested    lapsed, vested through 15 seconds before the run by an operator grant (scripts/rehearse.mjs): creates a
#             token, restores 1.<n>.1 for 1.*; 1.<n+1>.0 is not found, even from a lock file
#   unvested  created a token while subscribed, then lapsed with nothing vested: refused with 403, and refused a new token
#   unknown   a well-formed token the feed does not know: refused with 401
#
# Needs dotnet, curl, jq, openssl, unzip, access to nuget.org (for NETStandard.Library) and a local Supabase stack with
# this repository's migrations applied and Storage and Auth running (`supabase start`), given by:
#   FEED_E2E_SUPABASE_URL       its API URL, such as http://127.0.0.1:54321
#   FEED_E2E_ANON_KEY           its anon key
#   FEED_E2E_SERVICE_ROLE_KEY   its service-role key
# It starts the site with `next dev` on FEED_E2E_PORT (default 3197) with stand-in settings for everything else, and
# writes its users, customers, packages and tokens to that local database. It refuses any Supabase URL that is not
# local. It never calls Paddle: its customers have no subscriptions, so reconcile has nothing to ask Paddle about.
set -euo pipefail

: "${FEED_E2E_SUPABASE_URL:?set FEED_E2E_SUPABASE_URL to the local Supabase API URL}"
: "${FEED_E2E_ANON_KEY:?set FEED_E2E_ANON_KEY}"
: "${FEED_E2E_SERVICE_ROLE_KEY:?set FEED_E2E_SERVICE_ROLE_KEY}"
case "$FEED_E2E_SUPABASE_URL" in
  http://127.0.0.1:* | http://localhost:*) ;;
  *)
    echo "FEED_E2E_SUPABASE_URL must be a local stack (http://127.0.0.1:… or http://localhost:…)" >&2
    exit 2
    ;;
esac

port="${FEED_E2E_PORT:-3197}"
site="http://127.0.0.1:$port"
feed="$site/feed/v3/index.json"
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
run_id="$(date +%s)"
probe_id="Tenantry.Pro.FeedProbe$run_id"
n=$((run_id - 1790000000))
v_first="1.$n.0" v_patch="1.$n.1" v_next="1.$((n + 1)).0" v_rc="1.$((n + 2)).0-rc.1"
# An ISO 8601 UTC time, `seconds` before the run started (BSD date, then GNU).
iso_before() {
  local at=$((run_id - $1))
  date -u -r "$at" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$at" +%Y-%m-%dT%H:%M:%SZ
}
probe_lower="$(tr '[:upper:]' '[:lower:]' <<<"$probe_id")"
failures=0
passes=0

cleanup() {
  if [[ -n "${server_pid:-}" ]]; then
    pkill -P "$server_pid" 2>/dev/null || true
    kill "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

pass() {
  passes=$((passes + 1))
  echo "PASS  $1"
}
fail() {
  failures=$((failures + 1))
  echo "FAIL  $1"
  if [[ -n "${2:-}" ]]; then sed 's/^/      /' <<<"$2" | tail -20; fi
}
# check NAME CONDITION [OUTPUT]: passes when the condition (a bash expression) holds.
check() {
  if eval "$2"; then pass "$1"; else fail "$1" "${3:-}"; fi
}

# Writes a row through the local stack's REST API with the service-role key.
rest() {
  curl -sS --fail-with-body -X POST "$FEED_E2E_SUPABASE_URL/rest/v1/$1" \
    -H "apikey: $FEED_E2E_SERVICE_ROLE_KEY" -H "Authorization: Bearer $FEED_E2E_SERVICE_ROLE_KEY" \
    -H 'Content-Type: application/json' -d "$2" >/dev/null
}

# Changes rows through the REST API with the service-role key: rest_patch TABLE FILTER JSON.
rest_patch() {
  curl -sS --fail-with-body -X PATCH "$FEED_E2E_SUPABASE_URL/rest/v1/$1?$2" \
    -H "apikey: $FEED_E2E_SERVICE_ROLE_KEY" -H "Authorization: Bearer $FEED_E2E_SERVICE_ROLE_KEY" \
    -H 'Content-Type: application/json' -d "$3" >/dev/null
}
# Reads rows: rest_get TABLE QUERY.
rest_get() {
  curl -sS --fail-with-body "$FEED_E2E_SUPABASE_URL/rest/v1/$1?$2" \
    -H "apikey: $FEED_E2E_SERVICE_ROLE_KEY" -H "Authorization: Bearer $FEED_E2E_SERVICE_ROLE_KEY"
}

sha256_hex() { printf '%s' "$1" | openssl dgst -sha256 -r | cut -d' ' -f1; }
file_hash() { openssl dgst -sha512 -binary "$1" | openssl base64 -A; }

# --- The site -----------------------------------------------------------------------------------------------------

publish_key="$(openssl rand -hex 32)"
openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null | openssl pkcs8 -topk8 -nocrypt -out "$work/licence.pem"

echo "Starting the site on $site"
(
  cd "$repo"
  exec env \
    NEXT_PUBLIC_SITE_URL="$site" \
    NEXT_PUBLIC_SUPABASE_URL="$FEED_E2E_SUPABASE_URL" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="$FEED_E2E_ANON_KEY" \
    SUPABASE_SERVICE_ROLE_KEY="$FEED_E2E_SERVICE_ROLE_KEY" \
    NEXT_PUBLIC_PADDLE_ENV=sandbox \
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_e2e \
    NEXT_PUBLIC_PADDLE_PRICE_MONTHLY=pri_e2emonth \
    NEXT_PUBLIC_PADDLE_PRICE_YEARLY=pri_e2eyear \
    PADDLE_API_KEY=e2e PADDLE_NOTIFICATION_WEBHOOK_SECRET=e2e PADDLE_PRO_PRODUCT_ID=pro_e2e \
    CRON_SECRET=e2e \
    LICENCE_SIGNING_PRIVATE_KEY="$(cat "$work/licence.pem")" \
    FEED_PUBLISH_KEY_SHA256="$(sha256_hex "$publish_key")" \
    npx next dev --port "$port" --hostname 127.0.0.1 >"$work/site.log" 2>&1
) &
server_pid=$!

for _ in $(seq 1 180); do
  if curl -sf "$feed" >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! curl -sf "$feed" >/dev/null; then
  echo "The site did not start:"
  tail -40 "$work/site.log"
  exit 1
fi

# --- The packages -------------------------------------------------------------------------------------------------

export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
export NUGET_HTTP_CACHE_PATH="$work/http-cache"  # for packing and pushing; each consumer has its own

# The feed for Tenantry Pro's packages and nuget.org for everything else, as a customer would configure them.
sources() {
  cat <<SOURCES
  <packageSources>
    <clear />
    <add key="tenantry" value="$feed" allowInsecureConnections="true" />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="tenantry"><package pattern="Tenantry.Pro.*" /></packageSource>
    <packageSource key="nuget.org"><package pattern="*" /></packageSource>
  </packageSourceMapping>
SOURCES
}

cat >"$work/nuget.config" <<CONFIG
<?xml version="1.0" encoding="utf-8"?>
<configuration>
$(sources)
</configuration>
CONFIG

mkdir -p "$work/probe" "$work/nupkgs"
cat >"$work/probe/$probe_id.csproj" <<'PROJECT'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>netstandard2.0</TargetFramework>
    <Authors>Tenantry</Authors>
    <Description>A package for testing the Tenantry Pro feed.</Description>
    <!-- The package versions' minor is too large for an assembly version. -->
    <AssemblyVersion>1.0.0.0</AssemblyVersion>
    <FileVersion>1.0.0.0</FileVersion>
  </PropertyGroup>
  <ItemGroup>
    <None Include="tenantry-release.json" Pack="true" PackagePath="" />
  </ItemGroup>
</Project>
PROJECT
echo 'namespace Tenantry.Pro.FeedProbe { public static class Probe { public const int Value = 1; } }' \
  >"$work/probe/Probe.cs"

# pack VERSION RELEASED_AT SECURITY
pack() {
  printf '{ "releasedAt": "%s", "security": %s }' "$2" "$3" >"$work/probe/tenantry-release.json"
  if ! NUGET_PACKAGES="$work/pack-packages" dotnet pack "$work/probe" -c Release -p:Version="$1" \
    -p:RestoreConfigFile="$work/nuget.config" -o "$work/nupkgs" --nologo >"$work/pack-$1.log" 2>&1; then
    cat "$work/pack-$1.log"
    exit 1
  fi
}
pack "$v_first" "$(iso_before 20)" false
pack "$v_patch" "$(iso_before 5)" false
pack "$v_next" "$(iso_before 0)" false
pack "$v_rc" "$(iso_before 0)" false

# push VERSION KEY: dotnet nuget push to the feed. A rerun against the same database finds the packages published
# already, which --skip-duplicate accepts.
push() {
  dotnet nuget push "$work/nupkgs/$probe_id.$1.nupkg" --source tenantry --api-key "$2" \
    --configfile "$work/nuget.config" --skip-duplicate 2>&1
}
for version in "$v_first" "$v_patch" "$v_next" "$v_rc"; do
  if output="$(push "$version" "$publish_key")"; then
    pass "dotnet nuget push publishes $version"
  else
    fail "dotnet nuget push publishes $version" "$output"
  fi
done
if output="$(push "$v_next" wrong-key)"; then
  fail 'a push with a wrong key is refused' "$output"
else
  check 'a push with a wrong key is refused' '[[ "$output" == *403* ]]' "$output"
fi

# A second build of 1.<n>.0, with other content: the feed must refuse it, even with --skip-duplicate.
mkdir -p "$work/other"
cp "$work/nupkgs/$probe_id.$v_first.nupkg" "$work/other/"
echo 'namespace Tenantry.Pro.FeedProbe { public static class Probe { public const int Value = 2; } }' >"$work/probe/Probe.cs"
pack "$v_first" "$(iso_before 20)" false
mv "$work/nupkgs/$probe_id.$v_first.nupkg" "$work/other/rebuilt.nupkg"
mv "$work/other/$probe_id.$v_first.nupkg" "$work/nupkgs/"
if output="$(dotnet nuget push "$work/other/rebuilt.nupkg" --source tenantry --api-key "$publish_key" \
  --configfile "$work/nuget.config" --skip-duplicate 2>&1)"; then
  fail 'a different package under a published version is refused, even with --skip-duplicate' "$output"
else
  check 'a different package under a published version is refused, even with --skip-duplicate' \
    '[[ "$output" == *400* ]]' "$output"
fi

# The operator's script: pushing the release again changes nothing, and the listing shows what the feed holds.
if output="$(FEED_PUBLISH_KEY="$publish_key" bash "$repo/scripts/feed-publish.sh" push "$site" "$work/nupkgs" 2>&1)"; then
  check 'scripts/feed-publish.sh pushes a published release again as unchanged' \
    '[[ "$output" == *"0 published, 4 already published."* ]]' "$output"
else
  fail 'scripts/feed-publish.sh pushes a published release again as unchanged' "$output"
fi
output="$(FEED_PUBLISH_KEY="$publish_key" bash "$repo/scripts/feed-publish.sh" list "$site" 2>&1 || true)"
first_published="$(awk -v v="$v_first" '$1 == v { print $3 }' <<<"$output")"
patch_dated="$(awk -v v="$v_patch" '$1 == v { print $6 }' <<<"$output")"
check 'scripts/feed-publish.sh lists the releases, with the patch release dated as its minor' \
  '[[ -n "$first_published" && "$patch_dated" == "$first_published" && "$output" == *"$probe_id"* ]]' "$output"
output="$(FEED_PUBLISH_KEY=wrong bash "$repo/scripts/feed-publish.sh" list "$site" 2>&1 || true)"
check 'and refuses a wrong publish key' '[[ "$output" == *403* ]]' "$output"

# --- The customers ------------------------------------------------------------------------------------------------

password="e2e-$(openssl rand -hex 12)"
customer_of() { echo "ctm_e2e_${1}_$run_id"; }
email_of() { echo "$(customer_of "$1")@example.com"; }

# signup NAME ACCESS: a confirmed login, its customer and their recorded access.
signup() {
  curl -sS --fail-with-body -X POST "$FEED_E2E_SUPABASE_URL/auth/v1/admin/users" \
    -H "apikey: $FEED_E2E_SERVICE_ROLE_KEY" -H "Authorization: Bearer $FEED_E2E_SERVICE_ROLE_KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$(email_of "$1")\",\"password\":\"$password\",\"email_confirm\":true}" >/dev/null
  rest customers "{\"customer_id\":\"$(customer_of "$1")\",\"email\":\"$(email_of "$1")\"}"
  rest active_subscriptions "{\"customer_id\":\"$(customer_of "$1")\",\"access_status\":\"$2\"}"
}

# The customer's session cookies, as the site's sign-in sets them (@supabase/ssr), in a file per customer.
session() {
  if [[ ! -f "$work/cookie-$1" ]]; then
    (cd "$repo" && URL="$FEED_E2E_SUPABASE_URL" ANON="$FEED_E2E_ANON_KEY" EMAIL="$(email_of "$1")" PASSWORD="$password" \
      node --input-type=module -e '
        import { createServerClient } from "@supabase/ssr";
        const jar = new Map();
        const client = createServerClient(process.env.URL, process.env.ANON, {
          cookies: {
            getAll: () => [...jar].map(([name, value]) => ({ name, value })),
            setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
          },
        });
        const { error } = await client.auth.signInWithPassword({ email: process.env.EMAIL, password: process.env.PASSWORD });
        if (error) throw error;
        process.stdout.write([...jar].map(([name, value]) => `${name}=${value}`).join("; "));
      ') >"$work/cookie-$1"
  fi
  cat "$work/cookie-$1"
}

# action CUSTOMER NAME ARGUMENT: calls one of the Access page's server actions (src/app/dashboard/pro/actions.ts) as
# the signed-in customer, the way the page's form does, and prints the answer.
action_id() {
  jq -r --arg name "$1" '.node | to_entries[]
    | select(.value.exportedName == $name and .value.filename == "src/app/dashboard/pro/actions.ts") | .key' \
    "$repo/.next/dev/server/server-reference-manifest.json"
}
action() {
  curl -sS -X POST "$site/dashboard/pro" -H "Cookie: $(session "$1")" -H "Next-Action: $(action_id "$2")" \
    -H 'Content-Type: text/plain;charset=UTF-8' -H 'Accept: text/x-component' -H "Origin: $site" \
    --data "[$(jq -n --arg value "$3" '$value')]"
}
# new_token CUSTOMER FILE NAME: creates a feed token through the action and keeps it in the file.
new_token() {
  local answer
  answer="$(action "$1" createFeedToken "$3")"
  grep -o '"token":"tpf_[A-Za-z0-9_-]*"' <<<"$answer" | head -1 | cut -d'"' -f4 >"$work/token-$2"
  if [[ -s "$work/token-$2" ]]; then pass "$1 creates the feed token $3 on the Access page"; else
    fail "$1 creates the feed token $3 on the Access page" "$answer"
  fi
}
token() { cat "$work/token-$1"; }

# The Access page compiles its actions when it is first requested.
signup active active
curl -sf -o "$work/access.html" -H "Cookie: $(session active)" "$site/dashboard/pro" || true
check 'the Access page shows a subscriber the token form and every release' \
  'grep -q "id=\"feed-token-name\"" "$work/access.html" && grep -q "serves you every Tenantry Pro release" "$work/access.html"'

new_token active active CI
new_token active revocable laptop
check 'a feed token is stored only as its hash, with its first characters' \
  '[[ "$(rest_get feed_tokens "customer_id=eq.$(customer_of active)&select=token_hash,prefix&order=created_at" |
      jq -r ".[0].token_hash + \" \" + .[0].prefix")" == "$(sha256_hex "$(token active)") $(token active | cut -c1-8)" ]]'

signup vested lapsed
(cd "$repo" && NEXT_PUBLIC_PADDLE_ENV=sandbox NEXT_PUBLIC_SUPABASE_URL="$FEED_E2E_SUPABASE_URL" \
  SUPABASE_SERVICE_ROLE_KEY="$FEED_E2E_SERVICE_ROLE_KEY" \
  node scripts/rehearse.mjs grant "$(email_of vested)" "$(iso_before 15)" e2e vested before the run) >"$work/grant.log" 2>&1 ||
  fail 'scripts/rehearse.mjs grants a vested-through date' "$(cat "$work/grant.log")"
new_token vested vested Laptop

signup unvested active
new_token unvested unvested CI
rest_patch active_subscriptions "customer_id=eq.$(customer_of unvested)" '{"access_status":"lapsed"}'
answer="$(action unvested createFeedToken 'after the lapse')"
check 'a lapsed customer with nothing vested is refused a new token, and told why' \
  '[[ "$answer" == *"no releases are vested, so the package feed serves you nothing"* ]]' "$answer"

echo "tpf_$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' | cut -c1-43)" >"$work/token-unknown"

# consumer CUSTOMER VERSION: a project referencing the probe at VERSION with the customer's token, restoring into its own
# package folder.
consumer() {
  local dir="$work/consumer-$1-$(sha256_hex "$2" | cut -c1-8)"
  mkdir -p "$dir"
  cat >"$dir/nuget.config" <<CONFIG
<?xml version="1.0" encoding="utf-8"?>
<configuration>
$(sources)
  <packageSourceCredentials>
    <tenantry>
      <add key="Username" value="e2e" />
      <add key="ClearTextPassword" value="$(token "$1")" />
    </tenantry>
  </packageSourceCredentials>
</configuration>
CONFIG
  cat >"$dir/Consumer.csproj" <<PROJECT
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>netstandard2.0</TargetFramework>
    <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="$probe_id" Version="$2" />
  </ItemGroup>
</Project>
PROJECT
  echo "$dir"
}

# Each consumer has its own package folder and HTTP cache: NuGet caches version lists by URL for 30 minutes whatever
# the credentials, so a shared cache would show one customer another's list.
restore() {
  NUGET_PACKAGES="$1/packages" NUGET_HTTP_CACHE_PATH="$1/http-cache" dotnet restore "$1" --nologo "${@:2}" 2>&1
}
probe() { jq -r ".dependencies[][\"$probe_id\"] | select(. != null) | .$2" "$1/packages.lock.json"; }

# Active: the newest release, with the lock file's hash the package's own, then a locked-mode restore from nothing.
dir="$(consumer active '1.*')"
if output="$(restore "$dir")"; then
  check "an active customer restores 1.* as $v_next" '[[ "$(probe "$dir" resolved)" == $v_next ]]' "$output"
  check "the lock file records the published package's SHA-512" \
    '[[ "$(probe "$dir" contentHash)" == "$(file_hash "$work/nupkgs/$probe_id.$v_next.nupkg")" ]]'
else
  fail "an active customer restores 1.* as $v_next" "$output"
fi
rm -rf "$dir/packages" "$dir/http-cache"
if output="$(restore "$dir" --locked-mode)"; then
  pass 'a locked-mode restore downloads it again, through the redirect'
else
  fail 'a locked-mode restore downloads it again, through the redirect' "$output"
fi
# The release candidate: only a version or range that allows prereleases restores it.
for range in '1.*-*' "$v_rc"; do
  dir="$(consumer active "$range")"
  if output="$(restore "$dir")"; then
    check "an active customer restores $range as the release candidate $v_rc" '[[ "$(probe "$dir" resolved)" == $v_rc ]]' \
      "$output"
  else
    fail "an active customer restores $range as the release candidate $v_rc" "$output"
  fi
done

# The redirect itself, and a 404.
auth="Authorization: Basic $(printf 'e2e:%s' "$(token active)" | openssl base64 -A)"
headers="$(curl -s -o /dev/null -D - -H "$auth" \
  "$site/feed/v3/flat/$probe_lower/$v_next/$probe_lower.$v_next.nupkg")"
check 'a download answers 302 to a signed storage URL, kept out of shared caches' \
  '[[ "$headers" == *" 302"* && "$headers" == *"/storage/v1/object/sign/pro-packages/"* && "$headers" == *"private, no-store"* ]]' \
  "$headers"
location="$(sed -n 's/^[Ll]ocation: //p' <<<"$headers" | tr -d '\r')"
curl -sf -o "$work/downloaded.nupkg" "$location" || true
check 'the signed URL serves the published bytes' \
  '[[ -f "$work/downloaded.nupkg" && "$(file_hash "$work/downloaded.nupkg")" == "$(file_hash "$work/nupkgs/$probe_id.$v_next.nupkg")" ]]'
status="$(curl -s -o /dev/null -w '%{http_code}' -H "$auth" "$site/feed/v3/flat/tenantry.pro.missing/index.json")"
check 'an unknown package answers 404' '[[ "$status" == 404 ]]' "$status"

# Vested: the patch release of the vested minor, though it was published after the vested-through date, and nothing
# newer.
dir="$(consumer vested '1.*')"
name="a vested customer restores 1.* as the patch release $v_patch, published after its date"
if output="$(restore "$dir")"; then
  check "$name" '[[ "$(probe "$dir" resolved)" == $v_patch ]]' "$output"
else
  fail "$name" "$output"
fi
dir="$(consumer vested "[$v_next]")"
if output="$(restore "$dir")"; then
  fail "a vested customer cannot restore $v_next" "$output"
else
  check "a vested customer cannot restore $v_next" '[[ "$output" == *NU1102* || "$output" == *NU1101* ]]' "$output"
fi
dir="$(consumer active "[$v_next]")"
restore "$dir" >/dev/null || true
sed -i.bak "s/$(token active)/$(token vested)/" "$dir/nuget.config"
rm -rf "$dir/packages" "$dir/http-cache"
if output="$(restore "$dir" --locked-mode)"; then
  fail "nor from another customer's lock file" "$output"
else
  pass "nor from another customer's lock file"
fi

# Unvested and unknown: refused.
dir="$(consumer unvested '1.*')"
if output="$(restore "$dir")"; then
  fail 'a lapsed customer who never vested is refused with 403' "$output"
else
  check 'a lapsed customer who never vested is refused with 403' '[[ "$output" == *403* ]]' "$output"
fi
dir="$(consumer unknown '1.*')"
if output="$(restore "$dir")"; then
  fail 'an unknown token is refused with 401' "$output"
else
  check 'an unknown token is refused with 401' '[[ "$output" == *401* ]]' "$output"
fi

# Revoking: the token restores until it is revoked on the Access page, then is refused; another customer cannot.
dir="$(consumer revocable '1.*')"
if output="$(restore "$dir")"; then pass 'a second token of the subscriber restores'; else
  fail 'a second token of the subscriber restores' "$output"
fi
revocable_id="$(rest_get feed_tokens "customer_id=eq.$(customer_of active)&name=eq.laptop&select=id" | jq -r '.[0].id')"
answer="$(action vested revokeFeedToken "$revocable_id")"
check "another customer cannot revoke it" '[[ "$answer" == *"not found"* ]]' "$answer"
answer="$(action active revokeFeedToken "$revocable_id")"
check 'its customer revokes it on the Access page' '[[ "$answer" == *"\"revoked\":true"* ]]' "$answer"
dir="$(consumer revocable '1.*')"
rm -rf "$dir/packages" "$dir/http-cache" "$dir/obj"
if output="$(restore "$dir")"; then
  fail 'a revoked token is refused with 401' "$output"
else
  check 'a revoked token is refused with 401' '[[ "$output" == *401* ]]' "$output"
fi
dir="$(consumer active '1.*')"
rm -rf "$dir/packages" "$dir/http-cache" "$dir/obj"
if output="$(restore "$dir")"; then pass "the subscriber's other token keeps working"; else
  fail "the subscriber's other token keeps working" "$output"
fi

# Vesting computed from the ledger: scripts/rehearse.mjs backdates 12 paid months, /api/reconcile vests them, a refund
# of half the newest one or a chargeback of it takes the vesting away (the money kept no longer pays for 12 months
# served), and undo removes what the script wrote. The customer has no subscription, so reconcile asks Paddle nothing.
# Their real payment is kept, so the paid time runs through it and the vested-through date is the reconcile's time, on
# or after that payment's start.
signup computed lapsed
anchor="$(iso_before 86400)"
rest payments "{\"transaction_id\":\"txn_e2e_$run_id\",\"customer_id\":\"$(customer_of computed)\",
  \"subscription_id\":\"sub_e2e_$run_id\",\"origin\":\"web\",\"price_id\":\"pri_e2emonth\",\"billing_interval\":\"month\",
  \"billing_frequency\":1,\"period_starts_at\":\"$anchor\",\"period_ends_at\":\"$(iso_before -2500000)\",
  \"subtotal\":3900,\"discount\":0,\"total\":3900,\"currency_code\":\"GBP\",\"completed_at\":\"$anchor\",
  \"last_event_at\":\"$anchor\"}"
rehearse() {
  (cd "$repo" && NEXT_PUBLIC_PADDLE_ENV=sandbox NEXT_PUBLIC_SUPABASE_URL="$FEED_E2E_SUPABASE_URL" \
    SUPABASE_SERVICE_ROLE_KEY="$FEED_E2E_SERVICE_ROLE_KEY" NEXT_PUBLIC_SITE_URL="$site" CRON_SECRET=e2e \
    node scripts/rehearse.mjs "$1" "$(email_of computed)" 2>&1)
}
vested_of() {
  rest_get vested_entitlements "customer_id=eq.$(customer_of computed)&kind=eq.paid_time&select=status,vested_through" |
    jq -r '.[0] | if . == null then "none" else .status + " " + (.vested_through | sub("\\+00:00$"; "Z") | sub("\\.[0-9]+Z$"; "Z")) end'
}
vested_on_or_after_anchor() {
  local vested
  vested="$(vested_of)"
  [[ "$vested" == confirmed* && ! "${vested#confirmed }" < "$anchor" ]]
}
output="$(rehearse vested)"
check 'scripts/rehearse.mjs backdates 12 paid months, and reconcile vests them through the time served' \
  'vested_on_or_after_anchor' "$output"
output="$(rehearse partial)"
# Half a month is no longer counted, and the real payment has served only a day of it back.
check 'a refund of half of the newest of them puts 12 paid months half a month later, so nothing is vested yet' \
  '[[ "$(vested_of)" == none ]]' "$output"
output="$(rehearse undo)"
output="$(rehearse vested)"
check 'vesting again after undo' 'vested_on_or_after_anchor' "$output"
output="$(rehearse chargeback)"
check 'a chargeback of the newest of them takes the vesting away' '[[ "$(vested_of)" == none ]]' "$output"
output="$(rehearse undo)"
check 'undo removes what the script wrote, and the customer is vested in nothing' \
  '[[ "$(vested_of)" == none && "$(rest_get payments "customer_id=eq.$(customer_of computed)&select=transaction_id" | jq length)" == 1 ]]' \
  "$output"
output="$(cd "$repo" && NEXT_PUBLIC_PADDLE_ENV=production node scripts/rehearse.mjs show x@example.com 2>&1 || true)"
check 'scripts/rehearse.mjs refuses to run outside the sandbox' '[[ "$output" == *"not \"sandbox\""* ]]' "$output"

echo
echo "$passes passed, $failures failed"
[[ $failures -eq 0 ]]
