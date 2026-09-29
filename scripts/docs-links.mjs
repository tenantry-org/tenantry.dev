import { posix } from 'path';

/**
 * Rewrites markdown links in the synced docs so they work on the site:
 *   - links to other docs pages become absolute site paths, which work from every page (a relative `./foo` on
 *     /docs/core would resolve to /docs/foo): (foo.md#anchor) → (/docs/<group>/foo#anchor),
 *     (README.md) → (/docs/<group>), and
 *     (https://github.com/tenantry-org/tenantry-core/blob/<ref>/docs/foo.md) → (/docs/core/foo);
 *   - links outside the docs folder (../samples/…, ../README.md) point into the source repository on GitHub,
 *     at the commit the docs were synced from: (../samples/X) → (<repository>/tree/<ref>/samples/X).
 *   - absolute links to this site (the API reference links Pro's pages to Core's) become site paths.
 * Other absolute URLs, site paths and in-page anchors are left alone. relativeLinks() lists anything still relative.
 *
 * @param {string} markdown
 * @param {string} group
 * @param {{ repository: string, ref: string } | null} [source]
 * @param {string} [dir] the page's folder inside the docs folder ('api' for the API reference), for relative links
 */
export function rewriteLinks(markdown, group, source = null, dir = '') {
  const page = (targetGroup, path, anchor = '') => {
    const clean = path.replace(/(^|\/)readme$/i, '');
    return `/docs/${targetGroup}${clean ? `/${clean}` : ''}${anchor}`;
  };

  return markdown
    .replace(/\]\(https:\/\/tenantry\.dev(\/[^)\s]*)\)/g, ']($1)')
    .replace(
      /\]\(https:\/\/github\.com\/tenantry-org\/tenantry-core\/blob\/[^/)]+\/docs\/([\w/-]+)\.md(#[^)]*)?\)/g,
      (_, name, anchor) => `](${page('core', name, anchor)})`,
    )
    .replace(/\]\(([^)\s#]+)(#[^)\s]*)?\)/g, (match, target, anchor = '') => {
      if (/^(https?:|mailto:|\/)/.test(target)) return match;

      const resolved = posix.normalize(posix.join(dir, target));
      if (resolved.startsWith('../')) {
        return source ? `](${source.repository}/tree/${source.ref}/${resolved.slice(3)}${anchor})` : match;
      }
      return resolved.endsWith('.md') ? `](${page(group, resolved.slice(0, -3), anchor)})` : match;
    });
}

/** Links that are neither absolute URLs, site paths, in-page anchors nor mail links: they would 404 on the site. */
export function relativeLinks(markdown) {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^(https?:|mailto:|\/|#)/.test(target));
}

/**
 * Links the first mention of each API type in a guide, written as code (`ITenantScope<TKey>`, or without its type
 * parameters), to its page in the API reference. Code blocks, existing links and headings are left alone.
 *
 * @param {string} markdown
 * @param {Map<string, string>} types type name without type parameters → its API page path
 */
export function linkApiTypes(markdown, types) {
  const linked = new Set();
  let inFence = false;

  return markdown
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) inFence = !inFence;
      if (inFence || line.startsWith('#')) return line;

      return line.replace(/(\[[^\]]*\]\([^)]*\))|`([A-Z]\w*)(<[\w, ]+>)?`/g, (match, link, name, typeParameters) => {
        if (link || !types.has(name) || linked.has(name)) return match;
        linked.add(name);
        return `[\`${name}${typeParameters ?? ''}\`](${types.get(name)})`;
      });
    })
    .join('\n');
}
