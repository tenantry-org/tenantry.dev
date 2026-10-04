import { llmsTxt } from '@/lib/docs-markdown';
import { markdownPages } from '@/lib/docs-pages';

// The newest docs for AI agents (https://llmstxt.org), prerendered with the site.
export async function GET() {
  return new Response(llmsTxt(await markdownPages()), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
