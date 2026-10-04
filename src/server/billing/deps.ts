import 'server-only';
import type { User } from '@supabase/supabase-js';
import * as billingStore from '@/server/db/billing-store';
import { createUserClient } from '@/server/db/user-client';
import { withCustomerLease } from '@/server/jobs/customer-lease';
import {
  currentLogin,
  grantAccess,
  hasPendingInvitation,
  type Membership,
  membershipOf,
  revokeAccess,
} from '@/server/integrations/github/provisioning';
import { issueLicence, type LicenceClaims } from '@/server/integrations/licensing/licence-issuer';
import { type EmailMessage, sendEmail } from '@/server/integrations/email/send';
import { alertOperator } from '@/server/integrations/email/alerts';
import { cancelSubscriptionNow } from '@/server/integrations/paddle/cancel-subscription';
import { listCompletedTransactions, type PaddleTransaction } from '@/server/integrations/paddle/list-transactions';
import { type ServerConfig, serverConfig } from '@/server/config/server-config';

/** The billing tables (db/billing-store.ts). */
export type BillingStore = typeof billingStore;

/** Team access in the customers' GitHub org (integrations/github/provisioning.ts). */
export interface GithubTeam {
  currentLogin: (githubId: number) => Promise<string | null>;
  grantAccess: (githubLogin: string) => Promise<Membership>;
  revokeAccess: (githubLogin: string) => Promise<void>;
  membershipOf: (githubLogin: string) => Promise<Membership | null>;
  hasPendingInvitation: (githubLogin: string) => Promise<boolean>;
}

/**
 * What the services that change a customer's access use beyond their own rules: the configuration, the billing tables,
 * GitHub, licence signing, email, Paddle, customer leases and the signed-in user. Each of those services
 * (customer-access.ts, reconcile-customer.ts, apply-paddle-event.ts, sync-github-link.ts) takes it as its last
 * argument, and the real ones by default; the tests pass the in-memory store and fakes (src/test/fake-billing-deps.ts).
 */
export interface BillingDeps {
  /** The server's configuration (server-config.ts): the provisioning mode, the Pro product and the site URL. */
  config: ServerConfig;
  store: BillingStore;
  github: GithubTeam;
  issueLicence: (claims: LicenceClaims) => string;
  /** Never throws (send.ts). */
  sendEmail: (message: EmailMessage) => Promise<boolean>;
  /** Never throws (alerts.ts). */
  alertOperator: (subject: string, detail: string) => Promise<void>;
  cancelSubscriptionNow: (subscriptionId: string) => Promise<boolean>;
  /** The completed transactions of these subscriptions billed since the date, from Paddle's API. */
  listCompletedTransactions: (subscriptionIds: string[], billedSince: Date) => Promise<PaddleTransaction[]>;
  withCustomerLease: typeof withCustomerLease;
  /** The signed-in user, read from the request's session, or null. */
  currentUser: () => Promise<User | null>;
}

export const defaultBillingDeps: BillingDeps = {
  // Read when a service runs, never while a module loads (the build loads them without a configuration).
  get config() {
    return serverConfig();
  },
  store: billingStore,
  github: { currentLogin, grantAccess, revokeAccess, membershipOf, hasPendingInvitation },
  issueLicence,
  sendEmail,
  alertOperator,
  cancelSubscriptionNow,
  listCompletedTransactions: (subscriptionIds, billedSince) => listCompletedTransactions(subscriptionIds, billedSince),
  withCustomerLease,
  currentUser: async () => {
    const supabase = await createUserClient();
    const { data } = await supabase.auth.getUser();
    return data.user;
  },
};
