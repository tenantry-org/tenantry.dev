import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { updateSession } from '@/server/db/update-session';

const session = vi.hoisted(() => ({ user: null as { id: string } | null, error: null as unknown }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: session.user }, error: session.error }) },
  }),
}));

const request = (path: string) => new NextRequest(new URL(path, 'https://tenantry.dev'));
const supabase = { url: 'http://127.0.0.1:54321', anonKey: 'anon-key' };

describe('updateSession', () => {
  beforeEach(() => {
    session.user = null;
    session.error = null;
  });

  it('redirects a signed-out dashboard request to the login page', async () => {
    const response = await updateSession(request('/dashboard/pro?tab=licence'), supabase);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://tenantry.dev/login');
  });

  it('lets a signed-in user reach the dashboard', async () => {
    session.user = { id: 'user-1' };

    const response = await updateSession(request('/dashboard/pro'), supabase);

    expect(response.headers.get('location')).toBeNull();
  });

  it('does not send a dashboard request to the login page when Auth cannot be reached', async () => {
    session.error = new AuthRetryableFetchError('fetch failed', 0);

    const response = await updateSession(request('/dashboard/pro'), supabase);

    expect(response.headers.get('location')).toBeNull();
  });

  it('lets a signed-out visitor reach public pages', async () => {
    const response = await updateSession(request('/docs/core'), supabase);

    expect(response.headers.get('location')).toBeNull();
  });
});
