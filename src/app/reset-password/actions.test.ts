import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setNewPassword } from './actions';

const auth = vi.hoisted(() => ({ getUser: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/utils/supabase/user-client', () => ({ createUserClient: async () => ({ auth }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: 'user_1' } } });
  auth.updateUser.mockResolvedValue({ data: {}, error: null });
});

describe('setNewPassword', () => {
  it('updates the signed-in customer’s password and opens the dashboard', async () => {
    await expect(setNewPassword('a-new-password')).rejects.toThrow('redirect:/dashboard/pro');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'a-new-password' });
  });

  it('sends a customer with no session to request a new link, changing nothing', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(setNewPassword('a-new-password')).rejects.toThrow('redirect:/forgot-password?expired=1');
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('explains a weak password', async () => {
    auth.updateUser.mockResolvedValue({ data: null, error: { code: 'weak_password', message: 'x' } });
    expect(await setNewPassword('short')).toEqual({ error: expect.stringContaining('stronger password') });
  });
});
