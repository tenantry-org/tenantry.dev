import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { isLinkError, syncGithubLinkForCurrentUser } from '@/utils/github/sync-link';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // if "next" is in param, use it as the redirect URL
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // If this OAuth round-trip carried a GitHub identity, record the link and grant access when
      // entitled. It never throws, so it cannot block sign-in; a link the portal must explain goes there.
      const { reason } = await syncGithubLinkForCurrentUser();
      if (isLinkError(reason)) return NextResponse.redirect(`${origin}/dashboard/pro?error=${reason}`);

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // The link could not sign the user in: opened in another browser than the one that asked for it, used
  // twice, or expired. An email confirmation has still taken effect, so logging in works.
  return NextResponse.redirect(`${origin}/login?error=link`);
}
