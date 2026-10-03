import { type OfferPrices, publicConfig } from '@/lib/public-config';

export interface Offer {
  name: string;
  description: string;
  features: string[];
}

/** How soon a support email is answered, as the site promises it. */
export const SUPPORT_REPLY_WITHIN = '48 hours';

/**
 * The single Tenantry Pro offer. Tenantry Core is free and open source; Pro is one subscription,
 * billed monthly or yearly, with no tiers or seats. Each environment has its own Paddle prices for it, in the
 * public configuration (src/lib/public-config.ts).
 */
export const ProOffer: Offer = {
  name: 'Tenantry Pro',
  description: 'For a database or schema per tenant: provisioning, migrations, and the tenant in jobs and messages.',
  features: [
    'Tenant databases created, migrated and seeded, on SQL Server, PostgreSQL and MySQL',
    'Offboarding that runs your export steps, then removes the tenant’s database, schema or rows',
    'Migrations across every tenant database or schema, as a deployment step',
    'A schema per tenant (SQL Server, PostgreSQL), and mixed mode',
    'The tenant carried through Hangfire, MassTransit, Quartz.NET and Rebus',
    'Audit logging, tenant health checks, and the tenant on ASP.NET Core’s request metrics',
    'Connection-string caching',
    'Private NuGet package feed',
    `Email support, with a reply within ${SUPPORT_REPLY_WITHIN}`,
  ],
};

/** Whether a Paddle price id is one of the Pro offer's prices, the only ones the checkout sells. */
export function isOfferPrice(priceId: string, prices: OfferPrices = publicConfig().paddle.prices): boolean {
  return priceId === prices.month || priceId === prices.year;
}
