import type { MetadataRoute } from 'next';
import { absoluteUrl, publishedPosts } from '@/lib/blog';
import { source } from '@/lib/source';

// The public pages: the home page, the Pro page, the blog, the latest docs (an older version's pages name the latest as canonical)
// and the legal pages. Account, checkout and dashboard pages are not for search engines.
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ['/', '/pro', '/blog', '/legal/terms', '/legal/privacy', '/legal/refunds', '/legal/eula'];
  const docs = source
    .getPages()
    .map((page) => page.url)
    .filter((url) => !/^\/docs\/v\d/.test(url));

  return [
    ...pages.map((path) => ({ url: absoluteUrl(path) })),
    ...publishedPosts().map((post) => ({ url: absoluteUrl(post.url), lastModified: post.updated ?? post.date })),
    ...docs.map((url) => ({ url: absoluteUrl(url) })),
  ];
}
