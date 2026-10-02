import 'server-only';
import { acquireCustomerLease, releaseCustomerLease } from '@/server/db/inbox';

/**
 * Per-customer leases (supabase/migrations/20260929150000_customer_leases.sql). The inbox worker processes a
 * customer's Paddle events and reconcile jobs one at a time; work outside it that changes the customer's GitHub
 * access (linking an account) holds the customer's lease, so it never runs alongside one of those.
 */

/**
 * How long a lease lasts if it is never released. The work it protects cannot outlast it: every route that
 * takes a lease stops at its `maxDuration`, which is shorter (lease-deadlines.test.ts). Otherwise a slow
 * relink could go on after the lease expired and another event for the customer had started.
 */
export const LEASE_SECONDS = 120;

/** Returned by withCustomerLease when the customer stayed busy for the whole wait. */
export const CUSTOMER_BUSY = Symbol('customer-busy');

export interface LeaseOptions {
  /** How long the lease lasts if it is never released: longer than the work can take. */
  seconds?: number;
  /** How long to wait for the customer's event in progress (or another lease) to finish. */
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Runs `work` holding the customer's lease: none of their inbox events runs meanwhile. Waits up to `waitMs` for
 * one in progress to finish, and returns CUSTOMER_BUSY if it does not. The lease is released however `work`
 * ends; if releasing fails, it expires after `seconds`.
 */
export async function withCustomerLease<T>(
  customerId: string,
  work: () => Promise<T>,
  {
    seconds = LEASE_SECONDS,
    waitMs = 10_000,
    pollMs = 500,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: LeaseOptions = {},
): Promise<T | typeof CUSTOMER_BUSY> {
  const deadline = Date.now() + waitMs;
  let leaseId: string | null = null;

  for (;;) {
    leaseId = await acquireCustomerLease(customerId, seconds);
    if (leaseId || Date.now() >= deadline) break;
    await sleep(pollMs);
  }

  if (!leaseId) return CUSTOMER_BUSY;

  try {
    return await work();
  } finally {
    await releaseCustomerLease(leaseId).catch((error: unknown) =>
      console.error(`Could not release lease ${leaseId}; it expires in ${seconds}s:`, error),
    );
  }
}
