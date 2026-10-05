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
 * Stores a package file at `path` unless a file is already there, which is kept: the publish step stores each package
 * at a path named by its SHA-512 (feed/publish.ts), so a file already there holds the same bytes. Never replacing a file
 * means a path, once recorded, always serves the bytes whose hash was recorded with it.
 */
export async function storePackageFile(path: string, bytes: Uint8Array): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage
    .from(PACKAGE_BUCKET)
    .upload(path, bytes, { contentType: 'application/octet-stream', upsert: false });

  if (error && isAlreadyStored(error)) return;
  if (error) throw error;
}

// Storage answers an upload to a path already stored with 409 (as statusCode; the HTTP status may be 400 or 409).
function isAlreadyStored(error: Error): boolean {
  const { status, statusCode } = error as Error & { status?: number; statusCode?: string };
  return status === 409 || statusCode === '409';
}
