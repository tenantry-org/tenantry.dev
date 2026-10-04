#!/usr/bin/env node
/**
 * Keeps docs-versions.json and newest-release.json in step with the releases: reads the release tags of Core's
 * repository and of the public tenantry-pro-docs repository (tagged by each Pro release's publish-docs job, after its
 * packages are published) and writes the versions they give (resolveVersions in docs-versions.mjs), and what the site
 * says about the newest of them (newest-release.mjs). A Core tag counts only once NuGet lists its version: Core is
 * tagged before its release runs, which can wait for approval, fail or be refused, and one taken back is unlisted. A
 * release whose docs the site cannot publish (docsProblem in docs-sources.mjs), or, in the newest line, whose facts it
 * cannot read (releaseFacts), is left out with a warning, and its line keeps the release before it. The
 * docs-versions workflow runs it on a schedule and commits any change, which redeploys the site; nobody edits either
 * file by hand.
 *
 *   pnpm docs:update   write what the releases give
 *   pnpm docs:check    fail unless both files match the releases
 */
import { execFileSync } from 'child_process';
import { isDeepStrictEqual } from 'util';
import {
  docsProblem,
  fetchJson,
  fetchText,
  fileAt,
  foldersAt,
  hasTag,
  partialClone,
  REPOSITORIES,
} from './docs-sources.mjs';
import {
  FIRST_SOLD_RELEASE,
  GROUPS,
  lineOf,
  listedVersions,
  publishedTags,
  readVersions,
  resolvePublishable,
  writeVersions,
} from './docs-versions.mjs';
import { readNewestRelease, releaseFacts, writeNewestRelease } from './newest-release.mjs';

function tags(group) {
  const options = { encoding: 'utf8' };
  const refs = execFileSync('git', ['ls-remote', '--tags', '--refs', REPOSITORIES[group]], options); // NOSONAR: git from the developer's or CI's PATH
  return refs
    .split('\n')
    .map((line) => line.split('\trefs/tags/')[1])
    .filter(Boolean);
}

// Tenantry.Core's registration index, which marks unlisted versions, and its package folder, which serves each nuspec.
const REGISTRATION = 'https://api.nuget.org/v3/registration5-gz-semver2/tenantry.core/index.json';
const PACKAGE = 'https://api.nuget.org/v3-flatcontainer/tenantry.core';

// The group's tags whose release is published: for Core, those NuGet lists (a Core tag is pushed before its release
// runs, and a release taken back is unlisted). Throws when the list cannot be read, so nothing unconfirmed is published.
async function releasedTags(group) {
  if (group !== 'core') return tags(group);
  try {
    return publishedTags(tags(group), await listedVersions(await fetchJson(REGISTRATION), fetchJson));
  } catch (error) {
    throw new Error(`docs-versions: ${REGISTRATION}: ${error.message}`);
  }
}

const command = process.argv[2];
if (!['check', 'update'].includes(command)) {
  console.error('usage: docs-versions-update.mjs update | check');
  process.exit(1);
}

const released = Object.fromEntries(await Promise.all(GROUPS.map(async (group) => [group, await releasedTags(group)])));

// Each group's releases, read from a partial clone. One that cannot be read stops the run: leaving it out would
// publish an older release's docs.
const clones = Object.fromEntries(
  GROUPS.map((group) => [
    group,
    partialClone(
      group,
      released[group].filter((tag) => lineOf(tag) && !tag.includes('-')),
    ),
  ]),
);

// The checks of a release (docsProblem), and for one of the newest line what the site says about it (releaseFacts).
// A reason is returned for a release that does not give them; a read that fails throws, and the run stops.
const facts = {};
async function problem(group, tag, newest) {
  if (!clones[group] || !hasTag(clones[group], tag)) {
    throw new Error(`docs-versions: ${tag} of ${REPOSITORIES[group]} cannot be read.`);
  }
  const reason = docsProblem(clones[group], group, tag);
  if (reason || !newest) return reason;
  const folders = foldersAt(clones[group], tag, 'samples');
  const text =
    group === 'core'
      ? await fetchText(`${PACKAGE}/${tag.slice(1)}/tenantry.core.nuspec`)
      : fileAt(clones.pro, tag, 'docs/installation.md');
  try {
    facts[group] = releaseFacts(group, folders, text);
    return null;
  } catch (error) {
    return `${tag}: ${error.message.replace(/\.$/, '')}`;
  }
}

const expected = await resolvePublishable(released, problem, ({ group, tag, reason }) =>
  console.warn(`::warning::docs-versions: leaving out ${group} ${tag}: ${reason}.`),
);

if (expected.length === 0) {
  console.error(
    FIRST_SOLD_RELEASE === null
      ? 'docs-versions: no release line has both a Core and a Pro release the site can publish.'
      : `docs-versions: no release line from ${lineOf(FIRST_SOLD_RELEASE)} on (FIRST_SOLD_RELEASE is ${FIRST_SOLD_RELEASE}) ` +
          'has both a Core and a Pro release the site can publish yet.',
  );
  process.exit(1);
}

const newest = expected[0];
const expectedNewest = {
  dotnet: facts.core.dotnet,
  samples: { core: facts.core.samples, pro: facts.pro.samples },
  proInstallation: facts.pro.proInstallation,
};

const current = { versions: readVersions(), newest: readNewestRelease() };
const describe = (versions) =>
  versions.map((entry) => `${entry.version} (core ${entry.core}, pro ${entry.pro})`).join(', ');

if (command === 'check') {
  if (!isDeepStrictEqual(current.versions, expected)) {
    console.error(
      `docs-versions: docs-versions.json lists ${describe(current.versions)}; the releases give ${describe(expected)}.`,
    );
    process.exit(1);
  }
  if (!isDeepStrictEqual(current.newest, expectedNewest)) {
    console.error(
      `docs-versions: newest-release.json differs from what core ${newest.core} and pro ${newest.pro} give.`,
    );
    process.exit(1);
  }
  console.log(`docs-versions: ${describe(current.versions)}`);
} else {
  if (isDeepStrictEqual(current.versions, expected)) {
    console.log(`docs-versions: up to date: ${describe(current.versions)}`);
  } else {
    writeVersions(expected);
    console.log(`docs-versions: now ${describe(expected)} (was ${describe(current.versions)})`);
  }
  if (!isDeepStrictEqual(current.newest, expectedNewest)) {
    writeNewestRelease(expectedNewest);
    console.log(`docs-versions: newest-release.json now from core ${newest.core} and pro ${newest.pro}.`);
  }
}
