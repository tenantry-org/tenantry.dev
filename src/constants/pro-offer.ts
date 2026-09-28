export interface Offer {
  name: string;
  icon: string;
  description: string;
  features: string[];
  priceId: Record<string, string>;
}

/**
 * The single Tenantry Pro offer (D10). Tenantry Core is free and open source; Pro is one subscription,
 * billed monthly or yearly, with no tiers or seats.
 *
 * Each environment has its own Paddle prices, both belonging to the product named by PADDLE_PRO_PRODUCT_ID:
 * NEXT_PUBLIC_PADDLE_PRICE_MONTHLY and NEXT_PUBLIC_PADDLE_PRICE_YEARLY, checked at startup (server-config.ts).
 * They are compiled into the client build, so changing one needs a redeploy.
 */
export const ProOffer: Offer = {
  name: 'Tenantry Pro',
  icon: '/assets/icons/price-tiers/basic-icon.svg',
  description: 'Physical tenant isolation and the tooling to run it in production.',
  features: [
    'Database-per-tenant, plus schema-per-tenant on SQL Server & PostgreSQL',
    'Tenant provisioning, lifecycle & migration orchestration across tenant databases',
    'EF Core providers (SQL Server, Npgsql, MySQL)',
    'Hangfire, MassTransit, Quartz & Rebus integrations',
    'Audit logging, health checks & OpenTelemetry',
    'Private NuGet package feed',
    'Email support',
  ],
  priceId: {
    month: process.env.NEXT_PUBLIC_PADDLE_PRICE_MONTHLY ?? '',
    year: process.env.NEXT_PUBLIC_PADDLE_PRICE_YEARLY ?? '',
  },
};

/**
 * Whether the Pro offer can be bought. Off unless NEXT_PUBLIC_CHECKOUT_ENABLED is exactly 'true', so a site
 * that is live before sales open (for Paddle's domain review, which needs the public site and its legal
 * pages) takes no payment. Compiled into the client build: changing it needs a redeploy.
 */
export const checkoutEnabled = process.env.NEXT_PUBLIC_CHECKOUT_ENABLED === 'true';

/** Whether a Paddle price id is one of the Pro offer's prices, the only ones the checkout sells. */
export function isOfferPrice(priceId: string): boolean {
  return priceId !== '' && Object.values(ProOffer.priceId).includes(priceId);
}
