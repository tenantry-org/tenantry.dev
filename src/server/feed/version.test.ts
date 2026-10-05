import { describe, expect, it } from 'vitest';
import { compareVersions, parseVersion } from './version';

describe('parseVersion', () => {
  it('reads a release and a release candidate', () => {
    expect(parseVersion('0.8.0')).toEqual({ major: 0, minor: 8, patch: 0, rc: null });
    expect(parseVersion('0.8.0-rc.1')).toEqual({ major: 0, minor: 8, patch: 0, rc: 1 });
    expect(parseVersion('1.12.3-rc.10')).toEqual({ major: 1, minor: 12, patch: 3, rc: 10 });
    expect(parseVersion('2147483647.0.0')).toEqual({ major: 2147483647, minor: 0, patch: 0, rc: null });
  });

  it.each([
    '0.8',
    '0.8.0.1',
    '00.8.0',
    '0.08.0',
    '0.8.00',
    'v0.8.0',
    '0.8.0-rc',
    '0.8.0-rc.',
    '0.8.0-rc.0',
    '0.8.0-rc.01',
    '0.8.0-rc1',
    '0.8.0-RC.1',
    '0.8.0-rc.1.1',
    '0.8.0-beta.1',
    '0.8.0-alpha.0.133',
    '0.8.0-rc.1+sha.abc',
    '0.8.0+sha.abc',
    ' 0.8.0',
    '2147483648.0.0',
    '0.8.0-rc.2147483648',
  ])('refuses %s', (version) => {
    expect(parseVersion(version)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders versions as SemVer does: numbers first, then each candidate before its release, by number', () => {
    const versions = ['1.0.0', '0.10.0', '0.8.0', '0.8.0-rc.10', '0.9.0-rc.1', '0.8.1', '0.8.0-rc.2', '0.8.0-rc.1'];
    const sorted = versions.map((version) => ({ version, ...parseVersion(version)! })).sort(compareVersions);

    expect(sorted.map(({ version }) => version)).toEqual([
      '0.8.0-rc.1',
      '0.8.0-rc.2',
      '0.8.0-rc.10',
      '0.8.0',
      '0.8.1',
      '0.9.0-rc.1',
      '0.10.0',
      '1.0.0',
    ]);
  });

  it('gives 0 only for the same version, and the opposite sign with its arguments swapped', () => {
    const [rc, release] = [parseVersion('0.8.0-rc.1')!, parseVersion('0.8.0')!];

    expect(compareVersions(release, parseVersion('0.8.0')!)).toBe(0);
    expect(compareVersions(rc, parseVersion('0.8.0-rc.1')!)).toBe(0);
    expect(compareVersions(rc, release)).toBeLessThan(0);
    expect(compareVersions(release, rc)).toBeGreaterThan(0);
  });
});
