import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './server-internal';

const headers = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock('next/headers', () => headers);

describe('the service-role client', () => {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
  );

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    // A signed-in user's request: before the fix, the client read these cookies and sent the user's access
    // token, so its writes ran as that user and RLS rejected them.
    headers.cookies.mockResolvedValue({
      getAll: () => [{ name: 'sb-127-auth-token', value: 'base64-signed-in-session' }],
      set: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('authorises writes with the service-role key, never a signed-in session, and reads no cookies', async () => {
    const client = createClient();

    await client.from('github_links').upsert({ customer_id: 'ctm_1', github_login: 'octocat', github_id: 42 });

    const call = fetchMock.mock.calls.find(([input]) => String(input).includes('/rest/v1/github_links'));
    expect(call).toBeDefined();
    const sent = new Headers(call?.[1]?.headers);
    expect(sent.get('Authorization')).toBe('Bearer service-role-key');
    expect(sent.get('apikey')).toBe('service-role-key');
    expect(headers.cookies).not.toHaveBeenCalled();
  });
});
