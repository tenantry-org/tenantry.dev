import { describe, expect, it } from 'vitest';
import { changelogPage, hasReleaseSection } from './docs-changelog.mjs';

const preamble = `# Changelog

All notable changes to Tenantry will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
`;
const fullChangelog = 'https://github.com/tenantry-org/tenantry-core/blob/v0.5.1/CHANGELOG.md';
const core05 = { product: 'Tenantry Core', minor: '0.5', fullChangelog };

describe('changelogPage', () => {
  it("keeps the minor's sections under a title and an introduction, and links the earlier releases", () => {
    const changelog =
      `${preamble}\n## [0.5.1] - 2026-10-09\n\n- A fix.\n\n## [0.5.0] - 2026-10-03\n\n### Upgrading from 0.4\n\n- A step.\n` +
      '\n## [0.4.0] - 2026-09-29\n\n- Old.\n\n## [0.3.0-alpha.1] - 2026-07-01\n\n- Older.\n';
    expect(changelogPage(changelog, core05)).toBe(
      '# Changelog\n\nThe changes in each release of Tenantry Core 0.5, newest first.\n\n' +
        '## 0.5.1 - 2026-10-09\n\n- A fix.\n\n## 0.5.0 - 2026-10-03\n\n### Upgrading from 0.4\n\n- A step.\n\n' +
        `Earlier releases are in the [full changelog](${fullChangelog}).\n`,
    );
  });

  it("keeps only the minor's releases from 1.0 as before it, and links nothing when nothing earlier is shown", () => {
    const changelog =
      `${preamble}\n## [1.10.1] - 2027-09-08\n\n- D.\n\n## [1.10.0] - 2027-09-01\n\n- C.\n\n` +
      '## [1.9.0] - 2027-07-01\n\n- B.\n\n## [1.1.0] - 2027-02-01\n\n- A.\n';
    const core110 = { ...core05, minor: '1.10' };
    expect(changelogPage(changelog, core110)).toBe(
      '# Changelog\n\nThe changes in each release of Tenantry Core 1.10, newest first.\n\n' +
        '## 1.10.1 - 2027-09-08\n\n- D.\n\n## 1.10.0 - 2027-09-01\n\n- C.\n\n' +
        `Earlier releases are in the [full changelog](${fullChangelog}).\n`,
    );
    expect(changelogPage(changelog, { ...core110, from: 'v1.10.0' })).not.toContain('Earlier releases');
  });

  it("leaves out a later minor's sections, which a backport's changelog can have, and does not count them as earlier", () => {
    const changelog =
      `${preamble}\n## [0.8.0] - 2026-12-01\n\n- Newer.\n\n## [0.7.4] - 2026-12-05\n\n- Backport.\n\n` +
      '## [0.7.3] - 2026-11-10\n\n- Sold.\n\n## [0.6.0] - 2026-10-01\n\n- Older.\n';
    const core07 = { ...core05, minor: '0.7' };

    expect(changelogPage(changelog, { ...core07, from: 'v0.7.3' })).toBe(
      '# Changelog\n\nThe changes in each release of Tenantry Core 0.7, newest first.\n\n' +
        '## 0.7.4 - 2026-12-05\n\n- Backport.\n\n## 0.7.3 - 2026-11-10\n\n- Sold.\n',
    );
    const withOlder = changelogPage(changelog, core07);
    expect(withOlder).not.toContain('0.8.0');
    expect(withOlder).toContain('Earlier releases');
  });

  it("drops a release tag's empty Unreleased section, and keeps one with entries", () => {
    const released = changelogPage(`${preamble}\n## [Unreleased]\n\n## [0.5.0] - 2026-10-03\n\n- B.\n`, core05);
    expect(released).not.toContain('Unreleased');
    expect(released).not.toContain('Earlier releases');

    const preview = changelogPage(`${preamble}\n## [Unreleased]\n\n- C.\n\n## [0.5.0] - 2026-10-03\n`, core05);
    expect(preview).toContain('## Unreleased\n\n- C.\n\n## 0.5.0 - 2026-10-03');
  });

  it("makes links relative to the repository root relative to the docs folder, as the guides' are", () => {
    const page = changelogPage(
      '## [0.5.0]\n\n[guide](docs/testing.md#setup) [sample](samples/Aot) [below](#upgrading-from-04) ' +
        '[spec](https://semver.org/) [site](/docs/core)\n',
      core05,
    );
    expect(page).toContain(
      '[guide](testing.md#setup) [sample](../samples/Aot) [below](#upgrading-from-04) ' +
        '[spec](https://semver.org/) [site](/docs/core)',
    );
  });

  it('leaves out the releases before the oldest one shown, and the link when every earlier release is hidden', () => {
    const changelog =
      `${preamble}\n## [0.6.1] - 2026-10-10\n\n- A fix.\n\n## [0.6.0] - 2026-10-03\n\n- New.\n` +
      '\n## [0.6.0-rc.1] - 2026-10-01\n\n- Nearly.\n\n## [0.5.0] - 2026-09-29\n\n- Old.\n';
    const core06 = { ...core05, minor: '0.6' };

    expect(changelogPage(changelog, { ...core06, from: 'v0.6.1' })).toBe(
      '# Changelog\n\nThe changes in each release of Tenantry Core 0.6, newest first.\n\n## 0.6.1 - 2026-10-10\n\n- A fix.\n',
    );

    const fromTheFirstRelease = changelogPage(changelog, { ...core06, from: 'v0.6.0' });
    expect(fromTheFirstRelease).toContain('## 0.6.0 - 2026-10-03');
    expect(fromTheFirstRelease).not.toContain('0.6.0-rc.1');
    expect(fromTheFirstRelease).not.toContain('Earlier releases');

    const fromAnEarlierMinor = changelogPage(changelog, { ...core06, from: 'v0.5.0' });
    expect(fromAnEarlierMinor).toContain('## 0.6.0-rc.1 - 2026-10-01');
    expect(fromAnEarlierMinor).toContain('Earlier releases');
  });

  it('is only the title and introduction when the minor has no releases', () => {
    expect(changelogPage(preamble, core05)).toBe(
      '# Changelog\n\nThe changes in each release of Tenantry Core 0.5, newest first.\n',
    );
  });

  it('finds the section of a release, not of its pre-release', () => {
    const changelog = `${preamble}\n## [Unreleased]\n\n## [0.6.1] - 2026-10-10\n\n## [0.6.0-rc.1] - 2026-10-01\n`;
    expect(hasReleaseSection(changelog, 'v0.6.1')).toBe(true);
    expect(hasReleaseSection(changelog, 'v0.6.0')).toBe(false);
    expect(hasReleaseSection(changelog, 'v0.6.0-rc.1')).toBe(true);
  });
});
