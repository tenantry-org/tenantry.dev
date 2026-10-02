'use server';

import { createUserClient } from '@/server/db/user-client';
import { serverConfig } from '@/server/config/server-config';

export type ResetRequestResult = { sent: true } | { error: string };

// Supabase error codes the customer can act on; anything else is answered as sent (see below).
const MESSAGES: Record<string, string> = {
  over_email_send_rate_limit: 'Too many reset emails were requested. Please wait a minute and try again.',
  over_request_rate_limit: 'Too many attempts. Please wait a minute and try again.',
  email_address_invalid: 'Enter a valid email address.',
  validation_failed: 'Enter a valid email address.',
};

/**
 * Emails a password reset link. The link comes back through /auth/callback, which signs the customer in and
 * takes them to /reset-password to choose a new password. The answer is the same whether or not an account
 * has the address, so accounts cannot be discovered.
 */
export async function requestPasswordReset(email: string): Promise<ResetRequestResult> {
  const supabase = await createUserClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${serverConfig().siteUrl}/auth/callback?next=/reset-password`,
  });

  if (error) {
    console.error('Password reset request failed:', error.code, error.message);
    const message = error.code ? MESSAGES[error.code] : undefined;
    if (message) return { error: message };
  }

  return { sent: true };
}
