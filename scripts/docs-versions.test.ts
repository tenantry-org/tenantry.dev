import { describe, expect, it } from 'vitest';
import {
  checkFirstSold,
  lineOf,
  oldestReleaseShown,
  publishedTags,
  resolvePublishable,
  resolveVersions,
  versionProblems,
} from './docs-versions.mjs';

const v04 = { version: '0.4', core: 'v0.4.0', pro: 'v0.4.0' };
// A first sale older than every release: no line is hidden.
const ALL = 'v0.1.0';

describe('docs versions', () => {
  it('reads a tag’s release line', () => {
    expect(lineOf('v0.4.0')).toBe('0.4');
    expect(lineOf('v0.12.3-rc.1')).toBe('0.12');
    expect(lineOf('v1.12.3')).toBe('1');
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
    expect(versionProblems([{ version: '0.4', core: 'v0.4.0', pro: 'v0.4.0-rc.1' }])).toEqual([
      "0.4's pro tag v0.4.0-rc.1 is not a release tag (vX.Y.Z).",
    ]);
    expect(versionProblems([v04, v04])).toEqual(['0.4 is listed twice.', '0.4 is out of order (newest first).']);
    expect(versionProblems([{ version: '1.0', core: 'v1.0.0', pro: 'v1.0.0' }])).toEqual([
      '"1.0" is not a release line (0.MINOR, or MAJOR from 1).',
    ]);
  });

  it('counts a tag only once its version is published, so a pushed tag whose release is pending or failed is not', () => {
    const tags = ['v0.4.0', 'v0.5.0', 'v0.5.1', 'v0.6.0-RC.1', 'not-a-release'];

    expect(publishedTags(tags, ['0.4.0', '0.5.0', '0.6.0-rc.1'])).toEqual(['v0.4.0', 'v0.5.0', 'v0.6.0-RC.1']);
    expect(resolveVersions({ core: publishedTags(tags, ['0.4.0', '0.5.0']), pro: ['v0.5.0', 'v0.5.1'] })).toEqual([
      { version: '0.5', core: 'v0.5.0', pro: 'v0.5.1' },
    ]);
  });

  it('publishes each line both groups released, with the newest stable patch of each', () => {
    expect(
      resolveVersions(
        {
          core: ['v0.3.0-alpha.1', 'v0.4.0', 'v0.4.2', 'v0.4.10', 'v0.5.0', 'v0.6.0-rc.1', 'not-a-release'],
          pro: ['v0.4.0', 'v0.4.1', 'v0.5.0', 'v0.5.1', 'v0.6.0-rc.1'],
        },
        ALL,
      ),
    ).toEqual([
      { version: '0.5', core: 'v0.5.0', pro: 'v0.5.1' },
      { version: '0.4', core: 'v0.4.10', pro: 'v0.4.1' },
    ]);
  });

  it('waits for both groups before publishing a new line', () => {
    expect(resolveVersions({ core: ['v0.4.0', 'v0.5.0'], pro: ['v0.4.0'] }, ALL)).toEqual([v04]);
    expect(resolveVersions({ core: [], pro: ['v0.4.0'] }, ALL)).toEqual([]);
  });

  it('orders lines numerically, newest first', () => {
    expect(
      resolveVersions({ core: ['v0.9.0', 'v0.10.0', 'v1.0.0'], pro: ['v0.9.0', 'v0.10.0', 'v1.0.0'] }, ALL).map(
        (v) => v.version,
      ),
    ).toEqual(['1', '0.10', '0.9']);
  });

  it('publishes one line per major from 1.0, with its newest release', () => {
    const versions = resolveVersions(
      {
        core: ['v0.5.6', 'v1.0.1', 'v1.2.0', 'v1.10.0', 'v2.0.0-rc.1'],
        pro: ['v0.5.0', 'v1.0.0', 'v1.1.3', 'v1.1.12'],
      },
      ALL,
    );
    expect(versions).toEqual([
      { version: '1', core: 'v1.10.0', pro: 'v1.1.12' },
      { version: '0.5', core: 'v0.5.6', pro: 'v0.5.0' },
    ]);
    expect(versionProblems(versions)).toEqual([]);
  });

  it('publishes only the newest line while no release has been sold', () => {
    const tags = { core: ['v0.4.0', 'v0.5.0', 'v0.6.0', 'v0.6.1'], pro: ['v0.4.0', 'v0.5.0', 'v0.6.1'] };
    expect(resolveVersions(tags, null)).toEqual([{ version: '0.6', core: 'v0.6.1', pro: 'v0.6.1' }]);
    expect(resolveVersions({ core: [], pro: [] }, null)).toEqual([]);
  });

  it('publishes the line of the first release sold and every later one, and none before it', () => {
    const tags = {
      core: ['v0.5.0', 'v0.6.0', 'v0.6.1', 'v0.7.0', 'v1.0.0'],
      pro: ['v0.5.0', 'v0.6.1', 'v0.7.2', 'v1.0.0'],
    };
    expect(resolveVersions(tags, 'v0.6.1').map((v) => v.version)).toEqual(['1', '0.7', '0.6']);
  });

  it('accepts no first sale, or a release tag, and refuses anything else with the reason', () => {
    expect(checkFirstSold(null)).toBeNull();
    expect(checkFirstSold('v0.6.1')).toBe('v0.6.1');
    for (const value of ['0.6.1', 'v0.6.1-rc.1', 'v0.6', '']) {
      expect(() => checkFirstSold(value)).toThrow(/FIRST_SOLD_RELEASE is .*: set it to null, or to a release tag/);
      expect(() => resolveVersions({ core: ['v0.6.1'], pro: ['v0.6.1'] }, value)).toThrow(/FIRST_SOLD_RELEASE/);
      expect(() => oldestReleaseShown('v0.6.1', value)).toThrow(/FIRST_SOLD_RELEASE/);
    }
  });

  it('publishes nothing while no line at or after the first release sold has both releases', () => {
    expect(resolveVersions({ core: ['v0.6.0', 'v0.7.0'], pro: ['v0.6.0'] }, 'v0.7.0')).toEqual([]);
  });

  it('starts a changelog at the first release sold, or at the release its docs are of when that is older', () => {
    expect(oldestReleaseShown('v0.6.2', null)).toBe('v0.6.2');
    expect(oldestReleaseShown('v0.6.2', 'v0.6.1')).toBe('v0.6.1');
    expect(oldestReleaseShown('v0.6.0', 'v0.6.1')).toBe('v0.6.0');
    expect(oldestReleaseShown('v0.7.3', 'v0.6.1')).toBe('v0.6.1');
  });

  it('leaves out a release whose docs cannot be published, and keeps the one before it', () => {
    const tags = { core: ['v0.6.0', 'v0.6.1', 'v0.7.0'], pro: ['v0.6.0', 'v0.6.1', 'v0.7.0'] };
    const broken: Record<string, string> = { 'pro v0.6.1': 'no docs folder', 'core v0.7.0': 'no changelog section' };
    const leftOut: string[] = [];
    const versions = resolvePublishable(
      tags,
      (group, tag) => broken[`${group} ${tag}`] ?? null,
      ({ group, tag, reason }) => leftOut.push(`${group} ${tag}: ${reason}`),
      ALL,
    );

    expect(versions).toEqual([{ version: '0.6', core: 'v0.6.1', pro: 'v0.6.0' }]);
    expect(leftOut).toEqual(['core v0.7.0: no changelog section', 'pro v0.6.1: no docs folder']);
    expect(tags.core).toContain('v0.7.0');
  });
});
