import { PricingTier } from '@/constants/pricing-tier';
import {
  EntitlementRecord,
  EntitlementStatus,
  getCurrentLicence,
  getCustomerEmail,
  getGithubLogin,
  clearLicenceFailure,
  listEntitlements,
  markGithubGranted,
  recordLicence,
  recordLicenceFailure,
  revokeLicences,
  setCustomerAccess,
} from '@/utils/entitlements/entitlements-store';
import { issueLicence } from '@/utils/licensing/licence-issuer';
import { grantAccess, revokeAccess } from '@/utils/github/provisioning';
import { sendEmail } from '@/utils/email/send';
import { accessRevokedEmail, welcomeProEmail } from '@/utils/email/templates';
import { provisioningAllowed } from '@/utils/provisioning-guard';
import { alertOperator } from '@/utils/email/alerts';
import { errorMessage } from '@/utils/errors';

/**
 * Customer-level access. A customer can hold several subscriptions, each with its own entitlement, but
 * GitHub team membership, the licence and the lifecycle emails belong to the customer. They follow the
 * aggregate of all the customer's entitlements (`customer_access`): access starts when the first
 * entitlement becomes active or grace, and ends only when none is left. Cancelling one of two
 * subscriptions therefore leaves the customer in the team, with a licence and no revocation email.
 */

// Licence lifetime when Paddle gives no billing period (the validator's own grace covers renewal gaps).
const FALLBACK_LICENCE_DAYS = 30;

const TIER_ORDER: string[] = PricingTier.map((tier) => tier.id);

export interface CustomerAccess {
  status: EntitlementStatus;
  /** The highest tier among the entitled subscriptions, or null when none is entitled. */
  tier: string | null;
  /** The latest end of an entitled subscription's billing period, or null if Paddle gave none. */
  licenceExpiresAt: Date | null;
}

export type AccessChange = 'started' | 'ended' | 'unchanged';

export function isEntitled(status: EntitlementStatus): boolean {
  return status === 'active' || status === 'grace';
}

/** Active if any subscription is active, grace if any is in grace, otherwise revoked. */
export function aggregateAccess(entitlements: EntitlementRecord[]): CustomerAccess {
  const entitled = entitlements.filter((entitlement) => isEntitled(entitlement.status));

  if (entitled.length === 0) return { status: 'revoked', tier: null, licenceExpiresAt: null };

  const tier = entitled
    .map((entitlement) => entitlement.tier)
    .reduce((best, candidate) => (TIER_ORDER.indexOf(candidate) > TIER_ORDER.indexOf(best) ? candidate : best));
  const periodEnds = entitled.flatMap((entitlement) => entitlement.currentPeriodEndsAt?.getTime() ?? []);

  return {
    status: entitled.some((entitlement) => entitlement.status === 'active') ? 'active' : 'grace',
    tier,
    licenceExpiresAt: periodEnds.length > 0 ? new Date(Math.max(...periodEnds)) : null,
  };
}

/**
 * Brings the customer's access in line with their entitlements, after one of them changed. Grants GitHub
 * access and sends the welcome email only when access starts; revokes it, revokes the licences and sends
 * the revocation email only when it ends. While the customer stays entitled it only re-issues the
 * licence if its tier or expiry changed.
 *
 * Called by the webhook worker, which handles one customer's events at a time. Everything that can
 * throw runs before the change is recorded, so a failure is retried as a whole; after that, each side
 * effect is attempted once and a failure is logged: reconcile retries GitHub grants and removals, licence
 * issuance and revocation, and an email is not resent.
 */
export async function syncCustomerAccess(customerId: string): Promise<AccessChange> {
  const access = aggregateAccess(await listEntitlements(customerId));
  const email = await getCustomerEmail(customerId);

  const wasEntitled = isEntitled(await setCustomerAccess(customerId, access.status, access.tier));

  if (!isEntitled(access.status)) {
    if (!wasEntitled) return 'unchanged';

    await endAccess(customerId, email);
    return 'ended';
  }

  // Provisioning gate: in manual mode (PROVISIONING_MODE not 'auto') or for a customer outside the
  // allowlist, access is recorded but GitHub access and the licence are left to the operator.
  if (!provisioningAllowed(email)) {
    console.warn(
      `Customer access: automated provisioning is off for ${email ?? customerId} ` +
        '(PROVISIONING_MODE/PROVISION_ALLOWLIST); recording access but withholding GitHub access and licence.',
    );
    return wasEntitled ? 'unchanged' : 'started';
  }

  if (wasEntitled) {
    await ensureLicence(customerId, access);
    return 'unchanged';
  }

  await grantGithubAccess(customerId);
  await ensureLicence(customerId, access);

  if (email) {
    await sendEmail(welcomeProEmail(email)); // sendEmail never throws
  } else {
    console.info(`Customer access: no email on file for customer ${customerId}; skipping the welcome email.`);
  }

  return 'started';
}

