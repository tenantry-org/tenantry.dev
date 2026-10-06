import 'server-only';
import * as billingStore from '@/server/db/billing-store';
import { issueLicence, type LicenceClaims } from '@/server/integrations/licensing/licence-issuer';
import { type EmailMessage, sendEmail } from '@/server/integrations/email/send';
import { alertOperator } from '@/server/integrations/email/alerts';
import { cancelSubscriptionNow } from '@/server/integrations/paddle/cancel-subscription';
import { getSubscription, type PaddleSubscription } from '@/server/integrations/paddle/get-subscription';
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
  /** The subscription as Paddle holds it now, from Paddle's API. */
  getSubscription: (subscriptionId: string) => Promise<PaddleSubscription>;
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
  getSubscription: (subscriptionId) => getSubscription(subscriptionId),
  listCompletedTransactions: (subscriptionIds, billedSince) => listCompletedTransactions(subscriptionIds, billedSince),
  listAdjustments: (subscriptionIds) => listAdjustments(subscriptionIds),
};

/**
 * Every price Pro has been offered at: only a payment at one of them counts. The configured PADDLE_PRICE_MONTHLY and
 * PADDLE_PRICE_YEARLY are added first, so changing them adds the new prices and keeps the old ones counting.
 */
export async function offeredPriceIds(deps: Pick<BillingDeps, 'config' | 'store'>): Promise<string[]> {
  await deps.store.recordOfferedPrices(deps.config.paddle.prices);
  return deps.store.listOfferedPriceIds();
}
