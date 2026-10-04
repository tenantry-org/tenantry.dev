import 'server-only';
import { isEntitled, mayUseRelease } from '@/server/billing/entitlement-policy';
import type { FeedCustomer, FeedPackage } from '@/server/db/package-feed';
import { type FeedDeps, defaultFeedDeps } from '@/server/feed/deps';
import { feedTokenFrom, hashFeedToken } from '@/server/feed/feed-tokens';

/**
 * Tenantry Pro's NuGet v3 feed (https://learn.microsoft.com/en-us/nuget/api/overview), served under /feed/v3/ by the
 * route in src/app/feed/v3. It answers the read resources NuGet clients use, for each customer showing only the
 * releases they may use (entitlement-policy.ts: mayUseRelease): every release while they have access; after a lapse,
 * those their vested-through date covers (a security patch dated as its minor's X.Y.0); nothing for a lapsed customer
 * who never vested. Hidden versions are absent from the version lists, registrations and search, not only refused on
 * download, so a restore never resolves a version it cannot download.
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
 * anyone but the client: each customer's lists differ.
 */

/** How long a download's signed URL works. NuGet follows the redirect at once. */
export const DOWNLOAD_URL_SECONDS = 300;

const FEED_PATH = '/feed/v3';

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
  const customer = token ? await deps.store.findFeedCustomer(hashFeedToken(token)) : null;
  if (!customer) return unauthorized();

  // A lapsed customer who never vested may restore nothing: say so, rather than claim the packages do not exist.
  if (!isEntitled(customer.accessStatus) && customer.vestedThrough === null) {
    return text(
      403,
      'This feed token belongs to a Tenantry Pro subscription that has ended, with no releases licensed after it.',
    );
  }

  if (resource === 'query' && rest.length === 0) {
    return json(search(base, visible(customer, await deps.store.listFeedPackages()), new URL(request.url)));
  }

  const [lowerId, ...file] = rest;
  if (!lowerId) return notFound();
  const packages = visible(customer, await deps.store.listFeedPackages(lowerId));
  if (packages.length === 0) return notFound();

  if (resource === 'flat') return flat(base, packages, file, deps);
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
function visible(customer: FeedCustomer, packages: FeedPackage[]): FeedPackage[] {
  return packages
    .filter((pkg) => mayUseRelease(customer, pkg.entitlementAt))
    .sort((a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch);
}

async function flat(base: string, packages: FeedPackage[], file: string[], deps: FeedDeps): Promise<Response> {
  const lowerId = packages[0].lowerId;

  if (file.length === 1 && file[0] === 'index.json') {
    return json({ versions: packages.map((pkg) => pkg.version) });
  }

  const [version, name] = file;
  const pkg = file.length === 2 ? packages.find((candidate) => candidate.version === version) : undefined;
  if (!pkg) return notFound();

  if (name === `${lowerId}.${version}.nupkg`) {
    const location = await deps.storage.signedDownloadUrl(pkg.storagePath, DOWNLOAD_URL_SECONDS);
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

// Search over the six or so package ids: by id, case-insensitively; every release is stable, so `prerelease` and
// `semVerLevel` change nothing.
function search(base: string, packages: FeedPackage[], url: URL) {
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const skip = Math.max(0, Number.parseInt(url.searchParams.get('skip') ?? '0', 10) || 0);
  const take = Math.min(100, Math.max(0, Number.parseInt(url.searchParams.get('take') ?? '20', 10) || 20));

  const byId = new Map<string, FeedPackage[]>();
  for (const pkg of packages) {
    if (query && !pkg.lowerId.includes(query)) continue;
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

function unauthorized(): Response {
  return text(401, 'A live Tenantry Pro feed token is required as the password.', {
    'WWW-Authenticate': 'Basic realm="Tenantry Pro"',
  });
}

function notFound(): Response {
  return text(404, 'Not found.');
}
