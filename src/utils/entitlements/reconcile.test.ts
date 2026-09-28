import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall, FakeTable } from '@/utils/testing/fake-supabase';
import { reconcileEntitlements } from './reconcile';

const github = vi.hoisted(() => ({ grantAccess: vi.fn(), hasAccess: vi.fn(), revokeAccess: vi.fn() }));
vi.mock('@/utils/github/provisioning', () => github);

const licences = vi.hoisted(() => ({ reconcileLicence: vi.fn() }));
vi.mock('@/utils/entitlements/customer-access', async (original) => ({
  ...(await original<object>()),
  reconcileLicence: licences.reconcileLicence,
}));

const state = vi.hoisted(() => ({ tables: {} as Record<string, FakeTable>, calls: [] as FakeCall[] }));

vi.mock('@/utils/supabase/server-internal', async () => {
  const { fakeSupabase } = await import('@/utils/testing/fake-supabase');
  return { createClient: async () => fakeSupabase(state.tables, state.calls) };
});

describe('reconcileEntitlements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.calls.length = 0;
    // An entitled customer with a linked GitHub account whose grant is still pending.
    state.tables = {
      customer_access: { list: [{ customer_id: 'ctm_1' }], single: { status: 'active' } },
      github_links: { single: { github_login: 'octocat' }, list: [] },
      customers: { single: { email: 'buyer@example.com' } },
      licences: { list: [] },
    };
    licences.reconcileLicence.mockResolvedValue('current');
  });

  afterEach(() => {
    delete process.env.PROVISIONING_MODE;
  });

  it('does not grant pending access when PROVISIONING_MODE is unset', async () => {
    const result = await reconcileEntitlements();

    expect(github.grantAccess).not.toHaveBeenCalled();
    expect(result.granted).toEqual([]);
  });

  it('grants pending access in automated mode, and records it only while the customer is entitled', async () => {
    process.env.PROVISIONING_MODE = 'auto';

    const result = await reconcileEntitlements();

    expect(github.grantAccess).toHaveBeenCalledWith('octocat');
    expect(result.granted).toEqual(['ctm_1']);
    expect(state.calls).toContainEqual({
      table: 'customer_access',
      method: 'in',
      args: ['status', ['active', 'grace']],
    });
  });

  it('removes a linked customer whose access has ended but who is still in the team', async () => {
    state.tables.customer_access = { list: [], single: { status: 'revoked' } };
    state.tables.github_links.list = [{ customer_id: 'ctm_1', github_login: 'octocat' }];
    github.hasAccess.mockResolvedValue(true);

    const result = await reconcileEntitlements();

    expect(github.revokeAccess).toHaveBeenCalledWith('octocat');
    expect(result.revoked).toEqual(['ctm_1']);
  });

  it('leaves a linked customer in the team while any of their subscriptions entitles them', async () => {
    state.tables.customer_access = { list: [], single: { status: 'grace' } };
    state.tables.github_links.list = [{ customer_id: 'ctm_1', github_login: 'octocat' }];
    github.hasAccess.mockResolvedValue(true);

    const result = await reconcileEntitlements();

    expect(github.revokeAccess).not.toHaveBeenCalled();
    expect(result.revoked).toEqual([]);
  });

  it('issues missing or out-of-date licences to entitled customers, only in automated mode', async () => {
    licences.reconcileLicence.mockResolvedValue('issued');

    expect((await reconcileEntitlements()).licencesIssued).toEqual([]);
    expect(licences.reconcileLicence).not.toHaveBeenCalled();

    process.env.PROVISIONING_MODE = 'auto';
    const result = await reconcileEntitlements();

    expect(licences.reconcileLicence).toHaveBeenCalledWith('ctm_1');
    expect(result.licencesIssued).toEqual(['ctm_1']);
  });

  it('reports database errors by their message', async () => {
    process.env.PROVISIONING_MODE = 'auto';
    licences.reconcileLicence.mockRejectedValue({ code: '08006', message: 'connection failure' });

    expect((await reconcileEntitlements()).errors).toContain('licence ctm_1: connection failure');
  });

  it('reports a licence that still cannot be issued', async () => {
    process.env.PROVISIONING_MODE = 'auto';
    licences.reconcileLicence.mockResolvedValue('failed');

    const result = await reconcileEntitlements();

    expect(result.licencesIssued).toEqual([]);
    expect(result.errors).toContain('licence ctm_1: issuance failed (see licence_failures)');
  });

  it('revokes live licences of a customer who is not entitled, whatever the provisioning mode', async () => {
    state.tables.customer_access = { list: [], single: { status: 'revoked' } };
    state.tables.licences = { list: [{ customer_id: 'ctm_1' }, { customer_id: 'ctm_1' }] };

    const result = await reconcileEntitlements();

    expect(result.licencesRevoked).toEqual(['ctm_1']);
    expect(state.calls).toContainEqual({ table: 'licences', method: 'update', args: [{ revoked: true }] });
  });

  it('keeps the licences of an entitled customer', async () => {
    state.tables.licences = { list: [{ customer_id: 'ctm_1' }] };

    const result = await reconcileEntitlements();

    expect(result.licencesRevoked).toEqual([]);
    expect(state.calls).not.toContainEqual(expect.objectContaining({ table: 'licences', method: 'update' }));
  });
});
