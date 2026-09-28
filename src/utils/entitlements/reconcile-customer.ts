import { grantAccess, hasAccess, revokeAccess } from '@/utils/github/provisioning';
import { provisioningAllowed } from '@/utils/provisioning-guard';
import {
  getCurrentLicence,
  getCustomerAccess,
  getCustomerEmail,
  getGithubLogin,
  markGithubGranted,
  revokeLicences,
} from '@/utils/entitlements/entitlements-store';
import { AccessChange, isEntitled, LicenceOutcome, syncCustomerAccess } from '@/utils/entitlements/customer-access';

/**
 * The inbox event type of a reconcile job (reconcile.ts queues one per customer). The inbox worker runs it
 * in order with the customer's Paddle events and never at the same time as one of them, so a reconcile
 * cannot act on access that a concurrent event is changing.
 */
export const RECONCILE_CUSTOMER_EVENT = 'tenantry.reconcile_customer';

export interface CustomerReconciliation {
  access: AccessChange;
  licence: LicenceOutcome | null;
  githubGranted: boolean;
  githubRemoved: boolean;
  licencesRevoked: boolean;
}

/**
 * Brings one customer's access, GitHub membership and licences in line with their entitlements. Catches
 * what a single webhook cannot:
 *   - a past-due subscription whose grace period has ended (there is no Paddle event for that): access
 *     ends, with the revocation email, unless another subscription entitles the customer,
 *   - a licence that is missing or out of date: never issued because access started while provisioning
 *     was manual, or its issuance failed (recorded in `licence_failures` and alerted on once),
 *   - a customer who linked GitHub after their access started (grant pending), or a grant or removal
 *     that failed during webhook handling,
 *   - licences left live after access ended.
 *
 * Every step is idempotent, so a job that throws is retried by the inbox with backoff.
 */
export async function reconcileCustomer(customerId: string): Promise<CustomerReconciliation> {
  const { change, licence } = await syncCustomerAccess(customerId);
  const access = await getCustomerAccess(customerId);
  const entitled = access !== null && isEntitled(access.status);
  const githubLogin = await getGithubLogin(customerId);
  const result: CustomerReconciliation = {
    access: change,
    licence,
    githubGranted: false,
    githubRemoved: false,
    licencesRevoked: false,
  };

  if (entitled && githubLogin && !access.githubGranted) {
    // Honour the provisioning gate, so reconcile cannot backfill a grant the webhook withheld.
    if (provisioningAllowed(await getCustomerEmail(customerId))) {
      await grantAccess(githubLogin);
      await markGithubGranted(customerId);
      result.githubGranted = true;
    }
  }

  if (!entitled && githubLogin && (await hasAccess(githubLogin))) {
    await revokeAccess(githubLogin);
    result.githubRemoved = true;
  }

  if (!entitled && (await getCurrentLicence(customerId))) {
    await revokeLicences(customerId);
    result.licencesRevoked = true;
  }

  return result;
}
