import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type FakeCall, type FakeTable, MAX_ROWS } from '@/test/fake-supabase';
import {
  deleteFeedDownloadsBefore,
  listFeedPackages,
  listPublishedReleases,
  listReleases,
  recordFeedDownload,
} from './package-feed';

// The queries the feed's store makes, against a fake client that, like the API, returns at most MAX_ROWS rows a
// request.
const state = vi.hoisted(() => ({
  tables: {} as Record<string, FakeTable>,
  calls: [] as FakeCall[],
}));
vi.mock('@/server/db/service-role-client', async () => {
  const { fakeSupabase } = await import('@/test/fake-supabase');
  return { createServiceRoleClient: () => fakeSupabase(state.tables, state.calls) };
});

const packageRow = (index: number) => ({
  package_id: `Tenantry.Pro.P${index}`,
  lower_id: `tenantry.pro.p${index}`,
  version: '1.4.0',
  storage_path: `tenantry.pro.p${index}/1.4.0/tenantry.pro.p${index}.1.4.0.nupkg`,
  description: null,
  authors: 'Tenantry',
  dependency_groups: [],
  pro_releases: {
    major: 1,
    minor: 4,
    patch: 0,
    rc: null,
    published_at: '2028-01-01T00:00:00Z',
    entitlement_at: '2028-01-01T00:00:00Z',
  },
});

beforeEach(() => {
  state.tables = {};
  state.calls.length = 0;
});

describe('listFeedPackages', () => {
  it('reads every package, beyond the API row limit, in pages in the primary key order', async () => {
    state.tables.pro_packages = { list: Array.from({ length: 2 * MAX_ROWS + 1 }, (_, index) => packageRow(index)) };

    const packages = await listFeedPackages();

    expect(packages).toHaveLength(2 * MAX_ROWS + 1);
    expect(new Set(packages.map((pkg) => pkg.lowerId)).size).toBe(2 * MAX_ROWS + 1);
    expect(state.calls.filter((call) => call.method === 'range').map((call) => call.args)).toEqual([
      [0, MAX_ROWS - 1],
      [MAX_ROWS, 2 * MAX_ROWS - 1],
      [2 * MAX_ROWS, 3 * MAX_ROWS - 1],
    ]);
    expect(state.calls.filter((call) => call.method === 'order').map((call) => call.args[0])).toEqual(
      Array.from({ length: 3 }, () => ['lower_id', 'version']).flat(),
    );
  });

  it('reads every package when the API returns fewer rows a request than a page asks for', async () => {
    state.tables.pro_packages = { list: Array.from({ length: 1200 }, (_, index) => packageRow(index)), maxRows: 500 };

    const packages = await listFeedPackages();

    expect(packages.map((pkg) => pkg.lowerId)).toEqual(
      Array.from({ length: 1200 }, (_, index) => `tenantry.pro.p${index}`),
    );
    expect(state.calls.filter((call) => call.method === 'range').map((call) => call.args[0])).toEqual([0, 500, 1000]);
  });

  it('reads one package id in one request, the count telling it there are no more', async () => {
    state.tables.pro_packages = { list: [packageRow(1)] };

    await expect(listFeedPackages('tenantry.pro.p1')).resolves.toEqual([
      expect.objectContaining({ packageId: 'Tenantry.Pro.P1', version: '1.4.0', rc: null }),
    ]);
    expect(state.calls.filter((call) => call.method === 'range')).toHaveLength(1);
    expect(state.calls).toContainEqual({ table: 'pro_packages', method: 'eq', args: ['lower_id', 'tenantry.pro.p1'] });
  });

  it('reads no packages in one request', async () => {
    await expect(listFeedPackages()).resolves.toEqual([]);
    expect(state.calls.filter((call) => call.method === 'range')).toHaveLength(1);
  });
});

const releaseRow = (index: number) => ({
  version: `1.${index}.0`,
  major: 1,
  minor: index,
  patch: 0,
  rc: null,
  published_at: '2028-01-01T00:00:00Z',
  security: false,
  entitlement_at: '2028-01-01T00:00:00Z',
  pro_packages: [{ package_id: 'Tenantry.Pro', size: 1000, sha512: 'abc=' }],
});

describe('listReleases', () => {
  it('reads every release, beyond the API row limit, in pages in the primary key order', async () => {
    state.tables.pro_releases = { list: Array.from({ length: 1200 }, (_, index) => releaseRow(index)), maxRows: 500 };

    const releases = await listReleases();

    expect(releases.map((release) => release.version)).toEqual(
      Array.from({ length: 1200 }, (_, index) => `1.${index}.0`),
    );
    expect(state.calls.filter((call) => call.method === 'range').map((call) => call.args[0])).toEqual([0, 500, 1000]);
    expect(state.calls.filter((call) => call.method === 'order').map((call) => call.args[0])).toEqual(
      Array.from({ length: 3 }, () => 'version'),
    );
  });
});

describe('listPublishedReleases', () => {
  it('reads every release, beyond the API row limit, in pages in version order', async () => {
    state.tables.pro_releases = { list: Array.from({ length: 1200 }, (_, index) => releaseRow(index)), maxRows: 500 };

    const releases = await listPublishedReleases();

    expect(releases.map((release) => release.version)).toEqual(
      Array.from({ length: 1200 }, (_, index) => `1.${index}.0`),
    );
    expect(state.calls.filter((call) => call.method === 'range').map((call) => call.args[0])).toEqual([0, 500, 1000]);
  });
});

describe('the download records', () => {
  it('records a download by its token, package and version, and the client network', async () => {
    await recordFeedDownload({
      tokenId: 'token-id',
      lowerId: 'tenantry.pro',
      version: '1.4.0',
      clientNetwork: '192.0.2.0/24',
    });

    expect(state.calls).toEqual([
      {
        table: 'feed_downloads',
        method: 'insert',
        args: [{ token_id: 'token-id', lower_id: 'tenantry.pro', version: '1.4.0', client_network: '192.0.2.0/24' }],
      },
    ]);
  });

  it('throws when the record cannot be written', async () => {
    state.tables.feed_downloads = { writeError: { code: '23503', message: 'no such package' } };

    await expect(
      recordFeedDownload({ tokenId: 'token-id', lowerId: 'tenantry.pro', version: '9.9.9', clientNetwork: null }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('deletes the records from before a time and says how many', async () => {
    state.tables.feed_downloads = { list: [{}, {}, {}] };

    await expect(deleteFeedDownloadsBefore(new Date('2026-08-02T04:00:00Z'))).resolves.toBe(3);
    expect(state.calls.map(({ method, args }) => [method, args])).toEqual([
      ['delete', [{ count: 'exact' }]],
      ['lt', ['downloaded_at', '2026-08-02T04:00:00.000Z']],
    ]);
  });
});
