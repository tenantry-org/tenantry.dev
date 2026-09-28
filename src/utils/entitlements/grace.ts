import type { SubscriptionStatus } from '@paddle/paddle-node-sdk';
import type { EntitlementStatus } from '@/utils/entitlements/entitlements-store';

/**
 * How long a past-due subscription keeps access. Paddle's default payment recovery retries a failed
 * renewal and cancels the subscription after 30 days if it is not recovered; this cutoff ends access at
 * the same point even if that cancellation never arrives (or recovery is configured to run longer).
 */
export const GRACE_PERIOD_DAYS = 30;

export function graceEndsAt(graceStartedAt: Date): Date {
  return new Date(graceStartedAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * The entitlement a Paddle subscription status gives. A past-due subscription is in grace from its first
 * past-due event (later ones keep that start); any other status ends grace.
 */
export function entitlementFor(
  status: SubscriptionStatus,
  graceStartedAt: Date | null,
  occurredAt: Date,
): { status: EntitlementStatus; graceStartedAt: Date | null } {
  switch (status) {
    case 'active':
    case 'trialing':
      return { status: 'active', graceStartedAt: null };
    case 'past_due':
      return { status: 'grace', graceStartedAt: graceStartedAt ?? occurredAt };
    case 'paused':
    case 'canceled':
    default:
      return { status: 'revoked', graceStartedAt: null };
  }
}
