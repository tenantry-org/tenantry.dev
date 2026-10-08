import GithubSlugger from 'github-slugger';
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
 * Links into the docs go to `base`, the path the version being synced is served under (/docs for the newest,
 * /docs/v0.4 for an older one), so an older version's pages link to each other.
 * Other absolute URLs, site paths and in-page anchors are left alone. relativeLinks() lists anything still relative.
 *
 * @param {string} markdown
 * @param {string} group
 * @param {{ repository: string, ref: string } | null} [source]
 * @param {string} [dir] the page's folder inside the docs folder ('api' for the API reference), for relative links
 * @param {string} [base] the path the docs version is served under
 */
export function rewriteLinks(markdown, group, source = null, dir = '', base = '/docs') {
  const page = (targetGroup, path, anchor = '') => {
    const clean = path.replace(/(^|\/)readme$/i, '');
    return `${base}/${targetGroup}${clean ? `/${clean}` : ''}${anchor}`;
  };

  return markdown
    .replace(
      /\]\(https:\/\/tenantry\.dev(\/[^)\s]*)\)/g,
      (_, path) => `](${path.replace(/^\/docs(?=\/(core|pro)\b)/, base)})`,
    )
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

// A markdown link (left alone), or a type name written as code, with optional type parameters.
const LINK_OR_TYPE_NAME = /(\[[^\]]*\]\([^)]*\))|`([A-Z]\w*)(<[\w, ]+>)?`/g; // NOSONAR: build time, our own docs

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

      return line.replace(LINK_OR_TYPE_NAME, (match, link, name, typeParameters) => {
        if (link || !types.has(name) || linked.has(name)) return match;
        linked.add(name);
        return `[\`${name}${typeParameters ?? ''}\`](${types.get(name)})`;
      });
    })
    .join('\n');
}

/**
 * The ids of a page's headings, as the site gives them: fumadocs' remark-heading takes a `[#id]` at the end of the
 * heading, or else slugs the heading's text with github-slugger, numbering repeats. Headings in code blocks are skipped.
 *
 * @param {string} markdown
 */
export function headingIds(markdown) {
  const slugger = new GithubSlugger();
  const ids = new Set();
  let inFence = false;

  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    const heading = !inFence && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!heading) continue;

    const custom = /\s*\[#([^\]]+)\]\s*$/.exec(heading[1]);
    if (custom) {
      ids.add(custom[1]);
      continue;
    }
    const text = heading[1]
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // a link or image: its text
      .replace(/`([^`]*)`|<[^>]+>/g, (_, code) => code ?? '') // code: its text, `<TKey>` included; an HTML tag: dropped
      .replace(/(\*\*|\*)(.+?)\1/g, '$2') // emphasis
      .trim();
    ids.add(slugger.slug(text));
  }
  return ids;
}

/**
 * Links into the synced docs whose page or heading does not exist, as `<page>: <link>`. The pages are the ones the
 * sync wrote, by site path (`/docs/core/tenant-stores`, a folder's index at the folder's path); links into `base` and
 * in-page anchors are checked, other site paths and URLs are not.
 *
 * @param {Map<string, string>} pages site path → the page's markdown
 * @param {string} base the path the docs version is served under
 */
export function brokenDocsLinks(pages, base) {
  const ids = new Map([...pages].map(([path, markdown]) => [path, headingIds(markdown)]));
  const broken = [];

  for (const [from, markdown] of pages) {
    for (const [, target] of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
      const [path, anchor] = target.split('#');
      const page = path === '' ? from : path.replace(/\/$/, '');
      if (page !== base && !page.startsWith(`${base}/`)) continue;
      if (!ids.has(page) || (anchor && !ids.get(page).has(decodeURIComponent(anchor))))
        broken.push(`${from}: ${target}`);
    }
  }
  return broken;
}
