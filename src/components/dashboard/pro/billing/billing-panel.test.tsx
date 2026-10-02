import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BillingSubscription, BillingView, NoSubscriptionView } from '@/server/billing/pro-pages';
import { BillingPanel } from './billing-panel';

vi.mock('@/app/dashboard/pro/billing-actions', () => ({ openBillingPortal: vi.fn(), keepSubscription: vi.fn() }));

const pastDue: BillingSubscription = {
  id: 'sub_1',
  status: 'past_due',
  interval: 'month',
  renewsAt: null,
  endsAt: null,
};

function billing(overrides: Partial<BillingView>): BillingView {
  return { noSubscription: false, access: null, subscriptions: [], ...overrides };
}

const revoked: BillingView['access'] = { status: 'revoked', grace: null };

const render = (view: BillingView | NoSubscriptionView) => renderToStaticMarkup(<BillingPanel view={view} />);

describe('BillingPanel', () => {
  it('lets a customer whose grace period ended update the payment method that failed', () => {
    const html = render(billing({ access: revoked, subscriptions: [pastDue] }));

    expect(html).toContain('grace period is over');
    expect(html).toContain('Update payment method');
    expect(html).toContain('Manage billing and invoices');
  });

  it('keeps the invoices of a customer whose subscriptions have all ended', () => {
    const html = render(billing({ access: revoked }));

    expect(html).toContain('subscription has ended');
    expect(html).toContain('Manage billing and invoices');
  });

  it('shows no billing to a login with no billing account', () => {
    const html = render({ noSubscription: true, customer: false, accountEmail: 'buyer@example.com' });

    expect(html).toContain('No active Tenantry Pro subscription');
    expect(html).toContain('none was made with');
    expect(html).not.toContain('Manage billing and invoices');
  });
});
