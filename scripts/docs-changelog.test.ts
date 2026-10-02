import { describe, expect, it } from 'vitest';
import { changelogPage } from './docs-changelog.mjs';

const preamble = `# Changelog

All notable changes to Tenantry will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
`;

describe('changelogPage', () => {
  it("keeps the releases' sections under a title and an introduction, without the preamble", () => {
    const page = changelogPage(`${preamble}\n## [0.4.0] - 2026-09-29\n\n### Added\n\n- A thing.\n`, 'Tenantry Core');
    expect(page).toBe(
      '# Changelog\n\nThe changes in each release of Tenantry Core, newest first.\n\n' +
        '## 0.4.0 - 2026-09-29\n\n### Added\n\n- A thing.\n',
    );
  });

  it("drops a release tag's empty Unreleased section, and keeps one with entries", () => {
    const released = changelogPage(`${preamble}\n## [Unreleased]\n\n## [0.5.0] - 2026-10-03\n\n- B.\n`, 'Tenantry Pro');
    expect(released).not.toContain('Unreleased');
    expect(released).toContain('## 0.5.0 - 2026-10-03\n\n- B.');

    const preview = changelogPage(`${preamble}\n## [Unreleased]\n\n- C.\n\n## [0.5.0] - 2026-10-03\n`, 'Tenantry Pro');
    expect(preview).toContain('## Unreleased\n\n- C.\n\n## 0.5.0 - 2026-10-03');
  });

  it("makes links relative to the repository root relative to the docs folder, as the guides' are", () => {
    const page = changelogPage(
      '## [0.5.0]\n\n[guide](docs/testing.md#setup) [sample](samples/Aot) [below](#upgrading-from-04) ' +
        '[spec](https://semver.org/) [site](/docs/core)\n',
      'Tenantry Core',
    );
    expect(page).toContain(
      '[guide](testing.md#setup) [sample](../samples/Aot) [below](#upgrading-from-04) ' +
        '[spec](https://semver.org/) [site](/docs/core)',
    );
  });

  it('is only the title and introduction when there are no releases', () => {
    expect(changelogPage(preamble, 'Tenantry Core')).toBe(
      '# Changelog\n\nThe changes in each release of Tenantry Core, newest first.\n',
    );
  });
});
