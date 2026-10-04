import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedCustomer, FeedPackage } from '@/server/db/package-feed';
import type { FeedDeps, FeedStore } from './deps';
import { hashFeedToken } from './feed-tokens';
import { DOWNLOAD_URL_SECONDS, handleFeedRequest, serveFeed } from './nuget-feed';

// The feed's resources against an in-memory store: what each customer sees, the shape of each answer as the NuGet
// server API documents it (https://learn.microsoft.com/en-us/nuget/api/overview), and the headers that keep one
// customer's answers out of any shared cache. scripts/feed-e2e.sh runs a real `dotnet restore` against it.

const BASE = 'https://sandbox.example.com/feed/v3';

/** Tenantry.Pro 1.4.0, 1.4.1, a security patch 1.4.3 (dated as 1.4.0) and 1.6.0; Tenantry.Pro.EfCore 1.4.0. */
function release(
  id: string,
  version: string,
  publishedAt: string,
  entitlementAt = publishedAt,
  extra: Partial<FeedPackage> = {},
): FeedPackage {
  const [major, minor, patch] = version.split('.').map(Number);
  return {
    packageId: id,
    lowerId: id.toLowerCase(),
    version,
    major,
    minor,
    patch,
    publishedAt: new Date(publishedAt),
    entitlementAt: new Date(entitlementAt),
    storagePath: `${id.toLowerCase()}/${version}/${id.toLowerCase()}.${version}.nupkg`,
    description: `${id} ${version}`,
    authors: 'Tenantry',
    dependencyGroups: [],
    ...extra,
  };
}

const PACKAGES: FeedPackage[] = [
  release('Tenantry.Pro', '1.6.0', '2028-05-20T12:00:00Z'),
  release('Tenantry.Pro', '1.4.0', '2027-11-20T12:00:00Z'),
  release('Tenantry.Pro', '1.4.3', '2028-03-15T12:00:00Z', '2027-11-20T12:00:00Z'),
  release('Tenantry.Pro', '1.4.1', '2028-01-10T12:00:00Z'),
  release('Tenantry.Pro.EfCore', '1.4.0', '2027-11-20T12:00:00Z', undefined, {
    dependencyGroups: [
      {
        targetFramework: 'net9.0',
        dependencies: [
          { id: 'Tenantry.Pro', range: '[1.4.0, )' },
          { id: 'Microsoft.EntityFrameworkCore', range: '[9.0.0, )' },
        ],
      },
    ],
  }),
];

const CUSTOMERS: Record<string, FeedCustomer> = {
  active: { customerId: 'ctm_active', accessStatus: 'active', vestedThrough: null },
  grace: { customerId: 'ctm_grace', accessStatus: 'grace', vestedThrough: null },
  // Vested through the end of 2027: 1.4.0 and its security patch 1.4.3, not 1.4.1 (January 2028) or 1.6.0.
  vested: { customerId: 'ctm_vested', accessStatus: 'lapsed', vestedThrough: new Date('2028-01-01T00:00:00Z') },
  unvested: { customerId: 'ctm_unvested', accessStatus: 'lapsed', vestedThrough: null },
};

let store: { [K in keyof FeedStore]: ReturnType<typeof vi.fn> };
let deps: FeedDeps;

beforeEach(() => {
  store = {
    findFeedCustomer: vi.fn(async (hash: string) => {
      const name = Object.keys(CUSTOMERS).find((key) => hashFeedToken(`tpf_${key}`) === hash);
      return name ? CUSTOMERS[name] : null;
    }),
    listFeedPackages: vi.fn(async (lowerId?: string) =>
      PACKAGES.filter((pkg) => lowerId === undefined || pkg.lowerId === lowerId),
    ),
    readPackageNuspec: vi.fn(async (lowerId: string, version: string) => `<package>${lowerId} ${version}</package>`),
    createFeedTokenRecord: vi.fn(),
    revokeFeedTokenRecord: vi.fn(),
    ensureRelease: vi.fn(),
    recordPackage: vi.fn(),
    packageExists: vi.fn(),
    listReleases: vi.fn(),
    recordedPackageId: vi.fn(),
  };
  deps = {
    store: store as unknown as FeedStore,
    storage: {
      signedDownloadUrl: vi.fn(async (path: string) => `https://storage.example.com/signed/${path}?token=t`),
      storePackageFile: vi.fn(),
    },
    siteUrl: () => 'https://sandbox.example.com',
    feedPublishKeySha256: () => null,
    now: () => new Date('2028-06-01T00:00:00Z'),
  };
});

/** A request to the feed, with the customer's token as the basic-auth password (any username, as NuGet sends). */
function get(path: string, customer?: string, init: { authorization?: string } = {}) {
  const headers = new Headers();
  const authorization =
    init.authorization ??
    (customer ? `Basic ${Buffer.from(`anything:tpf_${customer}`).toString('base64')}` : undefined);
  if (authorization) headers.set('authorization', authorization);

  const url = new URL(`${BASE}/${path}`);
  const segments = url.pathname.replace('/feed/v3/', '').split('/').filter(Boolean);
  return handleFeedRequest(new Request(url, { headers }), segments, deps);
}

