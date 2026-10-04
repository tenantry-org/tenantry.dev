import { defineCollections, defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';

// Docs are synced from the Core/Pro repos into content/docs by scripts/sync-docs.mjs. Each page's Markdown is kept
// with its compiled page, for its Markdown copy and llms.txt (src/lib/docs-markdown.ts); without Fumadocs' heading
// ids (`## Title [#id]`), which are not Markdown.
export const docs = defineDocs({
  dir: 'content/docs',
  docs: { postprocess: { includeProcessedMarkdown: { headingIds: false } } },
});

// Blog posts (src/lib/blog.ts): Markdown files (.md, not MDX), since each published post is also copied to dev.to
// as it is (scripts/devto-sync.mjs).
export const blog = defineCollections({
  type: 'doc',
  dir: 'content/blog',
  schema: pageSchema.extend({
    description: z.string(),
    /** The day it was published, YYYY-MM-DD. */
    date: z.iso.date(),
    /** The day it last changed in substance, if it has. */
    updated: z.iso.date().optional(),
    author: z.string(),
    /** The releases its examples were checked against, such as "Tenantry 0.5, .NET 10, EF Core 10". */
    versions: z.string(),
    /** dev.to's tags: at most four, lowercase letters and digits. */
    tags: z.array(z.string().regex(/^[a-z0-9]+$/)).max(4),
    /** The one next step the post ends with. */
    next: z.object({ label: z.string(), href: z.string() }),
    /** Not published: has a page and is listed only outside production; never fed, put in the sitemap, indexed or copied to dev.to. */
    draft: z.boolean().default(false),
  }),
});

export default defineConfig({
  mdxOptions: {
    // github-dark's comment colour fails WCAG contrast on the docs' dark background; the -default variant passes.
    rehypeCodeOptions: { themes: { light: 'github-light', dark: 'github-dark-default' } },
  },
});
