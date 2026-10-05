import { vi } from 'vitest';
import type { BillingDeps } from '@/server/billing/deps';
import { memory } from '@/test/memory-billing-store';
import { testServerConfig } from '@/test/server-config';

/**
 * The billing services' dependencies for a test: the in-memory store, and fakes for everything else. Licences are
 * signed as `licence:<customer>:<n>`; the configuration is `testServerConfig()`, so provisioning is automated (replace
 * `config` to change it). Build one per test, since its fakes record their calls.
 */
export function fakeBillingDeps() {
  let licencesSigned = 0;

  return {
    config: testServerConfig(),
    // A copy, so a test can spy on one function without changing the store for other tests.
    store: { ...memory.store },
    issueLicence: vi.fn<BillingDeps['issueLicence']>(({ customerId }) => {
      licencesSigned += 1;
      return `licence:${customerId}:${licencesSigned}`;
    }),
    sendEmail: vi.fn<BillingDeps['sendEmail']>(async () => true),
    alertOperator: vi.fn<BillingDeps['alertOperator']>(async () => undefined),
    cancelSubscriptionNow: vi.fn<BillingDeps['cancelSubscriptionNow']>(async () => true),
    // Paddle lists nothing unless a test says otherwise; tests never call Paddle.
    listCompletedTransactions: vi.fn<BillingDeps['listCompletedTransactions']>(async () => []),
    listAdjustments: vi.fn<BillingDeps['listAdjustments']>(async () => []),
  } satisfies BillingDeps;
}

export type FakeBillingDeps = ReturnType<typeof fakeBillingDeps>;
