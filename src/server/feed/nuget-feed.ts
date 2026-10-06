import 'server-only';
import { isIPv4, isIPv6 } from 'node:net';
import { canRestore, currentAccess, mayUseRelease } from '@/server/billing/entitlement-policy';
import type { FeedPackage } from '@/server/db/package-feed';
import { type FeedDeps, defaultFeedDeps } from '@/server/feed/deps';
import { feedTokenFrom, hashFeedToken, isFeedTokenShape } from '@/server/feed/feed-tokens';
import { compareVersions } from '@/server/feed/version';
import { FEED_PATH } from '@/lib/install-snippets';

/**
 * Tenantry Pro's NuGet v3 feed (https://learn.microsoft.com/en-us/nuget/api/overview), served under /feed/v3/ by the
 * route in src/app/feed/v3. It answers the read resources NuGet clients use, for each customer showing only the
 * releases they may use (entitlement-policy.ts: mayUseRelease): every release while they have access; after a lapse,
 * those their vested-through date covers (every patch release dated as its minor's X.Y.0); nothing for a lapsed
 * customer who never vested. Hidden versions are absent from the version lists, registrations and search, not only
 * refused on download, so a restore never resolves a version it cannot download. A release candidate (version.ts) is
 * served as any release published when it was; versions are listed in SemVer's order, a candidate before its release,
 * and NuGet restores a candidate only when the version or range asked for allows prereleases.
 *
 *   index.json                                   service index (no credentials needed)
 *   flat/{id}/index.json                         PackageBaseAddress/3.0.0: the versions
 *   flat/{id}/{version}/{id}.{version}.nupkg     the package: a redirect to a short-lived signed storage URL
 *   flat/{id}/{version}/{id}.nuspec              its manifest
 *   registration/{id}/index.json                 RegistrationsBaseUrl: metadata, every version inlined in one page
 *   registration/{id}/{version}.json             a registration leaf
 *   query                                        SearchQueryService/3.5.0
 *   package                                      PackagePublish/2.0.0 (publish.ts), for the release workflow
 *
 * Every package resource needs a feed token as the basic-auth password; without a live one the answer is 401 with a
 * Basic challenge, which makes NuGet send the credentials configured for the source. Responses are never cached by
 * anyone but the client: each customer's lists differ. Every request counts against the feed's rate limit
 * (rate-limit.ts), and each package download is recorded with its token (feed_downloads), kept for 90 days.
 */

/** How long a download's signed URL works. NuGet follows the redirect at once. */
export const DOWNLOAD_URL_SECONDS = 300;

export function feedBaseUrl(deps: FeedDeps): string {
  return `${deps.siteUrl()}${FEED_PATH}`;
}

/** Answers a GET (or HEAD, without the body) for `path`, the segments after /feed/v3/. */
export async function handleFeedRequest(
  request: Request,
  path: string[],
  deps: FeedDeps = defaultFeedDeps,
): Promise<Response> {
  const base = feedBaseUrl(deps);
  const [resource, ...rest] = path.map((segment) => segment.toLowerCase());

  if (path.length === 0 || (path.length === 1 && resource === 'index.json')) return json(serviceIndex(base));

  const token = feedTokenFrom(request);
  const found = token && isFeedTokenShape(token) ? await deps.store.findFeedCustomer(hashFeedToken(token)) : null;
  if (!found) return unauthorized(deps.siteUrl());
  const customer = { accessStatus: currentAccess(found.access, deps.now()).status, vestedThrough: found.vestedThrough };

  // A lapsed customer who never vested may restore nothing: say so, rather than claim the packages do not exist.
  if (!canRestore(customer)) {
    return text(
      403,
      "This feed token's Tenantry Pro subscription has ended and no releases are vested, so the feed serves nothing. " +
        `Subscribe again at ${deps.siteUrl()}/#pricing.`,
    );
  }

  if (resource === 'query' && rest.length === 0) {
    return json(search(base, visible(customer, await deps.store.listFeedPackages()), new URL(request.url)));
  }

  const [lowerId, ...file] = rest;
  if (!lowerId) return notFound();
  const packages = visible(customer, await deps.store.listFeedPackages(lowerId));
  if (packages.length === 0) return notFound();

  if (resource === 'flat') return flat(base, packages, file, { request, tokenId: found.tokenId }, deps);
  if (resource === 'registration') return registration(base, packages, file);

  return notFound();
}

