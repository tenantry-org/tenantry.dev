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
  description:
    'Migrations and provisioning for tenant databases and schemas, the tenant in background jobs and messages, audit logging, and offboarding.',
  features: [
    'Hangfire, Quartz.NET, MassTransit and Rebus work run as the tenant it was created for, and refused for a suspended or deleted tenant',
    'Recurring jobs and background services that run once for each tenant',
    'Audit logging of each tenant’s inserts, updates and deletes',
    'Onboarding and offboarding in one call, including deleting a tenant’s rows from a shared database',
    'Tenant databases created, migrated and seeded, on SQL Server, PostgreSQL and MySQL',
    'Migrations across every tenant database or schema, as a deployment step',
    'A schema per tenant (SQL Server, PostgreSQL), and mixed mode',
    'Tenant health checks and connection-string caching',
    'Private NuGet package feed',
    `Email support, with a reply within ${SUPPORT_REPLY_WITHIN}`,
  ],
};

/** Whether a Paddle price id is one of the Pro offer's prices, the only ones the checkout sells. */
export function isOfferPrice(priceId: string, prices: OfferPrices = publicConfig().paddle.prices): boolean {
  return priceId === prices.month || priceId === prices.year;
}
