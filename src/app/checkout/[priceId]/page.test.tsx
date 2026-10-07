import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import CheckoutPage from './page';

const getCurrentUser = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`Redirect to ${url}`);
  }),
);
vi.mock('@/server/db/current-user', () => ({ getCurrentUser }));
vi.mock('next/navigation', () => ({ redirect, notFound: vi.fn() }));
vi.mock('@/lib/public-config', () => ({
  publicConfig: () => ({ checkoutEnabled: true, paddle: { prices: { month: 'pri_month', year: 'pri_year' } } }),
}));
vi.mock('@/components/checkout/checkout-contents', () => ({
  CheckoutContents: ({ userEmail }: { userEmail: string }) => <p>{`Checkout for ${userEmail}`}</p>,
}));

async function render(): Promise<string> {
  const page = <CheckoutPage params={Promise.resolve({ priceId: 'pri_month' })} />;
  // A redirect thrown inside the Suspense boundary is reported here rather than failing the render.
  const { prelude } = await prerender(page, { onError: () => undefined });
  return new Response(prelude).text();
}

describe('CheckoutPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the checkout with a signed-in buyer’s email', async () => {
    getCurrentUser.mockResolvedValue({ email: 'buyer@example.com' });

    await expect(render()).resolves.toContain('Checkout for buyer@example.com');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('sends the buyer to sign up while Auth cannot be reached, rather than failing the page', async () => {
    getCurrentUser.mockRejectedValue(new AuthRetryableFetchError('fetch failed', 0));

    await render();

    expect(redirect).toHaveBeenCalledWith('/signup?next=%2Fcheckout%2Fpri_month');
  });
});
