import { PricingTier } from '@/constants/pricing-tier';

/**
 * Maps a Paddle product id to a Tenantry entitlement tier, from the `PADDLE_PRODUCT_TIER_MAP` env var: a
 * JSON object of `{ "<paddle_product_id>": "<tier>" }`. Each environment has its own Paddle products, so
 * there is no built-in map; the server does not start without a valid one (see `server-config.ts`).
 */

const KNOWN_TIERS = new Set<string>(PricingTier.map((tier) => tier.id));

/** Parses and checks a product→tier map; throws a message naming what is wrong. */
export function parseTierMap(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) {
    throw new Error('PADDLE_PRODUCT_TIER_MAP is not set: purchases could not be mapped to a tier.');
  }

  let map: unknown;
  try {
    map = JSON.parse(raw);
  } catch {
    throw new Error('PADDLE_PRODUCT_TIER_MAP is not valid JSON.');
  }

  if (typeof map !== 'object' || map === null || Array.isArray(map) || Object.keys(map).length === 0) {
    throw new Error('PADDLE_PRODUCT_TIER_MAP must be a JSON object with at least one "<product id>": "<tier>" entry.');
  }

  for (const [productId, tier] of Object.entries(map)) {
    if (!productId.trim() || typeof tier !== 'string' || !KNOWN_TIERS.has(tier)) {
      throw new Error(
        `PADDLE_PRODUCT_TIER_MAP maps "${productId}" to ${JSON.stringify(tier)}, which is not a tier ` +
          `(${[...KNOWN_TIERS].join(', ')}).`,
      );
    }
  }

  return map as Record<string, string>;
}

/**
 * Resolves the entitlement tier for a Paddle product id, or `null` if the product is unmapped.
 */
export function resolveTier(productId: string | null | undefined): string | null {
  if (!productId) return null;

  return parseTierMap(process.env.PADDLE_PRODUCT_TIER_MAP)[productId] ?? null;
}
