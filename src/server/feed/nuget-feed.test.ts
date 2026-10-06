import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Payment, PaymentAdjustment } from '@/server/db/billing-store';
import type { FeedCustomer, FeedPackage } from '@/server/db/package-feed';
import { computeEntitlement } from '@/server/billing/entitlement-policy';
import type { FeedDeps, FeedStore } from './deps';
import { hashFeedToken } from './feed-tokens';
import { clientNetwork, DOWNLOAD_URL_SECONDS, handleFeedRequest, serveFeed } from './nuget-feed';
import { parseVersion } from './version';

// The feed's resources against an in-memory store: what each customer sees, the shape of each answer as the NuGet
// server API documents it (https://learn.microsoft.com/en-us/nuget/api/overview), and the headers that keep one
// customer's answers out of any shared cache. scripts/feed-e2e.sh runs a real `dotnet restore` against it.

const BASE = 'https://sandbox.example.com/feed/v3';

/**
 * Tenantry.Pro 1.4.0, its patches 1.4.1 and 1.4.3 (a security fix), both dated as 1.4.0 as pro_releases dates them,
 * and 1.6.0; Tenantry.Pro.EfCore 1.4.0.
 */
function release(
  id: string,
  version: string,
  publishedAt: string,
  entitlementAt = publishedAt,
  extra: Partial<FeedPackage> = {},
): FeedPackage {
  return {
    packageId: id,
    lowerId: id.toLowerCase(),
    version,
    ...parseVersion(version)!,
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
  release('Tenantry.Pro', '1.4.1', '2028-01-10T12:00:00Z', '2027-11-20T12:00:00Z'),
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

const lapsed = { status: 'lapsed', graceEndsAt: null } as const;
// Each customer's token id is tok_<name> (the store's fake adds it).
const CUSTOMERS: Record<string, Omit<FeedCustomer, 'tokenId'>> = {
  active: { customerId: 'ctm_active', access: { status: 'active', graceEndsAt: null }, vestedThrough: null },
  grace: {
    customerId: 'ctm_grace',
    access: { status: 'grace', graceEndsAt: new Date('2028-06-10T00:00:00Z') },
    vestedThrough: null,
  },
  // Vested through the end of 2027: 1.4.0 and its patches, though both were published in 2028, not 1.6.0.
  vested: { customerId: 'ctm_vested', access: lapsed, vestedThrough: new Date('2028-01-01T00:00:00Z') },
  unvested: { customerId: 'ctm_unvested', access: lapsed, vestedThrough: null },
  // Recorded in grace, but its grace ended before now and reconcile has not run since: lapsed, so vested only.
  graceOver: {
    customerId: 'ctm_grace_over',
    access: { status: 'grace', graceEndsAt: new Date('2028-05-31T00:00:00Z') },
    vestedThrough: new Date('2028-01-01T00:00:00Z'),
  },
  graceOverUnvested: {
    customerId: 'ctm_grace_over_unvested',
    access: { status: 'grace', graceEndsAt: new Date('2028-05-31T00:00:00Z') },
    vestedThrough: null,
  },
};

/** A well-formed feed token for a customer of CUSTOMERS. */
const tokenOf = (name: string) => `tpf_${name.padEnd(43, '0')}`;

let store: { [K in keyof FeedStore]: ReturnType<typeof vi.fn> };
let deps: FeedDeps;

beforeEach(() => {
  store = {
    findFeedCustomer: vi.fn(async (hash: string) => {
      const name = Object.keys(CUSTOMERS).find((key) => hashFeedToken(tokenOf(key)) === hash);
      return name ? { tokenId: `tok_${name}`, ...CUSTOMERS[name] } : null;
    }),
    listFeedPackages: vi.fn(async (lowerId?: string) =>
      PACKAGES.filter((pkg) => lowerId === undefined || pkg.lowerId === lowerId),
    ),
    readPackageNuspec: vi.fn(async (lowerId: string, version: string) => `<package>${lowerId} ${version}</package>`),
    createFeedTokenRecord: vi.fn(),
    revokeFeedTokenRecord: vi.fn(),
    ensureRelease: vi.fn(),
    recordPackage: vi.fn(),
    recordedPackageHash: vi.fn(),
    listPublishedReleases: vi.fn(),
    listReleases: vi.fn(),
    recordedPackageId: vi.fn(),
    recordFeedDownload: vi.fn(async () => undefined),
    deleteFeedDownloadsBefore: vi.fn(),
  };
  deps = {
    store: store as unknown as FeedStore,
    storage: {
      signedDownloadUrl: vi.fn(async (path: string) => `https://storage.example.com/signed/${path}?token=t`),
      storePackageFile: vi.fn(),
    },
    siteUrl: () => 'https://sandbox.example.com',
    feedPublishKeySha256: () => null,
    githubOidcKeys: vi.fn(),
    feedPublishActors: () => [],
    rateLimited: vi.fn(async () => false),
    now: () => new Date('2028-06-01T00:00:00Z'),
  };
});

/** The request serveFeed is given, which only the rate limit reads. */
const FEED_REQUEST = new Request(`${BASE}/flat/tenantry.pro/index.json`);

/** A request to the feed, with the customer's token as the basic-auth password (any username, as NuGet sends). */
function get(path: string, customer?: string, init: { authorization?: string; ip?: string } = {}) {
  const headers = new Headers(init.ip ? { 'x-real-ip': init.ip } : {});
  const authorization =
    init.authorization ??
    (customer ? `Basic ${Buffer.from(`anything:${tokenOf(customer)}`).toString('base64')}` : undefined);
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
  it('challenges a credential that is not shaped like a feed token without asking the database', async () => {
    for (const credential of ['tpf_short', 'the-licence-key', `${tokenOf('active')}x`, `tpf_${'!'.repeat(43)}`]) {
      const authorization = `Basic ${Buffer.from(`user:${credential}`).toString('base64')}`;
      expect((await get('flat/tenantry.pro/index.json', undefined, { authorization })).status).toBe(401);
    }
    expect(store.findFeedCustomer).not.toHaveBeenCalled();
  });

  it.each([
    ['no credentials', undefined],
    ['an unknown or revoked token', `Basic ${Buffer.from(`user:${tokenOf('revoked')}`).toString('base64')}`],
    ['another scheme', `Bearer ${tokenOf('active')}`],
  ])('challenges a request with %s', async (_, authorization) => {
    const response = await get('flat/tenantry.pro/index.json', undefined, { authorization });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Basic realm="Tenantry Pro"');
    expect(await response.text()).toBe(
      'Send a Tenantry Pro feed token as the password. Create one at https://sandbox.example.com/dashboard/pro; a ' +
        'revoked token is refused.',
    );
  });

  it('takes the token from the username when the password is empty', async () => {
    const response = await get('flat/tenantry.pro/index.json', undefined, {
      authorization: `Basic ${Buffer.from(`${tokenOf('active')}:`).toString('base64')}`,
    });

    expect(response.status).toBe(200);
  });

  it('looks tokens up by their hash only', async () => {
    await get('flat/tenantry.pro/index.json', 'active');

    expect(store.findFeedCustomer).toHaveBeenCalledWith(hashFeedToken(tokenOf('active')));
  });
});

describe('what each customer sees', () => {
  it('shows a customer with access, or in grace, every version, oldest first', async () => {
    expect(await versions('active')).toEqual(['1.4.0', '1.4.1', '1.4.3', '1.6.0']);
    expect(await versions('grace')).toEqual(['1.4.0', '1.4.1', '1.4.3', '1.6.0']);
  });

  it('shows a lapsed vested customer the versions their date covers, with every patch of them', async () => {
    expect(await versions('vested')).toEqual(['1.4.0', '1.4.1', '1.4.3']);
    expect(await versions('vested', 'tenantry.pro.efcore')).toEqual(['1.4.0']);
  });

  it('treats a grace period that has ended as lapsed, before reconcile records it', async () => {
    expect(await versions('graceOver')).toEqual(['1.4.0', '1.4.1', '1.4.3']);
    expect((await get('flat/tenantry.pro/index.json', 'graceOverUnvested')).status).toBe(403);
  });

  it('refuses a lapsed customer who never vested, saying why', async () => {
    for (const path of ['flat/tenantry.pro/index.json', 'registration/tenantry.pro/index.json', 'query']) {
      const response = await get(path, 'unvested');
      expect(response.status).toBe(403);
      expect(await response.text()).toBe(
        "This feed token's Tenantry Pro subscription has ended and no releases are vested, so the feed serves " +
          'nothing. Subscribe again at https://sandbox.example.com/#pricing.',
      );
    }
  });

  it('hides a version from the registration and search as well as the version list', async () => {
    const registration = await (await get('registration/tenantry.pro/index.json', 'vested')).json();
    expect(
      registration.items[0].items.map((leaf: { catalogEntry: { version: string } }) => leaf.catalogEntry.version),
    ).toEqual(['1.4.0', '1.4.1', '1.4.3']);

    const search = await (await get('query?q=tenantry.pro', 'vested')).json();
    expect(
      search.data.map((result: { versions: { version: string }[] }) => result.versions.map((v) => v.version)),
    ).toEqual([['1.4.0', '1.4.1', '1.4.3'], ['1.4.0']]);
  });

  it('serves an annual subscriber who cancelled a day into the term the releases of the term, until a refund or chargeback', async () => {
    // Paid yearly on 1 January 2028 and cancelled the next day with nothing refunded; now is 1 June 2028.
    const term: Payment = {
      transactionId: 'txn_year',
      subscriptionId: 'sub_year',
      priceId: 'pri_01year',
      billingInterval: 'year',
      billingFrequency: 1,
      periodStartsAt: new Date('2028-01-01T00:00:00Z'),
      periodEndsAt: new Date('2029-01-01T00:00:00Z'),
      charged: 39000,
      currencyCode: 'GBP',
    };
    const cancelled = {
      subscriptionId: 'sub_year',
      productId: 'pro_01',
      status: 'canceled',
      graceStartedAt: null,
      endedAt: new Date('2028-01-02T00:00:00Z'),
    };
    const returned = (action: string): PaymentAdjustment => ({
      adjustmentId: `adj_${action}`,
      transactionId: 'txn_year',
      action,
      type: 'full',
      itemTypes: ['full'],
      status: 'approved',
      approvedAt: new Date('2028-05-30T00:00:00Z'),
      reversedAt: null,
      amount: 39000,
      currencyCode: 'GBP',
    });
    const asStored = (adjustments: PaymentAdjustment[]): (typeof CUSTOMERS)[string] => {
      const entitlement = computeEntitlement({
        subscriptions: [cancelled],
        payments: [term],
        adjustments,
        proProductId: 'pro_01',
        offerPriceIds: ['pri_01month', 'pri_01year'],
        now: deps.now(),
      });
      return { customerId: 'ctm_annual', access: entitlement.access, vestedThrough: entitlement.vestedThrough };
    };

    CUSTOMERS.annual = asStored([]);
    // Every release so far: those from before the term, and 1.4.1 and 1.6.0, published in it after the cancellation.
    expect(await versions('annual')).toEqual(['1.4.0', '1.4.1', '1.4.3', '1.6.0']);
    expect((await get('flat/tenantry.pro/1.6.0/tenantry.pro.1.6.0.nupkg', 'annual')).status).toBe(302);

    for (const action of ['refund', 'chargeback']) {
      CUSTOMERS.annual = asStored([returned(action)]);
      expect((await get('flat/tenantry.pro/index.json', 'annual')).status).toBe(403);
      expect((await get('flat/tenantry.pro/1.4.1/tenantry.pro.1.4.1.nupkg', 'annual')).status).toBe(403);
    }
    delete CUSTOMERS.annual;
  });

  it('serves a customer whose paid time added up across a gap the releases published in the gap', async () => {
    // Six months in 2027 (1.4.0 came out in November), nothing in the first months of 2028, then six months from April
    // 2028: 12 months served on 1 October 2028, after which the customer lapses. 1.4.1 and 1.6.0 came out in the gap.
    const month = (start: string, subscriptionId: string, n: number): Payment => ({
      transactionId: `txn_${subscriptionId}_${n}`,
      subscriptionId,
      priceId: 'pri_01month',
      billingInterval: 'month',
      billingFrequency: 1,
      periodStartsAt: new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1 + n, 1)),
      periodEndsAt: new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) + n, 1)),
      charged: 3900,
      currencyCode: 'GBP',
    });
    const payments = [
      ...Array.from({ length: 6 }, (_, n) => month('2027-07', 'sub_a', n)),
      ...Array.from({ length: 6 }, (_, n) => month('2028-04', 'sub_b', n)),
    ];
    const ended = (subscriptionId: string, at: string) => ({
      subscriptionId,
      productId: 'pro_01',
      status: 'canceled',
      graceStartedAt: null,
      endedAt: new Date(at),
    });
    const entitlement = computeEntitlement({
      subscriptions: [ended('sub_a', '2028-01-01T00:00:00Z'), ended('sub_b', '2028-10-01T00:00:00Z')],
      payments,
      adjustments: [],
      proProductId: 'pro_01',
      offerPriceIds: ['pri_01month', 'pri_01year'],
      now: new Date('2028-11-01T00:00:00Z'),
    });
    CUSTOMERS.gap = { customerId: 'ctm_gap', access: entitlement.access, vestedThrough: entitlement.vestedThrough };

    expect(entitlement.vestedThrough).toEqual(new Date('2028-10-01T00:00:00Z'));
    expect(await versions('gap')).toEqual(['1.4.0', '1.4.1', '1.4.3', '1.6.0']);
    delete CUSTOMERS.gap;
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

