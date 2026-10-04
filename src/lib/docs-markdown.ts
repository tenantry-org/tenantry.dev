import { SITE_ORIGIN } from '@/constants/site';
import { docsVersionOf, docsVersions, latestDocsVersion } from '@/lib/docs-versions';

/**
 * The docs as Markdown for AI agents: each page's Markdown at its URL with `.md` on the end, and /llms.txt and
 * /llms-full.txt (https://llmstxt.org) for the newest docs. Built from the pages the docs sync wrote, so they hold the
 * same versions and changelog entries as the site: only those docs-versions.json lists, and in each changelog only the
 * releases the site shows (scripts/docs-versions.mjs).
 */
export interface MarkdownPage {
  url: string;
  slugs: string[];
  title: string;
  description?: string;
  /** The page's Markdown, without its title. */
  markdown: string;
}

/** A page's Markdown URL: /docs/core/tenant-stores → /docs/core/tenant-stores.md, and /docs → /docs.md. */
export function markdownUrl(pageUrl: string): string {
  return `${pageUrl}.md`;
}

/**
 * Whether the site publishes the docs version a page's slugs are in: the newest, which has no prefix, or an older
 * version docs-versions.json lists.
 */
export function isPublished(slugs: string[]): boolean {
  return !isVersionPrefix(slugs[0]) || docsVersions.some((entry) => !entry.latest && slugs[0] === `v${entry.version}`);
}

function isVersionPrefix(slug: string | undefined): boolean {
  return /^v\d+\.\d+$/.test(slug ?? '');
}

/** The pages of the newest docs. */
function newestPages(pages: MarkdownPage[]): MarkdownPage[] {
  return pages.filter((page) => !isVersionPrefix(page.slugs[0]));
}

/**
 * Links to the site made absolute, and a link to a docs page made a link to its Markdown, so an agent reading the
 * Markdown can follow them. Code blocks are left as they are.
 */
export function absoluteLinks(markdown: string): string {
  return markdown
    .split(/(^```[\s\S]*?^```)/m)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/\]\((\/[^)\s]*)\)/g, (_, target: string) => `](${linkTarget(target)})`),
    )
    .join('');
}

function linkTarget(target: string): string {
  const [, path, rest] = /^([^#?]*)(.*)$/.exec(target)!;
  const page = /^\/docs(?:\/|$)/.test(path) && !/\.\w+$/.test(path);
  return new URL(`${page ? markdownUrl(path.replace(/\/$/, '')) : path}${rest}`, SITE_ORIGIN).toString();
}

/** A page's Markdown document: its title, which docs version it is of, and its Markdown with absolute links. */
export function markdownDocument(page: MarkdownPage): string {
  const version = docsVersionOf(page.slugs);
  const releases = `Core ${version.core}, Pro ${version.pro}`;
  const about = version.latest
    ? `The docs of Tenantry ${version.version} (${releases}), the newest release. Web page: ${absolute(page.url)}`
    : `The docs of Tenantry ${version.version} (${releases}). The newest release is ${latestDocsVersion.version}, ` +
      `whose docs are listed at ${absolute('/llms.txt')}.`;
  return `# ${page.title}\n\n${about}\n\n${absoluteLinks(page.markdown).trim()}\n`;
}

function absolute(path: string): string {
  return new URL(path, SITE_ORIGIN).toString();
}

interface Groups {
  core: MarkdownPage[];
  pro: MarkdownPage[];
  api: MarkdownPage[];
}

// The newest docs' guides of each product, in the sidebar's order with Core's ai-agents page first when it exists,
// and both API references.
function groups(pages: MarkdownPage[]): Groups {
  const newest = newestPages(pages);
  const guides = (product: string) => newest.filter((page) => page.slugs[0] === product && page.slugs[1] !== 'api');
  const isAiAgents = (page: MarkdownPage) => page.slugs.join('/') === 'core/ai-agents';
  const core = guides('core');
  return {
    core: [...core.filter(isAiAgents), ...core.filter((page) => !isAiAgents(page))],
    pro: guides('pro'),
    api: newest.filter((page) => page.slugs[1] === 'api'),
  };
}

function linkLine(page: MarkdownPage, title = page.title): string {
  const description = page.description?.trim();
  return `- [${title}](${absolute(markdownUrl(page.url))})${description ? `: ${description}` : ''}`;
}

// An API reference page's title, with its product: `Core API: ITenantStore`, and `Core API reference` for its index.
function apiTitle(page: MarkdownPage): string {
  const product = page.slugs[0] === 'pro' ? 'Pro' : 'Core';
  return page.slugs.length === 2 ? `${product} API reference` : `${product} API: ${page.title}`;
}

/** /llms.txt: the newest docs' pages, as links to their Markdown, with each page's description. */
export function llmsTxt(pages: MarkdownPage[]): string {
  const { core, pro, api } = groups(pages);
  const { version, core: coreTag, pro: proTag } = latestDocsVersion;
  const older = docsVersions.filter((entry) => !entry.latest);
  return (
    [
      '# Tenantry',
      '> Tenantry adds tenant isolation to ASP.NET Core and EF Core applications. Tenantry Core is open source ' +
        '(Apache-2.0); Tenantry Pro adds provisioning, migrations across tenant databases, schema per tenant and mixed ' +
        'mode, and the tenant in background jobs and messages.',
      `These are the docs of the newest release, Tenantry ${version} (Core ${coreTag}, Pro ${proTag}), as Markdown. ` +
        'Each page is also a web page at the same address without `.md`. Tenantry is in beta until 1.0.' +
        (older.length > 0
          ? ` Earlier releases' docs: ${older.map((entry) => `[${entry.version}](${absolute(markdownUrl(entry.base))})`).join(', ')}.`
          : ''),
      ['## Tenantry Core', ...core.map((page) => linkLine(page))].join('\n'),
      ['## Tenantry Pro', ...pro.map((page) => linkLine(page))].join('\n'),
      ['## Optional', ...api.map((page) => linkLine(page, apiTitle(page)))].join('\n'),
    ].join('\n\n') + '\n'
  );
}

/** /llms-full.txt: every guide of the newest docs, Core's then Pro's, as one Markdown file; not the API references. */
export function llmsFullTxt(pages: MarkdownPage[]): string {
  const { core, pro } = groups(pages);
  return [...core, ...pro].map(markdownDocument).join('\n');
}
