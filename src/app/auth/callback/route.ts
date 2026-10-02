import { NextResponse } from 'next/server';
import { createUserClient } from '@/server/db/user-client';
import { syncGithubLinkForCurrentUser } from '@/server/billing/sync-github-link';
import { isLinkErrorCode, linkErrorPage } from '@/lib/link-errors';

// Linking GitHub holds the customer's lease, which must outlast this function (customer-lease.ts).
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createUserClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // If this OAuth round-trip carried a GitHub identity, record the link and grant access when
      // entitled. It never throws, so it cannot block sign-in; a link the portal must explain goes there.
      const { reason } = await syncGithubLinkForCurrentUser();
      if (isLinkErrorCode(reason)) return NextResponse.redirect(new URL(linkErrorPage(reason), origin));

      return NextResponse.redirect(nextPage(searchParams.get('next'), origin));
    }
  }

  // The link could not sign the user in: opened in another browser than the one that asked for it, used
  // twice, or expired. An email confirmation has still taken effect, so logging in works.
  return NextResponse.redirect(`${origin}/login?error=link`);
}

// Where the link continues after signing in: the `next` path the site put in it, or the home page. Anyone can
// write a link, so a `next` that leaves the site (`//evil.example`, `@evil.example`, a full URL) or is no URL at
// all (`//`) is ignored.
function nextPage(next: string | null, origin: string): URL {
  const home = new URL('/', origin);
  const page = next?.startsWith('/') ? URL.parse(next, origin) : null;
  return page?.origin === origin ? page : home;
}
