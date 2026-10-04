import 'server-only';
import * as billingStore from '@/server/db/billing-store';
import { issueLicence, type LicenceClaims } from '@/server/integrations/licensing/licence-issuer';
import { type EmailMessage, sendEmail } from '@/server/integrations/email/send';
import { alertOperator } from '@/server/integrations/email/alerts';
import { cancelSubscriptionNow } from '@/server/integrations/paddle/cancel-subscription';
import { listCompletedTransactions, type PaddleTransaction } from '@/server/integrations/paddle/list-transactions';
import { listAdjustments, type PaddleAdjustment } from '@/server/integrations/paddle/list-adjustments';
import { type ServerConfig, serverConfig } from '@/server/config/server-config';

/** The billing tables (db/billing-store.ts). */
export type BillingStore = typeof billingStore;

/**
 * What the services that change a customer's access use beyond their own rules: the configuration, the billing tables,
 * licence signing, email and Paddle. Each of those services (customer-access.ts, reconcile-customer.ts,
 * apply-paddle-event.ts) takes it as its last argument, and the real ones by default; the tests pass the in-memory store
 * and fakes (src/test/fake-billing-deps.ts).
 */
export interface BillingDeps {
  /** The server's configuration (server-config.ts): the provisioning mode, the Pro product and the site URL. */
  config: ServerConfig;
  store: BillingStore;
  issueLicence: (claims: LicenceClaims) => string;
  /** Never throws (send.ts). */
  sendEmail: (message: EmailMessage) => Promise<boolean>;
  /** Never throws (alerts.ts). */
  alertOperator: (subject: string, detail: string) => Promise<void>;
  cancelSubscriptionNow: (subscriptionId: string) => Promise<boolean>;
  /** The completed transactions of these subscriptions billed since the date, from Paddle's API. */
  listCompletedTransactions: (subscriptionIds: string[], billedSince: Date) => Promise<PaddleTransaction[]>;
  /** Every adjustment of these subscriptions, from Paddle's API. */
  listAdjustments: (subscriptionIds: string[]) => Promise<PaddleAdjustment[]>;
}

export const defaultBillingDeps: BillingDeps = {
  // Read when a service runs, never while a module loads (the build loads them without a configuration).
  get config() {
    return serverConfig();
  },
  store: billingStore,
  issueLicence,
  sendEmail,
  alertOperator,
  cancelSubscriptionNow,
  listCompletedTransactions: (subscriptionIds, billedSince) => listCompletedTransactions(subscriptionIds, billedSince),
  listAdjustments: (subscriptionIds) => listAdjustments(subscriptionIds),
};