async function grantGithubAccess(customerId: string) {
  try {
    const githubLogin = await getGithubLogin(customerId);

    if (!githubLogin) {
      console.info(
        `Customer access: customer ${customerId} has not linked GitHub yet; access is granted when they do.`,
      );
      return;
    }

    await grantAccess(githubLogin);
    await markGithubGranted(customerId);
  } catch (error) {
    console.error(
      `Customer access: failed to grant GitHub access to customer ${customerId}; reconcile retries:`,
      error,
    );
  }
}

export type LicenceOutcome = 'issued' | 'current' | 'failed';

/**
 * Makes sure an entitled customer has a licence for their access, for reconcile to retry what failed or
 * was never done (e.g. access that started while provisioning was manual). Returns null for a customer
 * who is not entitled. The caller applies the provisioning gate.
 */
export async function reconcileLicence(customerId: string): Promise<LicenceOutcome | null> {
  const access = aggregateAccess(await listEntitlements(customerId));

  return isEntitled(access.status) ? ensureLicence(customerId, access) : null;
}

// Issues a licence for the customer's current tier and latest billing period, unless the current one
// already matches. A failure is recorded (alerting the operator when it starts a run of failures) and
// reconcile retries it; success clears the record.
async function ensureLicence(customerId: string, access: CustomerAccess): Promise<LicenceOutcome> {
  let outcome: LicenceOutcome = 'current';

  try {
    const tier = access.tier as string;
    const current = await getCurrentLicence(customerId);

    if (
      current?.tier !== tier ||
      (access.licenceExpiresAt && current.expiresAt.getTime() !== access.licenceExpiresAt.getTime())
    ) {
      const expiresAt = access.licenceExpiresAt ?? new Date(Date.now() + FALLBACK_LICENCE_DAYS * 24 * 60 * 60 * 1000);
      const jwt = issueLicence({ customerId, tier, expiresAt });
      await recordLicence({ customerId, jwt, tier, expiresAt });
      outcome = 'issued';
    }
  } catch (error) {
    await licenceFailed(customerId, error);
    return 'failed';
  }

  await forgetLicenceFailures(customerId);
  return outcome;
}

async function licenceFailed(customerId: string, error: unknown) {
  const message = errorMessage(error);
  console.error(`Customer access: failed to issue a licence for customer ${customerId}; reconcile retries:`, error);

  // If the failure cannot be recorded either, alert anyway rather than risk staying silent.
  let firstFailure = true;
  try {
    firstFailure = await recordLicenceFailure(customerId, message.slice(0, 2000));
  } catch (recordError) {
    console.error(`Customer access: could not record the licence failure for customer ${customerId}:`, recordError);
  }

  if (firstFailure) {
    await alertOperator(
      `Licence issuance failed for customer ${customerId}`,
      `Issuing a licence for Paddle customer ${customerId} failed: ${message}. The customer has access but no ` +
        'current licence. Reconcile retries on every run; failed attempts are recorded in licence_failures, ' +
        'and no further alert is sent until a licence is issued.',
    );
  }
}

async function forgetLicenceFailures(customerId: string) {
  try {
    await clearLicenceFailure(customerId);
  } catch (error) {
    console.error(`Customer access: could not clear the licence failure for customer ${customerId}:`, error);
  }
}

async function endAccess(customerId: string, email: string | null) {
  try {
    const githubLogin = await getGithubLogin(customerId);
    if (githubLogin) await revokeAccess(githubLogin);
  } catch (error) {
    console.error(
      `Customer access: failed to revoke GitHub access for customer ${customerId}; reconcile retries:`,
      error,
    );
  }

  try {
    await revokeLicences(customerId);
  } catch (error) {
    console.error(`Customer access: failed to revoke licences for customer ${customerId}; reconcile retries:`, error);
  }

  await forgetLicenceFailures(customerId);

  if (email) {
    await sendEmail(accessRevokedEmail(email));
  } else {
    console.info(`Customer access: no email on file for customer ${customerId}; skipping the revocation email.`);
  }
}
