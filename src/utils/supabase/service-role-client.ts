import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * The service-role client for server-side writes (webhooks, reconcile, account linking). It bypasses RLS,
 * so it must never carry a user's session: a client built from the request's cookies sends the signed-in
 * user's access token instead of the service-role key, and its writes then run as that user and fail RLS.
 * This one reads no cookies and keeps no session. Only modules under src/utils may import it (eslint.config.mjs).
 */
export function createServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
