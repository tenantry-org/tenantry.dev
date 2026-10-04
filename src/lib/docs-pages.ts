import 'server-only';
import { flattenTree } from 'fumadocs-core/page-tree';
import type { MarkdownPage } from '@/lib/docs-markdown';
import { latestDocsVersion, slugsInVersion } from '@/lib/docs-versions';
import { source } from '@/lib/source';

type DocsPage = ReturnType<typeof source.getPages>[number];

/** The same page in the latest docs, or the latest docs' home when the page is gone. */
export function latestUrl(slugs: string[]): string {
  return source.getPage(slugsInVersion(slugs, latestDocsVersion))?.url ?? latestDocsVersion.base;
}

/** A docs page as Markdown (docs-markdown.ts), from the Markdown kept with its compiled page (source.config.ts). */
export async function markdownPage(page: DocsPage): Promise<MarkdownPage> {
  return {
    url: page.url,
    slugs: page.slugs,
    title: page.data.title ?? '',
    description: page.data.description,
    markdown: await page.data.getText('processed'),
  };
}

/** Every docs page as Markdown, in the sidebar's order. */
export async function markdownPages(): Promise<MarkdownPage[]> {
  const order = new Map(flattenTree(source.getPageTree().children).map((item, index) => [item.url, index]));
  const position = (page: DocsPage) => order.get(page.url) ?? order.size;
  const pages = source.getPages().sort((a, b) => position(a) - position(b));
  return Promise.all(pages.map(markdownPage));
}
