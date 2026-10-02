import { createHash } from 'node:crypto';
import { absoluteUrl, crossPostMarkdown, publishedPosts } from '@/lib/blog';

/**
 * The published posts as their dev.to copies take them, prerendered with the site. scripts/devto-sync.mjs reads this
 * from the production site after each deployment, so dev.to gets only what the site has published, as published.
 * `source` is the hash of the post's file, by which it knows the site serves the commit it runs on. It reads the posts'
 * files, so it runs when requested, with the files traced into its function (next.config.mjs).
 */
export async function GET() {
  const posts = await Promise.all(
    publishedPosts().map(async (post) => ({
      slug: post.slug,
      url: absoluteUrl(post.url),
      title: post.title,
      description: post.description,
      tags: post.tags,
      markdown: crossPostMarkdown(post, await post.markdown()),
      source: createHash('sha256')
        .update(await post.source())
        .digest('hex'),
    })),
  );
  return Response.json({ posts });
}
