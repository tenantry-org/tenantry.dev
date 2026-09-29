/**
 * The docs versions the site publishes (docs-versions.json), newest first. Each is a release line (`0.4`) with the
 * Core and Pro release tags its docs come from: Core's repository and the public tenantry-pro-docs repository, which
 * each Pro release publishes to and tags. The newest is served at /docs, each older one at /docs/v<version>.
 *
 * A patch release moves its line's tags (`pnpm docs:pin pro v0.4.1`); a new minor adds a line (the first tag pinned
 * for it), which is complete once both groups are pinned.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export const GROUPS = ['core', 'pro'];
export const RELEASE_TAG = /^v(\d+)\.(\d+)\.\d+(-[0-9A-Za-z.-]+)?$/;
export const CONFIG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs-versions.json');

/** The release line a tag belongs to: v0.4.1 → 0.4. */
export function lineOf(tag) {
  const match = RELEASE_TAG.exec(tag ?? '');
  return match ? `${match[1]}.${match[2]}` : null;
}

/** The problems with a versions list, as messages; empty when it is valid and complete. */
export function versionProblems(versions) {
  const problems = [];
  if (!Array.isArray(versions) || versions.length === 0) return ['docs-versions.json lists no versions.'];

  const seen = new Set();
  let previous = null;
  for (const entry of versions) {
    const { version } = entry;
    if (!/^\d+\.\d+$/.test(version ?? '')) {
      problems.push(`"${version}" is not a release line (MAJOR.MINOR).`);
      continue;
    }
    if (seen.has(version)) problems.push(`${version} is listed twice.`);
    seen.add(version);
    if (previous && compareLines(version, previous) >= 0) problems.push(`${version} is out of order (newest first).`);
    previous = version;

    for (const group of GROUPS) {
      const tag = entry[group];
      if (!tag) problems.push(`${version} has no ${group} tag.`);
      else if (lineOf(tag) !== version) problems.push(`${version}'s ${group} tag ${tag} is not a ${version} release.`);
    }
  }
  return problems;
}

export function compareLines(a, b) {
  const [aMajor, aMinor] = a.split('.').map(Number);
  const [bMajor, bMinor] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor;
}

/** The site path each version is served under: the newest at /docs, the others at /docs/v<version>. */
export function basePath(versions, version) {
  return versions[0].version === version ? '/docs' : `/docs/v${version}`;
}

export function readVersions() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')).versions;
}

export function writeVersions(versions) {
  writeFileSync(CONFIG_PATH, JSON.stringify({ versions }, null, 2) + '\n');
}

/** The list with `tag` pinned for `group`: its line's entry updated, or a new line added in order. */
export function pinVersion(versions, group, tag) {
  if (!GROUPS.includes(group)) throw new Error(`unknown docs group "${group}"; use one of ${GROUPS.join(', ')}.`);
  const version = lineOf(tag);
  if (!version) throw new Error(`"${tag ?? ''}" is not a release tag (vMAJOR.MINOR.PATCH[-prerelease]).`);

  const existing = versions.find((entry) => entry.version === version);
  if (existing) return versions.map((entry) => (entry === existing ? { ...entry, [group]: tag } : entry));
  return [...versions, { version, [group]: tag }].sort((a, b) => compareLines(b.version, a.version));
}
