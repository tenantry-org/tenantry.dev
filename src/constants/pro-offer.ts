import { type OfferPrices, publicConfig } from '@/lib/public-config';

export interface Offer {
  name: string;
  description: string;
  features: string[];
}

/**
 * The single Tenantry Pro offer. Tenantry Core is free and open source; Pro is one subscription,
 * billed monthly or yearly, with no tiers or seats. Each environment has its own Paddle prices for it, in the
 * public configuration (src/lib/public-config.ts).
 */
export const ProOffer: Offer = {
  name: 'Tenantry Pro',
  description: 'Provisioning, migrations across tenant databases, and tenant-aware operations.',
  features: [
    'Tenant provisioning, lifecycle & migration orchestration across tenant databases',
    'Provisioning on SQL Server, PostgreSQL & MySQL',
    'Schema-per-tenant (SQL Server & PostgreSQL) and mixed mode',
    'Connection-string caching',
    'Hangfire, MassTransit, Quartz & Rebus integrations',
    'Audit logging, health checks & OpenTelemetry metrics',
    'Private NuGet package feed',
    'Email support',
  ],
};

/** Whether a Paddle price id is one of the Pro offer's prices, the only ones the checkout sells. */
export function isOfferPrice(priceId: string, prices: OfferPrices = publicConfig().paddle.prices): boolean {
  return priceId === prices.month || priceId === prices.year;
}
