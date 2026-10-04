import { isPublished, markdownDocument } from '@/lib/docs-markdown';
import { markdownPage } from '@/lib/docs-pages';
import { source } from '@/lib/source';
import { SITE_ORIGIN } from '@/constants/site';

// A docs page's Markdown, prerendered for every page. next.config.mjs serves it at the page's URL with `.md` on the
// end (/docs/core/tenant-stores.md); the web page is its canonical address.
export function generateStaticParams() {
  return source.generateParams();
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const page = source.getPage(slug);
  if (!page || !isPublished(page.slugs)) {
    return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return new Response(markdownDocument(await markdownPage(page)), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      Link: `<${new URL(page.url, SITE_ORIGIN)}>; rel="canonical"`,
    },
  });
}
