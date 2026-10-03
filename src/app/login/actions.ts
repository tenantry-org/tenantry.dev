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
/** Signs in, then continues to `next` when it is a page on the site, such as the checkout, or else the Pro page. */
export async function login(data: FormData, next?: string) {
  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithPassword(data);

  if (error) {
    return { error: true };
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
