import type { AdvancedIndex } from 'fumadocs-core/search/server';
import type { StructuredData } from 'fumadocs-core/mdx-plugins';
import { docsVersionOf } from '@/lib/docs-versions';

interface IndexedPage {
  url: string;
  slugs: string[];
  data: { title?: string; description?: string; structuredData: StructuredData };
}

/**
 * A docs page's entry in the search index, tagged with its docs version so a search covers one version. The search
 * index numbers each page's headings and paragraphs after its id (`<id>-0`, `<id>-1`), so the id ends in `#`, which no
 * page URL has: a page's URL as its id would clash with the parts of another page whose URL is the same with `-1` on
 * the end, as the API reference's `ITenantBuilder` and `ITenantBuilder<TKey>` (`tenantry-itenantbuilder-1`) are.
 */
export function searchIndex(page: IndexedPage): AdvancedIndex {
  return {
    id: `${page.url}#`,
    url: page.url,
    title: page.data.title ?? '',
    description: page.data.description,
    structuredData: page.data.structuredData,
    tag: docsVersionOf(page.slugs).version,
  };
}