/** The service index: the resources and where they are. */
export function serviceIndex(base: string) {
  const resource = (id: string, type: string, comment: string) => ({ '@id': id, '@type': type, comment });

  return {
    version: '3.0.0',
    resources: [
      resource(`${base}/flat/`, 'PackageBaseAddress/3.0.0', 'Package versions and content'),
      resource(`${base}/registration/`, 'RegistrationsBaseUrl', 'Package metadata'),
      resource(`${base}/registration/`, 'RegistrationsBaseUrl/3.6.0', 'Package metadata'),
      resource(`${base}/query`, 'SearchQueryService', 'Search'),
      resource(`${base}/query`, 'SearchQueryService/3.5.0', 'Search'),
      resource(`${base}/package`, 'PackagePublish/2.0.0', 'Publishing, for the release workflow only'),
    ],
  };
}

// The packages the customer may use, oldest version first.
function visible(customer: Parameters<typeof mayUseRelease>[0], packages: FeedPackage[]): FeedPackage[] {
  return packages.filter((pkg) => mayUseRelease(customer, pkg.entitlementAt)).sort(compareVersions);
}

async function flat(
  base: string,
  packages: FeedPackage[],
  file: string[],
  download: { request: Request; tokenId: string },
  deps: FeedDeps,
): Promise<Response> {
  const lowerId = packages[0].lowerId;

  if (file.length === 1 && file[0] === 'index.json') {
    return json({ versions: packages.map((pkg) => pkg.version) });
  }

  const [version, name] = file;
  const pkg = file.length === 2 ? packages.find((candidate) => candidate.version === version) : undefined;
  if (!pkg) return notFound();

  if (name === `${lowerId}.${version}.nupkg`) {
    const location = await deps.storage.signedDownloadUrl(pkg.storagePath, DOWNLOAD_URL_SECONDS);
    await recordDownload(download.tokenId, pkg, download.request, deps);
    return new Response(null, { status: 302, headers: { ...PRIVATE, Location: location } });
  }

  if (name === `${lowerId}.nuspec`) {
    const nuspec = await deps.store.readPackageNuspec(lowerId, version);
    if (nuspec === null) return notFound();
    return new Response(nuspec, { headers: { ...PRIVATE, 'Content-Type': 'application/xml; charset=utf-8' } });
  }

  return notFound();
}

function registration(base: string, packages: FeedPackage[], file: string[]): Response {
  const lowerId = packages[0].lowerId;
  const index = `${base}/registration/${lowerId}/index.json`;

  if (file.length === 1 && file[0] === 'index.json') {
    const lower = packages[0].version;
    const upper = packages[packages.length - 1].version;
    return json({
      count: 1,
      items: [
        {
          '@id': `${index}#page/${lower}/${upper}`,
          count: packages.length,
          items: packages.map((pkg) => registrationLeaf(base, pkg)),
          lower,
          upper,
          parent: index,
        },
      ],
    });
  }

  const pkg = file.length === 1 ? packages.find((candidate) => `${candidate.version}.json` === file[0]) : undefined;
  if (!pkg) return notFound();

  return json({
    '@id': leafUrl(base, pkg),
    listed: true,
    packageContent: contentUrl(base, pkg),
    published: pkg.publishedAt.toISOString(),
    registration: index,
  });
}

function registrationLeaf(base: string, pkg: FeedPackage) {
  const leaf = leafUrl(base, pkg);

  return {
    '@id': leaf,
    catalogEntry: {
      '@id': `${leaf}#catalogEntry`,
      id: pkg.packageId,
      version: pkg.version,
      authors: pkg.authors ?? '',
      description: pkg.description ?? '',
      listed: true,
      published: pkg.publishedAt.toISOString(),
      packageContent: contentUrl(base, pkg),
      dependencyGroups: pkg.dependencyGroups.map((group) => ({
        ...(group.targetFramework ? { targetFramework: group.targetFramework } : {}),
        dependencies: group.dependencies.map((dependency) => ({
          id: dependency.id,
          ...(dependency.range ? { range: dependency.range } : {}),
          // Only this feed's own packages are registered here; the others are on nuget.org.
          ...(/^tenantry\.pro(\.|$)/i.test(dependency.id)
            ? { registration: `${base}/registration/${dependency.id.toLowerCase()}/index.json` }
            : {}),
        })),
      })),
    },
    packageContent: contentUrl(base, pkg),
    registration: `${base}/registration/${pkg.lowerId}/index.json`,
  };
}

function leafUrl(base: string, pkg: FeedPackage): string {
  return `${base}/registration/${pkg.lowerId}/${pkg.version}.json`;
}

function contentUrl(base: string, pkg: FeedPackage): string {
  return `${base}/flat/${pkg.lowerId}/${pkg.version}/${pkg.lowerId}.${pkg.version}.nupkg`;
}

