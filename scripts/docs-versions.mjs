/**
 * The docs versions the site publishes (docs-versions.json), newest first. Each is a release line with the Core and
 * Pro release tags its docs come from: Core's repository and the public tenantry-pro-docs repository, which each Pro
 * release publishes to and tags. The newest is served at /docs, each older one at /docs/v<version>.
 *
 * A release line is the releases that keep one API, so only its newest release's docs are needed: before 1.0 a minor
 * release can break the API, so each minor is a line (`0.4`, `0.5`); from 1.0 only a major release can, so each
 * major is one (`1`, `2`). Core and Pro release separately within a line, so its Core and Pro tags can differ.
 *
 * The list is derived from the release tags (resolveVersions), not written by hand: a line is published once both
 * Core and Pro have a stable release in it, with the newest release of each. The docs-versions workflow updates the
 * file when a release changes it.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export const GROUPS = ['core', 'pro'];
export const RELEASE_TAG = /^v(\d+)\.(\d+)\.\d+(-[0-9A-Za-z.-]+)?$/;
// A release without a pre-release suffix: the only kind whose docs the site publishes.
const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
export const CONFIG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs-versions.json');

/**
 * The first release that was on sale, such as `v0.6.1`, or null while Tenantry Pro is not on sale. The site shows
 * nothing older: no docs of an earlier release line, and no changelog entry of an earlier release. While it is null
 * no release has been sold, so the site shows only the newest release line and, in its changelog, only that line's
 * newest release. Set it once, to the release that is current when checkout opens.
 *
 * @type {string | null}
 */
export const FIRST_SOLD_RELEASE = null;

/** The release line a tag belongs to: v0.4.1 → 0.4, v1.2.3 → 1. */
export function lineOf(tag) {
  const match = RELEASE_TAG.exec(tag ?? '');
  if (!match) return null;
  return match[1] === '0' ? `0.${match[2]}` : match[1];
}

/** The problems with a versions list, as messages; empty when it is valid and complete. */
export function versionProblems(versions) {
  const problems = [];
  if (!Array.isArray(versions) || versions.length === 0) return ['docs-versions.json lists no versions.'];

  const seen = new Set();
  let previous = null;
  for (const entry of versions) {
    const { version } = entry;
    if (!/^(0\.\d+|[1-9]\d*)$/.test(version ?? '')) {
      problems.push(`"${version}" is not a release line (0.MINOR, or MAJOR from 1).`);
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
  const [aMajor, aMinor = 0] = a.split('.').map(Number);
  const [bMajor, bMinor = 0] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor;
}

/** Two stable tags by version: v0.4.10 is after v0.4.2. */
export function compareReleases(a, b) {
  const [, ...aParts] = STABLE_TAG.exec(a).map(Number);
  const [, ...bParts] = STABLE_TAG.exec(b).map(Number);
  return aParts[0] - bParts[0] || aParts[1] - bParts[1] || aParts[2] - bParts[2];
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

/**
 * The tags whose release is published: those whose version (the tag without its `v`) is among `publishedVersions`,
 * such as the versions NuGet lists for the package. A tag exists as soon as it is pushed, before its release passes
 * CI and approval, or when that release fails, so a tag alone does not mean its packages shipped.
 */
export function publishedTags(tags, publishedVersions) {
  const published = new Set(publishedVersions.map((version) => version.toLowerCase()));
  return tags.filter((tag) => tag.startsWith('v') && published.has(tag.slice(1).toLowerCase()));
}

/**
 * The versions to publish, given each group's tags: every line both groups released, the newest patch of each, from
 * the line of the first release sold (`firstSold`) on. With none sold yet (null), only the newest line.
 *
 * @param {Record<string, string[]>} tagsByGroup
 * @param {string | null} [firstSold]
 */
export function resolveVersions(tagsByGroup, firstSold = FIRST_SOLD_RELEASE) {
  const newest = {};
  for (const group of GROUPS) {
    newest[group] = new Map();
    for (const tag of tagsByGroup[group] ?? []) {
      if (!STABLE_TAG.test(tag)) continue;
      const line = lineOf(tag);
      const current = newest[group].get(line);
      if (!current || compareReleases(tag, current) > 0) newest[group].set(line, tag);
    }
  }

  const versions = [...newest.core.keys()]
    .filter((line) => newest.pro.has(line))
    .sort((a, b) => compareLines(b, a))
    .map((line) => ({ version: line, core: newest.core.get(line), pro: newest.pro.get(line) }));

  return firstSold === null
    ? versions.slice(0, 1)
    : versions.filter((entry) => compareLines(entry.version, lineOf(firstSold)) >= 0);
}
