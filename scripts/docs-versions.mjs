/**
 * The docs versions the site publishes (docs-versions.json), newest first. Each is a minor version (`0.7`, `1.0`,
 * `1.2`) with the Core and Pro release tags its docs come from: Core's repository and the public tenantry-pro-docs
 * repository, which each Pro release publishes to and tags. The newest is served at /docs, each older one at
 * /docs/v<version>.
 *
 * Each minor has its own docs, after 1.0 as before: a customer whose rights to new releases end at a minor still
 * needs the docs of the release they can restore. Patches keep the API, so only the newest patch's docs are needed.
 * Core and Pro release patches separately, so a minor's Core and Pro tags can differ.
 *
 * The list is derived from the release tags (resolveVersions), not written by hand: a minor is published once both
 * Core and Pro have a stable release in it, with the newest patch of each. The docs-versions workflow updates the
 * file when a release changes it.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export const GROUPS = ['core', 'pro'];
export const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(?:0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;
// A release without a pre-release suffix: the only kind whose docs the site publishes.
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const CONFIG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs-versions.json');

/**
 * The first release that was on sale, such as `v0.6.1`, or null while Tenantry Pro is not on sale. The site shows
 * nothing older: no docs of an earlier minor, and no changelog entry of an earlier release. While it is null no
 * release has been sold, so the site shows only the newest minor and, in its changelog, only that minor's newest
 * release. Set it once, to the release that is current when checkout opens.
 *
 * @type {string | null}
 */
export const FIRST_SOLD_RELEASE = null;

/** The first release sold, checked: null, or a release tag without a pre-release suffix, such as `v0.6.1`. */
export function checkFirstSold(firstSold) {
  if (firstSold === null || STABLE_TAG.test(firstSold ?? '')) return firstSold;
  throw new Error(
    `FIRST_SOLD_RELEASE is ${JSON.stringify(firstSold)}: set it to null, or to a release tag such as v0.6.1, ` +
      'with its v and without a pre-release suffix.',
  );
}

/**
 * The oldest release a docs version's changelog shows, given the release its docs are of (`tag`): the first release
 * sold, or the docs' own release when that is older or none has been sold. A minor whose product released only
 * before the first sale still shows the release its docs describe.
 */
export function oldestReleaseShown(tag, firstSold = FIRST_SOLD_RELEASE) {
  checkFirstSold(firstSold);
  return firstSold !== null && compareReleases(firstSold, tag) < 0 ? firstSold : tag;
}

/** The minor version a tag belongs to: v0.4.1 → 0.4, v1.12.3 → 1.12. */
export function minorOf(tag) {
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
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')) {
      problems.push(`"${version}" is not a minor version (MAJOR.MINOR).`);
      continue;
    }
    if (seen.has(version)) problems.push(`${version} is listed twice.`);
    seen.add(version);
    if (previous && compareMinors(version, previous) >= 0) problems.push(`${version} is out of order (newest first).`);
    previous = version;

    for (const group of GROUPS) {
      const tag = entry[group];
      if (!tag) problems.push(`${version} has no ${group} tag.`);
      else if (!STABLE_TAG.test(tag)) problems.push(`${version}'s ${group} tag ${tag} is not a release tag (vX.Y.Z).`);
      else if (minorOf(tag) !== version) problems.push(`${version}'s ${group} tag ${tag} is not a ${version} release.`);
    }
  }
  return problems;
}

/** Two minor versions: 1.10 is after 1.9. */
export function compareMinors(a, b) {
  const [aMajor, aMinor] = a.split('.').map(Number);
  const [bMajor, bMinor] = b.split('.').map(Number);
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
 * The versions to publish, given each group's tags: every minor both groups released, the newest patch of each, from
 * the minor of the first release sold (`firstSold`) on. With none sold yet (null), only the newest minor.
 *
 * @param {Record<string, string[]>} tagsByGroup
 * @param {string | null} [firstSold]
 */
export function resolveVersions(tagsByGroup, firstSold = FIRST_SOLD_RELEASE) {
  checkFirstSold(firstSold);
  const newest = {};
  for (const group of GROUPS) {
    newest[group] = new Map();
    for (const tag of tagsByGroup[group] ?? []) {
      if (!STABLE_TAG.test(tag)) continue;
      const minor = minorOf(tag);
      const current = newest[group].get(minor);
      if (!current || compareReleases(tag, current) > 0) newest[group].set(minor, tag);
    }
  }

  const versions = [...newest.core.keys()]
    .filter((minor) => newest.pro.has(minor))
    .sort((a, b) => compareMinors(b, a))
    .map((minor) => ({ version: minor, core: newest.core.get(minor), pro: newest.pro.get(minor) }));

  return firstSold === null
    ? versions.slice(0, 1)
    : versions.filter((entry) => compareMinors(entry.version, minorOf(firstSold)) >= 0);
}

/**
 * resolveVersions, leaving out each release whose docs cannot be published: `problem(group, tag, newest)` gives the
 * reason, or null; `newest` is true for the releases of the newest minor, from which the site also takes what it says
 * about the newest release. The minor of a release left out keeps the release before it, or waits for the next one.
 * `onLeftOut` is called with each release left out and its reason.
 *
 * @param {Record<string, string[]>} tagsByGroup
 * @param {(group: string, tag: string, newest: boolean) => Promise<string | null> | string | null} problem
 * @param {(release: { group: string, tag: string, reason: string }) => void} [onLeftOut]
 * @param {string | null} [firstSold]
 */
export async function resolvePublishable(tagsByGroup, problem, onLeftOut = () => {}, firstSold = FIRST_SOLD_RELEASE) {
  const tags = { ...tagsByGroup };
  for (;;) {
    const versions = resolveVersions(tags, firstSold);
    let left = null;
    for (const [index, entry] of versions.entries()) {
      for (const group of GROUPS) {
        const reason = left ? null : await problem(group, entry[group], index === 0);
        if (reason) left = { group, tag: entry[group], reason };
      }
    }
    if (!left) return versions;
    onLeftOut(left);
    tags[left.group] = tags[left.group].filter((tag) => tag !== left.tag);
  }
}

/**
 * The versions NuGet lists for a package, from its registration index (the registration API, which marks a version
 * that was unlisted): `fetchJson` reads a URL. A page of the index that is not inlined is fetched.
 *
 * @param {{ items: { '@id': string, items?: { catalogEntry: { version: string, listed?: boolean } }[] }[] }} index
 * @param {(url: string) => Promise<any>} fetchJson
 */
export async function listedVersions(index, fetchJson) {
  if (!Array.isArray(index?.items)) throw new Error('the registration index has no items.');
  const versions = [];
  for (const page of index.items) {
    const leaves = page.items ?? (await fetchJson(page['@id'])).items ?? [];
    for (const { catalogEntry } of leaves) {
      if (catalogEntry.listed !== false) versions.push(catalogEntry.version.split('+')[0]);
    }
  }
  return versions;
}
