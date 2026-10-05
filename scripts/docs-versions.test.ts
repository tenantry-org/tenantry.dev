import { describe, expect, it } from 'vitest';
import { changelogPage } from './docs-changelog.mjs';
import {
  checkFirstSold,
  listedVersions,
  minorOf,
  oldestReleaseShown,
  publishedTags,
  resolvePublishable,
  resolveVersions,
  versionProblems,
} from './docs-versions.mjs';

const v04 = { version: '0.4', core: 'v0.4.0', pro: 'v0.4.0' };
// A first sale older than every release: no minor is hidden.
const ALL = { core: 'v0.1.0', pro: 'v0.1.0' };
const sold = (core: string, pro = core) => ({ core, pro });

describe('docs versions', () => {
  it('reads a tag’s minor version', () => {
    expect(minorOf('v0.4.0')).toBe('0.4');
    expect(minorOf('v0.12.3-rc.1')).toBe('0.12');
    expect(minorOf('v1.0.0')).toBe('1.0');
    expect(minorOf('v1.12.3')).toBe('1.12');
    expect(minorOf('0.4.0')).toBeNull();
    expect(minorOf('v0.4')).toBeNull();
  });

  it('accepts complete versions, newest first', () => {
    expect(versionProblems([{ version: '0.5', core: 'v0.5.1', pro: 'v0.5.0' }, v04])).toEqual([]);
    expect(
      versionProblems([
        { version: '1.10', core: 'v1.10.0', pro: 'v1.10.2' },
        { version: '1.9', core: 'v1.9.3', pro: 'v1.9.0' },
        { version: '1.0', core: 'v1.0.0', pro: 'v1.0.1' },
      ]),
    ).toEqual([]);
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
    for (const version of ['1', '1.02', 'v1.0', '1.0.0']) {
      expect(versionProblems([{ version, core: 'v1.0.0', pro: 'v1.0.0' }])).toEqual([
        `"${version}" is not a minor version (MAJOR.MINOR).`,
      ]);
    }
    expect(versionProblems([{ version: '1.2', core: 'v1.2.0', pro: 'v1.1.4' }])).toEqual([
      "1.2's pro tag v1.1.4 is not a 1.2 release.",
    ]);
  });

  it('counts a tag only once its version is published, so a pushed tag whose release is pending or failed is not', () => {
    const tags = ['v0.4.0', 'v0.5.0', 'v0.5.1', 'v0.6.0-RC.1', 'not-a-release'];

    expect(publishedTags(tags, ['0.4.0', '0.5.0', '0.6.0-rc.1'])).toEqual(['v0.4.0', 'v0.5.0', 'v0.6.0-RC.1']);
    expect(resolveVersions({ core: publishedTags(tags, ['0.4.0', '0.5.0']), pro: ['v0.5.0', 'v0.5.1'] })).toEqual([
      { version: '0.5', core: 'v0.5.0', pro: 'v0.5.1' },
    ]);
  });

  it('publishes each minor both groups released, with the newest stable patch of each', () => {
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

  it('waits for both groups before publishing a new minor', () => {
    expect(resolveVersions({ core: ['v0.4.0', 'v0.5.0'], pro: ['v0.4.0'] }, ALL)).toEqual([v04]);
    expect(resolveVersions({ core: [], pro: ['v0.4.0'] }, ALL)).toEqual([]);
  });

  it('orders minors numerically, newest first', () => {
    const tags = ['v0.9.0', 'v0.9.4', 'v0.10.0', 'v1.0.0', 'v1.9.0', 'v1.10.0'];
    expect(resolveVersions({ core: tags, pro: tags }, ALL).map((v) => v.version)).toEqual([
      '1.10',
      '1.9',
      '1.0',
      '0.10',
      '0.9',
    ]);
  });

  it('publishes each minor from 1.0 as before it, with the newest patch of each', () => {
    const versions = resolveVersions(
      {
        core: ['v0.9.2', 'v1.0.0', 'v1.0.3', 'v1.1.0', 'v1.2.0', 'v1.2.1', 'v1.3.0', 'v2.0.0-rc.1'],
        pro: ['v0.9.0', 'v1.0.1', 'v1.1.3', 'v1.1.12', 'v1.2.0', 'v1.3.0-rc.1', 'v2.0.0-rc.1'],
      },
      ALL,
    );
    // 1.3 has only Core's release (Pro's is a pre-release), and 2.0 none: neither is published yet.
    expect(versions).toEqual([
      { version: '1.2', core: 'v1.2.1', pro: 'v1.2.0' },
      { version: '1.1', core: 'v1.1.0', pro: 'v1.1.12' },
      { version: '1.0', core: 'v1.0.3', pro: 'v1.0.1' },
      { version: '0.9', core: 'v0.9.2', pro: 'v0.9.0' },
    ]);
    expect(versionProblems(versions)).toEqual([]);
  });

  it('publishes only the newest minor while no release has been sold', () => {
    const tags = { core: ['v0.4.0', 'v0.5.0', 'v0.6.0', 'v0.6.1'], pro: ['v0.4.0', 'v0.5.0', 'v0.6.1'] };
    expect(resolveVersions(tags, null)).toEqual([{ version: '0.6', core: 'v0.6.1', pro: 'v0.6.1' }]);
    expect(resolveVersions({ core: ['v1.0.0', 'v1.1.0'], pro: ['v1.0.0', 'v1.1.2'] }, null)).toEqual([
      { version: '1.1', core: 'v1.1.0', pro: 'v1.1.2' },
    ]);
    expect(resolveVersions({ core: [], pro: [] }, null)).toEqual([]);
  });

  it('publishes the minor of the first releases sold and every later one, and none before it', () => {
    const tags = {
      core: ['v0.5.0', 'v0.6.0', 'v0.6.1', 'v0.7.0', 'v1.0.0', 'v1.1.0', 'v1.2.0', 'v1.2.3'],
      pro: ['v0.5.0', 'v0.6.1', 'v0.7.2', 'v1.0.0', 'v1.1.0', 'v1.2.1'],
    };
    expect(resolveVersions(tags, sold('v0.6.1')).map((v) => v.version)).toEqual(['1.2', '1.1', '1.0', '0.7', '0.6']);
    expect(resolveVersions(tags, sold('v1.1.0')).map((v) => v.version)).toEqual(['1.2', '1.1']);
    expect(resolveVersions(tags, sold('v0.7.0', 'v0.7.2')).map((v) => v.version)).toEqual(['1.2', '1.1', '1.0', '0.7']);
  });

  it("accepts no first sale, or Core's and Pro's release tags in one minor, and refuses anything else", () => {
    expect(checkFirstSold(null)).toBeNull();
    expect(checkFirstSold(sold('v0.8.1', 'v0.8.0'))).toEqual({ core: 'v0.8.1', pro: 'v0.8.0' });
    const refused = [
      'v0.6.1',
      sold('0.6.1'),
      sold('v0.6.1-rc.1', 'v0.6.1'),
      sold('v0.6', 'v0.6.1'),
      sold('v0.6.1', ''),
      { core: 'v0.6.1' },
      sold('v0.7.0', 'v0.6.1'),
      sold('v1.0.0', 'v0.10.0'),
    ];
    for (const value of refused) {
      expect(() => checkFirstSold(value)).toThrow(/FIRST_SOLD_RELEASE is .*: set it to null, or to Core's and Pro's/);
      expect(() => resolveVersions({ core: ['v0.6.1'], pro: ['v0.6.1'] }, value as never)).toThrow(/FIRST_SOLD/);
      expect(() => oldestReleaseShown('core', 'v0.6.1', value as never)).toThrow(/FIRST_SOLD_RELEASE/);
    }
  });

  it('publishes nothing while no minor at or after the first releases sold has both releases', () => {
    expect(resolveVersions({ core: ['v0.6.0', 'v0.7.0'], pro: ['v0.6.0'] }, sold('v0.7.0'))).toEqual([]);
  });

  it("starts a group's changelog at its first release sold, or at the release its docs are of when that is older", () => {
    expect(oldestReleaseShown('core', 'v0.6.2', null)).toBe('v0.6.2');
    expect(oldestReleaseShown('core', 'v0.6.2', sold('v0.6.1'))).toBe('v0.6.1');
    expect(oldestReleaseShown('core', 'v0.6.0', sold('v0.6.1'))).toBe('v0.6.0');
    expect(oldestReleaseShown('core', 'v0.7.3', sold('v0.6.1'))).toBe('v0.6.1');
    expect(oldestReleaseShown('pro', 'v1.10.0', sold('v1.9.2', 'v1.9.0'))).toBe('v1.9.0');
  });

  it("shows each product's changelog from its own first release sold when their patches differ", () => {
    // Checkout opens at Core v0.8.3 and Pro v0.8.1; Core v0.8.4 and Pro v0.8.2 follow.
    const firstSold = sold('v0.8.3', 'v0.8.1');
    const changelog = (patches: number[]) =>
      patches.map((patch) => `## [0.8.${patch}] - 2026-11-0${patch + 1}\n\n- Patch ${patch}.\n`).join('\n');
    const page = (group: 'core' | 'pro', tag: string, patches: number[]) =>
      changelogPage(changelog(patches), {
        product: group,
        minor: '0.8',
        fullChangelog: 'https://example.test/CHANGELOG.md',
        from: oldestReleaseShown(group, tag, firstSold),
      });
    const shown = (markdown: string) => [...markdown.matchAll(/^## (0\.8\.\d)/gm)].map((match) => match[1]);

    expect(shown(page('core', 'v0.8.4', [4, 3, 2, 1, 0]))).toEqual(['0.8.4', '0.8.3']);
    expect(shown(page('pro', 'v0.8.2', [2, 1, 0]))).toEqual(['0.8.2', '0.8.1']);
    expect(
      resolveVersions({ core: ['v0.6.0', 'v0.8.3', 'v0.8.4'], pro: ['v0.6.0', 'v0.8.1', 'v0.8.2'] }, firstSold),
    ).toEqual([{ version: '0.8', core: 'v0.8.4', pro: 'v0.8.2' }]);
  });

  it('leaves out a release whose docs cannot be published, and keeps the one before it', async () => {
    const tags = { core: ['v0.6.0', 'v0.6.1', 'v0.7.0'], pro: ['v0.6.0', 'v0.6.1', 'v0.7.0'] };
    const broken: Record<string, string> = { 'pro v0.6.1': 'no docs folder', 'core v0.7.0': 'no changelog section' };
    const leftOut: string[] = [];
    const versions = await resolvePublishable(
      tags,
      (group, tag) => broken[`${group} ${tag}`] ?? null,
      ({ group, tag, reason }) => leftOut.push(`${group} ${tag}: ${reason}`),
      ALL,
    );

    expect(versions).toEqual([{ version: '0.6', core: 'v0.6.1', pro: 'v0.6.0' }]);
    expect(leftOut).toEqual(['core v0.7.0: no changelog section', 'pro v0.6.1: no docs folder']);
    expect(tags.core).toContain('v0.7.0');
  });

  it('checks the facts of the newest minor only, and leaves out its release when they cannot be read', async () => {
    const tags = { core: ['v0.6.0', 'v0.7.0'], pro: ['v0.6.0', 'v0.7.0', 'v0.7.1'] };
    const asked: string[] = [];
    const versions = await resolvePublishable(
      tags,
      async (group, tag, newest) => {
        if (newest) asked.push(`${group} ${tag}`);
        return newest && tag === 'v0.7.1' ? 'no docs/installation.md' : null;
      },
      undefined,
      ALL,
    );

    expect(versions).toEqual([
      { version: '0.7', core: 'v0.7.0', pro: 'v0.7.0' },
      { version: '0.6', core: 'v0.6.0', pro: 'v0.6.0' },
    ]);
    expect(asked).toEqual(['core v0.7.0', 'pro v0.7.1', 'core v0.7.0', 'pro v0.7.0']);
  });

  it('counts only the versions NuGet lists, reading a page of the index that is not inlined', async () => {
    const entry = (version: string, listed?: boolean) => ({ catalogEntry: { version, listed } });
    const index = {
      items: [
        { '@id': 'page/0', items: [entry('0.5.0'), entry('0.6.0', false), entry('0.6.1+build.7', true)] },
        { '@id': 'page/1' },
      ],
    };
    const pages: Record<string, unknown> = { 'page/1': { items: [entry('0.7.0-rc.1'), entry('0.7.0')] } };

    expect(await listedVersions(index, async (url) => pages[url])).toEqual(['0.5.0', '0.6.1', '0.7.0-rc.1', '0.7.0']);
    await expect(listedVersions({} as never, async () => ({}))).rejects.toThrow('the registration index has no items.');
  });

  it('reads a release tag only without leading zeros', () => {
    expect(minorOf('v01.2.3')).toBeNull();
    expect(() => checkFirstSold(sold('v01.2.3'))).toThrow(/FIRST_SOLD_RELEASE/);
    expect(() => checkFirstSold(sold('v0.6.01'))).toThrow(/FIRST_SOLD_RELEASE/);
    expect(resolveVersions({ core: ['v0.06.0', 'v0.6.0'], pro: ['v0.6.0'] }, ALL)).toEqual([
      { version: '0.6', core: 'v0.6.0', pro: 'v0.6.0' },
    ]);
  });
});
