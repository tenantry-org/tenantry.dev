'use server';

import { createUserClient } from '@/utils/supabase/user-client';
import { siteOrigin } from '@/utils/site-origin';

interface FormData {
  email: string;
  password: string;
}

export type SignupResult = { sent: true } | { error: string };

// Supabase error codes the customer can act on; anything else gets the generic message.
const MESSAGES: Record<string, string> = {
  over_email_send_rate_limit: 'Too many sign-up emails were requested. Please wait a minute and try again.',
  over_request_rate_limit: 'Too many attempts. Please wait a minute and try again.',
  weak_password: 'Choose a stronger password: at least 8 characters.',
  email_address_invalid: 'Enter a valid email address.',
  validation_failed: 'Enter a valid email address and password.',
};

/**
 * Creates the account and sends the confirmation email. The link in it comes back through /auth/callback,
 * which signs the customer in and takes them to their Pro access page. Supabase answers an address that is
 * already registered as if it were new (so accounts cannot be discovered), and sends no email for it.
 */
export async function signup(data: FormData): Promise<SignupResult> {
  const supabase = await createUserClient();
  const { error } = await supabase.auth.signUp({
    ...data,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback?next=/dashboard/pro` },
  });

  if (error) {
    console.error('Sign-up failed:', error.code, error.message);
    return { error: (error.code && MESSAGES[error.code]) || 'Something went wrong. Please try again.' };
  }

  return { sent: true };
}