// Search over the six or so package ids: by id, case-insensitively. A release candidate's version (x.y.z-rc.N) is a
// prerelease, and SemVer 2.0.0 by its dotted label, so it is included only with prerelease=true and semVerLevel=2.0.0,
// as NuGet's search API has it; a package with nothing else is then left out.
function search(base: string, packages: FeedPackage[], url: URL) {
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const candidates =
    url.searchParams.get('prerelease')?.toLowerCase() === 'true' &&
    /^2(\.|$)/.test(url.searchParams.get('semVerLevel') ?? '');
  const skip = Math.max(0, Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0);
  const take = Math.min(100, Math.max(0, Number.parseInt(url.searchParams.get('take') ?? '20', 10) || 20));

  const byId = new Map<string, FeedPackage[]>();
  for (const pkg of packages) {
    if (query && !pkg.lowerId.includes(query)) continue;
    if (pkg.rc !== null && !candidates) continue;
    byId.set(pkg.lowerId, [...(byId.get(pkg.lowerId) ?? []), pkg]);
  }
  const results = [...byId.values()].sort((a, b) => a[0].lowerId.localeCompare(b[0].lowerId));

  return {
    totalHits: results.length,
    data: results.slice(skip, skip + take).map((versions) => {
      const latest = versions[versions.length - 1];
      return {
        id: latest.packageId,
        version: latest.version,
        description: latest.description ?? '',
        authors: latest.authors ?? '',
        registration: `${base}/registration/${latest.lowerId}/index.json`,
        totalDownloads: 0,
        packageTypes: [{ name: 'Dependency' }],
        versions: versions.map((pkg) => ({ version: pkg.version, downloads: 0, '@id': leafUrl(base, pkg) })),
      };
    }),
  };
}

// Records a download for the token. A record that cannot be written is logged and the download goes ahead: the record
// is for spotting a shared token, and a customer's restore matters more.
async function recordDownload(tokenId: string, pkg: FeedPackage, request: Request, deps: FeedDeps): Promise<void> {
  try {
    await deps.store.recordFeedDownload({
      tokenId,
      lowerId: pkg.lowerId,
      version: pkg.version,
      clientNetwork: clientNetwork(request),
    });
  } catch (error) {
    console.error('Package feed: a download could not be recorded:', error);
  }
}

/**
 * The client's network rather than its address: an IPv4 address's /24 or an IPv6 address's /48, from the address
 * Vercel gives in X-Real-IP (or the first in X-Forwarded-For). Null when there is none.
 */
export function clientNetwork(request: Request): string | null {
  const address = (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0] ??
    ''
  ).trim();
  const v4 = address.replace(/^::ffff:/i, '');
  if (isIPv4(v4)) return `${v4.split('.').slice(0, 3).join('.')}.0/24`;
  if (!isIPv6(address)) return null;

  // The eight 16-bit groups, with '::' expanded and a trailing dotted IPv4 part as its two groups.
  const parts = (side: string | undefined) =>
    (side ? side.split(':') : []).flatMap((part) => {
      if (!part.includes('.')) return [part];
      const [a, b, c, d] = part.split('.').map(Number);
      return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
    });
  const [head, tail] = address.split('::');
  const groups =
    tail === undefined
      ? parts(head)
      : [...parts(head), ...Array<string>(8 - parts(head).length - parts(tail).length).fill('0'), ...parts(tail)];
  return `${groups
    .slice(0, 3)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(':')}::/48`;
}

/**
 * Runs a feed handler and makes sure its answer, whatever it is, stays out of shared caches: a request over the rate
 * limit gets 429 without reaching the handler (or the database), a failure becomes a 500 without its details, and every
 * answer carries PRIVATE. The route wraps each method in it.
 */
export async function serveFeed(
  request: Request,
  handle: () => Promise<Response>,
  deps: FeedDeps = defaultFeedDeps,
): Promise<Response> {
  let response: Response;
  try {
    response = (await deps.rateLimited(request))
      ? text(429, 'Too many requests to the package feed from this address. Try again in a minute.', {
          'Retry-After': '60',
        })
      : await handle();
  } catch (error) {
    console.error('Package feed: the request failed:', error);
    response = text(500, 'The feed failed to answer. Try again shortly.');
  }

  for (const [name, value] of Object.entries(PRIVATE)) response.headers.set(name, value);
  return response;
}

// Each customer's answers differ, and the token is in the request: nothing may be cached for another request.
const PRIVATE = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: PRIVATE });
}

function text(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(message, {
    status,
    headers: { ...PRIVATE, 'Content-Type': 'text/plain; charset=utf-8', ...headers },
  });
}

function unauthorized(siteUrl: string): Response {
  const message =
    'Send a Tenantry Pro feed token as the password. ' +
    `Create one at ${siteUrl}/dashboard/pro; a revoked token is refused.`;
  return text(401, message, {
    'WWW-Authenticate': 'Basic realm="Tenantry Pro"',
  });
}

function notFound(): Response {
  return text(404, 'Not found.');
}
