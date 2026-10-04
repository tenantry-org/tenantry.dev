import 'server-only';
import { createServiceRoleClient } from '@/server/db/service-role-client';

/**
 * The packages' storage: the private Supabase Storage bucket `pro-packages` (created by
 * supabase/migrations/20261004130000_package_feed.sql), which only the service role can read or write. The feed
 * redirects a download to a short-lived signed URL, so the package bytes never pass through a Vercel function. Another
 * store (S3, R2) can replace this by implementing the same two functions (src/server/feed/deps.ts: PackageStorage).
 */

export const PACKAGE_BUCKET = 'pro-packages';

/** A URL that downloads the stored file for `expiresInSeconds`, without credentials. */
export async function signedDownloadUrl(path: string, expiresInSeconds: number): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.storage.from(PACKAGE_BUCKET).createSignedUrl(path, expiresInSeconds);

  if (error) throw error;

  return data.signedUrl;
}

/**
 * Stores a package file. A file already at `path` is replaced: the publish step stores the file before recording the
 * package, and refuses a package already recorded, so a file without a record was never served (a publish that failed
 * part-way) and may be replaced by its retry.
 */
export async function storePackageFile(path: string, bytes: Uint8Array): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage
    .from(PACKAGE_BUCKET)
    .upload(path, bytes, { contentType: 'application/octet-stream', upsert: true });

  if (error) throw error;
}
