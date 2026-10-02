import { absoluteUrl, publishedPosts } from '@/lib/blog';

// The published posts as RSS 2.0, prerendered with the site.
export function GET() {
  const items = publishedPosts()
    .map(
      (post) => `    <item>
      <title>${escape(post.title)}</title>
      <link>${absoluteUrl(post.url)}</link>
      <guid isPermaLink="true">${absoluteUrl(post.url)}</guid>
      <description>${escape(post.description)}</description>
      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>
${post.tags.map((tag) => `      <category>${escape(tag)}</category>`).join('\n')}
    </item>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Tenantry blog</title>
    <link>${absoluteUrl('/blog')}</link>
    <atom:link href="${absoluteUrl('/blog/rss.xml')}" rel="self" type="application/rss+xml" />
    <description>Articles on multi-tenancy in .NET.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}

function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
