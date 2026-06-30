import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Client-side search index (Orama) built from the docs source.
export const { GET } = createFromSource(source);
