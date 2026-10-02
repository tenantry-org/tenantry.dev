/**
 * A repository's CHANGELOG.md as a docs page: the releases' sections without the Keep a Changelog preamble, under a
 * title and a one-line introduction, ready for sync-docs' frontmatter and link rewriting.
 *   - An empty `## [Unreleased]` section (a release tag's) is dropped; one with entries (a local preview of a
 *     repository's master) stays.
 *   - `## [0.5.0] - 2026-10-03` becomes `## 0.5.0 - 2026-10-03`: the brackets are for reference links the changelogs
 *     do not define, and would otherwise show.
 *   - Links relative to the repository root are made relative to its docs folder, as the guides' are: `docs/foo.md`
 *     becomes `foo.md`, and anything else goes up a folder, to the repository on GitHub.
 *
 * @param {string} markdown the changelog, as the release tag has it
 * @param {string} product the product's name, for the introduction ('Tenantry Core')
 */
export function changelogPage(markdown, product) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const first = lines.findIndex((line) => line.startsWith('## '));
  const sections = [];
  for (const line of first === -1 ? [] : lines.slice(first)) {
    if (line.startsWith('## ')) sections.push([line]);
    else sections.at(-1).push(line);
  }

  const body = sections
    .filter(([heading, ...rest]) => !/^## \[?unreleased\]?\s*$/i.test(heading) || rest.some((line) => line.trim()))
    .map(([heading, ...rest]) => [heading.replace(/^## \[([^\]]+)\]/, '## $1'), ...rest].join('\n'))
    .join('\n')
    .replace(/\]\((?![a-z][\w+.-]*:|\/|#)([^)\s]+)\)/gi, (_, target) =>
      target.startsWith('docs/') ? `](${target.slice(5)})` : `](../${target})`,
    )
    .trim();

  return (
    ['# Changelog', `The changes in each release of ${product}, newest first.`, body].filter(Boolean).join('\n\n') +
    '\n'
  );
}
