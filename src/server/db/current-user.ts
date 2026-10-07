import 'server-only';
import { cache } from 'react';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { createUserClient } from '@/server/db/user-client';

/**
 * The signed-in user, or null. Cached per request, so a layout and its page share one lookup. Auth being unreachable
 * throws rather than reading as signed out, so a page shows the error page (app/error.tsx) and an action reports a
 * failure. The site header and the checkout pages catch it and show what a signed-out visitor sees.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.getUser();

  if (error && isAuthRetryableFetchError(error)) throw error;

  return data.user;
});
