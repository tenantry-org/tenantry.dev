import 'server-only';
import type { Entitlement, GithubState } from '@/server/db/billing-store';
import { accessRevokedEmail, welcomeProEmail } from '@/server/integrations/email/templates';
import { errorMessage } from '@/lib/errors';
import { computeEntitlement, isEntitled } from '@/server/billing/entitlement-policy';
import { type BillingDeps, defaultBillingDeps } from '@/server/billing/deps';

/**
 * Brings a customer's stored state, and what follows from it, in line with what Paddle has told us. Every Paddle event
 * takes one path: it is recorded as a fact (a subscription, a payment or an adjustment), and then `syncCustomer`
 * recomputes everything that depends on those facts with one module (entitlement-policy.ts), stores it in one
 * transaction (`set_customer_entitlement`), and acts on a change of access. Reconcile runs the same function.
 *
 * Access belongs to the customer, not a subscription: it starts when the first Pro subscription becomes active (or
 * past due within grace) and ends only when none entitles them. Cancelling one of two subscriptions therefore leaves
 * the customer in the team, with no revocation email. A past-due subscription entitles only until its grace period
 * ends; that is decided when access is computed, so the daily reconcile ends access once grace is over, with no event
 * from Paddle. In the same way, reconcile confirms vesting as periods are served.
 *
 * GitHub team membership and the lifecycle emails follow access. The licence does not expire (licence-issuer.ts): a
 * customer is issued one key when their access first starts and keeps it for good, through renewals, lapses and
 * returns. It does not decide which releases they may use (the feed and the EULA do), so ending access leaves it in
 * place, and the dashboard keeps showing it.
 */

export type AccessChange = 'started' | 'ended' | 'unchanged';

export interface CustomerSync {
  change: AccessChange;
  /** What happened to the licence, or null when none was due (not entitled, or provisioning is manual). */
  licence: LicenceOutcome | null;
  /** What the customer may access now, and owns for good, as stored. */
  entitlement: Entitlement;
}

/**
 * Recomputes the customer's access and entitlement and stores them, then grants GitHub access and sends the welcome
 * email only when access starts, and revokes GitHub access and sends the revocation email only when it ends. While the
 * customer is entitled it only issues the licence if they have none (a first start, a failed issuance, or access that
 * started while provisioning was manual).
 *
 * Called after every Paddle event that recorded something for the customer (the worker runs one customer's jobs at a
 * time), and by reconcile. `set_customer_entitlement` makes concurrent calls see each change of access once.
 * Everything that can throw runs before the change is recorded, so a failure is retried as a whole; after that, each
 * side effect is attempted once and a failure is logged: reconcile retries GitHub grants and removals, and licence
 * issuance, and an email is not resent.
 */
export async function syncCustomer(
  customerId: string,
  deps: BillingDeps = defaultBillingDeps,
  now: Date = new Date(),
): Promise<CustomerSync> {
  const { store } = deps;
  const [subscriptions, payments, adjustments, email] = await Promise.all([
    store.listSubscriptions(customerId),
    store.listPayments(customerId),
    store.listPaymentAdjustments(customerId),
    store.getCustomerEmail(customerId),
  ]);
  const entitlement = computeEntitlement({
    subscriptions,
    payments,
    adjustments,
    proProductId: deps.config.paddle.proProductId,
    now,
  });
  const entitled = isEntitled(entitlement.access.status);

  const wasEntitled = isEntitled(await store.saveCustomerState(customerId, entitlement));

  if (!entitled) {
    if (!wasEntitled) return { change: 'unchanged', licence: null, entitlement };

    await endAccess(customerId, email, deps);
    return { change: 'ended', licence: null, entitlement };
  }

  // Provisioning gate: in manual mode (PROVISIONING_MODE not 'auto') access is recorded but GitHub access
  // and the licence are left to the operator.
  if (deps.config.provisioning !== 'auto') {
    console.warn(
      `Customer access: automated provisioning is off (PROVISIONING_MODE) for customer ${customerId}; ` +
        'recording access but withholding GitHub access and licence.',
    );
    return { change: wasEntitled ? 'unchanged' : 'started', licence: null, entitlement };
  }

  if (wasEntitled) {
    return { change: 'unchanged', licence: await ensureLicence(customerId, deps), entitlement };
  }

  await grantGithubAccess(customerId, deps);
  const licence = await ensureLicence(customerId, deps);

  if (email) {
    await deps.sendEmail(welcomeProEmail(email, deps.config.siteUrl)); // sendEmail never throws
  } else {
    console.info(`Customer access: no email on file for customer ${customerId}; skipping the welcome email.`);
  }

  return { change: 'started', licence, entitlement };
}

/**
 * The current login of the customer's linked GitHub account, looked up by its id: after a rename the stored
 * login names nobody, or someone else. Records a new login. Null when the customer has not linked GitHub, or
 * the account has since been deleted (its team membership and invitations went with it).
 */
