import 'server-only';
import type { SubscriptionStatus } from '@paddle/paddle-node-sdk';
import type { Tables } from '@/lib/supabase/database.types';
import type { OfferPrices } from '@/lib/public-config';
import { getCustomerId, readDashboardRows } from '@/server/db/customer-dashboard';
import { graceEndsAt } from '@/server/billing/access-policy';
import type { EntitlementStatus, GithubState } from '@/server/db/billing-store';
import { type ServerConfig, serverConfig } from '@/server/config/server-config';

/** GitHub drops an org invitation that is not accepted within 7 days; reconcile then sends a new one. */
const INVITATION_DAYS = 7;

/**
 * Read model for the customer-facing Pro pages. Reads with the signed-in user's session (customer-dashboard.ts),
 * so RLS guarantees a customer only ever sees their own access / licence / GitHub link.
 */
export interface ProAccess {
  customerId: string | null;
  /**
   * The customer's access across all their subscriptions (`customer_access`). While every subscription
   * that entitles them is past due, `grace` says when access ends if no payment recovers, and whether that
   * has passed (access is then removed by the next reconcile).
   */
  entitlement: {
    status: EntitlementStatus;
    github: GithubState;
    /** While `github` is 'invited': when the invitation lapses if not accepted. */
    invitationExpiresAt: string | null;
    grace: { endsAt: string; ended: boolean } | null;
  } | null;
  /** The customer's licence key; it does not expire. */
  licence: { jwt: string } | null;
  githubLogin: string | null;
  /** The customer's Pro subscriptions that have not ended, for the billing card; from our own records. */
  subscriptions: BillingSubscription[];
}

export interface BillingSubscription {
  id: string;
  /** Paddle's status; never canceled, since ended subscriptions are left out. */
  status: Exclude<SubscriptionStatus, 'canceled'>;
  interval: 'month' | 'year' | null;
  /** When it renews, unless it is scheduled to cancel. */
  renewsAt: string | null;
  /** When a scheduled cancellation takes effect. */
  endsAt: string | null;
}

/**
 * The signed-in customer's access. `paddle` is the Pro product and prices, by default the server's: read only after
 * the request's session, since the build prerenders the pages that call this until they read the request, and the
 * server's configuration is not read during the build.
 */
export async function getProAccess(paddle?: ServerConfig['paddle']): Promise<ProAccess> {
  const customerId = await getCustomerId();

  if (!customerId) {
    return { customerId: null, entitlement: null, licence: null, githubLogin: null, subscriptions: [] };
  }

  const { access, licence, link, entitlements, subscriptions } = await readDashboardRows(customerId);
  const { proProductId, prices } = paddle ?? serverConfig().paddle;

  const graceEnds = entitlements
    .filter(({ status, grace_started_at }) => status === 'grace' && grace_started_at)
    .map(({ grace_started_at }) => graceEndsAt(new Date(grace_started_at!)).getTime());
  const graceEnd = graceEnds.length > 0 ? Math.max(...graceEnds) : null;

  return {
    customerId,
    entitlement: access
      ? {
          // customer_access's check constraints allow only these.
          status: access.status as EntitlementStatus,
          github: access.github_state as GithubState,
          invitationExpiresAt:
            access.github_state === 'invited' && access.github_invited_at
              ? new Date(
                  new Date(access.github_invited_at).getTime() + INVITATION_DAYS * 24 * 60 * 60 * 1000,
                ).toISOString()
              : null,
          grace:
            access.status === 'grace' && graceEnd !== null
              ? { endsAt: new Date(graceEnd).toISOString(), ended: graceEnd <= Date.now() }
              : null,
        }
      : null,
    licence: licence ? { jwt: licence.jwt } : null,
    githubLogin: link?.github_login ?? null,
    subscriptions: subscriptions
      .filter((row) => row.product_id === proProductId && row.status !== 'canceled')
      .map((row) => billingSubscription(row, entitlements, prices)),
  };
}

type EntitlementRow = Pick<Tables<'entitlements'>, 'subscription_id' | 'current_period_ends_at'>;

type SubscriptionRow = Pick<
  Tables<'subscriptions'>,
  'subscription_id' | 'status' | 'price_id' | 'scheduled_change_at' | 'scheduled_change_action'
>;

function billingSubscription(
  row: SubscriptionRow,
  entitlements: EntitlementRow[],
  prices: OfferPrices,
): BillingSubscription {
  const endsAt = row.scheduled_change_action === 'cancel' ? row.scheduled_change_at : null;
  const periodEndsAt = entitlements.find((e) => e.subscription_id === row.subscription_id)?.current_period_ends_at;

  return {
    id: row.subscription_id,
    // Paddle's status, as record_subscription_event stored it; canceled ones are filtered out above.
    status: row.status as BillingSubscription['status'],
    interval: row.price_id === prices.month ? 'month' : row.price_id === prices.year ? 'year' : null,
    renewsAt: endsAt ? null : (periodEndsAt ?? null),
    endsAt,
  };
}
