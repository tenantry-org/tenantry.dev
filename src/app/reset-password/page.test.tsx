import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import ResetPasswordPage from './page';

const getCurrentUser = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`Redirect to ${url}`);
  }),
);
vi.mock('@/server/db/current-user', () => ({ getCurrentUser }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/components/authentication/reset-password-form', () => ({ ResetPasswordForm: () => <form /> }));

// The errors thrown inside the Suspense boundary, which the browser hands to the nearest error boundary.
async function render(): Promise<{ html: string; errors: unknown[] }> {
  const errors: unknown[] = [];
  const { prelude } = await prerender(<ResetPasswordPage />, { onError: (error) => void errors.push(error) });
  return { html: await new Response(prelude).text(), errors };
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the form to a customer signed in by the reset link', async () => {
    getCurrentUser.mockResolvedValue({ id: 'user_1' });

    const { html, errors } = await render();

    expect(html).toContain('<form>');
    expect(errors).toEqual([]);
  });

  it('sends a visitor with no session to request a new link', async () => {
    getCurrentUser.mockResolvedValue(null);

    await render();

    expect(redirect).toHaveBeenCalledWith('/forgot-password?expired=1');
  });

  it('reports Auth out of reach as a failure, not as an expired link', async () => {
    const outage = new AuthRetryableFetchError('fetch failed', 0);
    getCurrentUser.mockRejectedValue(outage);

    const { errors } = await render();

    expect(errors).toEqual([outage]);
    expect(redirect).not.toHaveBeenCalled();
  });
});
