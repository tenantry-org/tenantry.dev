import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/supabase/database.types';
import { serverConfig } from '@/server/config/server-config';

/**
 * The signed-in user's client: the anon key plus the session in the request's cookies, so row-level security
 * applies and every query runs as that user (or as anon, when nobody is signed in). For writes no user may make,
 * the server uses the service-role client (service-role-client.ts) instead.
 */
export async function createUserClient() {
  const cookieStore = await cookies();
  const { supabase } = serverConfig();

  return createServerClient<Database>(supabase.url, supabase.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  });
}
