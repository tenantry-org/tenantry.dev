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
 * NOTE: the priceId values are PLACEHOLDERS from the starter kit. Replace them with the Pro product's real
 * Paddle price ids (plan item 6.10); both prices belong to the product named by PADDLE_PRO_PRODUCT_ID.
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
  priceId: { month: 'pri_01hsxycme6m95sejkz7sbz5e9g', year: 'pri_01hsxyeb2bmrg618bzwcwvdd6q' },
};