describe('patch releases', () => {
  // 0.8.0 published in January, 0.9.0 in March and 0.8.3 in June, dated as 0.8.0 (pro_releases' entitlement date).
  const RELEASES: FeedPackage[] = [
    release('Tenantry.Pro', '0.8.0', '2027-01-10T12:00:00Z'),
    release('Tenantry.Pro', '0.9.0', '2027-03-10T12:00:00Z'),
    release('Tenantry.Pro', '0.8.3', '2027-06-10T12:00:00Z', '2027-01-10T12:00:00Z'),
  ];

  beforeEach(() => {
    store.listFeedPackages.mockImplementation(async (lowerId?: string) =>
      RELEASES.filter((pkg) => lowerId === undefined || pkg.lowerId === lowerId),
    );
  });

  it('serves every patch of a vested minor, published after the vested-through date or not, and nothing newer', async () => {
    // Vested through February: 0.8.0 is vested, 0.9.0 is not, and 0.8.3 is published after that date.
    CUSTOMERS.february = { customerId: 'ctm_feb', access: lapsed, vestedThrough: new Date('2027-02-01T00:00:00Z') };
    expect(await versions('february')).toEqual(['0.8.0', '0.8.3']);
    expect((await get('flat/tenantry.pro/0.8.3/tenantry.pro.0.8.3.nupkg', 'february')).status).toBe(302);
    expect((await get('flat/tenantry.pro/0.9.0/tenantry.pro.0.9.0.nupkg', 'february')).status).toBe(404);

    // Vested through December 2026: 0.8.0 is not vested, so neither is its patch.
    CUSTOMERS.december = { customerId: 'ctm_dec', access: lapsed, vestedThrough: new Date('2026-12-01T00:00:00Z') };
    expect(await versions('december')).toBe(404);
    expect((await get('flat/tenantry.pro/0.8.3/tenantry.pro.0.8.3.nupkg', 'december')).status).toBe(404);
    delete CUSTOMERS.february;
    delete CUSTOMERS.december;
  });
});

