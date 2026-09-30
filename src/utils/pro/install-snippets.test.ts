import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ciWorkflow, licenceRegistration, licenceUserSecret, nugetConfig } from './install-snippets';

// Tenantry.Pro's installation guide, from a sibling checkout when working locally (the synced docs are those of
// the latest release, which may predate a change made on both sides).
const GUIDE = ['../tenantry-pro/docs/installation.md'].find((path) => existsSync(path));

function codeBlocks(markdown: string, language: string): string[] {
  return [...markdown.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))].map((match) => match[1]);
}

describe('install snippets', () => {
  it('points the feed at the environment’s org', () => {
    expect(nugetConfig('tenantry-sandbox')).toContain(
      '<add key="tenantry-pro" value="https://nuget.pkg.github.com/tenantry-sandbox/index.json" />',
    );
  });

  it.skipIf(!GUIDE)('match the Pro installation guide', () => {
    const guide = readFileSync(GUIDE as string, 'utf8');

    expect(codeBlocks(guide, 'xml')).toContain(nugetConfig('tenantry-org'));
    expect(codeBlocks(guide, 'yaml').map((block) => block.trimEnd())).toContain(ciWorkflow);
    expect(codeBlocks(guide, 'csharp').map((block) => block.trimEnd())).toContain(licenceRegistration);
    expect(guide).toContain(licenceUserSecret);
  });
});
