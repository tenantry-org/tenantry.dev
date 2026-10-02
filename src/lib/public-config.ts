export type PaddleEnvironment = 'sandbox' | 'production';

/** How often Pro is billed: monthly or yearly, each at its own Paddle price. */
export type BillingInterval = 'month' | 'year';

/** The Pro offer's two Paddle prices, by billing interval. */
export type OfferPrices = Record<BillingInterval, string>;

/**
 * The configuration the browser has: the `NEXT_PUBLIC_` variables it uses, which Next.js compiles into the build, so
 * changing one needs a redeploy. Each environment sets its own, and none has a default. (NEXT_PUBLIC_SITE_URL is not
 * among them: only the server reads it, in server-config.ts.)
 */
export interface PublicConfig {
  supabase: { url: string; anonKey: string };
  paddle: {
    environment: PaddleEnvironment;
    clientToken: string;
    /** Both belong to the product named by PADDLE_PRO_PRODUCT_ID (server-config.ts). */
    prices: OfferPrices;
  };
  /**
   * Whether the Pro offer can be bought: only when NEXT_PUBLIC_CHECKOUT_ENABLED is exactly 'true', so a site that is
   * live before sales open (for Paddle's domain review, which needs the public site and its legal pages) takes no
   * payment.
   */
  checkoutEnabled: boolean;
}

export type Env = Record<string, string | undefined>;

/**
 * Reads the public configuration from `env`, adding a problem for each variable that is missing or invalid. The
 * result is valid only if it added none. The server's startup check uses it too (server-config.ts).
 */
export function readPublicConfig(env: Env, problems: string[]): PublicConfig {
  const value = (name: string) => env[name]?.trim() || undefined;
  const required = (name: string, consequence: string) => {
    const configured = value(name);
    if (!configured) problems.push(`${name} is not set: ${consequence}`);
    return configured ?? '';
  };

  const environment = value('NEXT_PUBLIC_PADDLE_ENV');
  if (environment !== 'sandbox' && environment !== 'production') {
    const actual = environment ? `"${environment}"` : 'not set';
    problems.push(`NEXT_PUBLIC_PADDLE_ENV must be "sandbox" or "production" (it is ${actual}); there is no default`);
  }

  const supabase = {
    url: required('NEXT_PUBLIC_SUPABASE_URL', 'the site cannot reach its database'),
    anonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'the site cannot reach its database'),
  };
  const clientToken = required(
    'NEXT_PUBLIC_PADDLE_CLIENT_TOKEN',
    'Paddle checkout cannot load, so nothing can be bought',
  );

  const price = (name: string) => {
    const id = required(name, 'the Pro offer cannot be bought');
    if (id && !/^pri_[a-z0-9]+$/.test(id)) problems.push(`${name} must be a Paddle price id ("pri_…"); it is "${id}"`);
    return id;
  };
  const prices = {
    month: price('NEXT_PUBLIC_PADDLE_PRICE_MONTHLY'),
    year: price('NEXT_PUBLIC_PADDLE_PRICE_YEARLY'),
  };
  if (prices.month && prices.month === prices.year) {
    problems.push('NEXT_PUBLIC_PADDLE_PRICE_MONTHLY and NEXT_PUBLIC_PADDLE_PRICE_YEARLY are the same price');
  }

  return {
    supabase,
    paddle: { environment: environment as PaddleEnvironment, clientToken, prices },
    checkoutEnabled: value('NEXT_PUBLIC_CHECKOUT_ENABLED') === 'true',
  };
}

export class ConfigError extends Error {
  constructor(
    what: string,
    readonly problems: string[],
  ) {
    const list = problems.map((problem) => `  - ${problem}`).join('\n');
    super(`The ${what} is invalid:\n${list}`);
    this.name = 'ConfigError';
  }
}

/** Freezes a configuration and the plain objects in it. */
export function deepFreeze<T extends object>(config: T): T {
  for (const value of Object.values(config)) {
    if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      deepFreeze(value);
    }
  }
  return Object.freeze(config);
}

// Each variable is named literally: Next.js compiles `process.env.NEXT_PUBLIC_…` into the build only where it appears
// in full, so `process.env[name]` would be undefined in the browser.
function publicEnv(): Env {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_PADDLE_ENV: process.env.NEXT_PUBLIC_PADDLE_ENV,
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
    NEXT_PUBLIC_PADDLE_PRICE_MONTHLY: process.env.NEXT_PUBLIC_PADDLE_PRICE_MONTHLY,
    NEXT_PUBLIC_PADDLE_PRICE_YEARLY: process.env.NEXT_PUBLIC_PADDLE_PRICE_YEARLY,
    NEXT_PUBLIC_CHECKOUT_ENABLED: process.env.NEXT_PUBLIC_CHECKOUT_ENABLED,
  };
}

let checked: PublicConfig | undefined;

/**
 * The public configuration this build was compiled with, checked on first use: it throws a `ConfigError` listing
 * every problem. The pricing section and the checkout page read it while they prerender, so a build without it fails
 * before anything is deployed. The browser, the proxy and those pages use it; other server code uses `serverConfig()`.
 */
export function publicConfig(): PublicConfig {
  if (checked) return checked;

  const problems: string[] = [];
  const config = readPublicConfig(publicEnv(), problems);
  if (problems.length > 0) throw new ConfigError('public configuration', problems);

  return (checked = deepFreeze(config));
}
