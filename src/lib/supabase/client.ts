import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/supabase/database.types';
import { publicConfig } from '@/lib/public-config';

export function createClient() {
  const { url, anonKey } = publicConfig().supabase;
  return createBrowserClient<Database>(url, anonKey);
}
