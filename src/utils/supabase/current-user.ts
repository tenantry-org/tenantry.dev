import 'server-only';
import { cache } from 'react';
import { createUserClient } from '@/utils/supabase/user-client';

/** The signed-in user, or null. Cached per request, so a layout and its page share one lookup. */
export const getCurrentUser = cache(async () => {
  const supabase = await createUserClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
});
