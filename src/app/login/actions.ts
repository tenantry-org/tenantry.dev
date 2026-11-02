'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createUserClient } from '@/server/db/user-client';
import { serverConfig } from '@/server/config/server-config';
import { sitePath } from '@/lib/site-path';

interface FormData {
  email: string;
  password: string;
}

export type LoginResult = { error: string };

// Supabase error codes the customer can act on; anything else, such as Auth out of reach, gets the generic message
// rather than being reported as a wrong password. Supabase checks the password before it reports an unconfirmed
// address, so email_not_confirmed reveals nothing to someone without the password.
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Invalid email or password.',
  email_not_confirmed:
    'Confirm your email address first: open the link we sent, or sign up again with the same address to resend it.',
  over_request_rate_limit: 'Too many attempts. Please wait a minute and try again.',
  validation_failed: 'Enter a valid email address and password.',
};

/** Signs in, then continues to `next` when it is a page on the site, such as the checkout, or else the Pro page. */
export async function login(data: FormData, next?: string): Promise<LoginResult> {
  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithPassword(data);

  if (error) {
    console.error('Sign-in failed:', error.code, error.message);
    return { error: (error.code && MESSAGES[error.code]) || 'Something went wrong. Please try again.' };
  }

  revalidatePath('/', 'layout');
  redirect(sitePath(next) ?? '/dashboard/pro');
}

export async function signInWithGithub(next?: string) {
  const page = sitePath(next);
  const supabase = await createUserClient();
  const { data } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${serverConfig().siteUrl}/auth/callback${page ? `?next=${encodeURIComponent(page)}` : ''}`,
    },
  });
  if (data.url) {
    redirect(data.url);
  }
}
