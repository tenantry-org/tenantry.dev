import { describe, expect, it } from 'vitest';
import { lineOf, resolveVersions, versionProblems } from './docs-versions.mjs';

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

  it('publishes each line both groups released, with the newest stable patch of each', () => {
    expect(
      resolveVersions({
        core: ['v0.3.0-alpha.1', 'v0.4.0', 'v0.4.2', 'v0.4.10', 'v0.5.0', 'v0.6.0-rc.1', 'not-a-release'],
        pro: ['v0.4.0', 'v0.4.1', 'v0.5.0', 'v0.5.1', 'v0.6.0-rc.1'],
      }),
    ).toEqual([
      { version: '0.5', core: 'v0.5.0', pro: 'v0.5.1' },
      { version: '0.4', core: 'v0.4.10', pro: 'v0.4.1' },
    ]);
  });

  it('waits for both groups before publishing a new line', () => {
    expect(resolveVersions({ core: ['v0.4.0', 'v0.5.0'], pro: ['v0.4.0'] })).toEqual([v04]);
    expect(resolveVersions({ core: [], pro: ['v0.4.0'] })).toEqual([]);
  });

  it('orders lines numerically, newest first', () => {
    expect(
      resolveVersions({ core: ['v0.9.0', 'v0.10.0', 'v1.0.0'], pro: ['v0.9.0', 'v0.10.0', 'v1.0.0'] }).map(
        (v) => v.version,
      ),
    ).toEqual(['1.0', '0.10', '0.9']);
  });
});
