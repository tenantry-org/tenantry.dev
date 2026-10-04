import { describe, expect, it, vi } from 'vitest';
import { getRewrittenUrl, isRewrite, unstable_getResponseFromNextConfig } from 'next/experimental/testing/server';
import nextConfig from '../next.config.mjs';

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
