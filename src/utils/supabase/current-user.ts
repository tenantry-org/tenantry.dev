import { cache } from 'react';
import { createClient } from '@/utils/supabase/server';

/** The signed-in user, or null. Cached per request, so a layout and its page share one lookup. */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
});