async function versions(customer: string, id = 'tenantry.pro') {
  const response = await get(`flat/${id}/index.json`, customer);
  return response.status === 200 ? ((await response.json()) as { versions: string[] }).versions : response.status;
}

describe('the service index', () => {
  it('lists the resources NuGet needs, at absolute URLs, without credentials', async () => {
    const response = await get('index.json');

    expect(response.status).toBe(200);
    const index = await response.json();
    expect(index.version).toBe('3.0.0');
    expect(index.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ '@id': `${BASE}/flat/`, '@type': 'PackageBaseAddress/3.0.0' }),
        expect.objectContaining({ '@id': `${BASE}/registration/`, '@type': 'RegistrationsBaseUrl/3.6.0' }),
        expect.objectContaining({ '@id': `${BASE}/registration/`, '@type': 'RegistrationsBaseUrl' }),
        expect.objectContaining({ '@id': `${BASE}/query`, '@type': 'SearchQueryService/3.5.0' }),
        expect.objectContaining({ '@id': `${BASE}/package`, '@type': 'PackagePublish/2.0.0' }),
      ]),
    );
    expect(store.findFeedCustomer).not.toHaveBeenCalled();
  });
});

describe('authentication', () => {
  it.each([
    ['no credentials', undefined],
    ['an unknown or revoked token', `Basic ${Buffer.from('user:tpf_revoked').toString('base64')}`],
    ['another scheme', 'Bearer tpf_active'],
  ])('challenges a request with %s', async (_, authorization) => {
    const response = await get('flat/tenantry.pro/index.json', undefined, { authorization });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Basic realm="Tenantry Pro"');
  });

  it('takes the token from the username when the password is empty', async () => {
    const response = await get('flat/tenantry.pro/index.json', undefined, {
      authorization: `Basic ${Buffer.from('tpf_active:').toString('base64')}`,
    });

    expect(response.status).toBe(200);
  });

  it('looks tokens up by their hash only', async () => {
    await get('flat/tenantry.pro/index.json', 'active');

    expect(store.findFeedCustomer).toHaveBeenCalledWith(hashFeedToken('tpf_active'));
  });
});

describe('what each customer sees', () => {
  it('shows a customer with access, or in grace, every version, oldest first', async () => {
    expect(await versions('active')).toEqual(['1.4.0', '1.4.1', '1.4.3', '1.6.0']);
    expect(await versions('grace')).toEqual(['1.4.0', '1.4.1', '1.4.3', '1.6.0']);
  });

  it('shows a lapsed vested customer the versions their date covers, with security patches to them', async () => {
    expect(await versions('vested')).toEqual(['1.4.0', '1.4.3']);
    expect(await versions('vested', 'tenantry.pro.efcore')).toEqual(['1.4.0']);
  });

  it('refuses a lapsed customer who never vested, saying why', async () => {
    for (const path of ['flat/tenantry.pro/index.json', 'registration/tenantry.pro/index.json', 'query']) {
      const response = await get(path, 'unvested');
      expect(response.status).toBe(403);
      expect(await response.text()).toContain('subscription that has ended');
    }
  });

  it('hides a version from the registration and search as well as the version list', async () => {
    const registration = await (await get('registration/tenantry.pro/index.json', 'vested')).json();
    expect(
      registration.items[0].items.map((leaf: { catalogEntry: { version: string } }) => leaf.catalogEntry.version),
    ).toEqual(['1.4.0', '1.4.3']);

    const search = await (await get('query?q=tenantry.pro', 'vested')).json();
    expect(
      search.data.map((result: { versions: { version: string }[] }) => result.versions.map((v) => v.version)),
    ).toEqual([['1.4.0', '1.4.3'], ['1.4.0']]);
  });

  it('answers 404 for a package with no version the customer may use, and for an unknown package', async () => {
    expect(await versions('vested', 'tenantry.pro.hangfire')).toBe(404);
    expect((await get('registration/tenantry.pro.hangfire/index.json', 'active')).status).toBe(404);
  });
});

describe('downloads', () => {
  it('redirects a download to a short-lived signed URL, finding the package in any case', async () => {
    const response = await get('flat/Tenantry.Pro/1.4.0/tenantry.pro.1.4.0.nupkg', 'vested');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://storage.example.com/signed/tenantry.pro/1.4.0/tenantry.pro.1.4.0.nupkg?token=t',
    );
    expect(deps.storage.signedDownloadUrl).toHaveBeenCalledWith(
      'tenantry.pro/1.4.0/tenantry.pro.1.4.0.nupkg',
      DOWNLOAD_URL_SECONDS,
    );
    expect(DOWNLOAD_URL_SECONDS).toBeLessThanOrEqual(300);
  });

  it('answers 404 for a version the customer may not use, without signing anything', async () => {
    const response = await get('flat/tenantry.pro/1.6.0/tenantry.pro.1.6.0.nupkg', 'vested');

    expect(response.status).toBe(404);
    expect(deps.storage.signedDownloadUrl).not.toHaveBeenCalled();
  });

  it('serves the nuspec of a version the customer may use', async () => {
    const response = await get('flat/tenantry.pro/1.4.0/tenantry.pro.nuspec', 'vested');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/xml');
    expect(await response.text()).toBe('<package>tenantry.pro 1.4.0</package>');
    expect((await get('flat/tenantry.pro/1.6.0/tenantry.pro.nuspec', 'vested')).status).toBe(404);
  });

  it('answers 404 for a file name that does not match the package', async () => {
    expect((await get('flat/tenantry.pro/1.4.0/tenantry.pro.efcore.1.4.0.nupkg', 'active')).status).toBe(404);
  });
});

