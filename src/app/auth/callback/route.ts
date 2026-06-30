import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { syncGithubLinkForCurrentUser } from '@/utils/github/sync-link';

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
      // entitled. Best-effort: a failure here must not block sign-in.
      try {
        await syncGithubLinkForCurrentUser();
      } catch (syncError) {
        console.error('GitHub link sync failed after OAuth callback:', syncError);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
