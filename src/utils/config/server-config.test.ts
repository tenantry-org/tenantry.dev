import { generateKeyPairSync } from 'crypto';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_LICENCE_PUBLIC_KEY, ServerConfigError, validateServerConfig } from './server-config';

// Stand-ins for the two environments' licence keypairs: the "production" public key is passed to the
// validator in place of the real embedded one, whose private half never leaves the production secret store.
function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}
const productionKey = keypair();
const sandboxKey = keypair();

function environment(paddleEnvironment: 'sandbox' | 'production', overrides: Record<string, string | undefined> = {}) {
  return {
    NEXT_PUBLIC_PADDLE_ENV: paddleEnvironment,
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    PADDLE_API_KEY: 'paddle',
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'test_client_token',
    PADDLE_NOTIFICATION_WEBHOOK_SECRET: 'webhook',
    CRON_SECRET: 'cron',
    GITHUB_ORG: paddleEnvironment === 'production' ? 'tenantry-org' : 'tenantry-sandbox',
    GITHUB_TEAM: 'pro-customers',
    GITHUB_APP_ID: '1',
    GITHUB_APP_PRIVATE_KEY: 'app-key',
    GITHUB_APP_INSTALLATION_ID: '2',
    PADDLE_PRO_PRODUCT_ID: 'pro_01',
    NEXT_PUBLIC_PADDLE_PRICE_MONTHLY: 'pri_01month',
    NEXT_PUBLIC_PADDLE_PRICE_YEARLY: 'pri_01year',
    LICENCE_SIGNING_PRIVATE_KEY: paddleEnvironment === 'production' ? productionKey.pem : sandboxKey.pem,
    NEXT_PUBLIC_SITE_URL: 'https://tenantry.dev',
    RESEND_API_KEY: 'resend',
    EMAIL_FROM: 'Tenantry <hello@tenantry.dev>',
    EMAIL_REPLY_TO: 'support@tenantry.dev',
    ALERT_EMAIL: 'ops@tenantry.dev',
    ...overrides,
  };
}

function problems(env: Record<string, string | undefined>): string[] {
  try {
    validateServerConfig(env, productionKey.spki);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(ServerConfigError);
    return (error as ServerConfigError).problems;
  }
}