describe('registration', () => {
  it('inlines every version in one page with the leaf, content and dependency details NuGet reads', async () => {
    const index = await (await get('registration/tenantry.pro.efcore/index.json', 'active')).json();

    expect(index).toEqual({
      count: 1,
      items: [
        {
          '@id': `${BASE}/registration/tenantry.pro.efcore/index.json#page/1.4.0/1.4.0`,
          count: 1,
          lower: '1.4.0',
          upper: '1.4.0',
          parent: `${BASE}/registration/tenantry.pro.efcore/index.json`,
          items: [
            {
              '@id': `${BASE}/registration/tenantry.pro.efcore/1.4.0.json`,
              packageContent: `${BASE}/flat/tenantry.pro.efcore/1.4.0/tenantry.pro.efcore.1.4.0.nupkg`,
              registration: `${BASE}/registration/tenantry.pro.efcore/index.json`,
              catalogEntry: {
                '@id': `${BASE}/registration/tenantry.pro.efcore/1.4.0.json#catalogEntry`,
                id: 'Tenantry.Pro.EfCore',
                version: '1.4.0',
                authors: 'Tenantry',
                description: 'Tenantry.Pro.EfCore 1.4.0',
                listed: true,
                published: '2027-11-20T12:00:00.000Z',
                packageContent: `${BASE}/flat/tenantry.pro.efcore/1.4.0/tenantry.pro.efcore.1.4.0.nupkg`,
                dependencyGroups: [
                  {
                    targetFramework: 'net9.0',
                    dependencies: [
                      {
                        id: 'Tenantry.Pro',
                        range: '[1.4.0, )',
                        registration: `${BASE}/registration/tenantry.pro/index.json`,
                      },
                      { id: 'Microsoft.EntityFrameworkCore', range: '[9.0.0, )' },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it('serves a registration leaf for a version the customer may use', async () => {
    const response = await get('registration/tenantry.pro/1.4.3.json', 'vested');

    expect(await response.json()).toEqual({
      '@id': `${BASE}/registration/tenantry.pro/1.4.3.json`,
      listed: true,
      packageContent: `${BASE}/flat/tenantry.pro/1.4.3/tenantry.pro.1.4.3.nupkg`,
      published: '2028-03-15T12:00:00.000Z',
      registration: `${BASE}/registration/tenantry.pro/index.json`,
    });
    expect((await get('registration/tenantry.pro/1.6.0.json', 'vested')).status).toBe(404);
  });
});

describe('search', () => {
  it('finds packages by id, with every visible version, and pages the results', async () => {
    const all = await (await get('query', 'active')).json();
    expect(all.totalHits).toBe(2);
    expect(all.data[0]).toMatchObject({
      id: 'Tenantry.Pro',
      version: '1.6.0',
      registration: `${BASE}/registration/tenantry.pro/index.json`,
      packageTypes: [{ name: 'Dependency' }],
    });
    expect(all.data[0].versions[0]).toEqual({
      version: '1.4.0',
      downloads: 0,
      '@id': `${BASE}/registration/tenantry.pro/1.4.0.json`,
    });

    expect((await (await get('query?q=EFCORE', 'active')).json()).data.map((r: { id: string }) => r.id)).toEqual([
      'Tenantry.Pro.EfCore',
    ]);
    expect((await (await get('query?skip=1&take=1', 'active')).json()).data.map((r: { id: string }) => r.id)).toEqual([
      'Tenantry.Pro.EfCore',
    ]);
  });
});

describe('caching', () => {
  it.each([
    ['index.json', undefined],
    ['flat/tenantry.pro/index.json', 'active'],
    ['flat/tenantry.pro/1.4.0/tenantry.pro.1.4.0.nupkg', 'active'],
    ['registration/tenantry.pro/index.json', 'vested'],
    ['query', 'active'],
    ['flat/tenantry.pro/index.json', 'unvested'],
    ['flat/tenantry.pro/index.json', undefined],
  ])('keeps %s out of shared caches, varying by credentials', async (path, customer) => {
    const response = await get(path, customer);

    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Authorization');
  });
});

describe('serveFeed', () => {
  it('answers a failure with 500, kept out of shared caches like every other answer', async () => {
    store.listFeedPackages.mockRejectedValue(new Error('database unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await serveFeed(() => get('flat/tenantry.pro/index.json', 'active'));

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Authorization');
    expect(await response.text()).not.toContain('database unavailable');
  });

  it('adds the headers to an answer that lacks them', async () => {
    const response = await serveFeed(async () => new Response('Not found.', { status: 404 }));

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Authorization');
  });
});
