import { llmsFullTxt } from '@/lib/docs-markdown';
import { markdownPages } from '@/lib/docs-pages';

// Every guide of the newest docs as one Markdown file, for AI agents, prerendered with the site.
export async function GET() {
  return new Response(llmsFullTxt(await markdownPages()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
