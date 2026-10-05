import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { type FeedDeps, defaultFeedDeps } from '@/server/feed/deps';
import { parseNuspec, readRootFiles } from '@/server/feed/nupkg';
import { compareVersions, parseVersion } from '@/server/feed/version';

/**
 * Publishing a package to the feed (PackagePublish/2.0.0): what `dotnet nuget push --source <feed>/index.json
 * --api-key <key>` sends, a PUT of the .nupkg as multipart form data with the key in X-NuGet-ApiKey. Only the release
 * workflow holds the key; the server knows only its hash (FEED_PUBLISH_KEY_SHA256).
 *
 * A package is accepted if its id is Tenantry.Pro or Tenantry.Pro.*, in the casing it was first published with, its
 * version is major.minor.patch or a release candidate major.minor.patch-rc.N (version.ts), and that id and version are
 * not published yet. A release candidate is published and served like any release. Publishing the same package again
 * (the same bytes, by SHA-512) answers 409, which `dotnet nuget push --skip-duplicate` and scripts/feed-publish.sh
 * treat as done, so a release can be pushed again safely. A different package under an id and version already published
 * answers 400, which no client treats as done: a published version never changes. Its release is recorded with
 * the first of its packages (pro_releases). The release date is when that first package is published, unless the
 * package carries a `tenantry-release.json` at its root, which may give:
 *   releasedAt  the release's date (ISO 8601), such as the signed tag's date, for a release published later. It may
 *               be at most MAX_BACKDATE_DAYS before now, at most five minutes ahead, and not before any earlier
 *               version's date (in SemVer's order, a candidate before its release): otherwise a release could be dated
 *               under customers' vested dates and be served to them. It is ignored, and not checked, when the release
 *               is recorded already by another of its packages. Without it, a release is dated now, or as the newest
 *               earlier release if that is later.
 *   security    true for a security patch, recorded and listed to the operator. It changes no date: every patch
 *               release, a security fix or not, is dated for vesting as its minor's X.Y.0 release, which must be
 *               recorded first, by the release record's own rule. A release candidate is never a security patch.
 *
 * Packages are limited to 4 MB: a Vercel function takes a request body of at most 4.5 MB. Pro's packages are well
 * under 1 MB.
 */

const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;
/** How far before now a release may be dated: room for a release published some days after it was tagged. */
export const MAX_BACKDATE_DAYS = 3;
/**
 * How far after now: clock skew between the workflow and the site, and no more, since a later version may not be dated
 * before it.
 */
const MAX_FORWARD_DATE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PACKAGE_ID = /^Tenantry\.Pro(\.[A-Za-z0-9]+)*$/;

