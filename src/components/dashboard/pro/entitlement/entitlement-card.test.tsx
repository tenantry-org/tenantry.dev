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
    expect(html).toContain('If your subscription continues, 12 paid months are reached on 1 January 2027');
    expect(html).toContain('the start of your qualifying period plus the paid time served');
    expect(html).toContain(
      'A refund, credit or chargeback of a payment takes away the time that money paid for, so 12 paid months are reached later;',
    );
    expect(html).not.toContain('starts again after it');
    expect(html).toContain('and no new one starts within an hour, the qualifying period starts again from zero');
    expect(html).toContain(
      'a full refund of your latest paid billing period, or a chargeback of any payment, also cancels your subscription',
    );
    expect(html).not.toContain('vested-through date is');
  });

  it('shows a vested subscriber their vested-through date, and that it moves forward', () => {
    const html = render(ENTITLEMENT.vestedActive);

    expect(html).toContain('reached 12 paid months on 1 January 2027');
    expect(html).toContain('moves forward as your paid time is served');
    expect(html).not.toContain('end of each paid month');
    expect(html).toContain('vested-through date is <span class="font-medium text-foreground">1 March 2027</span>');
  });

  it('does not say 12 months were reached until the twelfth is served', () => {
    const html = render(ENTITLEMENT.twelvePaid);

    expect(html).not.toContain('reached 12 paid months');
    expect(html).toContain('12 of 12</span> paid months');
    expect(html).toContain('12 paid months are reached on 1 January 2027');
  });

  it('shows an annual subscriber that the term is vested since it was paid, and what withdraws it', () => {
    const html = render(ENTITLEMENT.annual);

    expect(html).toContain('Your annual term is paid, so every release published up to the end of the term is vested');
    expect(html).toContain('including those published later in the term');
    expect(html).toContain('vested-through date is <span class="font-medium text-foreground">1 October 2027</span>');
    expect(html).toContain(
      'A refund, credit or chargeback of the term&#x27;s payment withdraws them, even after the term',
    );
    expect(html).not.toContain('end of the term, on that date');
    expect(html).not.toContain('paid months');
  });

  it('tells an annual subscriber who cancelled mid-term that the feed serves the releases up to the term end', () => {
    const html = render(ENTITLEMENT.annualLapsed);

    expect(html).toContain('Your subscription has ended. The package feed serves you the vested releases');
    expect(html).toContain('1 October 2027');
    expect(html).not.toContain('no releases are vested');
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
    expect(html).toContain('Subscribing again never takes away the vested releases');
    expect(html).toContain('more than an hour after this one ended starts a new qualifying period');
    expect(html).not.toContain('A new subscription starts a new qualifying period');
  });

  it('tells a lapsed customer with nothing vested that the feed serves them nothing', () => {
    expect(render(ENTITLEMENT.unvestedLapsed)).toContain(
      'no releases are vested, so the package feed serves you nothing',
    );
  });
});
