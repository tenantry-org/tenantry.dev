import { Webhooks } from '@paddle/paddle-node-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaddleEventJson } from '@/utils/webhooks/inbox';
import { subscriptionEvent } from '@/utils/testing/paddle-events';
import { memory } from '@/utils/testing/memory-entitlements';
import { ProcessWebhook } from './process-webhook';

const state = vi.hoisted(() => ({
  lastEventAt: new Map<string, string>(),
  rpcError: null as { code: string; message: string } | null,
}));

// Stands in for record_subscription_event: applies an event unless a newer one was applied already.
vi.mock('@/utils/supabase/server-internal', () => ({
  createClient: async () => ({
    rpc: async (_name: string, args: Record<string, string>) => {
      if (state.rpcError) return { data: null, error: state.rpcError };
      const last = state.lastEventAt.get(args.p_subscription_id);
      if (last && new Date(last) > new Date(args.p_occurred_at)) return { data: false, error: null };
      state.lastEventAt.set(args.p_subscription_id, args.p_occurred_at);
      return { data: true, error: null };
    },
  }),
}));

const effects = vi.hoisted(() => ({ grantAccess: vi.fn(), revokeAccess: vi.fn(), sendEmail: vi.fn() }));
vi.mock('@/utils/github/provisioning', () => ({
  grantAccess: effects.grantAccess,
  revokeAccess: effects.revokeAccess,
}));
vi.mock('@/utils/entitlements/entitlements-store', async () => {
  const { memory } = await import('@/utils/testing/memory-entitlements');
  return memory.store;
});
vi.mock('@/utils/email/send', () => ({ sendEmail: effects.sendEmail }));
vi.mock('@/utils/licensing/licence-issuer', () => ({
  issueLicence: ({ tier, expiresAt }: { tier: string; expiresAt: Date }) => `${tier}:${expiresAt.toISOString()}`,
}));
vi.mock('@/utils/provisioning-guard', () => ({ provisioningAllowed: () => true }));
vi.mock('@/constants/tier-mapping', () => ({ resolveTier: () => 'pro' }));

function delivered(event: PaddleEventJson) {
  return Webhooks.fromJson(event as unknown as Parameters<typeof Webhooks.fromJson>[0]);
}

function emailSubjects(): string[] {
  return effects.sendEmail.mock.calls.map(([message]) => message.subject);
}

const WELCOME = 'Welcome to Tenantry Pro — connect GitHub to get access';
const ENDED = 'Your Tenantry Pro subscription has ended';

const created = subscriptionEvent({
  eventId: 'evt_created',
  eventType: 'subscription.created',
  occurredAt: '2026-09-28T11:00:00Z',
  status: 'active',
});
const earlierUpdate = subscriptionEvent({
  eventId: 'evt_update',
  occurredAt: '2026-09-28T11:30:00Z',
  status: 'active',
});
const cancelled = subscriptionEvent({
  eventId: 'evt_cancel',
  eventType: 'subscription.canceled',
  occurredAt: '2026-09-28T12:00:00Z',
  status: 'canceled',
});

describe('ProcessWebhook', () => {
  const processor = new ProcessWebhook();

  beforeEach(() => {
    vi.clearAllMocks();
    state.lastEventAt.clear();
    state.rpcError = null;
    memory.reset();
    memory.state.emails.set('ctm_01', 'buyer@example.com');
    memory.state.githubLogins.set('ctm_01', 'octocat');
  });

  it('keeps a cancelled subscription revoked when an older update is delivered after the cancellation', async () => {
    await processor.processEvent(delivered(created));
    await processor.processEvent(delivered(cancelled));

    expect(effects.revokeAccess).toHaveBeenCalledWith('octocat');
    expect(memory.state.access.get('ctm_01')?.status).toBe('revoked');
    vi.clearAllMocks();

    await processor.processEvent(delivered(earlierUpdate));

    expect(memory.state.entitlements.get('sub_01')?.status).toBe('revoked');
    expect(memory.state.access.get('ctm_01')?.status).toBe('revoked');
    expect(memory.liveLicences('ctm_01')).toEqual([]);
    expect(effects.grantAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  it('applies the same events in order: access granted, then revoked', async () => {
    await processor.processEvent(delivered(earlierUpdate));
    expect(effects.grantAccess).toHaveBeenCalledWith('octocat');
    expect(memory.liveLicences('ctm_01')).toHaveLength(1);

    await processor.processEvent(delivered(cancelled));
    expect(effects.revokeAccess).toHaveBeenCalledWith('octocat');
    expect(memory.state.access.get('ctm_01')?.status).toBe('revoked');
    expect(memory.liveLicences('ctm_01')).toEqual([]);
    expect(emailSubjects()).toEqual([WELCOME, ENDED]);
  });

  it('keeps a customer with two subscriptions in the team, with a licence, when one is cancelled', async () => {
    const second = { subscriptionId: 'sub_02', periodEndsAt: '2026-10-15T00:00:00Z' };
    await processor.processEvent(delivered(created));
    await processor.processEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_created_2',
          eventType: 'subscription.created',
          occurredAt: '2026-09-28T11:10:00Z',
          status: 'active',
          ...second,
        }),
      ),
    );

    // Access started once, with the first subscription.
    expect(effects.grantAccess).toHaveBeenCalledOnce();
    expect(emailSubjects()).toEqual([WELCOME]);
    vi.clearAllMocks();

    await processor.processEvent(delivered(cancelled));

    expect(memory.state.entitlements.get('sub_01')?.status).toBe('revoked');
    expect(memory.state.access.get('ctm_01')).toEqual({ status: 'active', tier: 'pro', githubGranted: true });
    expect(effects.revokeAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
    expect(memory.liveLicences('ctm_01').at(-1)).toMatchObject({
      tier: 'pro',
      expiresAt: new Date(second.periodEndsAt),
    });

    // Access ends with the last subscription.
    await processor.processEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_cancel_2',
          eventType: 'subscription.canceled',
          occurredAt: '2026-09-28T12:10:00Z',
          status: 'canceled',
          ...second,
        }),
      ),
    );

    expect(effects.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_01')).toEqual({ status: 'revoked', tier: null, githubGranted: false });
    expect(memory.liveLicences('ctm_01')).toEqual([]);
    expect(emailSubjects()).toEqual([ENDED]);
  });

  it('fails a subscription event whose customer is not recorded yet, so the worker retries it', async () => {
    state.rpcError = {
      code: '23503',
      message: 'violates foreign key constraint "public_subscriptions_customer_id_fkey"',
    };

    await expect(processor.processEvent(delivered(earlierUpdate))).rejects.toMatchObject({ code: '23503' });
    expect(memory.state.entitlements.size).toBe(0);
    expect(effects.grantAccess).not.toHaveBeenCalled();
  });
});
