import 'server-only';
import { createUserClient } from '@/utils/supabase/user-client';
import { getCustomerId } from '@/utils/paddle/get-customer-id';
import { graceEndsAt } from '@/utils/entitlements/grace';
import type { GithubState } from '@/utils/entitlements/entitlements-store';
import { isProProduct } from '@/constants/pro-product';
import { ProOffer } from '@/constants/pro-offer';

/** GitHub drops an org invitation that is not accepted within 7 days; reconcile then sends a new one. */
const INVITATION_DAYS = 7;

/**
 * Read model for the customer-facing Pro access page. Uses the user-scoped client, so RLS guarantees
 * a customer only ever sees their own access / licence / GitHub link.
 */
export interface ProAccess {
  customerId: string | null;
  /**
   * The customer's access across all their subscriptions (`customer_access`). While every subscription
   * that entitles them is past due, `grace` says when access ends if no payment recovers, and whether that
   * has passed (access is then removed by the next reconcile).
   */
  entitlement: {
    status: string;
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
  /** Paddle's status: active, trialing, past_due or paused. */
  status: string;
  interval: 'month' | 'year' | null;
  /** When it renews, unless it is scheduled to cancel. */
  renewsAt: string | null;
  /** When a scheduled cancellation takes effect. */
  endsAt: string | null;
}

export async function getProAccess(): Promise<ProAccess> {
  const customerId = await getCustomerId();

  if (!customerId) {
    return { customerId: null, entitlement: null, licence: null, githubLogin: null, subscriptions: [] };
  }

  const supabase = await createUserClient();

  const [{ data: entitlement }, { data: licence }, { data: link }, { data: entitlements }, { data: subscriptions }] =
    await Promise.all([
      supabase
        .from('customer_access')
        .select('status,github_state,github_invited_at')
        .eq('customer_id', customerId)
        .maybeSingle(),
      supabase
        .from('licences')
        .select('jwt')
        .eq('customer_id', customerId)
        .eq('revoked', false)
        .order('issued_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('github_links').select('github_login').eq('customer_id', customerId).maybeSingle(),
      supabase
        .from('entitlements')
        .select('subscription_id,status,current_period_ends_at,grace_started_at')
        .eq('customer_id', customerId),
      supabase
        .from('subscriptions')
        .select('subscription_id,subscription_status,price_id,product_id,scheduled_change,scheduled_change_action')
        .eq('customer_id', customerId),
    ]);

  const entitlementRows = (entitlements ?? []) as EntitlementRow[];
  const graceEnds = entitlementRows
    .filter(({ status, grace_started_at }) => status === 'grace' && grace_started_at)
    .map(({ grace_started_at }) => graceEndsAt(new Date(grace_started_at!)).getTime());
  const graceEnd = graceEnds.length > 0 ? Math.max(...graceEnds) : null;

  return {
    customerId,
    entitlement: entitlement
      ? {
          status: entitlement.status,
          github: entitlement.github_state as GithubState,
          invitationExpiresAt:
            entitlement.github_state === 'invited' && entitlement.github_invited_at
              ? new Date(
                  new Date(entitlement.github_invited_at).getTime() + INVITATION_DAYS * 24 * 60 * 60 * 1000,
                ).toISOString()
              : null,
          grace:
            entitlement.status === 'grace' && graceEnd !== null
              ? { endsAt: new Date(graceEnd).toISOString(), ended: graceEnd <= Date.now() }
              : null,
        }
      : null,
    licence: licence ? { jwt: licence.jwt } : null,
    githubLogin: link?.github_login ?? null,
    subscriptions: ((subscriptions ?? []) as SubscriptionRow[])
      .filter((row) => isProProduct(row.product_id) && row.subscription_status !== 'canceled')
      .map((row) => billingSubscription(row, entitlementRows)),
  };
}

interface EntitlementRow {
  subscription_id: string;
  status: string;
  current_period_ends_at: string | null;
  grace_started_at: string | null;
}

interface SubscriptionRow {
  subscription_id: string;
  subscription_status: string;
  price_id: string | null;
  product_id: string | null;
  scheduled_change: string | null;
  scheduled_change_action: string | null;
}

function billingSubscription(row: SubscriptionRow, entitlements: EntitlementRow[]): BillingSubscription {
  const endsAt = row.scheduled_change_action === 'cancel' ? row.scheduled_change : null;
  const periodEndsAt = entitlements.find((e) => e.subscription_id === row.subscription_id)?.current_period_ends_at;

  return {
    id: row.subscription_id,
    status: row.subscription_status,
    interval:
      row.price_id === ProOffer.priceId.month ? 'month' : row.price_id === ProOffer.priceId.year ? 'year' : null,
    renewsAt: endsAt ? null : (periodEndsAt ?? null),
    endsAt,
  };
}
