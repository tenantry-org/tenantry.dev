import type { User } from '@supabase/supabase-js';
import { vi } from 'vitest';
import type { BillingDeps, GithubTeam } from '@/server/billing/deps';
import { memory } from '@/test/memory-billing-store';
import { testServerConfig } from '@/test/server-config';

/**
 * The billing services' dependencies for a test: the in-memory store, and fakes for everything else. GitHub
 * knows the accounts `memory.linkGithub` links and grants membership at once; licences are signed as
 * `licence:<customer>:<n>`; the configuration is `testServerConfig()`, so provisioning is automated (replace
 * `config` to change it). Build one per test, since its fakes record their calls.
 */
export function fakeBillingDeps() {
  let licencesSigned = 0;

  return {
    config: testServerConfig(),
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
    // Paddle lists nothing unless a test says otherwise; tests never call Paddle.
    listCompletedTransactions: vi.fn<BillingDeps['listCompletedTransactions']>(async () => []),
    // Holds the lease at once (spy on it to make the customer busy); customer-lease.test.ts tests the real one.
    withCustomerLease: <T>(_customerId: string, work: () => Promise<T>) => work(),
    currentUser: vi.fn<() => Promise<User | null>>(async () => null),
  } satisfies BillingDeps;
}

export type FakeBillingDeps = ReturnType<typeof fakeBillingDeps>;
