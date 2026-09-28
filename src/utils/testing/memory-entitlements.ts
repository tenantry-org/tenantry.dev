import type * as EntitlementsStore from '@/utils/entitlements/entitlements-store';
import type { EntitlementRecord, EntitlementStatus } from '@/utils/entitlements/entitlements-store';

/**
 * In-memory stand-in for entitlements-store.ts, for tests that follow a customer's access through several
 * events. `setCustomerAccess` and `recordLicenceFailure` behave as the `set_customer_access` and
 * `record_licence_failure` database functions do (tested in supabase/tests/database).
 */
interface Licence {
  customerId: string;
  jwt: string;
  tier: string;
  expiresAt: Date;
  revoked: boolean;
}

const state = {
  emails: new Map<string, string>(),
  githubLogins: new Map<string, string>(),
  entitlements: new Map<string, EntitlementRecord>(),
  access: new Map<string, { status: EntitlementStatus; tier: string | null; githubGranted: boolean }>(),
  licences: [] as Licence[],
  licenceFailures: new Map<string, { attempts: number; lastError: string }>(),
};

/** The customer's licences that are not revoked, oldest first. */
function liveLicences(customerId: string): Licence[] {
  return state.licences.filter((licence) => licence.customerId === customerId && !licence.revoked);
}

export const memory = {
  state,
  liveLicences,

  reset() {
    state.emails.clear();
    state.githubLogins.clear();
    state.entitlements.clear();
    state.access.clear();
    state.licences.length = 0;
    state.licenceFailures.clear();
  },

  store: {
    async getCustomerEmail(customerId: string) {
      return state.emails.get(customerId) ?? null;
    },

    async getGithubLogin(customerId: string) {
      return state.githubLogins.get(customerId) ?? null;
    },

    async upsertEntitlement(record: EntitlementRecord) {
      state.entitlements.set(record.subscriptionId, { ...record });
    },

    async listEntitlements(customerId: string) {
      return [...state.entitlements.values()].filter((entitlement) => entitlement.customerId === customerId);
    },

    async setCustomerAccess(customerId: string, status: EntitlementStatus, tier: string | null) {
      const previous = state.access.get(customerId);
      state.access.set(customerId, {
        status,
        tier,
        githubGranted: (previous?.githubGranted ?? false) && status !== 'revoked',
      });
      return previous?.status ?? 'revoked';
    },

    async markGithubGranted(customerId: string) {
      const access = state.access.get(customerId);
      if (access && access.status !== 'revoked') access.githubGranted = true;
    },

    async getCurrentLicence(customerId: string) {
      const licence = liveLicences(customerId).at(-1);
      return licence ? { tier: licence.tier, expiresAt: licence.expiresAt } : null;
    },

    async recordLicence(params: { customerId: string; jwt: string; tier: string; expiresAt: Date }) {
      state.licences.push({ ...params, revoked: false });
    },

    async revokeLicences(customerId: string) {
      for (const licence of liveLicences(customerId)) licence.revoked = true;
    },

    async recordLicenceFailure(customerId: string, error: string) {
      const attempts = (state.licenceFailures.get(customerId)?.attempts ?? 0) + 1;
      state.licenceFailures.set(customerId, { attempts, lastError: error });
      return attempts === 1;
    },

    async clearLicenceFailure(customerId: string) {
      state.licenceFailures.delete(customerId);
    },
  } satisfies Partial<typeof EntitlementsStore>,
};
