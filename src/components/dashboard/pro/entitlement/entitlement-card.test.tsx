import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VESTED_RELEASES } from '@/constants/vesting';
import { ENTITLEMENT } from '@/test/entitlement-views';
import { EntitlementCard } from './entitlement-card';

const render = (entitlement: (typeof ENTITLEMENT)[keyof typeof ENTITLEMENT]) =>
  renderToStaticMarkup(<EntitlementCard entitlement={entitlement} />);

describe('EntitlementCard', () => {
  it('shows a monthly subscriber their paid months, and when they vest', () => {
    const html = render(ENTITLEMENT.active);

    expect(html).toContain('4 of 12</span> paid months');
    expect(html).toContain('Your releases start to vest on 1 January 2027 if you keep paying.');
    expect(html).toContain('Paid months add up across subscriptions, gaps included;');
    expect(html).toContain('a refund, credit or chargeback takes away the time its money paid for');
    expect(html).not.toMatch(/qualifying|within an hour|from zero/);
    expect(html).toContain('href="/legal/eula#vesting"');
    expect(html).not.toContain('vested-through date is');
  });

  it('shows a vested subscriber their vested-through date, and that it moves forward', () => {
    const html = render(ENTITLEMENT.vestedActive);

    expect(html).toContain('Your paid time reached 12 paid months on 1 January 2027');
    expect(html).toContain('moves forward as further paid time is served');
    expect(html).not.toContain('end of each paid month');
    expect(html).toContain('vested-through date is <span class="font-medium text-foreground">1 March 2027</span>');
    expect(html).toContain(`Your vested releases are ${VESTED_RELEASES}.`);
  });

  it('does not say 12 months were reached until the twelfth is served', () => {
    const html = render(ENTITLEMENT.twelvePaid);

    expect(html).not.toContain('reached 12 paid months');
    expect(html).toContain('12 of 12</span> paid months');
    expect(html).toContain('Your releases start to vest on 1 January 2027.');
  });

  it('shows an annual subscriber that the term is vested since it was paid, and what withdraws it', () => {
    const html = render(ENTITLEMENT.annual);

    expect(html).toContain('Your annual term is paid.');
    expect(html).toContain('vested-through date is <span class="font-medium text-foreground">1 October 2027</span>');
    expect(html).toContain(
      'A refund, credit or chargeback of any of its payments withdraws its vesting, even after the term',
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
    expect(html).toContain(`The package feed serves you the vested releases: ${VESTED_RELEASES}.`);
    expect(html).not.toContain('moves on to');
    expect(html).not.toContain('Paid time:');
    expect(html).toContain('If you subscribe again, the paid time you have kept still counts');
    expect(html).not.toMatch(/qualifying|an hour/);
  });

  it('tells a lapsed vested customer whose paid time runs on that their date moves on to its end', () => {
    const html = render(ENTITLEMENT.vestedRunningOn);

    expect(html).toContain('vested-through date is <span class="font-medium text-foreground">10 February 2027</span>');
    expect(html).toContain(
      'it moves on to <span class="font-medium text-foreground">1 March 2027</span> as the time you have paid for is served',
    );
  });

  it('tells a lapsed customer whose paid time reaches 12 months after access ends when it vests', () => {
    const html = render(ENTITLEMENT.unvestedRunningOn);

    expect(html).toContain('no releases are vested yet');
    expect(html).toContain(
      'You have paid for time up to <span class="font-medium text-foreground">1 March 2027</span>',
    );
    expect(html).toContain('which brings your paid time to 12 paid months');
    expect(html).toContain('By that date, the releases published up to it become vested');
    expect(html).not.toContain('if you subscribe again');
  });

  it('tells a lapsed customer with nothing vested that the feed serves them nothing', () => {
    expect(render(ENTITLEMENT.unvestedLapsed)).toContain(
      'no releases are vested, so the package feed serves you nothing',
    );
  });
});