export async function linkedGithubLogin(
  customerId: string,
  deps: BillingDeps = defaultBillingDeps,
): Promise<string | null> {
  const account = await deps.store.getGithubAccount(customerId);
  if (!account) return null;

  const login = await deps.github.currentLogin(account.id);
  if (login === null) {
    console.warn(`Customer access: the GitHub account linked to customer ${customerId} (id ${account.id}) is deleted.`);
    return null;
  }

  if (login !== account.login) await deps.store.setGithubLogin(customerId, login);
  return login;
}

async function grantGithubAccess(customerId: string, deps: BillingDeps) {
  let githubLogin: string | null;
  try {
    githubLogin = await linkedGithubLogin(customerId, deps);
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

  await grantAndRecord(customerId, githubLogin, deps);
}

/**
 * Adds the customer's GitHub account to the team and records the outcome: 'active', 'invited' (an org
 * invitation to accept), or 'failed', which reconcile retries. The first failure after a success alerts the
 * operator; retries that keep failing do not. Never throws.
 */
export async function grantAndRecord(
  customerId: string,
  githubLogin: string,
  deps: BillingDeps = defaultBillingDeps,
): Promise<GithubState> {
  let state: GithubState;
  try {
    state = (await deps.github.grantAccess(githubLogin)) === 'active' ? 'active' : 'invited';
  } catch (error) {
    console.error(
      `Customer access: failed to grant GitHub access to customer ${customerId}; reconcile retries:`,
      error,
    );
    state = 'failed';
    await grantFailed(customerId, githubLogin, error, deps);
  }

  try {
    await deps.store.setGithubState(customerId, state);
  } catch (error) {
    console.error(`Customer access: could not record GitHub state '${state}' for customer ${customerId}:`, error);
  }

  return state;
}

// Alerts unless the grant was already failing (a retry). If the state cannot be read, alerts anyway rather
// than risk staying silent.
async function grantFailed(customerId: string, githubLogin: string, error: unknown, deps: BillingDeps) {
  let alreadyFailing = false;
  try {
    alreadyFailing = (await deps.store.getCustomerAccess(customerId))?.githubState === 'failed';
  } catch (readError) {
    console.error(`Customer access: could not read the GitHub state of customer ${customerId}:`, readError);
  }

  if (alreadyFailing) return;

  await deps.alertOperator(
    `GitHub grant failed for customer ${customerId}`,
    `Adding GitHub account ${githubLogin} (Paddle customer ${customerId}) to the customer team failed: ` +
      `${errorMessage(error)}. The customer has access but cannot restore packages. Reconcile retries on every ` +
      'run, and no further alert is sent while it keeps failing.',
  );
}

export type LicenceOutcome = 'issued' | 'current' | 'failed';

// Issues the customer's licence unless they already have one; it does not expire, so renewals and returns keep it.
// A failure is recorded (alerting the operator when it starts a run of failures) and reconcile retries it;
// success clears the record.
async function ensureLicence(customerId: string, deps: BillingDeps): Promise<LicenceOutcome> {
  let outcome: LicenceOutcome = 'current';

  try {
    if (!(await deps.store.hasLicence(customerId))) {
      await deps.store.recordLicence({ customerId, jwt: deps.issueLicence({ customerId }) });
      outcome = 'issued';
    }
  } catch (error) {
    await licenceFailed(customerId, error, deps);
    return 'failed';
  }

  await forgetLicenceFailures(customerId, deps);
  return outcome;
}

async function licenceFailed(customerId: string, error: unknown, deps: BillingDeps) {
  const message = errorMessage(error);
  console.error(`Customer access: failed to issue a licence for customer ${customerId}; reconcile retries:`, error);

  // If the failure cannot be recorded either, alert anyway rather than risk staying silent.
  let firstFailure = true;
  try {
    firstFailure = await deps.store.recordLicenceFailure(customerId, message.slice(0, 2000));
  } catch (recordError) {
    console.error(`Customer access: could not record the licence failure for customer ${customerId}:`, recordError);
  }

  if (firstFailure) {
    await deps.alertOperator(
      `Licence issuance failed for customer ${customerId}`,
      `Issuing a licence for Paddle customer ${customerId} failed: ${message}. The customer has access but no ` +
        'current licence. Reconcile retries on every run; failed attempts are recorded in licence_failures, ' +
        'and no further alert is sent until a licence is issued.',
    );
  }
}

async function forgetLicenceFailures(customerId: string, deps: BillingDeps) {
  try {
    await deps.store.clearLicenceFailure(customerId);
  } catch (error) {
    console.error(`Customer access: could not clear the licence failure for customer ${customerId}:`, error);
  }
}

async function endAccess(customerId: string, email: string | null, deps: BillingDeps) {
  try {
    const githubLogin = await linkedGithubLogin(customerId, deps);
    if (githubLogin) await deps.github.revokeAccess(githubLogin);
  } catch (error) {
    console.error(
      `Customer access: failed to revoke GitHub access for customer ${customerId}; reconcile retries:`,
      error,
    );
  }

  await forgetLicenceFailures(customerId, deps);

  if (email) {
    await deps.sendEmail(accessRevokedEmail(email, deps.config.siteUrl));
  } else {
    console.info(`Customer access: no email on file for customer ${customerId}; skipping the revocation email.`);
  }
}
