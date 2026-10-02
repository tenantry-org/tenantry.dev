import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { serverConfig } from '@/server/config/server-config';

/**
 * The service-role client for server-side writes (webhooks, reconcile, account linking). It bypasses RLS,
 * so it must never carry a user's session: a client built from the request's cookies sends the signed-in
 * user's access token instead of the service-role key, and its writes then run as that user and fail RLS.
 * This one reads no cookies and keeps no session. Only the modules in src/server/db may import it (eslint.config.mjs).
 */
export function createServiceRoleClient(supabase = serverConfig().supabase) {
  return createClient<Database>(supabase.url, supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
