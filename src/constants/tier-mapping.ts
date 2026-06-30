/**
 * Maps a Paddle product id to a Tenantry entitlement tier.
 *
 * Configure WITHOUT a code change via the `PADDLE_PRODUCT_TIER_MAP` env var (a JSON object of
 * `{ "<paddle_product_id>": "<tier>" }`). When that env var is absent the DEFAULT map below is used.
 *
 * The defaults are PLACEHOLDERS — replace them with the real Paddle product ids (or set the env var)
 * before launch. Unknown products resolve to `null` (no entitlement granted).
 */
const DEFAULT_PRODUCT_TIER_MAP: Record<string, string> = {
  // TODO(launch): replace with the real Paddle product id(s), or set PADDLE_PRODUCT_TIER_MAP.
  pro_REPLACE_WITH_REAL_PRODUCT_ID: 'pro',
};

function loadMap(): Record<string, string> {
  const raw = process.env.PADDLE_PRODUCT_TIER_MAP;

  if (raw) {
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      console.error('PADDLE_PRODUCT_TIER_MAP is not valid JSON; falling back to the default product→tier map.');
    }
  }

  return DEFAULT_PRODUCT_TIER_MAP;
}

/**
 * Resolves the entitlement tier for a Paddle product id, or `null` if the product is unmapped.
 */
export function resolveTier(productId: string | null | undefined): string | null {
  if (!productId) return null;

  return loadMap()[productId] ?? null;
}
