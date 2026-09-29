#!/usr/bin/env node
/**
 * The docs submodules (content/_src/{core,pro}) pin the docs the site publishes to release tags, so the
 * site describes the released packages rather than whatever a branch holds (sync-docs.mjs).
 *
 *   pnpm docs:pin <core|pro> <tag>   check out that release tag in the submodule and stage the new pin
 *   pnpm docs:check                  fail unless each submodule is checked out at a release tag
 *
 * Core's tags are its release tags (`v0.3.0-alpha.1`). Pro's docs repository is tagged with the Pro release
 * tag by that release's publish-docs job. Pin both as a step of each release, then commit the site.
 */
import { execFileSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUBMODULES = { core: 'content/_src/core', pro: 'content/_src/pro' };
const RELEASE_TAG = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd: resolve(siteRoot, cwd), encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(`docs-pins: ${message}`);
  process.exit(1);
}

function releaseTagsAt(path) {
  git(path, 'fetch', '--quiet', '--tags', 'origin');
  const tags = git(path, 'tag', '--points-at', 'HEAD');
  return tags ? tags.split('\n').filter((tag) => RELEASE_TAG.test(tag)) : [];
}

function pin(group, tag) {
  const path = SUBMODULES[group];
  if (!path) fail(`unknown docs group "${group}"; use one of ${Object.keys(SUBMODULES).join(', ')}.`);
  if (!RELEASE_TAG.test(tag ?? '')) fail(`"${tag ?? ''}" is not a release tag (vMAJOR.MINOR.PATCH[-prerelease]).`);

  git(path, 'fetch', '--quiet', '--tags', 'origin');
  try {
    git(path, 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}`);
  } catch {
    fail(`${group} has no tag ${tag} (has its release published the docs yet?).`);
  }

  git(path, 'checkout', '--quiet', '--detach', `refs/tags/${tag}`);
  git('.', 'add', path);
  console.log(`docs-pins: ${group} pinned to ${tag} (${git(path, 'rev-parse', '--short', 'HEAD')}); commit the site.`);
}

function check() {
  const unpinned = [];
  for (const [group, path] of Object.entries(SUBMODULES)) {
    const tags = releaseTagsAt(path);
    if (tags.length === 0) {
      unpinned.push(`${group} (${git(path, 'rev-parse', '--short', 'HEAD')})`);
    } else {
      console.log(`docs-pins: ${group} at ${tags.join(', ')}`);
    }
  }

  if (unpinned.length > 0) {
    fail(`not at a release tag: ${unpinned.join(', ')}. Pin with \`pnpm docs:pin <group> <tag>\`.`);
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === 'pin') pin(...args);
else if (command === 'check') check();
else fail('usage: docs-pins.mjs pin <core|pro> <tag> | check');
