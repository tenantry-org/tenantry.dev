'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/utils/supabase/server';
import { isLinkError, syncGithubLinkForCurrentUser } from '@/utils/github/sync-link';
import { siteOrigin } from '@/utils/site-origin';

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
    const { reason } = await syncGithubLinkForCurrentUser();
    if (isLinkError(reason)) redirect(`/dashboard/pro?error=${reason}`);
    revalidatePath('/dashboard/pro', 'layout'); // Access, Install and Billing all show this customer's state
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
