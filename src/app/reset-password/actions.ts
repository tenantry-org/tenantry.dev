'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createUserClient } from '@/server/db/user-client';

export type NewPasswordResult = { error: string };

const MESSAGES: Record<string, string> = {
  weak_password: 'Choose a stronger password: at least 8 characters.',
  same_password: 'Choose a password different from your current one.',
  reauthentication_needed: 'Your reset link has expired. Request a new one.',
};

/**
 * Sets a new password for the signed-in customer, who arrives here from a reset link (which signed them in)
 * or from their account. Without a session there is no one to update, so they are sent to request a link.
 */
export async function setNewPassword(password: string): Promise<NewPasswordResult> {
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/forgot-password?expired=1');

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error('Password update failed:', error.code, error.message);
    return { error: (error.code && MESSAGES[error.code]) || 'Something went wrong. Please try again.' };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard/pro');
}
