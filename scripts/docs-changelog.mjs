import { lineOf } from './docs-versions.mjs';

/**
 * A repository's CHANGELOG.md as the Changelog page of one docs version: that release line's sections (0.5.0 and
 * its patches, with the steps to update from 0.4) without the Keep a Changelog preamble, under a title and a
 * one-line introduction, and a link to the full changelog for earlier releases. Ready for sync-docs' frontmatter and
 * link rewriting.
 *   - An empty `## [Unreleased]` section (a release tag's) is dropped; one with entries (a local preview of a
 *     repository's master) stays.
 *   - `## [0.5.0] - 2026-10-03` becomes `## 0.5.0 - 2026-10-03`: the brackets are for reference links the changelogs
 *     do not define, and would otherwise show.
 *   - Links relative to the repository root are made relative to its docs folder, as the guides' are: `docs/foo.md`
 *     becomes `foo.md`, and anything else goes up a folder, to the repository on GitHub.
 *
 * @param {string} markdown the changelog, as the release tag has it
 * @param {{ product: string, line: string, fullChangelog: string }} page the product's name ('Tenantry Core'), the
 *   docs version's release line ('0.5'), and the URL of the whole changelog at the tag
 */
export function changelogPage(markdown, { product, line, fullChangelog }) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const first = lines.findIndex((text) => text.startsWith('## '));
  const sections = [];
  for (const text of first === -1 ? [] : lines.slice(first)) {
    if (text.startsWith('## ')) sections.push([text]);
    else sections.at(-1).push(text);
  }

  const lineOfSection = ([heading]) => {
    const version = /^## \[?v?(\d+\.\d+\.\d+[0-9A-Za-z.-]*)/.exec(heading)?.[1];
    return version === undefined ? null : lineOf(`v${version}`);
  };
  const unreleased = ([heading, ...rest]) =>
    /^## \[?unreleased\]?\s*$/i.test(heading) && rest.some((text) => text.trim());

  const body = sections
    .filter((section) => unreleased(section) || lineOfSection(section) === line)
    .map(([heading, ...rest]) => [heading.replace(/^## \[([^\]]+)\]/, '## $1'), ...rest].join('\n'))
    .join('\n')
    .replace(/\]\((?![a-z][\w+.-]*:|\/|#)([^)\s]+)\)/gi, (_, target) =>
      target.startsWith('docs/') ? `](${target.slice(5)})` : `](../${target})`,
    )
    .trim();
  const earlier = sections.some((section) => ![null, line].includes(lineOfSection(section)))
    ? `Earlier releases are in the [full changelog](${fullChangelog}).`
    : '';

  return (
    ['# Changelog', `The changes in each release of ${product} ${line}, newest first.`, body, earlier]
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}
