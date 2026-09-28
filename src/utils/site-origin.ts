import { headers } from 'next/headers';

/** The public origin for links that leave and come back to the site (OAuth and email confirmation). */
export async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;

  const requestHeaders = await headers();
  const host = requestHeaders.get('host') ?? '';
  const proto = requestHeaders.get('x-forwarded-proto') ?? 'https';

  return host ? `${proto}://${host}` : '';
}
