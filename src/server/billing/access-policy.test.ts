import { describe, expect, it } from 'vitest';
import type { EntitlementRecord } from '@/server/db/billing-store';
import { aggregateAccess, entitlementFor } from './access-policy';

const NOVEMBER = new Date('2026-11-01T00:00:00Z');

function entitlement(overrides: Partial<EntitlementRecord> = {}): EntitlementRecord {
  return {
    customerId: 'ctm_1',
    subscriptionId: 'sub_1',
    status: 'active',
    currentPeriodEndsAt: NOVEMBER,
    graceStartedAt: null,
    ...overrides,
  };
}

describe('aggregateAccess', () => {
  it('is revoked when no subscription entitles the customer', () => {
    expect(aggregateAccess([])).toBe('revoked');
    expect(aggregateAccess([entitlement({ status: 'revoked' })])).toBe('revoked');
  });

  it('is active if any subscription is active, and grace if the only entitled ones are in grace', () => {
    expect(aggregateAccess([entitlement({ status: 'grace' }), entitlement({ status: 'revoked' })])).toBe('grace');
    expect(aggregateAccess([entitlement({ status: 'grace' }), entitlement({ status: 'active' })])).toBe('active');
  });

  it('counts a subscription in grace until its grace period ends', () => {
    // The renewal on 1 October fails; grace ends 30 days later.
    const grace = entitlement({ status: 'grace', graceStartedAt: new Date('2026-10-01T00:00:00Z') });
    const graceEnds = new Date('2026-10-31T00:00:00Z');

    expect(aggregateAccess([grace], new Date('2026-10-30T23:59:59Z'))).toBe('grace');
    expect(aggregateAccess([grace], graceEnds)).toBe('revoked');
    expect(aggregateAccess([grace, entitlement({ subscriptionId: 'sub_2' })], graceEnds)).toBe('active');
  });
});

describe('entitlementFor', () => {
  const PAST_DUE = new Date('2026-10-01T00:05:00Z');

  it('starts grace at the first past-due event and keeps that start', () => {
    expect(entitlementFor('past_due', null, PAST_DUE)).toEqual({ status: 'grace', graceStartedAt: PAST_DUE });
    expect(entitlementFor('past_due', PAST_DUE, new Date('2026-10-08T00:05:00Z'))).toEqual({
      status: 'grace',
      graceStartedAt: PAST_DUE,
    });
  });

  it('entitles an active or trialing subscription, and ends grace', () => {
    expect(entitlementFor('active', PAST_DUE, NOVEMBER)).toEqual({ status: 'active', graceStartedAt: null });
    expect(entitlementFor('trialing', null, NOVEMBER)).toEqual({ status: 'active', graceStartedAt: null });
  });

  it('entitles a paused or cancelled subscription to nothing', () => {
    expect(entitlementFor('paused', null, NOVEMBER)).toEqual({ status: 'revoked', graceStartedAt: null });
    expect(entitlementFor('canceled', PAST_DUE, NOVEMBER)).toEqual({ status: 'revoked', graceStartedAt: null });
  });
});
