import 'server-only';
import { createServiceRoleClient } from '@/server/db/service-role-client';
import type { Json } from '@/lib/supabase/database.types';
import type { Access, AccessStatus } from '@/server/db/billing-store';

/**
 * Service-role data access for the package feed (supabase/migrations/20261004130000_package_feed.sql): feed tokens,
 * the releases and their packages, and the private bucket the packages are stored in. The feed itself is
 * src/server/feed; this module only maps rows.
 */

/**
 * The customer a feed token belongs to, with what decides which releases they may restore: their access as stored
 * (entitlement-policy.ts: currentAccess says what it is now) and their vested-through date.
 */
export interface FeedCustomer {
  customerId: string;
  access: Access;
  vestedThrough: Date | null;
}

/** A dependency of a package, as its nuspec declares it, grouped by target framework. */
export interface DependencyGroup {
  targetFramework?: string;
  dependencies: { id: string; range?: string }[];
}

/** One package of a release, as the feed lists it. */
export interface FeedPackage {
  packageId: string;
  lowerId: string;
  version: string;
  major: number;
  minor: number;
  patch: number;
  publishedAt: Date;
  /** The date a vested customer's vested-through date is compared with (pro_releases.entitlement_at). */
  entitlementAt: Date;
  storagePath: string;
  description: string | null;
  authors: string | null;
  dependencyGroups: DependencyGroup[];
}

/** The customer a token's hash belongs to (`feed_customer`), or null for an unknown or revoked token. */
export async function findFeedCustomer(tokenHash: string): Promise<FeedCustomer | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('feed_customer', { p_token_hash: tokenHash });

  if (error) throw error;

  const row = data?.[0];
  return row
    ? {
        customerId: row.customer_id,
        access: {
          // active_subscriptions' check constraint allows only these; feed_customer gives 'lapsed' for no row.
          status: row.access_status as AccessStatus,
          // The function returns null outside grace and when nothing is vested; generated return types are never
          // nullable.
          graceEndsAt: (row.grace_ends_at as string | null) ? new Date(row.grace_ends_at) : null,
        },
        vestedThrough: (row.vested_through as string | null) ? new Date(row.vested_through) : null,
      }
    : null;
}

/** Every package of every release, or only those with this lowercased id. */
export async function listFeedPackages(lowerId?: string): Promise<FeedPackage[]> {
  const supabase = createServiceRoleClient();
  let query = supabase
    .from('pro_packages')
    .select(
      'package_id,lower_id,version,storage_path,description,authors,dependency_groups,pro_releases(major,minor,patch,published_at,entitlement_at)',
    );
  if (lowerId !== undefined) query = query.eq('lower_id', lowerId);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).flatMap((row) => {
    const release = row.pro_releases;
    if (!release) return [];
    return [
      {
        packageId: row.package_id,
        lowerId: row.lower_id,
        version: row.version,
        major: release.major,
        minor: release.minor,
        patch: release.patch,
        publishedAt: new Date(release.published_at),
        entitlementAt: new Date(release.entitlement_at),
        storagePath: row.storage_path,
        description: row.description,
        authors: row.authors,
        dependencyGroups: row.dependency_groups as unknown as DependencyGroup[],
      },
    ];
  });
}

/** A package's nuspec, or null if there is no such package. */
export async function readPackageNuspec(lowerId: string, version: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('pro_packages')
    .select('nuspec')
    .eq('lower_id', lowerId)
    .eq('version', version)
    .maybeSingle();

  if (error) throw error;

  return data?.nuspec ?? null;
}

/** Records a feed token's hash for the customer (`create_feed_token`, at most 10 live) and returns its id. */
export async function createFeedTokenRecord(token: {
  customerId: string;
  name: string;
  tokenHash: string;
  prefix: string;
}): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('create_feed_token', {
    p_customer_id: token.customerId,
    p_name: token.name,
    p_token_hash: token.tokenHash,
    p_prefix: token.prefix,
  });

  if (error) throw error;

  return data;
}

