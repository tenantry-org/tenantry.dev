import type { EntitlementView } from '@/server/billing/pro-pages';

/** The Pro pages' entitlement in each state a customer can be in, for the components' tests. */
export const ENTITLEMENT = {
  /** Four months of paid time. */
  active: {
    access: 'active',
    graceEndsAt: null,
    canRestore: true,
    vestedThrough: null,
    paidTime: { monthsPaid: 4, vestsAt: '2027-01-01T00:00:00.000Z', reached: false },
    runsTo: null,
    annualTerm: false,
  },
  /** Fourteen months in: vested, and the vested-through date moving forward. */
  vestedActive: {
    access: 'active',
    graceEndsAt: null,
    canRestore: true,
    vestedThrough: '2027-03-01T00:00:00.000Z',
    paidTime: { monthsPaid: 14, vestsAt: '2027-01-01T00:00:00.000Z', reached: true },
    runsTo: null,
    annualTerm: false,
  },
  /** A month into an annual term: vested through its end since it was paid. */
  annual: {
    access: 'active',
    graceEndsAt: null,
    canRestore: true,
    vestedThrough: '2027-10-01T00:00:00.000Z',
    paidTime: { monthsPaid: 12, vestsAt: '2027-10-01T00:00:00.000Z', reached: false },
    runsTo: null,
    annualTerm: true,
  },
  /** An annual term paid on 1 October 2026 and cancelled a day later with nothing refunded. */
  annualLapsed: {
    access: 'lapsed',
    graceEndsAt: null,
    canRestore: true,
    vestedThrough: '2027-10-01T00:00:00.000Z',
    paidTime: null,
    runsTo: null,
    annualTerm: false,
  },
  grace: {
    access: 'grace',
    graceEndsAt: '2026-10-31T00:00:00.000Z',
    canRestore: true,
    vestedThrough: null,
    paidTime: { monthsPaid: 1, vestsAt: '2027-09-01T00:00:00.000Z', reached: false },
    runsTo: null,
    annualTerm: false,
  },
  vestedLapsed: {
    access: 'lapsed',
    graceEndsAt: null,
    canRestore: true,
    vestedThrough: '2027-12-31T00:00:00.000Z',
    paidTime: null,
    runsTo: null,
    annualTerm: false,
  },
  /** Twelve months paid, the twelfth not yet served. */
  twelvePaid: {
    access: 'active',
    graceEndsAt: null,
    canRestore: true,
    vestedThrough: null,
    paidTime: { monthsPaid: 12, vestsAt: '2027-01-01T00:00:00.000Z', reached: false },
    runsTo: null,
    annualTerm: false,
  },
  unvestedLapsed: {
    access: 'lapsed',
    graceEndsAt: null,
    canRestore: false,
    vestedThrough: null,
    paidTime: null,
    runsTo: null,
    annualTerm: false,
  },
  /** Cancelled mid-month with nothing refunded: the time paid for brings the paid time to 12 months on 1 March 2027. */
  unvestedRunningOn: {
    access: 'lapsed',
    graceEndsAt: null,
    canRestore: false,
    vestedThrough: null,
    paidTime: null,
    runsTo: '2027-03-01T00:00:00.000Z',
    annualTerm: false,
  },
  /** Vested, then cancelled mid-month with nothing refunded: the vested-through date moves on to 1 March 2027. */
  vestedRunningOn: {
    access: 'lapsed',
    graceEndsAt: null,
    canRestore: true,
    vestedThrough: '2027-02-10T00:00:00.000Z',
    paidTime: null,
    runsTo: '2027-03-01T00:00:00.000Z',
    annualTerm: false,
  },
} satisfies Record<string, EntitlementView>;
