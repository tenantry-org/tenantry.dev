/**
 * What the site says about the newest release it publishes (newest-release.json), read from that release so that no
 * page needs editing when a release changes it: the .NET versions Tenantry Core's packages target (from the nuspec
 * NuGet serves), the number of samples in Core's repository and in tenantry-pro-docs at the release tags, and the
 * setup snippets of Pro's installation guide (install-snippets.mjs), which the Pro access page shows. The
 * docs-versions workflow writes it with docs-versions.json (docs-versions-update.mjs).
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { installSnippets } from './install-snippets.mjs';

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
 * What the site says about a release of the newest line, from what was read of it: its samples/ folders, and Core's
 * nuspec or Pro's installation guide (null when the tag has none). Throws, with the reason, when the release does not
 * give it; reading is the caller's, so a read that fails is never taken for a release without the facts.
 *
 * @param {'core' | 'pro'} group
 * @param {string[]} sampleFolders
 * @param {string | null} text
 */
export function releaseFacts(group, sampleFolders, text) {
  const samples = sampleCount(group, sampleFolders);
  if (group === 'core') return { dotnet: dotnetVersions(text ?? ''), samples };
  if (text === null) throw new Error('it has no docs/installation.md');
  return { samples, proInstallation: installSnippets(text) };
}

/** newest-release.json, or null before it is first written. */
export function readNewestRelease() {
  return existsSync(NEWEST_RELEASE_PATH) ? JSON.parse(readFileSync(NEWEST_RELEASE_PATH, 'utf8')) : null;
}

export function writeNewestRelease(facts) {
  writeFileSync(NEWEST_RELEASE_PATH, JSON.stringify(facts, null, 2) + '\n');
}
