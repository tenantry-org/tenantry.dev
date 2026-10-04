import { markdownDocument, markdownUrl } from '@/lib/docs-markdown';
import { latestUrl, markdownPage } from '@/lib/docs-pages';
import { docsVersionOf, slugsOutsidePublishedVersions } from '@/lib/docs-versions';
import { source } from '@/lib/source';
import { SITE_ORIGIN } from '@/constants/site';

// A docs page's Markdown, prerendered for every page. next.config.mjs serves it at the page's URL with `.md` on the
// end (/docs/core/tenant-stores.md). As the web pages do, a path under a docs version the site does not publish
// redirects to the same page's Markdown in the latest docs, and the canonical address is the latest web page.
export function generateStaticParams() {
  return source.generateParams();
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const page = source.getPage(slug);
  if (!page) {
    const latestSlugs = slugsOutsidePublishedVersions(slug);
    if (latestSlugs) {
      return new Response(null, { status: 307, headers: { Location: markdownUrl(latestUrl(latestSlugs)) } });
    }
    return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const canonical = docsVersionOf(page.slugs).latest ? page.url : latestUrl(page.slugs);
  return new Response(markdownDocument(await markdownPage(page)), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      Link: `<${new URL(canonical, SITE_ORIGIN)}>; rel="canonical"`,
    },
  });
}
