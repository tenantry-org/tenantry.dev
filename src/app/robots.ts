import type { MetadataRoute } from 'next';
import { absoluteUrl, draftsShown } from '@/lib/blog';

// Pages for a signed-in customer or a step of signing in or paying, and the API: not for any crawler.
const PRIVATE = [
  '/api/',
  '/auth/',
  '/checkout',
  '/dashboard',
  '/pay',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/error',
];

/**
 * AI crawlers and the agents that fetch a page for a user, each as its vendor documents it: OpenAI
 * (developers.openai.com/api/docs/bots), Anthropic (support.claude.com, article 8896518), Perplexity
 * (docs.perplexity.ai/guides/bots), Google (Google-Extended, in its list of common crawlers), Apple
 * (support.apple.com/en-us/119829) and Common Crawl (commoncrawl.org/ccbot). Allowed by name, so the docs are read
 * by the assistants developers ask; a crawler follows only the group that names it, so each group lists PRIVATE too.
 */
const AI_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
];

// Search engines and AI crawlers read the production site only; the sandbox and local builds, which show drafts, are
// disallowed for every crawler.
export default function robots(): MetadataRoute.Robots {
  if (draftsShown()) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE },
      { userAgent: AI_AGENTS, allow: '/', disallow: PRIVATE },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
