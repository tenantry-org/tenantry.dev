import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPublicConfig } from './public-config';

const complete = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  NEXT_PUBLIC_PADDLE_ENV: 'sandbox',
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: ' test_client_token ',
  NEXT_PUBLIC_PADDLE_PRICE_MONTHLY: 'pri_01month',
  NEXT_PUBLIC_PADDLE_PRICE_YEARLY: 'pri_01year',
  NEXT_PUBLIC_CHECKOUT_ENABLED: 'true',
};

function read(env: Record<string, string | undefined>) {
  const problems: string[] = [];
  return { config: readPublicConfig(env, problems), problems };
}

describe('readPublicConfig', () => {
  it('reads each setting, trimmed', () => {
    expect(read(complete)).toEqual({
      config: {
        supabase: { url: 'https://project.supabase.co', anonKey: 'anon' },
        paddle: {
          environment: 'sandbox',
          clientToken: 'test_client_token',
          prices: { month: 'pri_01month', year: 'pri_01year' },
        },
        checkoutEnabled: true,
      },
      problems: [],
    });
  });

  it('has no default Paddle environment', () => {
    expect(read({ ...complete, NEXT_PUBLIC_PADDLE_ENV: undefined }).problems).toEqual([
      'NEXT_PUBLIC_PADDLE_ENV must be "sandbox" or "production" (it is not set); there is no default',
    ]);
    expect(read({ ...complete, NEXT_PUBLIC_PADDLE_ENV: 'live' }).problems).toEqual([
      expect.stringContaining('(it is "live")'),
    ]);
  });

  it('needs the database and the Paddle client token', () => {
    expect(
      read({
        ...complete,
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ' ',
        NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: undefined,
      }).problems,
    ).toEqual([
      expect.stringContaining('NEXT_PUBLIC_SUPABASE_URL is not set'),
      expect.stringContaining('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set'),
      expect.stringContaining('NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is not set'),
    ]);
  });

  it('needs both Pro prices, as distinct Paddle price ids', () => {
    expect(read({ ...complete, NEXT_PUBLIC_PADDLE_PRICE_YEARLY: undefined }).problems).toEqual([
      expect.stringContaining('NEXT_PUBLIC_PADDLE_PRICE_YEARLY is not set'),
    ]);
    expect(read({ ...complete, NEXT_PUBLIC_PADDLE_PRICE_MONTHLY: 'pro_01month' }).problems).toEqual([
      expect.stringContaining('must be a Paddle price id'),
    ]);
    expect(read({ ...complete, NEXT_PUBLIC_PADDLE_PRICE_YEARLY: 'pri_01month' }).problems).toEqual([
      expect.stringContaining('are the same price'),
    ]);
  });

  it('keeps the checkout closed unless it is explicitly enabled', () => {
    for (const [value, open] of [
      [undefined, false],
      ['false', false],
      ['1', false],
      ['true', true],
    ] as const) {
      expect(read({ ...complete, NEXT_PUBLIC_CHECKOUT_ENABLED: value }).config.checkoutEnabled).toBe(open);
    }
  });

  it('refuses checkout in production while the legal entity has placeholders, so the build fails', () => {
    const placeholder = { name: '[COMPANY LEGAL NAME]', address: 'London', registration: 'England' };
    const named = { name: 'Example Software Ltd', address: 'London', registration: 'England' };
    const production = { ...complete, NEXT_PUBLIC_PADDLE_ENV: 'production' };
    const readWith = (env: Record<string, string | undefined>, entity: Record<string, string>) => {
      const problems: string[] = [];
      readPublicConfig(env, problems, entity);
      return problems;
    };

    expect(readWith(production, placeholder)).toEqual([expect.stringContaining('legal entity')]);
    expect(readWith(production, named)).toEqual([]);
    expect(readWith({ ...production, NEXT_PUBLIC_CHECKOUT_ENABLED: undefined }, placeholder)).toEqual([]);
    // The sandbox sells test transactions only, so it may run checkout before the entity is set.
    expect(readWith(complete, placeholder)).toEqual([]);
  });
});

describe('publicConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load(env: Record<string, string | undefined>) {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    // A fresh module each time: it keeps the configuration it checked.
    return import('./public-config');
  }

  it('checks the configuration once and keeps it, frozen', async () => {
    const { publicConfig } = await load(complete);

    const config = publicConfig();
    expect(config.paddle.prices).toEqual({ month: 'pri_01month', year: 'pri_01year' });
    expect(publicConfig()).toBe(config);
    expect(Object.isFrozen(config) && Object.isFrozen(config.paddle.prices)).toBe(true);
  });

  it('throws, listing every problem, when the configuration is invalid', async () => {
    const { publicConfig, ConfigError } = await load({
      ...complete,
      NEXT_PUBLIC_PADDLE_ENV: undefined,
      NEXT_PUBLIC_SUPABASE_URL: '',
    });

    expect(publicConfig).toThrow(ConfigError);
    expect(publicConfig).toThrow(/NEXT_PUBLIC_PADDLE_ENV must be[\s\S]*NEXT_PUBLIC_SUPABASE_URL is not set/);
  });
});
