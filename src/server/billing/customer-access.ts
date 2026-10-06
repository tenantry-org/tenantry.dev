import 'server-only';
import type { Entitlement, Grant } from '@/server/db/billing-store';
import type { WithdrawnGrant } from '@/server/integrations/email/templates';
import {
  accessRevokedEmail,
  grantWithdrawnEmail,
  vestingConfirmedEmail,
  welcomeProEmail,
} from '@/server/integrations/email/templates';
import { errorMessage } from '@/lib/errors';
import { computeEntitlement, type EntitlementInput, isEntitled } from '@/server/billing/entitlement-policy';
import { type BillingDeps, defaultBillingDeps, offeredPriceIds } from '@/server/billing/deps';

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
 * withdrawn (a refund, a credit or a chargeback); the operator is alerted about a withdrawal. The licence does not
 * expire (licence-issuer.ts): a customer is issued one key when their access first starts and keeps it for good,
 * through renewals, lapses and returns. It does not decide which releases they may use (the feed and the EULA do), so
 * ending access leaves it in place, and the dashboard keeps showing it.
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
  const [subscriptions, payments, adjustments, email, previousGrants, operatorThrough, isTest, offerPriceIds] =
    await Promise.all([
      deps.store.listSubscriptions(customerId),
      deps.store.listPayments(customerId),
      deps.store.listPaymentAdjustments(customerId),
      deps.store.getCustomerEmail(customerId),
      deps.store.listGrants(customerId),
      deps.store.readOperatorVestedThrough(customerId),
      deps.store.isTestCustomer(customerId),
      offeredPriceIds(deps),
    ]);
  // A test customer (customers.is_test) is kept by the operator for checks: nobody is emailed or alerted about it.
  if (isTest) deps = { ...deps, sendEmail: async () => false, alertOperator: async () => undefined };
  const { store } = deps;
  const input: EntitlementInput = {
    subscriptions,
    payments,
    adjustments,
    proProductId: deps.config.paddle.proProductId,
    offerPriceIds,
    now,
  };
  const entitlement = computeEntitlement(input);
  const entitled = isEntitled(entitlement.access.status);

  // The vested-through date as stored (vested_through()), operator grants included: the date the feed and the dashboard
  // use, so the emails give it too.
  const vestedThrough = latestDate(
    [entitlement.vestedThrough, operatorThrough].filter((date): date is Date => date !== null),
  );

  const wasEntitled = isEntitled(await store.saveCustomerState(customerId, entitlement));
  await notifyGrantChanges(customerId, previousGrants, entitlement, vestedThrough, email, deps, now);

  if (!entitled) {
    if (!wasEntitled) return { change: 'unchanged', licence: null, entitlement };

    await endAccess(customerId, email, input, entitlement, vestedThrough, deps);
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
 * Tells the customer when their vested releases change, comparing the grants stored before this sync with those stored
 * by it:
 *   - an annual term's grant withdrawn (money returned from its payment);
 *   - their vested-through date moved back or gone for any other reason: money returned that their paid time relied
 *     on, which recomputes the paid time without it rather than marking it withdrawn;
 *   - a grant newly confirmed (paid time reaching 12 months, an annual term paid, or a grant restored by a reversal)
 *     that vests beyond their previous vested-through date: paid time confirmed after it, or an annual term ending
 *     after it. A vested-through date moving forward with the time served sends nothing, nor does paid time
 *     recomputed from a later start (money returned from its first payment).
 * An annual term that ends before an operator grant does vests nothing new, so it sends nothing; paid time reaching 12
 * months does, since it moves on as it is served. The emails and alerts give the stored vested-through date (`stored`,
 * operator grants included). Anything taken away also alerts the operator. Never throws: a failed email is not resent.
 */
async function notifyGrantChanges(
  customerId: string,
  previous: Grant[],
  entitlement: Entitlement,
  stored: Date | null,
  email: string | null,
  deps: BillingDeps,
  now: Date,
) {
  const before = new Map(previous.map((grant) => [grantKey(grant), grant.status]));
  const previousThrough = latestDate(previous.filter((g) => g.status === 'confirmed').map((g) => g.vestedThrough));
  const through = entitlement.vestedThrough;

  const confirmed = entitlement.grants.filter(
    (grant) => grant.status === 'confirmed' && before.get(grantKey(grant)) !== 'confirmed',
  );
  const withdrawn: WithdrawnGrant[] = entitlement.grants.filter((grant) => {
    const was = before.get(grantKey(grant));
    return grant.status === 'withdrawn' && was === 'confirmed';
  });
  // Vesting taken away without a grant marked withdrawn: money returned that the paid time relied on.
  if (withdrawn.length === 0 && previousThrough && (!through || through < previousThrough)) {
    withdrawn.push({ kind: 'paid_time', vestedThrough: previousThrough, withdrawnReason: null });
  }
  // A grant that vests beyond the previous vested-through date: not paid time recomputed from a later start.
  const vested =
    through !== null &&
    !(stored && stored > through && !confirmed.some((grant) => grant.kind === 'paid_time')) &&
    confirmed.some(
      (grant) =>
        !previousThrough ||
        (grant.kind === 'annual_term' ? grant.vestedThrough : (grant.confirmedAt ?? grant.vestedThrough)) >
          previousThrough,
    );
  // Whether the vested-through date is the end of an annual term not over yet, which vests releases still to come.
  const annualTerm = entitlement.grants.some(
    (grant) =>
      grant.kind === 'annual_term' &&
      grant.status === 'confirmed' &&
      grant.vestedThrough.getTime() === through?.getTime() &&
      grant.vestedThrough > now,
  );

  for (const grant of withdrawn) {
    const what = grant.kind === 'annual_term' ? 'annual term' : 'paid time';
    await deps.alertOperator(
      grant.withdrawnReason
        ? `Grant withdrawn for customer ${customerId}`
        : `Vested releases taken away for customer ${customerId}`,
      `The ${what} of Paddle customer ${customerId} no longer vests releases up to ` +
        `${grant.vestedThrough.toISOString()} (${grant.withdrawnReason ?? 'money it relied on was returned'}). Their ` +
        `vested-through date is now ${stored?.toISOString() ?? 'none'}. Check the adjustment in Paddle if this is ` +
        'unexpected.',
    );
  }
  if (vested) {
    console.info(`Customer access: customer ${customerId} is vested through ${through!.toISOString()}.`);
  }

  if (!email) return;
  for (const grant of withdrawn) {
    await deps.sendEmail(grantWithdrawnEmail(email, grant, stored, deps.config.siteUrl));
  }
  if (vested) {
    await deps.sendEmail(vestingConfirmedEmail(email, stored!, annualTerm, deps.config.siteUrl));
  }
}

function latestDate(dates: Date[]): Date | null {
  return dates.length === 0 ? null : new Date(Math.max(...dates.map((date) => date.getTime())));
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

async function endAccess(
  customerId: string,
  email: string | null,
  input: EntitlementInput,
  entitlement: Entitlement,
  vestedThrough: Date | null,
  deps: BillingDeps,
) {
  await forgetLicenceFailures(customerId, deps);

  if (email) {
    // Paid time still being served after a cancel or pause with nothing returned starts the vesting, or moves a
    // vested-through date on, only if it reaches 12 paid months by its end, when the entitlement as of then has a paid
    // time grant. Otherwise the email names no later date: a date from an operator grant or an annual term stays where
    // it is.
    const paidUntil = entitlement.paidUntil && entitlement.paidUntil > input.now ? entitlement.paidUntil : null;
    const runsTo =
      paidUntil &&
      computeEntitlement({ ...input, now: paidUntil }).grants.some(
        (grant) => grant.kind === 'paid_time' && grant.status === 'confirmed',
      )
        ? paidUntil
        : null;
    await deps.sendEmail(accessRevokedEmail(email, vestedThrough, runsTo, deps.config.siteUrl));
  } else {
    console.info(`Customer access: no email on file for customer ${customerId}; skipping the revocation email.`);
  }
}
