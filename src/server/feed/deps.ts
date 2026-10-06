import 'server-only';
import type { JWTVerifyGetKey } from 'jose';
import * as packageFeed from '@/server/db/package-feed';
import { signedDownloadUrl, storePackageFile } from '@/server/db/package-storage';
import { serverConfig } from '@/server/config/server-config';
import { githubOidcKeys } from '@/server/feed/github-oidc';
import { feedRateLimited } from '@/server/feed/rate-limit';

/** The feed's tables (db/package-feed.ts). */
export type FeedStore = typeof packageFeed;

/**
 * Where the packages' files are stored (db/package-storage.ts: a private Supabase Storage bucket). Anything that can
 * store a file without ever replacing one, and hand out a short-lived download URL for it, can replace it.
 */
export interface PackageStorage {
  signedDownloadUrl: (path: string, expiresInSeconds: number) => Promise<string>;
  storePackageFile: (path: string, bytes: Uint8Array) => Promise<void>;
}

/**
 * What the feed uses beyond its own rules: the feed's tables, the package storage, the site's origin (the feed's URLs
 * are absolute), who may publish (the publish key's hash, GitHub's OIDC signing keys and the release managers' logins)
 * and the rate limit. The handlers take it as their last argument, and the real ones by default; the tests pass fakes.
 */
export interface FeedDeps {
  store: FeedStore;
  storage: PackageStorage;
  siteUrl: () => string;
  feedPublishKeySha256: () => string | null;
  githubOidcKeys: JWTVerifyGetKey;
  feedPublishActors: () => string[];
  rateLimited: (request: Request) => Promise<boolean>;
  now: () => Date;
}

export const defaultFeedDeps: FeedDeps = {
  store: packageFeed,
  storage: { signedDownloadUrl, storePackageFile },
  // Read when a request is handled, never while a module loads (the build loads them without a configuration).
  siteUrl: () => serverConfig().siteUrl,
  feedPublishKeySha256: () => serverConfig().feedPublishKeySha256,
  githubOidcKeys,
  feedPublishActors: () => serverConfig().feedPublishActors,
  rateLimited: feedRateLimited,
  now: () => new Date(),
};
