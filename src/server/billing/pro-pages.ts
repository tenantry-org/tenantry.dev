import 'server-only';
import type { SubscriptionStatus } from '@paddle/paddle-node-sdk';
import type { Tables } from '@/lib/supabase/database.types';
import type { OfferPrices } from '@/lib/public-config';
import { getCurrentUser } from '@/server/db/current-user';
import {
  getCustomerId,
  readCustomerAccess,
  readEntitlements,
  readGithubLogin,
  readLicenceKey,
  readSubscriptions,
} from '@/server/db/customer-dashboard';
import { graceEndsAt, isEntitled } from '@/server/billing/access-policy';
import type { EntitlementStatus, GithubState } from '@/server/db/billing-store';
import { type ServerConfig, serverConfig } from '@/server/config/server-config';

/**
 * Read models for the customer's Pro pages (Access, Install and Billing). Each reads only what its page shows, with
 * the signed-in user's session (customer-dashboard.ts), so RLS guarantees a customer only ever sees their own rows.
 */

/** GitHub drops an org invitation that is not accepted within 7 days; reconcile then sends a new one. */
const INVITATION_DAYS = 7;

/** Shown instead of a page that is not for the login: it has no Pro (or, for Billing, no billing account). */
export interface NoSubscriptionView {
  noSubscription: true;
  /** Whether the login has a billing account: a purchase was made with its confirmed email. */
  customer: boolean;
  /** The login's email, which a purchase must have been made with to show here. */
  accountEmail: string | null;
}

/** Access (/dashboard/pro), for a customer with Pro: their GitHub connection and licence key. */
export interface AccessView {
  noSubscription: false;
  github: {
    /** The account they connected, if any. */
    login: string | null;
    state: GithubState;
    /** While `state` is 'invited': when the invitation lapses if not accepted. */
    invitationExpiresAt: string | null;
  };
  /** Their licence key, which does not expire; null until it is issued. */
  licenceKey: string | null;
}

/** Install (/dashboard/pro/install), for a customer with Pro: setting up the feed, with their GitHub account. */
export interface InstallView {
  noSubscription: false;
  githubLogin: string | null;
}

/**
 * Billing (/dashboard/pro/billing), for any customer, with Pro or not: one whose access ended still needs it, to
 * update the payment method that failed or for their invoices.
 */
export interface BillingView {
  noSubscription: false;
  /**
   * The customer's access across all their subscriptions (`customer_access`), or null if they never had any. While
   * every subscription that entitles them is past due, `grace` says when access ends if no payment recovers, and
   * whether that has passed (access is then removed by the next reconcile).
   */
  access: { status: EntitlementStatus; grace: { endsAt: string; ended: boolean } | null } | null;
  /** The customer's Pro subscriptions that have not ended, from our own records. */
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

export async function getAccessView(): Promise<AccessView | NoSubscriptionView> {
  const customerId = await getCustomerId();
  if (!customerId) return noSubscription(false);

  // Read with the access, not after it, saving a round trip: a former customer's licences are revoked, so none is read.
  const [access, licenceKey, githubLogin] = await Promise.all([
    readCustomerAccess(customerId),
    readLicenceKey(customerId),
    readGithubLogin(customerId),
  ]);
  if (!access || !isEntitled(access.status)) return noSubscription(true);

  const invitedAt = access.githubState === 'invited' ? access.githubInvitedAt : null;

  return {
    noSubscription: false,
    github: {
      login: githubLogin,
      state: access.githubState,
      invitationExpiresAt: invitedAt
        ? new Date(invitedAt.getTime() + INVITATION_DAYS * 24 * 60 * 60 * 1000).toISOString()
        : null,
    },
    licenceKey,
  };
}

export async function getInstallView(): Promise<InstallView | NoSubscriptionView> {
  const customerId = await getCustomerId();
  if (!customerId) return noSubscription(false);

  const [access, githubLogin] = await Promise.all([readCustomerAccess(customerId), readGithubLogin(customerId)]);
  if (!access || !isEntitled(access.status)) return noSubscription(true);

  return { noSubscription: false, githubLogin };
}

/**
 * `paddle` is the Pro product and prices, by default the server's: read only after the request's session, since the
 * build prerenders the pages that call this until they read the request, and the server's configuration is not read
 * during the build.
 */
export async function getBillingView(paddle?: ServerConfig['paddle']): Promise<BillingView | NoSubscriptionView> {
  const customerId = await getCustomerId();
  if (!customerId) return noSubscription(false);

  const [access, entitlements, subscriptions] = await Promise.all([
    readCustomerAccess(customerId),
    readEntitlements(customerId),
    readSubscriptions(customerId),
  ]);
  const { proProductId, prices } = paddle ?? serverConfig().paddle;

  const graceEnds = entitlements
    .filter(({ status, grace_started_at }) => status === 'grace' && grace_started_at)
    .map(({ grace_started_at }) => graceEndsAt(new Date(grace_started_at!)).getTime());
  const graceEnd = graceEnds.length > 0 ? Math.max(...graceEnds) : null;

  return {
    noSubscription: false,
    access: access
      ? {
          status: access.status,
          grace:
            access.status === 'grace' && graceEnd !== null
              ? { endsAt: new Date(graceEnd).toISOString(), ended: graceEnd <= Date.now() }
              : null,
        }
      : null,
    subscriptions: subscriptions
      .filter((row) => row.product_id === proProductId && row.status !== 'canceled')
      .map((row) => billingSubscription(row, entitlements, prices)),
  };
}

// The login's email is the request's cached user (current-user.ts), which getCustomerId has already read.
async function noSubscription(customer: boolean): Promise<NoSubscriptionView> {
  const user = await getCurrentUser();
  return { noSubscription: true, customer, accountEmail: user?.email ?? null };
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
