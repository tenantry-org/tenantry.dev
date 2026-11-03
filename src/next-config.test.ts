import { describe, expect, it, vi } from 'vitest';
import { getRewrittenUrl, isRewrite, unstable_getResponseFromNextConfig } from 'next/experimental/testing/server';
import nextConfig, { contentSecurityPolicy } from '../next.config.mjs';

// Fumadocs' wrapper compiles the docs when it is loaded; the routing under test is the config's own.
vi.mock('fumadocs-mdx/next', () => ({ createMDX: () => (config: unknown) => config }));

const rewritten = async (url: string) => {
  const response = await unstable_getResponseFromNextConfig({ url, nextConfig });
  return isRewrite(response) ? getRewrittenUrl(response) : null;
};

describe('next.config', () => {
  it("serves each docs page's Markdown at its URL with .md on the end", async () => {
    expect(await rewritten('https://tenantry.dev/docs.md')).toBe('https://tenantry.dev/llms.mdx');
    expect(await rewritten('https://tenantry.dev/docs/core/tenant-stores.md')).toBe(
      'https://tenantry.dev/llms.mdx/core/tenant-stores',
    );
    expect(await rewritten('https://tenantry.dev/docs/v0.5/pro.md')).toBe('https://tenantry.dev/llms.mdx/v0.5/pro');
    expect(await rewritten('https://tenantry.dev/docs/core/tenant-stores')).toBeNull();
  });
});

describe('the security headers', () => {
  const production = { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://abcd1234.supabase.co/' };
  const directives = (env: Record<string, string>) =>
    Object.fromEntries(
      contentSecurityPolicy(env)
        .split('; ')
        .map((directive: string) => {
          const [name, ...sources] = directive.split(' ');
          return [name, sources];
        }),
    );

  it('sends the policy and the permissions policy with every page', async () => {
    const [rule] = await nextConfig.headers!();

    expect(rule.source).toBe('/:path*');
    expect(rule.headers.map(({ key }) => key)).toEqual(
      expect.arrayContaining(['Content-Security-Policy', 'Permissions-Policy', 'X-Frame-Options']),
    );
  });

  it('lets a page send data only to the site, Supabase and Paddle', () => {
    expect(directives(production)['connect-src']).toEqual([
      "'self'",
      'https://abcd1234.supabase.co',
      'https://*.paddle.com',
    ]);
    expect(directives(production)['form-action']).toEqual(["'self'"]);
  });

  it('loads scripts and frames only from the site, Paddle and Turnstile, with no eval in production', () => {
    expect(directives(production)['script-src']).toEqual([
      "'self'",
      "'unsafe-inline'",
      'https://*.paddle.com',
      'https://challenges.cloudflare.com',
    ]);
    expect(directives(production)['frame-src']).toEqual(['https://*.paddle.com', 'https://challenges.cloudflare.com']);
    expect(directives(production)).toMatchObject({
      'frame-ancestors': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
    });
  });

  it("allows the Vercel Toolbar on preview deployments and React's eval in development", () => {
    const preview = directives({ ...production, VERCEL_ENV: 'preview' });
    expect(preview['script-src']).toContain('https://vercel.live');
    expect(preview['frame-src']).toContain('https://vercel.live');
    expect(directives({ ...production, VERCEL_ENV: 'production' })['script-src']).not.toContain('https://vercel.live');
    expect(directives({ ...production, NODE_ENV: 'development' })['script-src']).toContain("'unsafe-eval'");
  });
});
