#!/usr/bin/env node
/**
 * Pins the docs the site publishes to release tags (docs-versions.json, read by sync-docs.mjs), so the site
 * describes the released packages rather than whatever a branch holds.
 *
 *   pnpm docs:pin <core|pro> <tag>   pin a release: a patch moves its line's tag, a new minor adds a version
 *   pnpm docs:check                  fail unless every version is complete and every tag exists
 *
 * Core's tags are its release tags (`v0.4.0`). Pro's docs repository is tagged with the Pro release tag by that
 * release's publish-docs job. Pin both as a step of each release, then commit the site.
 */
import { execFileSync } from 'child_process';
import { GROUPS, pinVersion, readVersions, versionProblems, writeVersions } from './docs-versions.mjs';

const REPOSITORIES = {
  core: 'https://github.com/tenantry-org/tenantry-core',
  pro: 'https://github.com/tenantry-org/tenantry-pro-docs',
};

function fail(message) {
  console.error(`docs-pins: ${message}`);
  process.exit(1);
}

function tagExists(group, tag) {
  const options = { encoding: 'utf8' };
  const refs = execFileSync('git', ['ls-remote', '--tags', REPOSITORIES[group], `refs/tags/${tag}`], options); // NOSONAR: git from the developer's or CI's PATH
  return refs.trim().length > 0;
}

function pin(group, tag) {
  let versions;
  try {
    versions = pinVersion(readVersions(), group, tag);
  } catch (error) {
    fail(error.message);
  }
  if (!tagExists(group, tag)) fail(`${group} has no tag ${tag} (has its release published the docs yet?).`);

  writeVersions(versions);
  const incomplete = versionProblems(versions);
  console.log(`docs-pins: ${group} pinned to ${tag}; commit docs-versions.json.`);
  if (incomplete.length > 0) console.log(`docs-pins: still to do: ${incomplete.join(' ')}`);
}

function check() {
  const versions = readVersions();
  const problems = versionProblems(versions);
  for (const entry of versions) {
    for (const group of GROUPS) {
      if (entry[group] && !tagExists(group, entry[group])) problems.push(`${group} has no tag ${entry[group]}.`);
    }
  }
  if (problems.length > 0) fail(problems.join(' '));
  for (const entry of versions) console.log(`docs-pins: ${entry.version}: core ${entry.core}, pro ${entry.pro}`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'pin') pin(...args);
else if (command === 'check') check();
else fail('usage: docs-pins.mjs pin <core|pro> <tag> | check');
