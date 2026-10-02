import type { MetadataRoute } from 'next';
import { absoluteUrl, draftsShown } from '@/lib/blog';

// Search engines index the production site only; the sandbox and local builds, which show drafts, are disallowed.
export default function robots(): MetadataRoute.Robots {
  if (draftsShown()) return { rules: { userAgent: '*', disallow: '/' } };
  return { rules: { userAgent: '*', allow: '/' }, sitemap: absoluteUrl('/sitemap.xml') };
}
