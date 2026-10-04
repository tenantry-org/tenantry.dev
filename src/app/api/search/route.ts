import { source } from '@/lib/source';
import { searchIndex } from '@/lib/search-index';
import { createFromSource } from 'fumadocs-core/search/server';

// Client-side search index (Orama) built from the docs source (src/lib/search-index.ts).
export const { GET } = createFromSource(source, { buildIndex: searchIndex });
