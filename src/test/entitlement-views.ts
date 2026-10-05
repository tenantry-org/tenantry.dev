import type { EntitlementView } from '@/server/billing/pro-pages';

/** The Pro pages' entitlement in each state a customer can be in, for the components' tests. */
export const ENTITLEMENT = {
  /** Four months into a monthly qualifying period. */
  active: {
    access: 'active',
    graceEndsAt: null,
    canRestore: true,
    vestedThrough: null,
    qualifying: { monthsPaid: 4, vestsAt: '2027-01-01T00:00:00.000Z', reached: false },
    annualTerm: false,
  },
  /** Fourteen months in: vested, and the vested-through date moving forward. */
  vestedActive: {
    access: 'active',
    graceEndsAt: null,
    canRestore: true,
    vestedThrough: '2027-03-01T00:00:00.000Z',
    qualifying: { monthsPaid: 14, vestsAt: '2027-01-01T00:00:00.000Z', reached: true },
    annualTerm: false,
  },
  /** A month into an annual term: vested through its end since it was paid. */
  annual: {
    access: 'active',
    graceEndsAt: null,
    canRestore: true,
    vestedThrough: '2027-10-01T00:00:00.000Z',
    qualifying: { monthsPaid: 12, vestsAt: '2027-10-01T00:00:00.000Z', reached: false },
    annualTerm: true,
  },
  /** An annual term paid on 1 October 2026 and cancelled a day later with nothing refunded. */
  annualLapsed: {
    access: 'lapsed',
    graceEndsAt: null,
    canRestore: true,
    vestedThrough: '2027-10-01T00:00:00.000Z',
    qualifying: null,
    annualTerm: false,
  },
  grace: {
    access: 'grace',
    graceEndsAt: '2026-10-31T00:00:00.000Z',
    canRestore: true,
    vestedThrough: null,
    qualifying: { monthsPaid: 1, vestsAt: '2027-09-01T00:00:00.000Z', reached: false },
    annualTerm: false,
  },
  vestedLapsed: {
    access: 'lapsed',
    graceEndsAt: null,
    canRestore: true,
    vestedThrough: '2027-12-31T00:00:00.000Z',
    qualifying: null,
    annualTerm: false,
  },
  /** Twelve months paid, the twelfth not yet served. */
  twelvePaid: {
    access: 'active',
    graceEndsAt: null,
    canRestore: true,
    vestedThrough: null,
    qualifying: { monthsPaid: 12, vestsAt: '2027-01-01T00:00:00.000Z', reached: false },
    annualTerm: false,
  },
  unvestedLapsed: {
    access: 'lapsed',
    graceEndsAt: null,
    canRestore: false,
    vestedThrough: null,
    qualifying: null,
    annualTerm: false,
  },
} satisfies Record<string, EntitlementView>;
