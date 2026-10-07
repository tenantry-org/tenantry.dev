'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/db/current-user';
import { createUserClient } from '@/server/db/user-client';

export type NewPasswordResult = { error: string };

const FAILED = 'Something went wrong. Please try again.';

const MESSAGES: Record<string, string> = {
  weak_password: 'Choose a stronger password: at least 8 characters.',
  same_password: 'Choose a password different from your current one.',
  reauthentication_needed: 'Your reset link has expired. Request a new one.',
};

/**
 * Sets a new password for the signed-in customer, who arrives here from a reset link (which signed them in)
 * or from their account. Without a session there is no one to update, so they are sent to request a link. Auth out of
 * reach is reported as a failure to retry, not as an expired link.
 */
export async function setNewPassword(password: string): Promise<NewPasswordResult> {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch (error) {
    console.error('Reading the signed-in user failed:', error);
    return { error: FAILED };
  }
  if (!user) redirect('/forgot-password?expired=1');

  const supabase = await createUserClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error('Password update failed:', error.code, error.message);
    return { error: (error.code && MESSAGES[error.code]) || FAILED };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard/pro');
}
