import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type FakeCall, type FakeTable, MAX_ROWS } from '@/test/fake-supabase';
import { listFeedPackages } from './package-feed';

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
      [2 * MAX_ROWS + 1, 3 * MAX_ROWS],
    ]);
    expect(state.calls.filter((call) => call.method === 'order').map((call) => call.args[0])).toEqual(
      Array.from({ length: 4 }, () => ['lower_id', 'version']).flat(),
    );
  });

  it('reads every package when the API returns fewer rows a request than a page asks for', async () => {
    state.tables.pro_packages = { list: Array.from({ length: 1200 }, (_, index) => packageRow(index)), maxRows: 500 };

    const packages = await listFeedPackages();

    expect(packages.map((pkg) => pkg.lowerId)).toEqual(
      Array.from({ length: 1200 }, (_, index) => `tenantry.pro.p${index}`),
    );
    expect(state.calls.filter((call) => call.method === 'range').map((call) => call.args[0])).toEqual([
      0, 500, 1000, 1200,
    ]);
  });

  it('reads one package id, then finds no more', async () => {
    state.tables.pro_packages = { list: [packageRow(1)] };

    await expect(listFeedPackages('tenantry.pro.p1')).resolves.toEqual([
      expect.objectContaining({ packageId: 'Tenantry.Pro.P1', version: '1.4.0', rc: null }),
    ]);
    expect(state.calls.filter((call) => call.method === 'range')).toHaveLength(2);
    expect(state.calls).toContainEqual({ table: 'pro_packages', method: 'eq', args: ['lower_id', 'tenantry.pro.p1'] });
  });
});
