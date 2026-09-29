import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateSession } from '@/utils/supabase/middleware';

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: session.user } }) } }),
}));

const request = (path: string) => new NextRequest(new URL(path, 'https://tenantry.dev'));

describe('updateSession', () => {
  beforeEach(() => {
    session.user = null;
  });

  it('redirects a signed-out dashboard request to the login page', async () => {
    const response = await updateSession(request('/dashboard/pro?tab=licence'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://tenantry.dev/login');
  });

  it('lets a signed-in user reach the dashboard', async () => {
    session.user = { id: 'user-1' };

    const response = await updateSession(request('/dashboard/pro'));

    expect(response.headers.get('location')).toBeNull();
  });

  it('lets a signed-out visitor reach public pages', async () => {
    const response = await updateSession(request('/docs/core'));

    expect(response.headers.get('location')).toBeNull();
  });
});
