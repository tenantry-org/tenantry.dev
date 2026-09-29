import { source } from '@/lib/source';
import { docsVersionOf } from '@/lib/docs-versions';
import { createFromSource } from 'fumadocs-core/search/server';

// Client-side search index (Orama) built from the docs source, each page tagged with its docs version so a search
// covers one version.
export const { GET } = createFromSource(source, {
  buildIndex: (page) => ({
    id: page.url,
    url: page.url,
    title: page.data.title,
    description: page.data.description,
    structuredData: page.data.structuredData,
    tag: docsVersionOf(page.slugs).version,
  }),
});
