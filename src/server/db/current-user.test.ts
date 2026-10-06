import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js';
import { getCurrentUser } from './current-user';

const state = vi.hoisted(() => ({ result: {} as { data: { user: unknown }; error: unknown } }));
vi.mock('@/server/db/user-client', () => ({
  createUserClient: async () => ({ auth: { getUser: async () => state.result } }),
}));

describe('getCurrentUser', () => {
  beforeEach(() => {
    state.result = { data: { user: null }, error: null };
  });

  it('is the signed-in user', async () => {
    state.result = { data: { user: { id: 'user_1' } }, error: null };

    await expect(getCurrentUser()).resolves.toEqual({ id: 'user_1' });
  });

  it('is null when signed out', async () => {
    state.result = { data: { user: null }, error: new AuthSessionMissingError() };

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it('throws when Auth cannot be reached, rather than reading as signed out', async () => {
    const error = new AuthRetryableFetchError('fetch failed', 0);
    state.result = { data: { user: null }, error };

    await expect(getCurrentUser()).rejects.toBe(error);
  });
});