/** Revokes one of the customer's feed tokens (`revoke_feed_token`); false if it was not theirs or already revoked. */
export async function revokeFeedTokenRecord(customerId: string, tokenId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('revoke_feed_token', { p_customer_id: customerId, p_token_id: tokenId });

  if (error) throw error;

  return data === true;
}

/** A release as the publish step records it (pro_releases); its entitlement date is set by the database. */
export interface ReleaseRecord {
  version: string;
  major: number;
  minor: number;
  patch: number;
  publishedAt: string;
  security: boolean;
}

/**
 * The release with this version, recording it first if it is new. Returns whether it is a security patch as recorded,
 * which may differ from `release.security` if another package of the release recorded it first.
 */
export async function ensureRelease(release: ReleaseRecord): Promise<{ security: boolean }> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('pro_releases').upsert(
    {
      version: release.version,
      major: release.major,
      minor: release.minor,
      patch: release.patch,
      published_at: release.publishedAt,
      security: release.security,
      // Set by the pro_releases_entitlement_at trigger; the column is not null, so a value is needed here.
      entitlement_at: release.publishedAt,
    },
    { onConflict: 'version', ignoreDuplicates: true },
  );
  if (error) throw error;

  const { data, error: readError } = await supabase
    .from('pro_releases')
    .select('security')
    .eq('version', release.version)
    .single();
  if (readError) throw readError;

  return { security: data.security };
}

/** Every recorded release, with when it was published. */
export async function listReleases(): Promise<
  { version: string; major: number; minor: number; patch: number; publishedAt: Date }[]
> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from('pro_releases').select('version,major,minor,patch,published_at');

  if (error) throw error;

  return (data ?? []).map((row) => ({
    version: row.version,
    major: row.major,
    minor: row.minor,
    patch: row.patch,
    publishedAt: new Date(row.published_at),
  }));
}

/** A package file of a release, as the publish step records it. */
export interface PackageRecord {
  packageId: string;
  version: string;
  storagePath: string;
  size: number;
  sha512: string;
  nuspec: string;
  description: string | null;
  authors: string | null;
  dependencyGroups: DependencyGroup[];
}

/** Records a package; returns false if this package and version were recorded already. */
export async function recordPackage(record: PackageRecord): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('pro_packages').insert({
    lower_id: record.packageId.toLowerCase(),
    package_id: record.packageId,
    version: record.version,
    storage_path: record.storagePath,
    size: record.size,
    sha512: record.sha512,
    nuspec: record.nuspec,
    description: record.description,
    authors: record.authors,
    dependency_groups: record.dependencyGroups as unknown as NonNullable<Json>,
  });

  if (error?.code === '23505') return false;
  if (error) throw error;

  return true;
}

/** The id, as first recorded, of the package with this lowercased id, or null if none is recorded. */
export async function recordedPackageId(lowerId: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('pro_packages')
    .select('package_id')
    .eq('lower_id', lowerId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data?.package_id ?? null;
}

/** The base64 SHA-512 of this package and version as recorded, or null if it is not recorded. */
export async function recordedPackageHash(lowerId: string, version: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('pro_packages')
    .select('sha512')
    .eq('lower_id', lowerId)
    .eq('version', version)
    .maybeSingle();

  if (error) throw error;

  return data?.sha512 ?? null;
}

/** A release as an operator lists it, with its packages. */
export interface PublishedRelease {
  version: string;
  publishedAt: Date;
  security: boolean;
  entitlementAt: Date;
  packages: { id: string; size: number; sha512: string }[];
}

/** Every recorded release with its packages, oldest version first. */
export async function listPublishedReleases(): Promise<PublishedRelease[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('pro_releases')
    .select('version,major,minor,patch,published_at,security,entitlement_at,pro_packages(package_id,size,sha512)')
    .order('major')
    .order('minor')
    .order('patch');

  if (error) throw error;

  return (data ?? []).map((row) => ({
    version: row.version,
    publishedAt: new Date(row.published_at),
    security: row.security,
    entitlementAt: new Date(row.entitlement_at),
    packages: row.pro_packages
      .map((pkg) => ({ id: pkg.package_id, size: Number(pkg.size), sha512: pkg.sha512 }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  }));
}
