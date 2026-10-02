import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncGithubLinkForCurrentUser } from '@/server/billing/sync-github-link';
import { GET } from './route';

const auth = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));
vi.mock('@/server/db/user-client', () => ({ createUserClient: async () => ({ auth }) }));
vi.mock('@/server/billing/sync-github-link', () => ({
  syncGithubLinkForCurrentUser: vi.fn(async () => ({ reason: undefined })),
}));

const callback = (query: string) => GET(new Request(`https://tenantry.dev/auth/callback?${query}`));

beforeEach(() => {
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe('the auth callback', () => {
  it('continues to the page the link names', async () => {
    const response = await callback('code=c&next=/dashboard/pro');
    expect(response.headers.get('location')).toBe('https://tenantry.dev/dashboard/pro');
  });

  it('keeps the query string of the page', async () => {
    const response = await callback(`code=c&next=${encodeURIComponent('/dashboard/pro?tab=install')}`);
    expect(response.headers.get('location')).toBe('https://tenantry.dev/dashboard/pro?tab=install');
  });

  it('goes home when the link names no page', async () => {
    const response = await callback('code=c');
    expect(response.headers.get('location')).toBe('https://tenantry.dev/');
  });

  it.each([
    '//evil.example',
    '//',
    '/\\',
    '/\\evil.example',
    '/\t/evil.example',
    '@evil.example',
    '.evil.example',
    'https://evil.example/dashboard',
    'javascript:alert(1)',
  ])('goes home for a next that is not a page on the site: %j', async (next) => {
    const response = await callback(`code=c&next=${encodeURIComponent(next)}`);
    expect(response.headers.get('location')).toBe('https://tenantry.dev/');
  });

  it('sends a GitHub link that failed to the Access page, which explains why', async () => {
    vi.mocked(syncGithubLinkForCurrentUser).mockResolvedValueOnce({
      linked: false,
      granted: false,
      reason: 'link-busy',
    });
    const response = await callback('code=c&next=/dashboard/pro');
    expect(response.headers.get('location')).toBe('https://tenantry.dev/dashboard/pro?error=link-busy');
  });

  it('continues as usual when there was no GitHub link to record', async () => {
    vi.mocked(syncGithubLinkForCurrentUser).mockResolvedValueOnce({
      linked: false,
      granted: false,
      reason: 'no-github-identity',
    });
    const response = await callback('code=c&next=/dashboard/pro/billing');
    expect(response.headers.get('location')).toBe('https://tenantry.dev/dashboard/pro/billing');
  });

  it('sends a link that cannot sign in to the login page', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: { message: 'expired' } });
    const response = await callback('code=c&next=/dashboard/pro');
    expect(response.headers.get('location')).toBe('https://tenantry.dev/login?error=link');
  });
});
