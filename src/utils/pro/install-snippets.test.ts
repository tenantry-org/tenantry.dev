import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileAt, partialClone } from '../../../scripts/docs-sources.mjs';
import { compareLines, readVersions } from '../../../scripts/docs-versions.mjs';
import { ciWorkflow, LICENCE_CONFIG_KEY, licenceUserSecret, nugetConfig, PRO_RELEASE_LINE } from './install-snippets';

// The newest docs the site publishes. Once they are the snippets' release line, the snippets are compared with
// that release's guide, as customers read it; before that, with a sibling tenantry-pro checkout when there is one.
const published = readVersions()[0];
const released = published.version === PRO_RELEASE_LINE;
const SIBLING_GUIDE = ['../tenantry-pro/docs/installation.md'].find((path) => existsSync(path));

function codeBlocks(markdown: string, language: string): string[] {
  return [...markdown.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))].map((match) => match[1]);
}

function expectGuideToMatch(guide: string) {
  expect(codeBlocks(guide, 'xml')).toContain(nugetConfig('tenantry-org'));
  expect(codeBlocks(guide, 'yaml').map((block) => block.trimEnd())).toContain(ciWorkflow);
  expect(guide).toContain(`configuration key \`${LICENCE_CONFIG_KEY}\``);
  expect(guide).toContain(licenceUserSecret);
}

describe('install snippets', () => {
  it('points the feed at the environment’s org', () => {
    expect(nugetConfig('tenantry-sandbox')).toContain(
      '<add key="tenantry-pro" value="https://nuget.pkg.github.com/tenantry-sandbox/index.json" />',
    );
  });

  it('describe the newest Pro release line, or the next one', () => {
    expect(
      compareLines(published.version, PRO_RELEASE_LINE),
      `Tenantry Pro ${published.version}'s docs are published, but the snippets describe ${PRO_RELEASE_LINE}: ` +
        `compare them with its installation guide, then set PRO_RELEASE_LINE`,
    ).toBeLessThanOrEqual(0);
  });

  // In CI, which has no clone yet, this clones the docs repository: hence the longer timeout.
  it.runIf(released)(
    `match the installation guide of Tenantry Pro ${published.pro}`,
    () => {
      const repository = partialClone('pro', [published.pro]);
      const guide = repository && fileAt(repository, published.pro, 'docs/installation.md');
      expect(guide, `docs/installation.md at ${published.pro} of tenantry-pro-docs`).toBeTruthy();

      expectGuideToMatch(guide as string);
    },
    60_000,
  );

  it.runIf(!released && SIBLING_GUIDE)(`match the unreleased ${PRO_RELEASE_LINE} installation guide`, () => {
    expectGuideToMatch(readFileSync(SIBLING_GUIDE as string, 'utf8'));
  });
});
