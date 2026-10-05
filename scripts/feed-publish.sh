#!/usr/bin/env bash
# Publishes Tenantry Pro's packages to a deployment's package feed, or lists what it holds, with the publish key.
#
#   FEED_PUBLISH_KEY=... scripts/feed-publish.sh push <site> <folder>   push every .nupkg in the folder
#   FEED_PUBLISH_KEY=... scripts/feed-publish.sh list <site>            list the releases and packages the feed holds
#
# <site> is the deployment's origin, such as https://sandbox.tenantry.dev. The key is read from FEED_PUBLISH_KEY and
# never put on a command line. README.md (Package feed: publishing) gives the endpoint's contract.
#
# push sends the packages oldest version first, in SemVer's order (a release candidate X.Y.Z-rc.N before X.Y.Z), so a
# release's X.Y.0 is recorded before its patches, and a candidate before its release. For each
# package it prints the release date and security flag its tenantry-release.json gives, and refuses a folder where two
# packages of one version disagree about them. Re-running it is safe: a package already published with the same content
# is reported as such (409) and skipped. Any other refusal stops the run, naming the package and the feed's reason.
#
# Needs bash, curl, unzip and jq.
set -euo pipefail

usage() {
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

command="${1:-}"
site="${2:-}"
[[ "$command" == push && $# -eq 3 ]] || [[ "$command" == list && $# -eq 2 ]] || usage
: "${FEED_PUBLISH_KEY:?set FEED_PUBLISH_KEY to the publish key (the deployment holds its SHA-256 as FEED_PUBLISH_KEY_SHA256)}"

case "$site" in
  https://*) ;;
  http://127.0.0.1:* | http://localhost:*) ;;
  *)
    echo "The site must be an https:// origin (or a local http://127.0.0.1:… one), such as https://sandbox.tenantry.dev" >&2
    exit 2
    ;;
esac
site="${site%/}"
endpoint="$site/feed/v3/package"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# The key goes to curl in a header file only this user can read, so it never shows in the process list.
(
  umask 077
  printf 'X-NuGet-ApiKey: %s\n' "$FEED_PUBLISH_KEY" >"$work/headers"
)

if [[ "$command" == list ]]; then
  status="$(curl -sS -o "$work/body" -w '%{http_code}' -H "@$work/headers" "$endpoint")"
  if [[ "$status" != 200 ]]; then
    echo "The feed answered $status: $(cat "$work/body")" >&2
    exit 1
  fi
  jq -r '
    if (.releases | length) == 0 then "The feed holds no releases." else
      (.releases[] |
        "\(.version)  published \(.publishedAt)  entitlement date \(.entitlementAt)" +
        (if .security then "  security patch" else "" end),
        (.packages[] | "    \(.id)  \(.size) bytes  sha512 \(.sha512)"))
    end' "$work/body"
  exit 0
fi

folder="$3"
shopt -s nullglob
packages=("$folder"/*.nupkg)
if [[ ${#packages[@]} -eq 0 ]]; then
  echo "$folder has no .nupkg files." >&2
  exit 1
fi

# One line per package, oldest version first: version, id, release manifest (or "none"), file. Versions are
# major.minor.patch or major.minor.patch-rc.N, as the feed accepts them (src/server/feed/version.ts).
for file in "${packages[@]}"; do
  nuspec="$(unzip -Z1 "$file" | grep -iE '^[^/]+\.nuspec$' | head -1 || true)"
  if [[ -z "$nuspec" ]]; then
    echo "$file has no nuspec at its root." >&2
    exit 1
  fi
  xml="$(unzip -p "$file" "$nuspec")"
  id="$(sed -n 's:.*<id>\([^<]*\)</id>.*:\1:p' <<<"$xml" | head -1)"
  version="$(sed -n 's:.*<version>\([^<]*\)</version>.*:\1:p' <<<"$xml" | head -1)"
  if ! [[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.([1-9][0-9]*))?$ ]]; then
    echo "$file: version $version is not major.minor.patch or major.minor.patch-rc.N." >&2
    exit 1
  fi
  # A release's candidate number sorts after any candidate's.
  key=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[5]:-2147483648}")
  manifest=none
  if unzip -Z1 "$file" | grep -qx 'tenantry-release.json'; then
    manifest="$(unzip -p "$file" tenantry-release.json | jq -c '{releasedAt, security}')"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "${key[@]}" "$version" "$id" "$manifest" "$file"
done | sort -t$'\t' -k1,1n -k2,2n -k3,3n -k4,4n | cut -f5- >"$work/plan"

# Every package of a version must say the same about its release.
disagreeing="$(cut -f1,3 "$work/plan" | sort -u | cut -f1 | uniq -d)"
if [[ -n "$disagreeing" ]]; then
  echo "Packages of these versions disagree about their release date or security flag (tenantry-release.json):" >&2
  echo "$disagreeing" >&2
  exit 1
fi

published=0
skipped=0
while IFS=$'\t' read -r version id manifest file; do
  if [[ "$manifest" == none ]]; then
    about='no tenantry-release.json: dated when its release is first published'
  else
    about="released $(jq -r '.releasedAt // "when first published"' <<<"$manifest"), security $(jq -r '.security // false' <<<"$manifest")"
  fi
  status="$(curl -sS -o "$work/body" -w '%{http_code}' -X PUT -H "@$work/headers" \
    -F "package=@$file;type=application/octet-stream" "$endpoint")"
  case "$status" in
    201)
      published=$((published + 1))
      echo "published  $id $version ($about)"
      ;;
    409)
      skipped=$((skipped + 1))
      echo "unchanged  $id $version: already published with the same content"
      ;;
    *)
      echo "refused    $id $version ($about): the feed answered $status: $(cat "$work/body")" >&2
      echo "$published published, $skipped already published; stopped at $id $version." >&2
      exit 1
      ;;
  esac
done <"$work/plan"

echo "$published published, $skipped already published."
