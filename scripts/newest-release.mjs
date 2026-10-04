/**
 * What the site says about the newest release it publishes (newest-release.json), read from that release so that no
 * page needs editing when a release changes it: the .NET versions Tenantry Core's packages target (from the nuspec
 * NuGet serves), and the number of samples in Core's repository and in tenantry-pro-docs at the release tags. The
 * docs-versions workflow writes it with docs-versions.json (docs-versions-update.mjs). The install instructions are
 * not taken from a release: the site serves the package feed and writes them itself (src/lib/install-snippets.ts).
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export const NEWEST_RELEASE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'newest-release.json');

/** The .NET major versions a nuspec's dependency groups target, oldest first: `net8.0` → `8`. */
export function dotnetVersions(nuspec) {
  const majors = [...nuspec.matchAll(/targetFramework="net(\d+)\.0"/gi)].map((match) => match[1]);
  if (majors.length === 0) throw new Error('the nuspec names no .NET target framework.');
  return [...new Set(majors)].sort((a, b) => Number(a) - Number(b));
}

/** A sample's folder in each repository's samples/ (Tenantry.Samples.Quickstart, Tenantry.Pro.Samples.AuditLogging). */
export const SAMPLE_PREFIX = { core: 'Tenantry.Samples.', pro: 'Tenantry.Pro.Samples.' };

/** The number of samples among a group's samples/ folders. Throws when there is none, so the site never says 0. */
export function sampleCount(group, folders) {
  const count = folders.filter((folder) => folder.startsWith(SAMPLE_PREFIX[group])).length;
  if (count === 0) throw new Error(`samples/ has no ${SAMPLE_PREFIX[group]}* folder.`);
  return count;
}

/**
 * What the site says about a release of the newest line, from what was read of it: its samples/ folders, and for Core
 * its nuspec. Throws, with the reason, when the release does not give it; reading is the caller's, so a read that
 * fails is never taken for a release without the facts.
 *
 * @param {'core' | 'pro'} group
 * @param {string[]} sampleFolders
 * @param {string | null} [nuspec]
 */
export function releaseFacts(group, sampleFolders, nuspec = null) {
  const samples = sampleCount(group, sampleFolders);
  return group === 'core' ? { dotnet: dotnetVersions(nuspec ?? ''), samples } : { samples };
}

/** newest-release.json, or null before it is first written. */
export function readNewestRelease() {
  return existsSync(NEWEST_RELEASE_PATH) ? JSON.parse(readFileSync(NEWEST_RELEASE_PATH, 'utf8')) : null;
}

export function writeNewestRelease(facts) {
  writeFileSync(NEWEST_RELEASE_PATH, JSON.stringify(facts, null, 2) + '\n');
}
