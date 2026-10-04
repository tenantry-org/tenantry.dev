import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ENTITLEMENT } from '@/test/entitlement-views';
import { EntitlementCard } from './entitlement-card';

const render = (entitlement: (typeof ENTITLEMENT)[keyof typeof ENTITLEMENT]) =>
  renderToStaticMarkup(<EntitlementCard entitlement={entitlement} />);

describe('EntitlementCard', () => {
  it('shows a monthly subscriber the paid months of the qualifying period, and when it vests', () => {
    const html = render(ENTITLEMENT.active);

    expect(html).toContain('4 of 12</span> paid months');
    expect(html).toContain('If your subscription continues to 1 January 2027');
    expect(html).not.toContain('vested-through date is');
  });

  it('shows a vested subscriber their vested-through date, and that it moves forward', () => {
    const html = render(ENTITLEMENT.vestedActive);

    expect(html).toContain('reached 12 paid months on 1 January 2027');
    expect(html).toContain('vested-through date is <span class="font-medium text-foreground">1 March 2027</span>');
  });

  it('shows an annual subscriber the grant and the condition it is confirmed on', () => {
    const html = render(ENTITLEMENT.annual);

    expect(html).toContain('Your annual term grants the releases published up to');
    expect(html).toContain('1 October 2027');
    expect(html).toContain('A refund or chargeback of the term withdraws the grant');
    expect(html).not.toContain('paid months');
  });

  it('shows a customer in grace when access ends', () => {
    const html = render(ENTITLEMENT.grace);

    expect(html).toContain('every release until 31 October 2026');
    expect(html).toContain('/dashboard/pro/billing');
  });

  it('shows a lapsed vested customer what the feed serves them, and no progress', () => {
    const html = render(ENTITLEMENT.vestedLapsed);

    expect(html).toContain('serves you the vested releases');
    expect(html).toContain('31 December 2027');
    expect(html).not.toContain('Qualifying period:');
  });

  it('tells a lapsed customer with nothing vested that the feed serves them nothing', () => {
    expect(render(ENTITLEMENT.unvestedLapsed)).toContain(
      'no releases are vested, so the package feed serves you nothing',
    );
  });
});
