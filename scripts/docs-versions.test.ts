import { describe, expect, it } from 'vitest';
import { lineOf, pinVersion, versionProblems } from './docs-versions.mjs';

const v04 = { version: '0.4', core: 'v0.4.0', pro: 'v0.4.0' };

describe('docs versions', () => {
  it('reads a tag’s release line', () => {
    expect(lineOf('v0.4.0')).toBe('0.4');
    expect(lineOf('v1.12.3-rc.1')).toBe('1.12');
    expect(lineOf('0.4.0')).toBeNull();
    expect(lineOf('v0.4')).toBeNull();
  });

  it('accepts complete versions, newest first', () => {
    expect(versionProblems([{ version: '0.5', core: 'v0.5.1', pro: 'v0.5.0' }, v04])).toEqual([]);
  });

  it('reports incomplete, misplaced and mismatched versions', () => {
    expect(versionProblems([])).toEqual(['docs-versions.json lists no versions.']);
    expect(versionProblems([{ version: '0.5', core: 'v0.5.0' }, v04])).toEqual(['0.5 has no pro tag.']);
    expect(versionProblems([v04, { version: '0.5', core: 'v0.5.0', pro: 'v0.5.0' }])).toEqual([
      '0.5 is out of order (newest first).',
    ]);
    expect(versionProblems([{ version: '0.4', core: 'v0.4.0', pro: 'v0.5.0' }])).toEqual([
      "0.4's pro tag v0.5.0 is not a 0.4 release.",
    ]);
    expect(versionProblems([v04, v04])).toEqual(['0.4 is listed twice.', '0.4 is out of order (newest first).']);
  });

  it('pins a patch release on its line and a new minor as a new version', () => {
    expect(pinVersion([v04], 'pro', 'v0.4.1')).toEqual([{ ...v04, pro: 'v0.4.1' }]);
    expect(pinVersion([v04], 'core', 'v0.5.0')).toEqual([{ version: '0.5', core: 'v0.5.0' }, v04]);
    expect(pinVersion([{ version: '0.5', core: 'v0.5.0' }, v04], 'pro', 'v0.5.0')).toEqual([
      { version: '0.5', core: 'v0.5.0', pro: 'v0.5.0' },
      v04,
    ]);
  });

  it('refuses unknown groups and tags that are not releases', () => {
    expect(() => pinVersion([v04], 'docs', 'v0.4.1')).toThrow('unknown docs group');
    expect(() => pinVersion([v04], 'core', 'master')).toThrow('not a release tag');
  });
});
