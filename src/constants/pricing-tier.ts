export interface Tier {
  name: string;
  id: 'starter' | 'pro' | 'advanced';
  icon: string;
  description: string;
  features: string[];
  featured: boolean;
  priceId: Record<string, string>;
}

// NOTE: priceId values below are PLACEHOLDERS from the starter kit. Replace each with the real
// Paddle price ids once the Tenantry Pro products exist (see COMMERCIAL-SETUP.md §4), and keep them
// consistent with PADDLE_PRODUCT_TIER_MAP so webhooks resolve the right tier.
export const PricingTier: Tier[] = [
  {
    name: 'Solo',
    id: 'starter',
    icon: '/assets/icons/price-tiers/free-icon.svg',
    description: 'For a single production application that needs real tenant isolation.',
    features: [
      'Database-per-tenant & schema-per-tenant',
      'Automatic tenant provisioning',
      'EF Core providers (SQL Server, Npgsql, MySQL)',
      'Private NuGet package feed',
      'Email support',
    ],
    featured: false,
    priceId: { month: 'pri_01hsxyh9txq4rzbrhbyngkhy46', year: 'pri_01hsxyh9txq4rzbrhbyngkhy46' },
  },
  {
    name: 'Team',
    id: 'pro',
    icon: '/assets/icons/price-tiers/basic-icon.svg',
    description: 'For teams shipping several multi-tenant services.',
    features: [
      'Everything in Solo',
      'Migration orchestration & tenant lifecycle',
      'Hangfire, MassTransit, Quartz & Rebus integrations',
      'Audit logging & OpenTelemetry',
      'Priority support',
    ],
    featured: true,
    priceId: { month: 'pri_01hsxycme6m95sejkz7sbz5e9g', year: 'pri_01hsxyeb2bmrg618bzwcwvdd6q' },
  },
  {
    name: 'Enterprise',
    id: 'advanced',
    icon: '/assets/icons/price-tiers/pro-icon.svg',
    description: 'For organisations with compliance, scale, and support requirements.',
    features: [
      'Everything in Team',
      'Volume seat licensing',
      'SLA-backed support',
      'Architecture review & onboarding',
      'Custom contractual terms',
    ],
    featured: false,
    priceId: { month: 'pri_01hsxyff091kyc9rjzx7zm6yqh', year: 'pri_01hsxyfysbzf90tkh2wqbfxwa5' },
  },
];
