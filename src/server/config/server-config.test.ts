import { generateKeyPairSync, KeyObject } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '@/lib/public-config';
import { PRODUCTION_LICENCE_PUBLIC_KEY, validateServerConfig } from './server-config';

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
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).problems;
  }
}

describe('validateServerConfig', () => {
  it('returns the whole configuration, frozen', () => {
    const config = validateServerConfig(environment('production'), productionKey.spki);

    expect(config).toEqual({
      siteUrl: 'https://tenantry.dev',
      supabase: { url: 'https://project.supabase.co', anonKey: 'anon', serviceRoleKey: 'service' },
      paddle: {
        environment: 'production',
        clientToken: 'test_client_token',
        prices: { month: 'pri_01month', year: 'pri_01year' },
        apiKey: 'paddle',
        webhookSecret: 'webhook',
        proProductId: 'pro_01',
      },
      checkoutEnabled: false,
      github: {
        org: 'tenantry-org',
        team: 'pro-customers',
        app: { appId: '1', privateKey: 'app-key', installationId: '2' },
      },
      licenceSigningKey: expect.any(KeyObject),
      provisioning: 'manual',
      email: { resendApiKey: 'resend', from: 'Tenantry <hello@tenantry.dev>', replyTo: 'support@tenantry.dev' },
      alertEmail: 'ops@tenantry.dev',
      cronSecret: 'cron',
    });
    expect(config.licenceSigningKey.export({ type: 'pkcs8', format: 'pem' })).toBe(productionKey.pem);
    expect([config, config.paddle, config.paddle.prices, config.github.app, config.email].every(Object.isFrozen)).toBe(
      true,
    );
    expect(validateServerConfig(environment('sandbox'), productionKey.spki).paddle.environment).toBe('sandbox');
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

    expect(() => validateServerConfig(env, productionKey.spki)).toThrow(ConfigError);
    expect(() => validateServerConfig(env, productionKey.spki)).toThrow(/^The server configuration is invalid:\n  - /);
    expect(problems(env)).toEqual([
      expect.stringContaining('NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is not set'),
      expect.stringContaining('PADDLE_PRO_PRODUCT_ID is not set'),
      expect.stringContaining('GITHUB_ORG is not set'),
      expect.stringContaining('GITHUB_TEAM is not set'),
      expect.stringContaining('is not the production key'),
      expect.stringContaining('RESEND_API_KEY is not set'),
    ]);
  });

  it('checks the public configuration with the same rules as the browser (public-config.ts)', () => {
    expect(problems(environment('sandbox', { NEXT_PUBLIC_PADDLE_ENV: undefined }))).toEqual([
      expect.stringContaining('NEXT_PUBLIC_PADDLE_ENV must be "sandbox" or "production" (it is not set)'),
    ]);
    expect(problems(environment('sandbox', { NEXT_PUBLIC_PADDLE_PRICE_YEARLY: 'pri_01month' }))).toEqual([
      expect.stringContaining('are the same price'),
    ]);
  });

  it('rejects the production signing key outside production', () => {
    expect(problems(environment('sandbox', { LICENCE_SIGNING_PRIVATE_KEY: productionKey.pem }))).toEqual([
      expect.stringContaining('is the production key: sandbox needs its own keypair'),
    ]);
  });

  it('needs a signing key', () => {
    expect(problems(environment('sandbox', { LICENCE_SIGNING_PRIVATE_KEY: undefined }))).toEqual([
      'LICENCE_SIGNING_PRIVATE_KEY is not set: licences cannot be issued',
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

  it.each([
    ['nothing', undefined, 'PADDLE_PRO_PRODUCT_ID is not set'],
    ['an empty value', '  ', 'PADDLE_PRO_PRODUCT_ID is not set'],
    ['a price id', 'pri_01hsxycme6m95sejkz7sbz5e9g', 'must be a Paddle product id'],
    ['the old tier map', '{"pro_01": "pro"}', 'must be a Paddle product id'],
  ])('rejects %s as the Pro product id', (_, id, problem) => {
    expect(problems(environment('sandbox', { PADDLE_PRO_PRODUCT_ID: id }))).toEqual([expect.stringContaining(problem)]);
  });

  it('provisions automatically only for "auto" (trimmed, any case), and refuses an unknown mode', () => {
    const provisioning = (mode: string | undefined) =>
      validateServerConfig(environment('sandbox', { PROVISIONING_MODE: mode }), productionKey.spki).provisioning;

    expect(provisioning(undefined)).toBe('manual');
    expect(provisioning(' Manual ')).toBe('manual');
    expect(provisioning(' Auto ')).toBe('auto');
    for (const mode of ['atuo', 'true', 'automatic']) {
      expect(problems(environment('sandbox', { PROVISIONING_MODE: mode }))).toEqual([
        expect.stringContaining('PROVISIONING_MODE must be "manual" or "auto"'),
      ]);
    }
  });

  it("needs this environment's own site URL in every environment, as an origin", () => {
    for (const paddleEnvironment of ['sandbox', 'production'] as const) {
      expect(problems(environment(paddleEnvironment, { NEXT_PUBLIC_SITE_URL: undefined }))).toEqual([
        expect.stringContaining('NEXT_PUBLIC_SITE_URL is not set'),
      ]);
    }
    for (const url of [
      'tenantry.dev',
      'ftp://tenantry.dev',
      'https://tenantry.dev/dashboard',
      'https://tenantry.dev/?a=1',
    ]) {
      expect(problems(environment('sandbox', { NEXT_PUBLIC_SITE_URL: url }))).toEqual([
        expect.stringContaining("NEXT_PUBLIC_SITE_URL must be the site's origin"),
      ]);
    }
    const siteUrl = (url: string) =>
      validateServerConfig(environment('sandbox', { NEXT_PUBLIC_SITE_URL: url }), productionKey.spki).siteUrl;
    expect(siteUrl('https://sandbox.tenantry.dev/')).toBe('https://sandbox.tenantry.dev');
    expect(siteUrl('http://localhost:3000')).toBe('http://localhost:3000');
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

  it('needs the email settings and alert address only in production', () => {
    const withoutThem = {
      RESEND_API_KEY: undefined,
      EMAIL_FROM: undefined,
      EMAIL_REPLY_TO: undefined,
      ALERT_EMAIL: undefined,
    };

    const sandbox = validateServerConfig(environment('sandbox', withoutThem), productionKey.spki);
    expect([sandbox.email, sandbox.alertEmail]).toEqual([null, null]);
    expect(problems(environment('production', withoutThem))).toEqual([
      expect.stringContaining('RESEND_API_KEY is not set'),
      expect.stringContaining('EMAIL_FROM is not set'),
      expect.stringContaining('EMAIL_REPLY_TO is not set'),
      expect.stringContaining('ALERT_EMAIL is not set'),
    ]);
    expect(problems(environment('production', { ALERT_EMAIL: undefined }))).toEqual([
      expect.stringContaining('ALERT_EMAIL is not set'),
    ]);
  });

  it('has no default sender: email that is configured anywhere needs EMAIL_FROM', () => {
    expect(problems(environment('sandbox', { EMAIL_FROM: undefined }))).toEqual([
      'EMAIL_FROM is not set: emails need a sender, and there is no default',
    ]);
    const noReplyTo = validateServerConfig(environment('sandbox', { EMAIL_REPLY_TO: ' ' }), productionKey.spki);
    expect(noReplyTo.email).toMatchObject({ replyTo: null });
  });

  it('refuses to enable checkout in production while the legal entity has placeholders', () => {
    const placeholder = { name: '[COMPANY LEGAL NAME]', address: 'London', registration: 'England' };
    const complete = { name: 'Example Software Ltd', address: 'London', registration: 'England' };
    const checkout = environment('production', { NEXT_PUBLIC_CHECKOUT_ENABLED: 'true' });

    expect(() => validateServerConfig(checkout, productionKey.spki, placeholder)).toThrow(/legal entity/);
    expect(validateServerConfig(checkout, productionKey.spki, complete).checkoutEnabled).toBe(true);
    expect(validateServerConfig(environment('production'), productionKey.spki, placeholder)).toBeDefined();
    // The sandbox sells test transactions only, so it may run checkout before the entity is set.
    const sandboxCheckout = environment('sandbox', { NEXT_PUBLIC_CHECKOUT_ENABLED: 'true' });
    expect(validateServerConfig(sandboxCheckout, productionKey.spki, placeholder).checkoutEnabled).toBe(true);
  });

  it('checks the real key by default', () => {
    expect(PRODUCTION_LICENCE_PUBLIC_KEY).toMatch(/^MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/);
  });
});

describe('serverConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('validates the environment once, and keeps the configuration', async () => {
    for (const [name, value] of Object.entries(environment('sandbox'))) vi.stubEnv(name, value);
    // A fresh module: it keeps the configuration it validated.
    const { serverConfig } = await import('./server-config');

    const config = serverConfig();
    expect(config.github.org).toBe('tenantry-sandbox');
    vi.stubEnv('GITHUB_ORG', undefined);
    expect(serverConfig()).toBe(config);
  });

  it('throws while the environment is invalid', async () => {
    for (const [name, value] of Object.entries(environment('sandbox', { CRON_SECRET: undefined }))) {
      vi.stubEnv(name, value);
    }
    const { serverConfig } = await import('./server-config');

    expect(serverConfig).toThrow(/CRON_SECRET is not set/);
  });
});
