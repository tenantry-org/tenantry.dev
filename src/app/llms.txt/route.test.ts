import { describe, expect, it, vi } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/blog', () => ({ publishedPosts: () => [] }));
vi.mock('@/lib/docs-markdown', () => ({ llmsTxt: () => '# Tenantry\n' }));
vi.mock('@/lib/docs-pages', () => ({ markdownPages: async () => [] }));
vi.mock('@/server/integrations/paddle/get-base-prices', () => ({ basePricesOrNull: async () => null }));

describe('/llms.txt', () => {
  it('lets the CDN keep it for the hour the price is cached for', async () => {
    const response = await GET();

    expect(await response.text()).toBe('# Tenantry\n');
    expect(response.headers.get('Cache-Control')).toBe('public, s-maxage=3600, stale-while-revalidate=86400');
  });
});
