import { compareMinors, compareReleases, minorOf } from './docs-versions.mjs';

// The version of a release's section heading: `## [0.5.0] - 2026-10-03` → 0.5.0.
const SECTION_VERSION = /^## \[?v?(\d+\.\d+\.\d+[0-9A-Za-z.-]*)/;

/** Whether a changelog has a section for the release of a tag (`v0.6.1`: `## [0.6.1] - …`). */
export function hasReleaseSection(markdown, tag) {
  return markdown.split(/\r?\n/).some((text) => `v${SECTION_VERSION.exec(text)?.[1]}` === tag);
}

/**
 * A repository's CHANGELOG.md as the Changelog page of one docs version: that minor's sections (0.5.0 and its
 * patches, with the steps to update from 0.4) without the Keep a Changelog preamble, under a title and a
 * one-line introduction, and a link to the full changelog for earlier releases. Ready for sync-docs' frontmatter and
 * link rewriting.
 *   - Sections of other minors are left out. The link counts only earlier minors: a later minor's sections, which a
 *     backport's changelog can have, are neither shown nor linked as earlier releases.
 *   - With `from`, a release before it, or a pre-release of it, is left out, and so is the link when every earlier
 *     release is: the site shows nothing of a release older than the first one sold (oldestReleaseShown in
 *     docs-versions.mjs).
 *   - An empty `## [Unreleased]` section (a release tag's) is dropped; one with entries (a local preview of a
 *     repository's master) stays.
 *   - `## [0.5.0] - 2026-10-03` becomes `## 0.5.0 - 2026-10-03`: the brackets are for reference links the changelogs
 *     do not define, and would otherwise show.
 *   - Links relative to the repository root are made relative to its docs folder, as the guides' are: `docs/foo.md`
 *     becomes `foo.md`, and anything else goes up a folder, to the repository on GitHub.
 *
 * @param {string} markdown the changelog, as the release tag has it
 * @param {{ product: string, minor: string, fullChangelog: string, from?: string }} page the product's name
 *   ('Tenantry Core'), the docs version's minor ('0.5'), the URL of the whole changelog at the tag, and the
 *   tag of the oldest release to show ('v0.5.1'), if any is hidden
 */
export function changelogPage(markdown, { product, minor, fullChangelog, from }) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const first = lines.findIndex((text) => text.startsWith('## '));
  const sections = [];
  for (const text of first === -1 ? [] : lines.slice(first)) {
    if (text.startsWith('## ')) sections.push([text]);
    else sections.at(-1).push(text);
  }

  const versionOfSection = ([heading]) => SECTION_VERSION.exec(heading)?.[1];
  const minorOfSection = (section) => {
    const version = versionOfSection(section);
    return version === undefined ? null : minorOf(`v${version}`);
  };
  // A pre-release comes before its release, so `from` and later releases are shown, and only the pre-releases of
  // releases after `from`.
  const shown = (section) => {
    if (!from) return true;
    const [release, preRelease] = /^(\d+\.\d+\.\d+)(-.*)?/.exec(versionOfSection(section)).slice(1);
    const order = compareReleases(`v${release}`, from);
    return preRelease ? order > 0 : order >= 0;
  };
  const unreleased = ([heading, ...rest]) =>
    /^## \[?unreleased\]?\s*$/i.test(heading) && rest.some((text) => text.trim());

  const body = sections
    .filter((section) => unreleased(section) || (minorOfSection(section) === minor && shown(section)))
    .map(([heading, ...rest]) => [heading.replace(/^## \[([^\]]+)\]/, '## $1'), ...rest].join('\n'))
    .join('\n')
    .replace(/\]\((?![a-z][\w+.-]*:|\/|#)([^)\s]+)\)/gi, (_, target) =>
      target.startsWith('docs/') ? `](${target.slice(5)})` : `](../${target})`,
    )
    .trim();
  const earlier = sections.some((section) => {
    const sectionMinor = minorOfSection(section);
    return sectionMinor !== null && compareMinors(sectionMinor, minor) < 0 && shown(section);
  })
    ? `Earlier releases are in the [full changelog](${fullChangelog}).`
    : '';

  return (
    ['# Changelog', `The changes in each release of ${product} ${minor}, newest first.`, body, earlier]
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}
