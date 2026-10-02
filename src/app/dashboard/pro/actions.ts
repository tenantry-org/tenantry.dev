'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createUserClient } from '@/server/db/user-client';
import { isLinkError, syncGithubLinkForCurrentUser } from '@/server/billing/sync-github-link';
import { serverConfig } from '@/server/config/server-config';

/**
 * Connects the customer's GitHub account.
 *
 * If they already authenticated via GitHub, the identity exists — we just (re)sync the link and grant.
 * Otherwise we start a GitHub OAuth identity-link, returning through /auth/callback which syncs.
 */
export async function connectGithub() {
  const supabase = await createUserClient();
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

  await startGithubLink(supabase);
}

/**
 * Moves the customer's access to another GitHub account. The login's GitHub identity is disconnected and a new
 * one linked through GitHub, which signs in whichever account the browser is signed in to there. Access stays
 * with the previous account until the new one is linked: /auth/callback then removes the previous account and
 * grants the new one (sync-github-link.ts). If the customer abandons the switch, the previous account keeps access and
 * the Access page offers Connect GitHub again.
 *
 * A login that signs in only with GitHub cannot disconnect it (Supabase keeps at least one identity), so it is
 * asked to set a password first.
 */
export async function switchGithubAccount() {
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.getUserIdentities();

  if (error) {
    console.error('Failed to read the identities of the login:', error);
    redirect('/dashboard/pro?error=github-link');
  }

  const identities = data?.identities ?? [];
  const github = identities.find((identity) => identity.provider === 'github');

  if (github) {
    if (identities.length < 2) redirect('/dashboard/pro?error=github-only-sign-in');

    const { error: unlinkError } = await supabase.auth.unlinkIdentity(github);
    if (unlinkError) {
      console.error('Failed to disconnect the GitHub identity:', unlinkError);
      redirect('/dashboard/pro?error=github-link');
    }
  }

  await startGithubLink(supabase);
}

// Starts a GitHub OAuth identity link, which returns through /auth/callback.
async function startGithubLink(supabase: Awaited<ReturnType<typeof createUserClient>>) {
  const { data, error } = await supabase.auth.linkIdentity({
    provider: 'github',
    options: { redirectTo: `${serverConfig().siteUrl}/auth/callback?next=/dashboard/pro` },
  });

  if (error) {
    console.error('Failed to start GitHub identity link:', error);
    redirect('/dashboard/pro?error=github-link');
  }

  if (data?.url) redirect(data.url);
}
