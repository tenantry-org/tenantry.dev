import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccessView, FeedTokenView } from '@/server/billing/pro-pages';
import { ENTITLEMENT } from '@/test/entitlement-views';
import { AccessPanel } from './access-panel';

vi.mock('@/app/dashboard/pro/actions', () => ({ createFeedToken: vi.fn(), revokeFeedToken: vi.fn() }));

const token = (n: number): FeedTokenView => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `token ${n}`,
  prefix: 'tpf_ab12',
  createdAt: '2026-10-01T09:00:00.000Z',
  lastUsedAt: n === 1 ? '2026-10-03T10:00:00.000Z' : null,
});

const view = (overrides: Partial<AccessView> = {}): AccessView => ({
  noSubscription: false,
  entitlement: ENTITLEMENT.active,
  tokens: [token(1), token(2)],
  licenceKey: 'licence.key',
  ...overrides,
});

const render = (accessView: AccessView) => renderToStaticMarkup(<AccessPanel view={accessView} />);

describe('AccessPanel', () => {
  it('lists the feed tokens by name, first characters, creation and last use, never the token', () => {
    const html = render(view());

    expect(html).toContain('token 1');
    expect(html).toContain('<code>tpf_ab12…</code>, created 1 October 2026, last used 3 October 2026');
    expect(html).toContain('token 2');
    expect(html).toContain('not used yet');
    expect(html.match(/>Revoke</g)).toHaveLength(2);
    expect(html).toContain('id="feed-token-name"');
    expect(html).not.toMatch(/github/i);
  });

  it('says how many tokens can exist at once, that their use is up to the customer, and whose use they are for', () => {
    const html = render(view());

    expect(html).toContain('Up to 10 can exist at once, and how you use them is up to you');
    expect(html).toContain('They are for your company&#x27;s use only, or yours if you are a single developer.');
  });

  it('shows the licence key, and the access and progress towards vesting', () => {
    const html = render(view());

    expect(html).toContain('licence.key');
    expect(html).toContain('serves you every Tenantry Pro release');
    expect(html).toContain('4 of 12</span> months');
    expect(html).toContain('1 January 2027');
  });

  it('offers no new token once the customer holds 10, and says why', () => {
    const html = render(view({ tokens: Array.from({ length: 10 }, (_, n) => token(n + 1)) }));

    expect(html).toContain('You have 10 feed tokens, the most you can hold at once');
    expect(html).not.toContain('id="feed-token-name"');
  });

  it('lets a lapsed customer with vested releases create tokens, and says what the feed serves them', () => {
    const html = render(view({ entitlement: ENTITLEMENT.vestedLapsed }));

    expect(html).toContain('id="feed-token-name"');
    expect(html).toContain('serves you the vested releases');
    expect(html).toContain('31 December 2027');
    expect(html).toContain('licence.key');
  });

  it('tells a lapsed customer with nothing vested why they cannot restore, and lets them revoke', () => {
    const html = render(view({ entitlement: ENTITLEMENT.unvestedLapsed }));

    expect(html).toContain('no releases are vested, so the package feed serves you nothing');
    expect(html).toContain('No feed token can be created while the package feed serves you nothing');
    expect(html).not.toContain('id="feed-token-name"');
    expect(html.match(/>Revoke</g)).toHaveLength(2);
    expect(html).toContain('licence.key');
  });

  it('shows a login with no billing account how to get Pro', () => {
    const html = renderToStaticMarkup(
      <AccessPanel view={{ noSubscription: true, customer: false, accountEmail: 'someone@example.com' }} />,
    );

    expect(html).toContain('No active Tenantry Pro subscription');
    expect(html).toContain('none was made with');
    expect(html).not.toContain('Feed tokens');
  });
});
