import {
  EntitlementRecord,
  EntitlementStatus,
  GithubState,
  getCurrentLicence,
  getCustomerEmail,
  getGithubLogin,
  clearLicenceFailure,
  listEntitlements,
  recordLicence,
  recordLicenceFailure,
  revokeLicences,
  setCustomerAccess,
  setGithubState,
} from '@/utils/entitlements/entitlements-store';
import { issueLicence } from '@/utils/licensing/licence-issuer';
import { grantAccess, revokeAccess } from '@/utils/github/provisioning';
import { sendEmail } from '@/utils/email/send';
import { accessRevokedEmail, welcomeProEmail } from '@/utils/email/templates';
import { automatedProvisioningEnabled } from '@/utils/provisioning-guard';
import { alertOperator } from '@/utils/email/alerts';
import { errorMessage } from '@/utils/errors';
import { graceEndsAt } from '@/utils/entitlements/grace';

/**
 * Customer-level access. A customer can hold several subscriptions, each with its own entitlement, but
 * GitHub team membership, the licence and the lifecycle emails belong to the customer. They follow the
 * aggregate of all the customer's entitlements (`customer_access`): access starts when the first
 * entitlement becomes active or grace, and ends only when none is left. Cancelling one of two
 * subscriptions therefore leaves the customer in the team, with a licence and no revocation email.
 *
 * A past-due subscription ('grace') entitles the customer only until its grace period ends (grace.ts),
 * and its licence runs only to that point. This is decided when the access is computed, so the daily
 * reconcile ends access once grace is over, with no event from Paddle.
 */

// Licence lifetime when Paddle gives no billing period (the validator's own grace covers renewal gaps).
const FALLBACK_LICENCE_DAYS = 30;

export interface CustomerAccess {
  status: EntitlementStatus;
  /**
   * The latest point an entitled subscription covers: its billing period end, or for one in grace the end
   * of grace. Null if Paddle gave no billing period.
   */
  licenceExpiresAt: Date | null;
}

export type AccessChange = 'started' | 'ended' | 'unchanged';

export interface AccessSync {
  change: AccessChange;
  /** What happened to the licence, or null when none was due (not entitled, or provisioning is manual). */
  licence: LicenceOutcome | null;
}

export function isEntitled(status: EntitlementStatus): boolean {
  return status === 'active' || status === 'grace';
}

/**
 * Active if any subscription is active, grace if any is in grace (and its grace period has not ended by
 * `now`), otherwise revoked.
 */
export function aggregateAccess(entitlements: EntitlementRecord[], now: Date = new Date()): CustomerAccess {
  const entitled = entitlements.filter((entitlement) => entitles(entitlement, now));

  if (entitled.length === 0) return { status: 'revoked', licenceExpiresAt: null };

  const covered = entitled.flatMap((entitlement) => coveredUntil(entitlement)?.getTime() ?? []);

  return {
    status: entitled.some((entitlement) => entitlement.status === 'active') ? 'active' : 'grace',
    licenceExpiresAt: covered.length > 0 ? new Date(Math.max(...covered)) : null,
  };
}

function entitles(entitlement: EntitlementRecord, now: Date): boolean {
  if (entitlement.status === 'grace') {
    return !entitlement.graceStartedAt || graceEndsAt(entitlement.graceStartedAt) > now;
  }

  return entitlement.status === 'active';
}

function coveredUntil(entitlement: EntitlementRecord): Date | null {
  if (entitlement.status === 'grace' && entitlement.graceStartedAt) return graceEndsAt(entitlement.graceStartedAt);

  return entitlement.currentPeriodEndsAt;
}

