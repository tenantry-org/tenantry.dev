import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { type FeedDeps, defaultFeedDeps } from '@/server/feed/deps';
import { parseNuspec, readRootFiles } from '@/server/feed/nupkg';

/**
 * Publishing a package to the feed (PackagePublish/2.0.0): what `dotnet nuget push --source <feed>/index.json
 * --api-key <key>` sends, a PUT of the .nupkg as multipart form data with the key in X-NuGet-ApiKey. Only the release
 * workflow holds the key; the server knows only its hash (FEED_PUBLISH_KEY_SHA256).
 *
 * A package is accepted if its id is Tenantry.Pro or Tenantry.Pro.*, its version is major.minor.patch, and that id and
 * version are not published yet (409 otherwise, which `--skip-duplicate` treats as done). Its release is recorded with
 * the first of its packages (pro_releases). The release date is when that first package is published, unless the
 * package carries a `tenantry-release.json` at its root, which may give:
 *   releasedAt  the release's date (ISO 8601), such as the signed tag's date, for a release published later. It may
 *               be at most MAX_BACKDATE_DAYS before now, not in the future, and not before any earlier version's
 *               date: otherwise a release could be dated under customers' vested dates and be served to them.
 *   security    true for a security patch, which the feed dates as its minor's X.Y.0 (recorded first) by the
 *               release record's own rule, whatever releasedAt says
 *
 * Packages are limited to 4 MB: a Vercel function takes a request body of at most 4.5 MB. Pro's packages are well
 * under 1 MB.
 */

const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;
/** How far before now a release may be dated: room for a release published some days after it was tagged. */
export const MAX_BACKDATE_DAYS = 3;
/** How far after now: clock skew between the workflow and the site. */
const MAX_FORWARD_DATE_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PACKAGE_ID = /^Tenantry\.Pro(\.[A-Za-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export async function handlePublish(request: Request, deps: FeedDeps = defaultFeedDeps): Promise<Response> {
  const expected = deps.feedPublishKeySha256();
  const key = request.headers.get('x-nuget-apikey');
  if (!expected || !key || !sameHash(createHash('sha256').update(key, 'utf8').digest('hex'), expected)) {
    return reply(403, 'A valid publish key is required.');
  }

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

  const version = VERSION.exec(nuspec.version);
  if (!PACKAGE_ID.test(nuspec.id)) return reply(400, `${nuspec.id} is not a Tenantry Pro package id.`);
  if (!version) return reply(400, `${nuspec.version} is not a major.minor.patch version.`);

  const releasedAt = manifest.releasedAt === undefined ? deps.now() : new Date(String(manifest.releasedAt));
  if (Number.isNaN(releasedAt.getTime())) return reply(400, 'tenantry-release.json has an invalid releasedAt.');
  const security = manifest.security === true;
  const now = deps.now();
  if (releasedAt.getTime() < now.getTime() - MAX_BACKDATE_DAYS * DAY_MS) {
    return reply(400, `tenantry-release.json's releasedAt is more than ${MAX_BACKDATE_DAYS} days before now.`);
  }
  if (releasedAt.getTime() > now.getTime() + MAX_FORWARD_DATE_MS) {
    return reply(400, "tenantry-release.json's releasedAt is in the future.");
  }

  const lowerId = nuspec.id.toLowerCase();
  if (await deps.store.packageExists(lowerId, nuspec.version)) {
    return reply(409, `${nuspec.id} ${nuspec.version} is already published.`);
  }

  const [major, minor, patch] = [Number(version[1]), Number(version[2]), Number(version[3])];
  const earlier = (await deps.store.listReleases()).filter(
    (release) =>
      release.major < major ||
      (release.major === major && (release.minor < minor || (release.minor === minor && release.patch < patch))),
  );
  const newestEarlier = Math.max(...earlier.map((release) => release.publishedAt.getTime()));
  if (releasedAt.getTime() < newestEarlier) {
    return reply(
      400,
      `tenantry-release.json's releasedAt is before ${new Date(newestEarlier).toISOString()}, when an earlier version ` +
        'was released.',
    );
  }

  try {
    const release = await deps.store.ensureRelease({
      version: nuspec.version,
      major,
      minor,
      patch,
      publishedAt: releasedAt.toISOString(),
      security,
    });
    if (release.security !== security) {
      return reply(
        409,
        `Release ${nuspec.version} is recorded ${release.security ? 'as' : 'as not'} a security patch.`,
      );
    }
  } catch (error) {
    // The release's trigger refuses a security patch whose X.Y.0 is not recorded.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23503') {
      return reply(400, `Security patch ${nuspec.version} needs its ${version[1]}.${version[2]}.0 published first.`);
    }
    throw error;
  }

  // Stored at a path named by the package's own hash, never replacing a file: two concurrent publishes of one version
  // with different bytes store at two paths, the record's unique key picks one, and the recorded path always holds the
  // recorded bytes. The loser's file is left unreferenced.
  const sha512 = createHash('sha512').update(bytes).digest();
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
  if (!recorded) return reply(409, `${nuspec.id} ${nuspec.version} is already published.`);

  return reply(201, `Published ${nuspec.id} ${nuspec.version}.`);
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
