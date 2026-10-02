import type { User } from '@supabase/supabase-js';
import { vi } from 'vitest';
import type { BillingDeps, GithubTeam } from '@/server/billing/deps';
import { memory } from '@/test/memory-billing-store';

/**
 * The billing services' dependencies for a test: the in-memory store, and fakes for everything else. GitHub
 * knows the accounts `memory.linkGithub` links and grants membership at once; licences are signed as
 * `licence:<customer>:<n>`; provisioning is automated. Build one per test, since its fakes record their calls.
 */
export function fakeBillingDeps() {
  let licencesSigned = 0;

  return {
    // A copy, so a test can spy on one function without changing the store for other tests.
    store: { ...memory.store },
    github: {
      currentLogin: vi.fn<GithubTeam['currentLogin']>(memory.currentLogin),
      grantAccess: vi.fn<GithubTeam['grantAccess']>(async () => 'active'),
      revokeAccess: vi.fn<GithubTeam['revokeAccess']>(async () => undefined),
      membershipOf: vi.fn<GithubTeam['membershipOf']>(async () => null),
      hasPendingInvitation: vi.fn<GithubTeam['hasPendingInvitation']>(async () => false),
    },
    issueLicence: vi.fn<BillingDeps['issueLicence']>(({ customerId }) => {
      licencesSigned += 1;
      return `licence:${customerId}:${licencesSigned}`;
    }),
    sendEmail: vi.fn<BillingDeps['sendEmail']>(async () => true),
    alertOperator: vi.fn<BillingDeps['alertOperator']>(async () => undefined),
    cancelSubscriptionNow: vi.fn<BillingDeps['cancelSubscriptionNow']>(async () => true),
    automatedProvisioningEnabled: vi.fn<BillingDeps['automatedProvisioningEnabled']>(() => true),
    // Holds the lease at once (spy on it to make the customer busy); customer-lease.test.ts tests the real one.
    withCustomerLease: <T>(_customerId: string, work: () => Promise<T>) => work(),
    currentUser: vi.fn<() => Promise<User | null>>(async () => null),
  } satisfies BillingDeps;
}

export type FakeBillingDeps = ReturnType<typeof fakeBillingDeps>;
