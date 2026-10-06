import { publishedPosts } from '@/lib/blog';
import { llmsTxt } from '@/lib/docs-markdown';
import { markdownPages } from '@/lib/docs-pages';
import { basePricesOrNull } from '@/server/integrations/paddle/get-base-prices';

// The newest docs for AI agents (https://llmstxt.org), with Pro's price as Paddle holds it: built when requested.
export async function GET() {
  const text = llmsTxt(await markdownPages(), publishedPosts(), await basePricesOrNull());
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
