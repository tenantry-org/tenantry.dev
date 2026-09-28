/**
 * Rewrites markdown links to other docs pages into absolute site paths, which work from every page
 * (a relative `./foo` on /docs/core would resolve to /docs/foo):
 *   (foo.md#anchor) → (/docs/<group>/foo#anchor), (README.md) → (/docs/<group>)
 *   (https://github.com/tenantry-org/tenantry-core/blob/<ref>/docs/foo.md) → (/docs/core/foo)
 * Other absolute URLs, and links outside the docs folder (../samples/…), are left alone.
 */
export function rewriteLinks(markdown, group) {
  const page = (targetGroup, name, anchor = '') =>
    `/docs/${targetGroup}${name.toLowerCase() === 'readme' ? '' : `/${name}`}${anchor}`;

  return markdown
    .replace(
      /\]\(https:\/\/github\.com\/tenantry-org\/tenantry-core\/blob\/[^/)]+\/docs\/([\w-]+)\.md(#[^)]*)?\)/g,
      (_, name, anchor) => `](${page('core', name, anchor)})`,
    )
    .replace(/\]\((?:\.\/)?([\w-]+)\.md(#[^)]*)?\)/g, (_, name, anchor) => `](${page(group, name, anchor)})`);
}
