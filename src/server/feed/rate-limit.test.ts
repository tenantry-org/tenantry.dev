import { describe, expect, it, vi } from 'vitest';
import { FEED_RATE_LIMIT_ID, feedRateLimited } from './rate-limit';

// The feed's rate limit, with @vercel/firewall's checkRateLimit stood in for: it follows the firewall's answer, passes
// on no credentials, and lets the request through, with a warning, when there is no answer.

const request = new Request('https://sandbox.example.com/feed/v3/index.json', {
  headers: {
    host: 'sandbox.example.com',
    'x-real-ip': '192.0.2.1',
    authorization: 'Basic dXNlcjp0cGZfc2VjcmV0',
    'x-nuget-apikey': 'publish-key',
  },
});

describe('feedRateLimited', () => {
  it.each([
    ['within the limit', { rateLimited: false }, false],
    ['over the limit', { rateLimited: true }, true],
    ['blocked by the firewall', { rateLimited: true, error: 'blocked' as const }, true],
  ])('follows the firewall for a request %s', async (_, answer, limited) => {
    const check = vi.fn(async () => answer);

    await expect(feedRateLimited(request, check)).resolves.toBe(limited);
    expect(check).toHaveBeenCalledWith(FEED_RATE_LIMIT_ID, {
      headers: { host: 'sandbox.example.com', 'x-real-ip': '192.0.2.1' },
      timeout: 1000,
    });
  });

  it('lets the request through, with a warning, when no rule has the rate limit ID', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(feedRateLimited(request, async () => ({ rateLimited: false, error: 'not-found' }))).resolves.toBe(
      false,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`rate limit ID ${FEED_RATE_LIMIT_ID}`));
  });

  it('lets the request through, with a warning, when the firewall cannot be reached or does not answer in time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unreachable = new Error('Could not determine rate limit key.');

    await expect(
      feedRateLimited(request, async () => {
        throw unreachable;
      }),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      'Package feed: the rate limit could not be checked, so the request goes ahead:',
      unreachable,
    );
  });
});
