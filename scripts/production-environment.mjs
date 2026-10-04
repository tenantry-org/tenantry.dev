/**
 * What identifies production, for the checks that keep everything else off it: the server's configuration
 * (src/server/config/server-config.ts) and the operator scripts that write to a database (scripts/rehearse.mjs).
 */

/** Production's Supabase project. A sandbox server, and a rehearsal, must never use it. */
export const PRODUCTION_SUPABASE_URL = 'https://xoqqgenzhqefyeyzahim.supabase.co';
