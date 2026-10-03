#!/usr/bin/env node
/**
 * Keeps docs-versions.json in step with the releases: reads the release tags of Core's repository and of the public
 * tenantry-pro-docs repository (tagged by each Pro release's publish-docs job, after its packages are published) and
 * writes the versions they give (resolveVersions in docs-versions.mjs). A Core tag counts only once NuGet lists its
 * version: Core is tagged before its release runs, which can wait for approval, fail or be refused. The docs-versions
 * workflow runs it on a schedule and commits any change, which redeploys the site; nobody pins docs by hand.
 *
 *   pnpm docs:update   write the versions the releases give
 *   pnpm docs:check    fail unless docs-versions.json matches the releases
 */
import { execFileSync } from 'child_process';
import { isDeepStrictEqual } from 'util';
import { REPOSITORIES } from './docs-sources.mjs';
import { GROUPS, publishedTags, readVersions, resolveVersions, writeVersions } from './docs-versions.mjs';

function tags(group) {
  const options = { encoding: 'utf8' };
  const refs = execFileSync('git', ['ls-remote', '--tags', '--refs', REPOSITORIES[group]], options); // NOSONAR: git from the developer's or CI's PATH
  return refs
    .split('\n')
    .map((line) => line.split('\trefs/tags/')[1])
    .filter(Boolean);
}

// Where a group's published versions are listed, for a group whose tags come before its release.
const PUBLISHED = { core: 'https://api.nuget.org/v3-flatcontainer/tenantry.core/index.json' };

// The group's tags whose release is published. Throws when the list cannot be read, so nothing unconfirmed is published.
async function releasedTags(group) {
  if (!PUBLISHED[group]) return tags(group);
  const response = await fetch(PUBLISHED[group]);
  if (!response.ok) throw new Error(`docs-versions: ${PUBLISHED[group]} answered ${response.status}.`);
  const { versions } = await response.json();
  return publishedTags(tags(group), versions);
}

const expected = resolveVersions(
  Object.fromEntries(await Promise.all(GROUPS.map(async (group) => [group, await releasedTags(group)]))),
);
if (expected.length === 0) {
  console.error('docs-versions: no release line has both a Core and a Pro release.');
  process.exit(1);
}

const current = readVersions();
const describe = (versions) =>
  versions.map((entry) => `${entry.version} (core ${entry.core}, pro ${entry.pro})`).join(', ');
const command = process.argv[2];

if (command === 'check') {
  if (!isDeepStrictEqual(current, expected)) {
    console.error(
      `docs-versions: docs-versions.json lists ${describe(current)}; the releases give ${describe(expected)}.`,
    );
    process.exit(1);
  }
  console.log(`docs-versions: ${describe(current)}`);
} else if (command === 'update') {
  if (isDeepStrictEqual(current, expected)) {
    console.log(`docs-versions: up to date: ${describe(current)}`);
  } else {
    writeVersions(expected);
    console.log(`docs-versions: now ${describe(expected)} (was ${describe(current)})`);
  }
} else {
  console.error('usage: docs-versions-update.mjs update | check');
  process.exit(1);
}