export async function handlePublish(request: Request, deps: FeedDeps = defaultFeedDeps): Promise<Response> {
  if (!isPublisher(request, deps)) return reply(403, 'A valid publish key is required.');

  let bytes: Uint8Array;
  try {
    const form = await request.formData();
    const file = [...form.values()].find((value): value is File => typeof value !== 'string');
    if (!file) return reply(400, 'The request carries no package.');
    if (file.size > MAX_PACKAGE_BYTES) return reply(413, 'The package is larger than 4 MB.');
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return reply(400, 'The request is not multipart form data.');
  }

  let files: Map<string, string>;
  let nuspec: ReturnType<typeof parseNuspec>;
  let manifest: { releasedAt?: unknown; security?: unknown };
  try {
    files = readRootFiles(bytes, (name) => name.toLowerCase().endsWith('.nuspec') || name === 'tenantry-release.json');
    const nuspecXml = [...files].find(([name]) => name.toLowerCase().endsWith('.nuspec'))?.[1];
    if (!nuspecXml) return reply(400, 'The package has no nuspec.');
    nuspec = parseNuspec(nuspecXml);
    manifest = files.has('tenantry-release.json') ? JSON.parse(files.get('tenantry-release.json')!) : {};
  } catch (error) {
    return reply(400, `The package cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  const version = parseVersion(nuspec.version);
  if (!PACKAGE_ID.test(nuspec.id)) return reply(400, `${nuspec.id} is not a Tenantry Pro package id.`);
  if (!version) {
    return reply(400, `${nuspec.version} is not a major.minor.patch version or a major.minor.patch-rc.N candidate.`);
  }

  const security = manifest.security === true;
  // Only a patch release can be a security patch; pro_releases' check would refuse it with a server error.
  if (security && (version.rc !== null || version.patch === 0)) {
    return reply(
      400,
      `${nuspec.version} cannot be a security patch: only a patch release (x.y.Z, Z above 0, not a release ` +
        'candidate) can.',
    );
  }
  const declaredDate = manifest.releasedAt === undefined ? null : new Date(String(manifest.releasedAt));
  if (declaredDate && Number.isNaN(declaredDate.getTime())) {
    return reply(400, 'tenantry-release.json has an invalid releasedAt.');
  }

  const lowerId = nuspec.id.toLowerCase();
  // NuGet ids are case-insensitive: one package, one casing, as it was first published.
  const recordedId = await deps.store.recordedPackageId(lowerId);
  if (recordedId !== null && recordedId !== nuspec.id) {
    return reply(400, `${nuspec.id} is published as ${recordedId}; use that casing.`);
  }
  const sha512 = createHash('sha512').update(bytes).digest();
  const duplicate = await duplicateReply(nuspec.id, nuspec.version, sha512.toString('base64'), deps);
  if (duplicate) return duplicate;

  const releases = await deps.store.listReleases();
  // A release already recorded (by another of its packages) keeps its date, so this package's is not checked.
  const releaseRecorded = releases.some((release) => release.version === nuspec.version);
  const newestEarlier = Math.max(
    ...releases
      .filter((release) => compareVersions(release, version) < 0)
      .map((release) => release.publishedAt.getTime()),
  );
  const now = deps.now().getTime();
  // Without a date of its own, a release is dated now, or as the release before it if that one's clock ran ahead.
  const releasedAt = declaredDate ?? new Date(Math.max(now, newestEarlier));

  if (!releaseRecorded && declaredDate) {
    if (releasedAt.getTime() < now - MAX_BACKDATE_DAYS * DAY_MS) {
      return reply(400, `tenantry-release.json's releasedAt is more than ${MAX_BACKDATE_DAYS} days before now.`);
    }
    if (releasedAt.getTime() > now + MAX_FORWARD_DATE_MS) {
      return reply(400, "tenantry-release.json's releasedAt is in the future.");
    }
    if (releasedAt.getTime() < newestEarlier) {
      return reply(
        400,
        `tenantry-release.json's releasedAt is before ${new Date(newestEarlier).toISOString()}, when an earlier ` +
          'version was released.',
      );
    }
  }

  try {
    const release = await deps.store.ensureRelease({
      version: nuspec.version,
      ...version,
      publishedAt: releasedAt.toISOString(),
      security,
    });
    if (release.security !== security) {
      return reply(
        400,
        `Release ${nuspec.version} is recorded ${release.security ? 'as' : 'as not'} a security patch.`,
      );
    }
  } catch (error) {
    // The release's trigger refuses a patch release whose X.Y.0 release is not recorded.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23503') {
      return reply(
        400,
        `Patch release ${nuspec.version} needs its ${version.major}.${version.minor}.0 published first.`,
      );
    }
    throw error;
  }

  // Stored at a path named by the package's own hash, never replacing a file: two concurrent publishes of one version
  // with different bytes store at two paths, the record's unique key picks one, and the recorded path always holds the
  // recorded bytes. The loser's file is left unreferenced.
  const storagePath = `${lowerId}/${nuspec.version}/sha512-${sha512.toString('hex')}/${lowerId}.${nuspec.version}.nupkg`;
  await deps.storage.storePackageFile(storagePath, bytes);

  const recorded = await deps.store.recordPackage({
    packageId: nuspec.id,
    version: nuspec.version,
    storagePath,
    size: bytes.byteLength,
    sha512: sha512.toString('base64'),
    nuspec: [...files].find(([name]) => name.toLowerCase().endsWith('.nuspec'))![1],
    description: nuspec.description,
    authors: nuspec.authors,
    dependencyGroups: nuspec.dependencyGroups,
  });
  // A concurrent push of the same version recorded first.
  if (!recorded) return (await duplicateReply(nuspec.id, nuspec.version, sha512.toString('base64'), deps))!;

  return reply(201, `Published ${nuspec.id} ${nuspec.version}.`);
}

/**
 * What the feed holds, for an operator (`GET /feed/v3/package` with the publish key in X-NuGet-ApiKey, as
 * scripts/feed-publish.sh list sends it): every release, oldest first, with its dates and its packages' sizes and
 * hashes. Customers' feed tokens cannot read it.
 */
export async function handlePublishedList(request: Request, deps: FeedDeps = defaultFeedDeps): Promise<Response> {
  if (!isPublisher(request, deps)) return reply(403, 'A valid publish key is required.');

  const releases = await deps.store.listPublishedReleases();
  return Response.json(
    {
      releases: releases.map((release) => ({
        version: release.version,
        publishedAt: release.publishedAt.toISOString(),
        security: release.security,
        entitlementAt: release.entitlementAt.toISOString(),
        packages: release.packages,
      })),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

// Whether the request carries the publish key whose SHA-256 is configured (FEED_PUBLISH_KEY_SHA256). Nothing is
// published or listed while none is configured.
function isPublisher(request: Request, deps: FeedDeps): boolean {
  const expected = deps.feedPublishKeySha256();
  const key = request.headers.get('x-nuget-apikey');
  return Boolean(expected && key && sameHash(createHash('sha256').update(key, 'utf8').digest('hex'), expected!));
}

// 409 when this package and version is published with these bytes, 400 when it is published with others, and null when
// it is not published.
async function duplicateReply(id: string, version: string, sha512: string, deps: FeedDeps): Promise<Response | null> {
  const recorded = await deps.store.recordedPackageHash(id.toLowerCase(), version);
  if (recorded === null) return null;
  if (recorded === sha512) return reply(409, `${id} ${version} is already published with the same content.`);
  return reply(
    400,
    `${id} ${version} is already published with different content. A published version never changes: publish a new ` +
      'version.',
  );
}

function sameHash(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function reply(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
