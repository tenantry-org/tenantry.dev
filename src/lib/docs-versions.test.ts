import { describe, expect, it, vi } from 'vitest';
import { docsVersionOf, docsVersionOfPath, docsVersions, slugsInVersion, slugsWithinVersion } from './docs-versions';

// vi.mock is hoisted above the import: two versions, the newest first.
vi.mock('../../docs-versions.json', () => ({
  default: {
    versions: [
      { version: '0.5', core: 'v0.5.0', pro: 'v0.5.1' },
      { version: '0.4', core: 'v0.4.0', pro: 'v0.4.0' },
    ],
  },
}));

describe('docs versions', () => {
  it('serves the newest at /docs and older ones under their version', () => {
    expect(docsVersions.map((entry) => [entry.version, entry.latest, entry.base])).toEqual([
      ['0.5', true, '/docs'],
      ['0.4', false, '/docs/v0.4'],
    ]);
  });

  it('finds the version of a page', () => {
    expect(docsVersionOf(['core', 'installation']).version).toBe('0.5');
    expect(docsVersionOf([]).version).toBe('0.5');
    expect(docsVersionOf(['v0.4', 'core']).version).toBe('0.4');
    // A folder that is not a listed older version belongs to the newest.
    expect(docsVersionOf(['v0.3', 'core']).version).toBe('0.5');
    // The newest has no prefix of its own.
    expect(docsVersionOf(['v0.5', 'core']).version).toBe('0.5');
  });

  it('finds the version of a path', () => {
    expect(docsVersionOfPath('/docs').version).toBe('0.5');
    expect(docsVersionOfPath('/docs/pro/installation').version).toBe('0.5');
    expect(docsVersionOfPath('/docs/v0.4').version).toBe('0.4');
    expect(docsVersionOfPath('/docs/v0.4/pro/installation').version).toBe('0.4');
    expect(docsVersionOfPath('/dashboard/pro').version).toBe('0.5');
    expect(docsVersionOfPath('/docsv0.4').version).toBe('0.5');
  });

  it('maps a page to the same page in another version', () => {
    const [latest, older] = docsVersions;
    expect(slugsWithinVersion(['v0.4', 'pro', 'licensing'])).toEqual(['pro', 'licensing']);
    expect(slugsInVersion(['v0.4', 'pro', 'licensing'], latest)).toEqual(['pro', 'licensing']);
    expect(slugsInVersion(['pro', 'licensing'], older)).toEqual(['v0.4', 'pro', 'licensing']);
    expect(slugsInVersion([], older)).toEqual(['v0.4']);
  });
});
