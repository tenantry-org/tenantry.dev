import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BillingSubscription, ProAccess } from '@/utils/entitlements/get-entitlement';
import { BillingView } from './pro-access-view';

vi.mock('@/app/dashboard/pro/actions', () => ({ connectGithub: vi.fn(), switchGithubAccount: vi.fn() }));
vi.mock('@/app/dashboard/pro/billing-actions', () => ({ openBillingPortal: vi.fn(), keepSubscription: vi.fn() }));

const pastDue: BillingSubscription = {
  id: 'sub_1',
  status: 'past_due',
  interval: 'month',
  renewsAt: null,
  endsAt: null,
};

function access(overrides: Partial<ProAccess>): ProAccess {
  return { customerId: 'ctm_1', entitlement: null, licence: null, githubLogin: null, subscriptions: [], ...overrides };
}

function revoked(): ProAccess['entitlement'] {
  return { status: 'revoked', github: 'none', invitationExpiresAt: null, grace: null };
}

const render = (value: ProAccess) => renderToStaticMarkup(<BillingView access={value} accountEmail={null} />);

describe('BillingView', () => {
  it('lets a customer whose grace period ended update the payment method that failed', () => {
    const html = render(access({ entitlement: revoked(), subscriptions: [pastDue] }));

    expect(html).toContain('grace period is over');
    expect(html).toContain('Update payment method');
    expect(html).toContain('Manage billing and invoices');
  });

  it('keeps the invoices of a customer whose subscriptions have all ended', () => {
    const html = render(access({ entitlement: revoked() }));

    expect(html).toContain('subscription has ended');
    expect(html).toContain('Manage billing and invoices');
  });

  it('shows no billing to a login with no billing account', () => {
    const html = render(access({ customerId: null }));

    expect(html).toContain('No active Tenantry Pro subscription');
    expect(html).not.toContain('Manage billing and invoices');
  });
});
