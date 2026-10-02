'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createUserClient } from '@/utils/supabase/user-client';
import { siteOrigin } from '@/utils/site-origin';

interface FormData {
  email: string;
  password: string;
}
export async function login(data: FormData) {
  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithPassword(data);

  if (error) {
    return { error: true };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard/pro');
}

export async function signInWithGithub() {
  const supabase = await createUserClient();
  const { data } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${await siteOrigin()}/auth/callback`,
    },
  });
  if (data.url) {
    redirect(data.url);
  }
}
