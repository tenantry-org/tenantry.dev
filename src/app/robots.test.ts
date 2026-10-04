import { beforeEach, describe, expect, it, vi } from 'vitest';
import robots from './robots';

const blog = vi.hoisted(() => ({ draftsShown: vi.fn<() => boolean>() }));
vi.mock('@/lib/blog', () => ({
  draftsShown: blog.draftsShown,
  absoluteUrl: (path: string) => new URL(path, 'https://tenantry.dev').toString(),
}));

describe('robots', () => {
  beforeEach(() => blog.draftsShown.mockReset());

  it('disallows every crawler outside production', () => {
    blog.draftsShown.mockReturnValue(true);
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });

  it('allows search engines and the AI crawlers by name in production, and none of them the private pages', () => {
    blog.draftsShown.mockReturnValue(false);
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];

    expect(result.sitemap).toBe('https://tenantry.dev/sitemap.xml');
    expect(rules.map((rule) => rule.userAgent)).toEqual([
      '*',
      [
        'GPTBot',
        'OAI-SearchBot',
        'ChatGPT-User',
        'ClaudeBot',
        'Claude-SearchBot',
        'Claude-User',
        'PerplexityBot',
        'Perplexity-User',
        'Google-Extended',
        'Applebot-Extended',
        'CCBot',
      ],
    ]);
    for (const rule of rules) {
      expect(rule.allow).toBe('/');
      expect(rule.disallow).toEqual(expect.arrayContaining(['/api/', '/dashboard', '/checkout', '/login']));
    }
  });
});
