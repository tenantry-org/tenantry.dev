import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revalidatePath } from 'next/cache';
import { ENTITLEMENT } from '@/test/entitlement-views';
import { createFeedToken, revokeFeedToken } from './actions';

const mocks = vi.hoisted(() => ({
  customerId: 'ctm_mine' as string | null,
  entitlement: null as unknown,
  user: { email: 'Buyer@Example.com', email_confirmed_at: '2026-09-01T00:00:00Z' } as Record<string, unknown> | null,
  // The feed's tables: tokens by id, each with its customer; create_feed_token refuses an eleventh live one.
  tokens: new Map<string, { customerId: string; revoked: boolean }>(),
  sendEmail: vi.fn(async () => true),
}));
vi.mock('@/server/db/customer-dashboard', () => ({ getCustomerId: async () => mocks.customerId }));
vi.mock('@/server/db/current-user', () => ({ getCurrentUser: async () => mocks.user }));
vi.mock('@/server/billing/pro-pages', () => ({
  FEED_TOKEN_LIMIT: 10,
  readEntitlement: vi.fn(async () => mocks.entitlement),
}));
vi.mock('@/server/feed/feed-tokens', () => ({
  createFeedToken: vi.fn(async (customerId: string) => {
    const live = [...mocks.tokens.values()].filter((t) => t.customerId === customerId && !t.revoked);
    if (live.length >= 10) throw { code: '23514', message: `Customer ${customerId} already has 10 feed tokens` };
    const id = `00000000-0000-4000-8000-${String(mocks.tokens.size + 1).padStart(12, '0')}`;
    mocks.tokens.set(id, { customerId, revoked: false });
    return { id, token: `tpf_${'s'.repeat(43)}`, prefix: 'tpf_ssss' };
  }),
  // As revoke_feed_token: only the customer's own live token.
  revokeFeedToken: vi.fn(async (customerId: string, tokenId: string) => {
    const token = mocks.tokens.get(tokenId);
    if (!token || token.customerId !== customerId || token.revoked) return false;
    token.revoked = true;
    return true;
  }),
}));
vi.mock('@/server/integrations/email/send', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('@/server/config/server-config', () => ({ serverConfig: () => ({ siteUrl: 'https://sandbox.example.com' }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const someoneElsesToken = '00000000-0000-4000-8000-0000000000aa';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.customerId = 'ctm_mine';
  mocks.entitlement = ENTITLEMENT.active;
  mocks.user = { email: 'Buyer@Example.com', email_confirmed_at: '2026-09-01T00:00:00Z' };
  mocks.tokens.clear();
  mocks.tokens.set(someoneElsesToken, { customerId: 'ctm_someone_else', revoked: false });
});

describe('createFeedToken', () => {
  it('creates a token for the signed-in customer and returns it once, never logging it', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const result = await createFeedToken('  Build server  ');

    expect(result).toEqual({ token: `tpf_${'s'.repeat(43)}`, prefix: 'tpf_ssss', name: 'Build server' });
    const { createFeedToken: record } = await import('@/server/feed/feed-tokens');
    expect(record).toHaveBeenCalledWith('ctm_mine', 'Build server');
    expect(JSON.stringify(info.mock.calls)).not.toContain('tpf_s');
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/pro', 'layout');
  });

  it('tells the customer by email, naming the token by its name and first characters only', async () => {
    await createFeedToken('Build server');

    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    const [message] = mocks.sendEmail.mock.calls[0] as unknown as [{ to: string; html: string }];
    expect(message.to).toBe('buyer@example.com');
    expect(message.html).toContain('Build server');
    expect(message.html).toContain('tpf_ssss');
    expect(message.html).not.toContain(`tpf_${'s'.repeat(43)}`);
  });

  it('refuses a login with no billing account', async () => {
    mocks.customerId = null;

    await expect(createFeedToken('CI')).resolves.toEqual({ error: expect.stringContaining('No Tenantry Pro billing') });
    expect(mocks.tokens.size).toBe(1);
  });

  it.each([
    ['no name', '   '],
    ['a name too long', 'x'.repeat(61)],
    ['something other than text', { name: 'CI' }],
  ])('refuses %s', async (_, name) => {
    await expect(createFeedToken(name)).resolves.toEqual({ error: expect.any(String) });
    expect(mocks.tokens.size).toBe(1);
  });

  it('refuses a lapsed customer with nothing vested, saying why, but not a lapsed one with vested releases', async () => {
    mocks.entitlement = ENTITLEMENT.unvestedLapsed;
    await expect(createFeedToken('CI')).resolves.toEqual({
      error: expect.stringContaining('no releases are vested, so the package feed serves you nothing'),
    });
    expect(mocks.tokens.size).toBe(1);

    mocks.entitlement = ENTITLEMENT.vestedLapsed;
    await expect(createFeedToken('CI')).resolves.toMatchObject({ prefix: 'tpf_ssss' });
  });

  it('says so when the customer already holds 10 live tokens', async () => {
    for (let n = 0; n < 10; n++) await createFeedToken(`token ${n}`);

    await expect(createFeedToken('eleventh')).resolves.toEqual({
      error: expect.stringContaining('You have 10 feed tokens, the most you can hold at once'),
    });
  });

  it('hides a failure behind a plain message', async () => {
    const { createFeedToken: record } = await import('@/server/feed/feed-tokens');
    vi.mocked(record).mockRejectedValueOnce(new Error('connection refused to db.internal:5432'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(createFeedToken('CI')).resolves.toEqual({ error: 'Something went wrong. Try again in a moment.' });
  });
});

describe('revokeFeedToken', () => {
  it("revokes one of the customer's own tokens", async () => {
    const created = await createFeedToken('CI');
    const [id] = [...mocks.tokens].find(([, token]) => token.customerId === 'ctm_mine')!;
    expect(created).toHaveProperty('token');
    vi.mocked(revalidatePath).mockClear();

    await expect(revokeFeedToken(id)).resolves.toEqual({ revoked: true });
    expect(mocks.tokens.get(id)?.revoked).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/pro', 'layout');
  });

  it("cannot revoke another customer's token, whatever id the browser sends", async () => {
    await expect(revokeFeedToken(someoneElsesToken)).resolves.toEqual({ error: expect.stringContaining('not found') });
    expect(mocks.tokens.get(someoneElsesToken)?.revoked).toBe(false);
  });

  it('refuses a login with no billing account, and an id that is not a token id', async () => {
    mocks.customerId = null;
    await expect(revokeFeedToken(someoneElsesToken)).resolves.toEqual({ error: expect.any(String) });

    mocks.customerId = 'ctm_mine';
    for (const id of ['', 'not-a-uuid', 42, null]) {
      await expect(revokeFeedToken(id)).resolves.toEqual({ error: 'Feed token not found.' });
    }
    const { revokeFeedToken: revoke } = await import('@/server/feed/feed-tokens');
    expect(revoke).not.toHaveBeenCalled();
  });
});
