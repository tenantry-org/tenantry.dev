import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { AccountButton } from './account-button';

const getCurrentUser = vi.hoisted(() => vi.fn());
vi.mock('@/server/db/current-user', () => ({ getCurrentUser }));

const render = async () => renderToStaticMarkup(await AccountButton());

describe('AccountButton', () => {
  it('links a signed-in user to the dashboard', async () => {
    getCurrentUser.mockResolvedValue({ id: 'user_1' });

    await expect(render()).resolves.toContain('href="/dashboard/pro"');
  });

  it('shows Sign in while Auth cannot be reached, rather than failing the page', async () => {
    getCurrentUser.mockRejectedValue(new AuthRetryableFetchError('fetch failed', 0));

    const html = await render();

    expect(html).toContain('href="/login"');
    expect(html).toContain('Sign in');
  });
});
