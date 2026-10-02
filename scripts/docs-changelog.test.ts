import { describe, expect, it } from 'vitest';
import { changelogPage } from './docs-changelog.mjs';

const preamble = `# Changelog

All notable changes to Tenantry will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
`;
const fullChangelog = 'https://github.com/tenantry-org/tenantry-core/blob/v0.5.1/CHANGELOG.md';
const core05 = { product: 'Tenantry Core', line: '0.5', fullChangelog };

describe('changelogPage', () => {
  it("keeps the line's sections under a title and an introduction, and links the earlier releases", () => {
    const changelog =
      `${preamble}\n## [0.5.1] - 2026-10-09\n\n- A fix.\n\n## [0.5.0] - 2026-10-03\n\n### Upgrading from 0.4\n\n- A step.\n` +
      '\n## [0.4.0] - 2026-09-29\n\n- Old.\n\n## [0.3.0-alpha.1] - 2026-07-01\n\n- Older.\n';
    expect(changelogPage(changelog, core05)).toBe(
      '# Changelog\n\nThe changes in each release of Tenantry Core 0.5, newest first.\n\n' +
        '## 0.5.1 - 2026-10-09\n\n- A fix.\n\n## 0.5.0 - 2026-10-03\n\n### Upgrading from 0.4\n\n- A step.\n\n' +
        `Earlier releases are in the [full changelog](${fullChangelog}).\n`,
    );
  });

  it('keeps every release of a major line from 1.0, and links nothing when there is nothing earlier', () => {
    const changelog = `${preamble}\n## [1.1.0] - 2027-03-01\n\n- B.\n\n## [1.0.0] - 2027-01-01\n\n- A.\n`;
    const page = changelogPage(changelog, { ...core05, line: '1' });
    expect(page).toContain('## 1.1.0 - 2027-03-01\n\n- B.\n\n## 1.0.0 - 2027-01-01\n\n- A.');
    expect(page).not.toContain('Earlier releases');
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

  it('is only the title and introduction when the line has no releases', () => {
    expect(changelogPage(preamble, core05)).toBe(
      '# Changelog\n\nThe changes in each release of Tenantry Core 0.5, newest first.\n',
    );
  });
});
