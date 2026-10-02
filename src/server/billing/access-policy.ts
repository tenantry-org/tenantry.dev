import 'server-only';
import type { SubscriptionStatus } from '@paddle/paddle-node-sdk';
import type { EntitlementRecord, EntitlementStatus } from '@/server/db/billing-store';

/**
 * Who is entitled, and until when: the rules the billing services apply, as pure functions. A subscription's
 * Paddle status gives its entitlement (`entitlementFor`), and a customer's access is the aggregate of all their
 * entitlements (`aggregateAccess`).
 */

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

export function isEntitled(status: EntitlementStatus): boolean {
  return status === 'active' || status === 'grace';
}

/**
 * Active if any subscription is active, grace if any is in grace (and its grace period has not ended by
 * `now`), otherwise revoked.
 */
export function aggregateAccess(entitlements: EntitlementRecord[], now: Date = new Date()): EntitlementStatus {
  const entitled = entitlements.filter((entitlement) => entitles(entitlement, now));

  if (entitled.length === 0) return 'revoked';

  return entitled.some((entitlement) => entitlement.status === 'active') ? 'active' : 'grace';
}

function entitles(entitlement: EntitlementRecord, now: Date): boolean {
  if (entitlement.status === 'grace') {
    return !entitlement.graceStartedAt || graceEndsAt(entitlement.graceStartedAt) > now;
  }

  return entitlement.status === 'active';
}
