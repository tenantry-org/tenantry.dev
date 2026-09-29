import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOMER_BUSY, withCustomerLease } from './customer-lease';

const db = vi.hoisted(() => ({ grants: [] as (string | null)[], released: [] as string[] }));
vi.mock('@/utils/supabase/server-internal', () => ({
  createClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'acquire_customer_lease') return { data: db.grants.shift() ?? null, error: null };
      db.released.push(args.p_lease_id as string);
      return { data: null, error: null };
    },
  }),
}));

const noWait = { sleep: async () => {}, waitMs: 1_000, pollMs: 0 };

describe('withCustomerLease', () => {
  beforeEach(() => {
    db.grants = [];
    db.released = [];
  });

  it('runs the work holding the lease, then releases it', async () => {
    db.grants = ['lease_1'];
    const work = vi.fn(async () => {
      expect(db.released).toEqual([]);
      return 'done';
    });

    await expect(withCustomerLease('ctm_1', work, noWait)).resolves.toBe('done');
    expect(db.released).toEqual(['lease_1']);
  });

  it('waits for an event in progress to finish', async () => {
    db.grants = [null, null, 'lease_3'];

    await expect(withCustomerLease('ctm_1', async () => 'done', noWait)).resolves.toBe('done');
    expect(db.released).toEqual(['lease_3']);
  });

  it('gives up when the customer stays busy, running nothing', async () => {
    const work = vi.fn();

    await expect(withCustomerLease('ctm_1', work, { ...noWait, waitMs: 0 })).resolves.toBe(CUSTOMER_BUSY);
    expect(work).not.toHaveBeenCalled();
    expect(db.released).toEqual([]);
  });

  it('releases the lease when the work throws', async () => {
    db.grants = ['lease_1'];

    await expect(
      withCustomerLease(
        'ctm_1',
        async () => {
          throw new Error('GitHub unavailable');
        },
        noWait,
      ),
    ).rejects.toThrow('GitHub unavailable');
    expect(db.released).toEqual(['lease_1']);
  });
});