describe('release candidates', () => {
  // Tenantry.Pro 1.4.0, two candidates of 1.6.0 and then 1.6.0; Tenantry.Pro.Audit has only a candidate so far.
  const WITH_CANDIDATES: FeedPackage[] = [
    release('Tenantry.Pro', '1.6.0', '2028-05-20T12:00:00Z'),
    release('Tenantry.Pro', '1.6.0-rc.2', '2028-05-10T12:00:00Z'),
    release('Tenantry.Pro', '1.4.0', '2027-11-20T12:00:00Z'),
    release('Tenantry.Pro', '1.6.0-rc.1', '2028-05-01T12:00:00Z'),
    release('Tenantry.Pro.Audit', '1.7.0-rc.1', '2028-05-25T12:00:00Z'),
  ];

  beforeEach(() => {
    store.listFeedPackages.mockImplementation(async (lowerId?: string) =>
      WITH_CANDIDATES.filter((pkg) => lowerId === undefined || pkg.lowerId === lowerId),
    );
  });

  it('lists each candidate before its release, in SemVer order, in the version list and the registration', async () => {
    expect(await versions('active')).toEqual(['1.4.0', '1.6.0-rc.1', '1.6.0-rc.2', '1.6.0']);

    const registration = await (await get('registration/tenantry.pro/index.json', 'active')).json();
    expect(registration.items[0]).toMatchObject({ lower: '1.4.0', upper: '1.6.0', count: 4 });
    expect(
      registration.items[0].items.map((leaf: { catalogEntry: { version: string } }) => leaf.catalogEntry.version),
    ).toEqual(['1.4.0', '1.6.0-rc.1', '1.6.0-rc.2', '1.6.0']);
    expect(await versions('active', 'tenantry.pro.audit')).toEqual(['1.7.0-rc.1']);
  });

  it('serves a candidate, its leaf and its nuspec', async () => {
    const download = await get('flat/tenantry.pro/1.6.0-rc.2/tenantry.pro.1.6.0-rc.2.nupkg', 'active');
    expect(download.status).toBe(302);
    expect(download.headers.get('location')).toBe(
      'https://storage.example.com/signed/tenantry.pro/1.6.0-rc.2/tenantry.pro.1.6.0-rc.2.nupkg?token=t',
    );

    const leaf = await (await get('registration/tenantry.pro/1.6.0-rc.2.json', 'active')).json();
    expect(leaf.packageContent).toBe(`${BASE}/flat/tenantry.pro/1.6.0-rc.2/tenantry.pro.1.6.0-rc.2.nupkg`);
    expect(await (await get('flat/tenantry.pro/1.6.0-rc.2/tenantry.pro.nuspec', 'active')).text()).toBe(
      '<package>tenantry.pro 1.6.0-rc.2</package>',
    );
  });

  it('applies the vested-through date to a candidate as to any release published when it was', async () => {
    // Vested through 15 May 2028: both candidates of 1.6.0, not 1.6.0 itself.
    CUSTOMERS.vestedMay = {
      customerId: 'ctm_vested_may',
      access: lapsed,
      vestedThrough: new Date('2028-05-15T00:00:00Z'),
    };

    expect(await versions('vestedMay')).toEqual(['1.4.0', '1.6.0-rc.1', '1.6.0-rc.2']);
    expect((await get('flat/tenantry.pro/1.6.0/tenantry.pro.1.6.0.nupkg', 'vestedMay')).status).toBe(404);
    expect((await get('flat/tenantry.pro/1.6.0-rc.2/tenantry.pro.1.6.0-rc.2.nupkg', 'vestedMay')).status).toBe(302);
    delete CUSTOMERS.vestedMay;
  });

  it('leaves candidates out of search unless prerelease and SemVer 2.0.0 results are asked for', async () => {
    const ids = (body: { data: { id: string }[] }) => body.data.map((result) => result.id);
    const versionsOf = (body: { data: { versions: { version: string }[] }[] }) =>
      body.data.map((result) => result.versions.map((v) => v.version));

    for (const query of [
      'query',
      'query?prerelease=true',
      'query?semVerLevel=2.0.0',
      'query?prerelease=false&semVerLevel=2.0.0',
    ]) {
      const stable = await (await get(query, 'active')).json();
      expect(ids(stable)).toEqual(['Tenantry.Pro']);
      expect(stable.data[0].version).toBe('1.6.0');
      expect(versionsOf(stable)).toEqual([['1.4.0', '1.6.0']]);
    }

    const all = await (await get('query?prerelease=true&semVerLevel=2.0.0', 'active')).json();
    expect(ids(all)).toEqual(['Tenantry.Pro', 'Tenantry.Pro.Audit']);
    expect(all.data[0].version).toBe('1.6.0');
    expect(versionsOf(all)).toEqual([['1.4.0', '1.6.0-rc.1', '1.6.0-rc.2', '1.6.0'], ['1.7.0-rc.1']]);
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

    const response = await serveFeed(FEED_REQUEST, () => get('flat/tenantry.pro/index.json', 'active'), deps);

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Authorization');
    expect(await response.text()).not.toContain('database unavailable');
  });

  it('adds the headers to an answer that lacks them', async () => {
    const response = await serveFeed(FEED_REQUEST, async () => new Response('Not found.', { status: 404 }), deps);

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Authorization');
  });

  it('answers 429 to a request over the rate limit, before the handler looks a token up', async () => {
    vi.mocked(deps.rateLimited).mockResolvedValue(true);
    const handle = vi.fn(() => get('flat/tenantry.pro/index.json', 'active'));

    const response = await serveFeed(FEED_REQUEST, handle, deps);

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(deps.rateLimited).toHaveBeenCalledWith(FEED_REQUEST);
    expect(handle).not.toHaveBeenCalled();
    expect(store.findFeedCustomer).not.toHaveBeenCalled();
  });

  it('runs the handler for a request within the rate limit', async () => {
    const response = await serveFeed(FEED_REQUEST, () => get('flat/tenantry.pro/index.json', 'active'), deps);

    expect(response.status).toBe(200);
    expect(deps.rateLimited).toHaveBeenCalledWith(FEED_REQUEST);
  });
});

