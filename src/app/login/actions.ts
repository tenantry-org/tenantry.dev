'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createUserClient } from '@/server/db/user-client';
import { serverConfig } from '@/server/config/server-config';
import { sitePath } from '@/lib/site-path';

interface FormData {
  email: string;
  password: string;
  /** Turnstile's token, when the site has a Turnstile site key (captcha.tsx). */
  captchaToken?: string;
}

/**
 * Signs in, then continues to `next` when it is a page on the site, such as the checkout, or else the Pro page. A
 * failure answers with a message for the customer; it says the same for a wrong password and an unknown address.
 */
export async function login({ email, password, captchaToken }: FormData, next?: string): Promise<{ error: string }> {
  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });

  if (error) {
    return {
      error:
        error.code === 'captcha_failed'
          ? 'The check that keeps out scripts did not pass. Please try again.'
          : 'Invalid email or password',
    };
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
