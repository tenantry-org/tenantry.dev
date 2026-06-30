import { defineConfig, defineDocs } from 'fumadocs-mdx/config';

// Docs are synced from the Core/Pro repos into content/docs by scripts/sync-docs.mjs.
export const docs = defineDocs({
  dir: 'content/docs',
});

export default defineConfig();