/**
 * Brings the customer's access in line with their entitlements. Grants GitHub access and sends the
 * welcome email only when access starts; revokes it, revokes the licences and sends the revocation email
 * only when it ends. While the customer stays entitled it only re-issues the licence if its expiry changed.
 *
 * Called by the webhook worker after one of the customer's entitlements changed (one customer's events
 * at a time), and by reconcile for every entitled customer, which ends access whose grace period is over
 * and retries licences. `set_customer_access` makes concurrent calls see each change once. Everything
 * that can throw runs before the change is recorded, so a failure is retried as a whole; after that, each
 * side effect is attempted once and a failure is logged: reconcile retries GitHub grants and removals,
 * licence issuance and revocation, and an email is not resent.
 */
export async function syncCustomerAccess(customerId: string): Promise<AccessSync> {
  const access = aggregateAccess(await listEntitlements(customerId));
  const email = await getCustomerEmail(customerId);

  const wasEntitled = isEntitled(await setCustomerAccess(customerId, access.status));

  if (!isEntitled(access.status)) {
    if (!wasEntitled) return { change: 'unchanged', licence: null };

    await endAccess(customerId, email);
    return { change: 'ended', licence: null };
  }

  // Provisioning gate: in manual mode (PROVISIONING_MODE not 'auto') access is recorded but GitHub access
  // and the licence are left to the operator.
  if (!automatedProvisioningEnabled()) {
    console.warn(
      `Customer access: automated provisioning is off (PROVISIONING_MODE) for customer ${customerId}; ` +
        'recording access but withholding GitHub access and licence.',
    );
    return { change: wasEntitled ? 'unchanged' : 'started', licence: null };
  }

  if (wasEntitled) {
    return { change: 'unchanged', licence: await ensureLicence(customerId, access) };
  }

  await grantGithubAccess(customerId);
  const licence = await ensureLicence(customerId, access);

  if (email) {
    await sendEmail(welcomeProEmail(email)); // sendEmail never throws
  } else {
    console.info(`Customer access: no email on file for customer ${customerId}; skipping the welcome email.`);
  }

  return { change: 'started', licence };
}

async function grantGithubAccess(customerId: string) {
  let githubLogin: string | null;
  try {
    githubLogin = await getGithubLogin(customerId);
  } catch (error) {
    console.error(
      `Customer access: could not read the GitHub link of customer ${customerId}; reconcile retries:`,
      error,
    );
    return;
  }

  if (!githubLogin) {
    console.info(`Customer access: customer ${customerId} has not linked GitHub yet; access is granted when they do.`);
    return;
  }

  await grantAndRecord(customerId, githubLogin);
}

/**
 * Adds the customer's GitHub account to the team and records the outcome: 'active', 'invited' (an org
 * invitation to accept), or 'failed', which reconcile retries. Never throws.
 */
export async function grantAndRecord(customerId: string, githubLogin: string): Promise<GithubState> {
  let state: GithubState;
  try {
    state = (await grantAccess(githubLogin)) === 'active' ? 'active' : 'invited';
  } catch (error) {
    console.error(
      `Customer access: failed to grant GitHub access to customer ${customerId}; reconcile retries:`,
      error,
    );
    state = 'failed';
  }

  try {
    await setGithubState(customerId, state);
  } catch (error) {
    console.error(`Customer access: could not record GitHub state '${state}' for customer ${customerId}:`, error);
  }

  return state;
}

export type LicenceOutcome = 'issued' | 'current' | 'failed';

// Issues a licence running to the latest point the customer's entitled subscriptions cover, unless the
// current one already does. A failure is recorded (alerting the operator when it starts a run of failures) and
// reconcile retries it; success clears the record.
async function ensureLicence(customerId: string, access: CustomerAccess): Promise<LicenceOutcome> {
  let outcome: LicenceOutcome = 'current';

  try {
    const current = await getCurrentLicence(customerId);

    if (!current || (access.licenceExpiresAt && current.expiresAt.getTime() !== access.licenceExpiresAt.getTime())) {
      const expiresAt = access.licenceExpiresAt ?? new Date(Date.now() + FALLBACK_LICENCE_DAYS * 24 * 60 * 60 * 1000);
      const jwt = issueLicence({ customerId, expiresAt });
      await recordLicence({ customerId, jwt, expiresAt });
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
