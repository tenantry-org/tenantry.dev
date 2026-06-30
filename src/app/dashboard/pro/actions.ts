'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/utils/supabase/server';
import { syncGithubLinkForCurrentUser } from '@/utils/github/sync-link';

async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;

  const requestHeaders = await headers();
  const host = requestHeaders.get('host') ?? '';
  const proto = requestHeaders.get('x-forwarded-proto') ?? 'https';

  return host ? `${proto}://${host}` : '';
}

/**
 * Connects the customer's GitHub account.
 *
 * If they already authenticated via GitHub, the identity exists — we just (re)sync the link and grant.
 * Otherwise we start a GitHub OAuth identity-link, returning through /auth/callback which syncs.
 */
export async function connectGithub() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const alreadyHasGithub = user?.identities?.some((identity) => identity.provider === 'github');

  if (alreadyHasGithub) {
    await syncGithubLinkForCurrentUser();
    revalidatePath('/dashboard/pro');
    return;
  }

  const { data, error } = await supabase.auth.linkIdentity({
    provider: 'github',
    options: { redirectTo: `${await siteOrigin()}/auth/callback?next=/dashboard/pro` },
  });

  if (error) {
    console.error('Failed to start GitHub identity link:', error);
    redirect('/dashboard/pro?error=github-link');
  }

  if (data?.url) redirect(data.url);
}
