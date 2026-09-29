import { defineConfig, defineDocs } from 'fumadocs-mdx/config';

// Docs are synced from the Core/Pro repos into content/docs by scripts/sync-docs.mjs.
export const docs = defineDocs({
  dir: 'content/docs',
});

export default defineConfig({
  mdxOptions: {
    // github-dark's comment colour fails WCAG contrast on the docs' dark background; the -default variant passes.
    rehypeCodeOptions: { themes: { light: 'github-light', dark: 'github-dark-default' } },
  },
});
