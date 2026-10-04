import { NextResponse } from 'next/server';
import { createUserClient } from '@/server/db/user-client';
import { sitePath } from '@/lib/site-path';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createUserClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Where the link continues: the `next` page the site put in it, or the home page.
      return NextResponse.redirect(new URL(sitePath(searchParams.get('next')) ?? '/', origin));
    }
  }

  // The link could not sign the user in: opened in another browser than the one that asked for it, used
  // twice, or expired. An email confirmation has still taken effect, so logging in works.
  return NextResponse.redirect(`${origin}/login?error=link`);
}
