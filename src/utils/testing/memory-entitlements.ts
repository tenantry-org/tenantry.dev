import type * as EntitlementsStore from '@/utils/entitlements/entitlements-store';

type EntitlementRecord = EntitlementsStore.EntitlementRecord;
type EntitlementStatus = EntitlementsStore.EntitlementStatus;
type CustomerAccessRecord = EntitlementsStore.CustomerAccessRecord;
type GithubState = EntitlementsStore.GithubState;

/**
 * In-memory stand-in for entitlements-store.ts, for tests that follow a customer's access through several
 * events. `setCustomerAccess` and `recordLicenceFailure` behave as the `set_customer_access` and
 * `record_licence_failure` database functions do (tested in supabase/tests/database).
 */
interface Licence {
  customerId: string;
  jwt: string;
  revoked: boolean;
}

const state = {
  emails: new Map<string, string>(),
  /** Each customer's linked GitHub account, as github_links records it. */
  githubAccounts: new Map<string, EntitlementsStore.GithubAccount>(),
  /** GitHub itself: each account's current login, by id. Renaming an account changes only this. */
  githubUsers: new Map<number, string>(),
  entitlements: new Map<string, EntitlementRecord>(),
  access: new Map<string, CustomerAccessRecord>(),
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
    state.githubAccounts.clear();
    state.githubUsers.clear();
    state.entitlements.clear();
    state.access.clear();
    state.licences.length = 0;
    state.licenceFailures.clear();
  },

  /** Links a GitHub account to the customer, as connecting it on the dashboard does. */
  linkGithub(customerId: string, login: string, id = 1) {
    state.githubAccounts.set(customerId, { id, login });
    state.githubUsers.set(id, login);
  },

  /** Stands in for provisioning.ts's currentLogin: the account's login on GitHub now. */
  async currentLogin(githubId: number) {
    return state.githubUsers.get(githubId) ?? null;
  },

  store: {
    async getCustomerEmail(customerId: string) {
      return state.emails.get(customerId) ?? null;
    },

    async getGithubAccount(customerId: string) {
      const account = state.githubAccounts.get(customerId);
      return account ? { ...account } : null;
    },

    async setGithubLogin(customerId: string, login: string) {
      const account = state.githubAccounts.get(customerId);
      if (account) account.login = login;
    },

    async upsertEntitlement(record: EntitlementRecord) {
      // As entitlements_grace_started_check does: grace exactly when grace_started_at is set.
      if ((record.status === 'grace') !== (record.graceStartedAt !== null)) {
        throw Object.assign(new Error('violates check constraint "entitlements_grace_started_check"'), {
          code: '23514',
        });
      }
      state.entitlements.set(record.subscriptionId, { ...record });
    },

    async getEntitlement(subscriptionId: string) {
      const entitlement = state.entitlements.get(subscriptionId);
      return entitlement ? { ...entitlement } : null;
    },

    async listEntitlements(customerId: string) {
      return [...state.entitlements.values()].filter((entitlement) => entitlement.customerId === customerId);
    },

    async setCustomerAccess(customerId: string, status: EntitlementStatus) {
      const previous = state.access.get(customerId);
      const ended = status === 'revoked';
      state.access.set(customerId, {
        status,
        githubState: ended ? 'none' : (previous?.githubState ?? 'none'),
        githubInvitedAt: ended ? null : (previous?.githubInvitedAt ?? null),
      });
      return previous?.status ?? 'revoked';
    },

    async getCustomerAccess(customerId: string) {
      const access = state.access.get(customerId);
      return access ? { ...access } : null;
    },

    async resetGithubState(customerId: string) {
      const access = state.access.get(customerId);
      if (!access) return;
      access.githubState = 'none';
      access.githubInvitedAt = null;
    },

    async setGithubState(customerId: string, githubState: Exclude<GithubState, 'none'>) {
      const access = state.access.get(customerId);
      if (!access || access.status === 'revoked') return;
      access.githubState = githubState;
      access.githubInvitedAt = githubState === 'invited' ? new Date() : null;
    },

    async hasLiveLicence(customerId: string) {
      return liveLicences(customerId).length > 0;
    },

    async recordLicence(params: { customerId: string; jwt: string }) {
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
