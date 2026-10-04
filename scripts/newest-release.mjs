/**
 * What the site says about the newest release it publishes (newest-release.json), read from that release so that no
 * page needs editing when a release changes it: the .NET versions Tenantry Core's packages target (from the nuspec
 * NuGet serves), the number of samples in Core's repository and in tenantry-pro-docs at the release tags, and the
 * setup snippets of Pro's installation guide (docs/installation.md), which the Pro access page shows. The
 * docs-versions workflow writes it with docs-versions.json (docs-versions-update.mjs).
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

function codeBlocks(markdown, language) {
  return [...markdown.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))].map((match) => match[1]);
}

/**
 * The setup snippets of Pro's installation guide, as the Pro access page shows them: the nuget.config, setting the
 * feed credentials on macOS or Linux (without its comment line), setting the licence key with user secrets, and the
 * GitHub Actions job. Throws when the guide has no such block, so the page never shows a part of it.
 */
export function installSnippets(guide) {
  const find = (language, text) => {
    const block = codeBlocks(guide, language).find((code) => code.includes(text));
    if (block === undefined) throw new Error(`the installation guide has no \`\`\`${language} block with "${text}".`);
    return block;
  };
  return {
    nugetConfig: find('xml', '<packageSources>'),
    feedCredentials: find('bash', 'export ')
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .join('\n'),
    licenceUserSecret: find('bash', 'dotnet user-secrets set').trimEnd(),
    ciWorkflow: find('yaml', 'runs-on:').trimEnd(),
  };
}

/** newest-release.json, or null before it is first written. */
export function readNewestRelease() {
  return existsSync(NEWEST_RELEASE_PATH) ? JSON.parse(readFileSync(NEWEST_RELEASE_PATH, 'utf8')) : null;
}

export function writeNewestRelease(facts) {
  writeFileSync(NEWEST_RELEASE_PATH, JSON.stringify(facts, null, 2) + '\n');
}
