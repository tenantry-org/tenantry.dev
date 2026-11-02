'use server';

import { createUserClient } from '@/server/db/user-client';
import { serverConfig } from '@/server/config/server-config';
import { sitePath } from '@/lib/site-path';

interface FormData {
  email: string;
  password: string;
  /** Turnstile's token, when the site has a Turnstile site key (captcha.tsx). */
  captchaToken?: string;
}

export type SignupResult = { sent: true } | { error: string };

// Supabase error codes the customer can act on; anything else gets the generic message.
const MESSAGES: Record<string, string> = {
  over_email_send_rate_limit: 'Too many sign-up emails were requested. Please wait a minute and try again.',
  over_request_rate_limit: 'Too many attempts. Please wait a minute and try again.',
  // Supabase's own mailer sends only to the project team's addresses; custom SMTP lifts that (LAUNCH-SETUP §3).
  email_address_not_authorized:
    'We could not send a confirmation email to this address. Please try again later, or sign up with GitHub.',
  captcha_failed: 'The check that keeps out scripts did not pass. Please try again.',
  weak_password: 'Choose a stronger password: at least 8 characters.',
  email_address_invalid: 'Enter a valid email address.',
  validation_failed: 'Enter a valid email address and password.',
};

/**
 * Creates the account and sends the confirmation email. The link in it comes back through /auth/callback,
 * which signs the customer in and takes them to `next` when it is a page on the site, such as the checkout, or else
 * to their Pro access page. Supabase answers an address that is
 * already registered as if it were new (so accounts cannot be discovered), and sends no email for it.
 */
export async function signup({ email, password, captchaToken }: FormData, next?: string): Promise<SignupResult> {
  const page = sitePath(next) ?? '/dashboard/pro';
  const supabase = await createUserClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${serverConfig().siteUrl}/auth/callback?next=${encodeURIComponent(page)}`,
      captchaToken,
    },
  });

  if (error) {
    console.error('Sign-up failed:', error.code, error.message);
    return { error: (error.code && MESSAGES[error.code]) || 'Something went wrong. Please try again.' };
  }

  return { sent: true };
}
