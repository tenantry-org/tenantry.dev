#!/usr/bin/env bash
# End-to-end test of the package feed (src/server/feed) with a real NuGet client: packs a small probe package in three
# releases, publishes them with `dotnet nuget push`, then restores as several customers and checks what NuGet
# resolves, downloads and refuses.
#
#   Tenantry.Pro.FeedProbe<run> 1.<n>.0      released 20 seconds before the run started
#   Tenantry.Pro.FeedProbe<run> 1.<n>.1      a security patch, released 10 seconds before, dated as 1.<n>.0
#   Tenantry.Pro.FeedProbe<run> 1.<n+1>.0    released when the run started
#
# <run> is the run's start time and <n> grows with it, so each run publishes packages and releases of its own to the
# same database, later than every earlier run's (the feed refuses a release dated before an earlier version's, or more
# than a few days before now).
#
#   active    a subscriber: restores 1.<n+1>.0 for 1.*, with a lock file whose hash matches the package, and a
#             locked-mode restore from an empty package folder downloads it again through the redirect
#   vested    lapsed, vested through 15 seconds before the run: restores 1.<n>.1 for 1.*; 1.<n+1>.0 is not found, even
#             from a lock file
#   unvested  lapsed, never vested: refused with 403
#   unknown   a token the feed does not know: refused with 401
#
# Needs dotnet, curl, jq, openssl, access to nuget.org (for NETStandard.Library) and a local Supabase stack with this
# repository's migrations applied and Storage running (`supabase start`), given by:
#   FEED_E2E_SUPABASE_URL       its API URL, such as http://127.0.0.1:54321
#   FEED_E2E_ANON_KEY           its anon key
#   FEED_E2E_SERVICE_ROLE_KEY   its service-role key
# It starts the site with `next dev` on FEED_E2E_PORT (default 3197) with stand-in settings for everything else, and
# writes its customers, packages and tokens to that local database. It refuses any Supabase URL that is not local.
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
v_first="1.$n.0" v_patch="1.$n.1" v_next="1.$((n + 1)).0"
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
    CRON_SECRET=e2e GITHUB_ORG=tenantry-e2e GITHUB_TEAM=e2e \
    GITHUB_APP_ID=1 GITHUB_APP_PRIVATE_KEY=e2e GITHUB_APP_INSTALLATION_ID=1 \
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
pack "$v_patch" "$(iso_before 10)" true
pack "$v_next" "$(iso_before 0)" false

# push VERSION KEY: dotnet nuget push to the feed. A rerun against the same database finds the packages published
# already, which --skip-duplicate accepts.
push() {
  dotnet nuget push "$work/nupkgs/$probe_id.$1.nupkg" --source tenantry --api-key "$2" \
    --configfile "$work/nuget.config" --skip-duplicate 2>&1
}
for version in "$v_first" "$v_patch" "$v_next"; do
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

# --- The customers ------------------------------------------------------------------------------------------------

# Each customer's token, in a file: macOS's bash 3.2 has no associative arrays.
token() { cat "$work/token-$1"; }
for name in active vested unvested unknown; do echo "tpf_e2e_${name}_$(openssl rand -hex 16)" >"$work/token-$name"; done

for name in active vested unvested; do
  customer="ctm_e2e_${name}_$run_id"
  access=lapsed
  if [[ $name == active ]]; then access=active; fi
  rest customers "{\"customer_id\":\"$customer\",\"email\":\"$customer@example.com\"}"
  rest active_subscriptions "{\"customer_id\":\"$customer\",\"access_status\":\"$access\"}"
  rest feed_tokens "{\"customer_id\":\"$customer\",\"name\":\"e2e\",\"token_hash\":\"$(sha256_hex "$(token "$name")")\",\"prefix\":\"tpf_e2e_\"}"
done
rest vested_entitlements "{\"customer_id\":\"ctm_e2e_vested_$run_id\",\"kind\":\"qualifying_run\",\"started_at\":\"2027-01-01T00:00:00Z\",\"vested_through\":\"$(iso_before 15)\",\"status\":\"confirmed\",\"confirmed_at\":\"$(iso_before 15)\"}"

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

# Vested: the security patch of the vested minor, and nothing newer.
dir="$(consumer vested '1.*')"
if output="$(restore "$dir")"; then
  check "a vested customer restores 1.* as the security patch $v_patch" '[[ "$(probe "$dir" resolved)" == $v_patch ]]' \
    "$output"
else
  fail "a vested customer restores 1.* as the security patch $v_patch" "$output"
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

echo
echo "$passes passed, $failures failed"
[[ $failures -eq 0 ]]
