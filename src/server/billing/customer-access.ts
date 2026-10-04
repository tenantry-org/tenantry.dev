import 'server-only';
import type { Entitlement, Grant } from '@/server/db/billing-store';
import {
  accessRevokedEmail,
  grantWithdrawnEmail,
  vestingConfirmedEmail,
  welcomeProEmail,
} from '@/server/integrations/email/templates';
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
 * past due within grace) and ends only when none entitles them. Cancelling one of two subscriptions therefore changes
 * nothing, and sends no email. A past-due subscription entitles only until its grace period
 * ends; that is decided when access is computed, so the daily reconcile ends access once grace is over, with no event
 * from Paddle. In the same way, reconcile confirms vesting as periods are served.
 *
 * The lifecycle emails follow access, and the customer is told when a grant is confirmed (releases become vested) or
 * withdrawn (a refund, a chargeback, or an annual term not completed); the operator is alerted about a withdrawal. The
 * licence does not expire (licence-issuer.ts): a
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
 * Recomputes the customer's access and entitlement and stores them, then sends the welcome email only when access
 * starts, and the access-ended email only when it ends. While the customer is entitled it issues the licence if they
 * have none (a first start, a failed issuance, or access that started while provisioning was manual).
 *
 * Called after every Paddle event that recorded something for the customer (the worker runs one customer's jobs at a
 * time), and by reconcile. `set_customer_entitlement` makes concurrent calls see each change of access once.
 * Everything that can throw runs before the change is recorded, so a failure is retried as a whole; after that, each
 * side effect is attempted once and a failure is logged: reconcile retries licence issuance, and an email is not
 * resent.
 */
export async function syncCustomer(
  customerId: string,
  deps: BillingDeps = defaultBillingDeps,
  now: Date = new Date(),
): Promise<CustomerSync> {
  const { store } = deps;
  const [subscriptions, payments, adjustments, email, previousGrants] = await Promise.all([
    store.listSubscriptions(customerId),
    store.listPayments(customerId),
    store.listPaymentAdjustments(customerId),
    store.getCustomerEmail(customerId),
    store.listGrants(customerId),
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
  await notifyGrantChanges(customerId, previousGrants, entitlement, email, deps);

  if (!entitled) {
    if (!wasEntitled) return { change: 'unchanged', licence: null, entitlement };

    await endAccess(customerId, email, deps);
    return { change: 'ended', licence: null, entitlement };
  }

  // Provisioning gate: in manual mode (PROVISIONING_MODE not 'auto') access is recorded but the licence is left to
  // the operator. The package feed follows the recorded access whatever the mode.
  if (deps.config.provisioning !== 'auto') {
    console.warn(
      `Customer access: automated provisioning is off (PROVISIONING_MODE) for customer ${customerId}; ` +
        'recording access but withholding the licence.',
    );
    return { change: wasEntitled ? 'unchanged' : 'started', licence: null, entitlement };
  }

  if (wasEntitled) {
    return { change: 'unchanged', licence: await ensureLicence(customerId, deps), entitlement };
  }

  const licence = await ensureLicence(customerId, deps);

  if (email) {
    await deps.sendEmail(welcomeProEmail(email, deps.config.siteUrl)); // sendEmail never throws
  } else {
    console.info(`Customer access: no email on file for customer ${customerId}; skipping the welcome email.`);
  }

  return { change: 'started', licence, entitlement };
}

/**
 * Tells the customer about each grant that became confirmed (absent or conditional before: a first vesting, a new
 * qualifying period that vested, an annual term completed) and each that was withdrawn (conditional or confirmed
 * before), comparing the grants stored before this sync with those stored by it. A confirmed grant whose vested-through
 * date only moves forward, as a qualifying period does each month, sends nothing. A withdrawal also alerts the operator,
 * since a refund or chargeback took away releases. Never throws: a failed email is not resent.
 */
async function notifyGrantChanges(
  customerId: string,
  previous: Grant[],
  entitlement: Entitlement,
  email: string | null,
  deps: BillingDeps,
) {
  const before = new Map(previous.map((grant) => [grantKey(grant), grant.status]));
  const confirmed = entitlement.grants.filter(
    (grant) => grant.status === 'confirmed' && before.get(grantKey(grant)) !== 'confirmed',
  );
  const withdrawn = entitlement.grants.filter((grant) => {
    const was = before.get(grantKey(grant));
    return grant.status === 'withdrawn' && (was === 'conditional' || was === 'confirmed');
  });

  for (const grant of withdrawn) {
    await deps.alertOperator(
      `Grant withdrawn for customer ${customerId}`,
      `The ${grant.kind === 'annual_term' ? 'annual term' : 'qualifying period'} of Paddle customer ${customerId} ` +
        `that started ${grant.startedAt.toISOString()} no longer vests releases up to ` +
        `${grant.vestedThrough.toISOString()} (${grant.withdrawnReason}). Their vested-through date is now ` +
        `${entitlement.vestedThrough?.toISOString() ?? 'none'}. Check the adjustment in Paddle if this is unexpected.`,
    );
  }
  if (confirmed.length > 0 && entitlement.vestedThrough) {
    console.info(
      `Customer access: customer ${customerId} is vested through ${entitlement.vestedThrough.toISOString()}.`,
    );
  }

  if (!email) return;
  for (const grant of withdrawn) {
    await deps.sendEmail(grantWithdrawnEmail(email, grant, entitlement.vestedThrough, deps.config.siteUrl));
  }
  if (confirmed.length > 0 && entitlement.vestedThrough) {
    await deps.sendEmail(vestingConfirmedEmail(email, entitlement.vestedThrough, deps.config.siteUrl));
  }
}

function grantKey(grant: Pick<Grant, 'kind' | 'startedAt'>): string {
  return `${grant.kind}:${grant.startedAt.getTime()}`;
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
  await forgetLicenceFailures(customerId, deps);

  if (email) {
    await deps.sendEmail(accessRevokedEmail(email, deps.config.siteUrl));
  } else {
    console.info(`Customer access: no email on file for customer ${customerId}; skipping the revocation email.`);
  }
}