describe('download records', () => {
  it('records each download with its token, package, version and the client network', async () => {
    await get('flat/Tenantry.Pro/1.4.0/tenantry.pro.1.4.0.nupkg', 'vested', { ip: '203.0.113.77' });

    expect(store.recordFeedDownload).toHaveBeenCalledExactlyOnceWith({
      tokenId: 'tok_vested',
      lowerId: 'tenantry.pro',
      version: '1.4.0',
      clientNetwork: '203.0.113.0/24',
    });
  });

  it('records nothing for a version list, a nuspec or a refused download', async () => {
    await get('flat/tenantry.pro/index.json', 'active');
    await get('flat/tenantry.pro/1.4.0/tenantry.pro.nuspec', 'active');
    await get('flat/tenantry.pro/1.6.0/tenantry.pro.1.6.0.nupkg', 'vested');
    await get('flat/tenantry.pro/1.4.0/tenantry.pro.1.4.0.nupkg', 'unvested');

    expect(store.recordFeedDownload).not.toHaveBeenCalled();
  });

  it('still serves the download when the record cannot be written', async () => {
    store.recordFeedDownload.mockRejectedValue(new Error('database unavailable'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await get('flat/tenantry.pro/1.4.0/tenantry.pro.1.4.0.nupkg', 'active');

    expect(response.status).toBe(302);
    expect(logged).toHaveBeenCalledWith('Package feed: a download could not be recorded:', expect.any(Error));
  });
});

describe('clientNetwork', () => {
  const network = (headers: Record<string, string>) =>
    clientNetwork(new Request('https://sandbox.example.com/feed/v3/index.json', { headers }));

  it('keeps an IPv4 address’s /24 and an IPv6 address’s /48, never the address', () => {
    expect(network({ 'x-real-ip': '198.51.100.23' })).toBe('198.51.100.0/24');
    expect(network({ 'x-real-ip': '::ffff:198.51.100.23' })).toBe('198.51.100.0/24');
    expect(network({ 'x-real-ip': '2001:0db8:00a1:1234::5' })).toBe('2001:db8:a1::/48');
    expect(network({ 'x-real-ip': '2001:db8::1' })).toBe('2001:db8:0::/48');
    expect(network({ 'x-real-ip': '::1:2:3:4:192.0.2.1' })).toBe('0:0:1::/48');
    expect(network({ 'x-real-ip': '2001:db8:1:2:3:4:5:6' })).toBe('2001:db8:1::/48');
  });

  it('takes the first address of X-Forwarded-For without X-Real-IP, and gives null without an address', () => {
    expect(network({ 'x-forwarded-for': '192.0.2.9, 10.0.0.1' })).toBe('192.0.2.0/24');
    expect(network({})).toBeNull();
    expect(network({ 'x-real-ip': 'unknown' })).toBeNull();
  });
});
