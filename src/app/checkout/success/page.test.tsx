import { prerender } from 'react-dom/static';
import { describe, expect, it, vi } from 'vitest';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import SuccessPage from './page';

const getCurrentUser = vi.hoisted(() => vi.fn());
vi.mock('@/server/db/current-user', () => ({ getCurrentUser }));
vi.mock('@/components/home/footer/footer', () => ({ Footer: () => null }));

async function render(): Promise<string> {
  const { prelude } = await prerender(<SuccessPage searchParams={Promise.resolve({})} />);
  return new Response(prelude).text();
}

describe('SuccessPage', () => {
  it('sends a signed-in buyer to create a feed token', async () => {
    getCurrentUser.mockResolvedValue({ id: 'user_1' });

    await expect(render()).resolves.toContain('Create a feed token');
  });

  it('asks the buyer to log in while Auth cannot be reached, rather than failing the page', async () => {
    getCurrentUser.mockRejectedValue(new AuthRetryableFetchError('fetch failed', 0));

    const html = await render();

    expect(html).toContain('Thanks for subscribing');
    expect(html).toContain('Log in to create a feed token');
  });
});