describe('validateServerConfig', () => {
  it('accepts complete sandbox and production configurations', () => {
    expect(validateServerConfig(environment('sandbox'), productionKey.spki)).toEqual({ paddleEnvironment: 'sandbox' });
    expect(validateServerConfig(environment('production'), productionKey.spki)).toEqual({
      paddleEnvironment: 'production',
    });
  });

  it('throws for a misconfigured production environment, listing every problem', () => {
    const env = environment('production', {
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: undefined,
      GITHUB_ORG: undefined,
      GITHUB_TEAM: ' ',
      PADDLE_PRO_PRODUCT_ID: undefined,
      LICENCE_SIGNING_PRIVATE_KEY: sandboxKey.pem,
      RESEND_API_KEY: undefined,
    });

    expect(() => validateServerConfig(env, productionKey.spki)).toThrow(ServerConfigError);
    expect(problems(env)).toEqual([
      expect.stringContaining('NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is not set'),
      expect.stringContaining('GITHUB_ORG is not set'),
      expect.stringContaining('GITHUB_TEAM is not set'),
      expect.stringContaining('PADDLE_PRO_PRODUCT_ID is not set'),
      expect.stringContaining('is not the production key'),
      expect.stringContaining('RESEND_API_KEY is not set'),
    ]);
  });

  it('has no default Paddle environment', () => {
    expect(problems(environment('sandbox', { NEXT_PUBLIC_PADDLE_ENV: undefined }))).toEqual([
      expect.stringContaining('NEXT_PUBLIC_PADDLE_ENV must be "sandbox" or "production" (it is not set)'),
    ]);
    expect(problems(environment('sandbox', { NEXT_PUBLIC_PADDLE_ENV: 'live' }))).toEqual([
      expect.stringContaining('(it is "live")'),
    ]);
  });

  it('rejects the production signing key outside production', () => {
    expect(problems(environment('sandbox', { LICENCE_SIGNING_PRIVATE_KEY: productionKey.pem }))).toEqual([
      expect.stringContaining('is the production key: sandbox needs its own keypair'),
    ]);
  });

  it('rejects a signing key that is not a valid P-256 private key', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();

    expect(problems(environment('sandbox', { LICENCE_SIGNING_PRIVATE_KEY: 'not a key' }))).toEqual([
      expect.stringContaining('not a valid PKCS#8 private key'),
    ]);
    expect(problems(environment('sandbox', { LICENCE_SIGNING_PRIVATE_KEY: rsa }))).toEqual([
      expect.stringContaining('must be a P-256 EC private key'),
    ]);
  });

  it('rejects an invalid Pro product id and an unknown provisioning mode', () => {
    expect(problems(environment('sandbox', { PADDLE_PRO_PRODUCT_ID: 'pri_01' }))).toEqual([
      expect.stringContaining('must be a Paddle product id'),
    ]);
    expect(problems(environment('sandbox', { PROVISIONING_MODE: 'atuo' }))).toEqual([
      expect.stringContaining('PROVISIONING_MODE must be "manual" or "auto"'),
    ]);
  });

  it("keeps a sandbox server off production's GitHub org and database", () => {
    expect(problems(environment('sandbox', { GITHUB_ORG: 'Tenantry-Org' }))).toEqual([
      expect.stringContaining("GITHUB_ORG is production's org"),
    ]);
    expect(
      problems(environment('sandbox', { NEXT_PUBLIC_SUPABASE_URL: 'https://xoqqgenzhqefyeyzahim.supabase.co/' })),
    ).toEqual([expect.stringContaining("NEXT_PUBLIC_SUPABASE_URL is production's database")]);
    expect(
      problems(environment('production', { NEXT_PUBLIC_SUPABASE_URL: 'https://xoqqgenzhqefyeyzahim.supabase.co' })),
    ).toEqual([]);
  });

  it('needs both Pro prices, as distinct Paddle price ids', () => {
    expect(problems(environment('sandbox', { NEXT_PUBLIC_PADDLE_PRICE_YEARLY: undefined }))).toEqual([
      expect.stringContaining('NEXT_PUBLIC_PADDLE_PRICE_YEARLY is not set'),
    ]);
    expect(problems(environment('sandbox', { NEXT_PUBLIC_PADDLE_PRICE_MONTHLY: 'pro_01month' }))).toEqual([
      expect.stringContaining('must be a Paddle price id'),
    ]);
    expect(problems(environment('sandbox', { NEXT_PUBLIC_PADDLE_PRICE_YEARLY: 'pri_01month' }))).toEqual([
      expect.stringContaining('are the same price'),
    ]);
  });

  it('needs the site URL, email settings and alert address only in production', () => {
    const withoutThem = {
      NEXT_PUBLIC_SITE_URL: undefined,
      RESEND_API_KEY: undefined,
      EMAIL_FROM: undefined,
      EMAIL_REPLY_TO: undefined,
      ALERT_EMAIL: undefined,
    };

    expect(problems(environment('sandbox', withoutThem))).toEqual([]);
    expect(problems(environment('production', withoutThem))).toHaveLength(5);
    expect(problems(environment('production', { ALERT_EMAIL: undefined }))).toEqual([
      expect.stringContaining('ALERT_EMAIL is not set'),
    ]);
  });

  it('refuses to enable checkout in production while the legal entity has placeholders', () => {
    const placeholder = { name: '[COMPANY LEGAL NAME]', address: 'London', registration: 'England' };
    const complete = { name: 'Example Software Ltd', address: 'London', registration: 'England' };
    const checkout = environment('production', { NEXT_PUBLIC_CHECKOUT_ENABLED: 'true' });

    expect(() => validateServerConfig(checkout, productionKey.spki, placeholder)).toThrow(/legal entity/);
    expect(validateServerConfig(checkout, productionKey.spki, complete)).toEqual({ paddleEnvironment: 'production' });
    expect(validateServerConfig(environment('production'), productionKey.spki, placeholder)).toEqual({
      paddleEnvironment: 'production',
    });
    // The sandbox sells test transactions only, so it may run checkout before the entity is set.
    const sandboxCheckout = environment('sandbox', { NEXT_PUBLIC_CHECKOUT_ENABLED: 'true' });
    expect(validateServerConfig(sandboxCheckout, productionKey.spki, placeholder)).toEqual({
      paddleEnvironment: 'sandbox',
    });
  });

  it('checks the real key by default', () => {
    expect(PRODUCTION_LICENCE_PUBLIC_KEY).toMatch(/^MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/);
  });
});
