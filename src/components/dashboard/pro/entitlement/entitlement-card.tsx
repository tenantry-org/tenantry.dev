import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/components/dashboard/pro/format-date';
import { VESTED_RELEASES, VESTING_RULES } from '@/constants/vesting';
import type { EntitlementView } from '@/server/billing/pro-pages';

const link = 'text-link underline underline-offset-4';

/**
 * Which Tenantry Pro releases the customer may use, and restore from the package feed: all of them while subscribed or
 * in grace, the vested releases after a lapse, or none. With how far they are towards vesting more. The Access and
 * Billing pages both show it, from the same read (pro-pages.ts: readEntitlement), which applies the rules the feed
 * applies.
 */
export function EntitlementCard({ entitlement }: Readonly<{ entitlement: EntitlementView }>) {
  return (
    <Card className={'p-6'}>
      <CardHeader className={'p-0'}>
        <CardTitle>Releases you may use</CardTitle>
      </CardHeader>
      <CardContent className={'p-0 pt-4 flex flex-col gap-3 text-sm text-muted-foreground'}>
        <AccessNow entitlement={entitlement} />
        {entitlement.access !== 'lapsed' && <Progress entitlement={entitlement} />}
        {entitlement.access !== 'lapsed' && entitlement.vestedThrough && (
          <p>
            Your vested-through date is{' '}
            <span className={'font-medium text-foreground'}>{formatDate(entitlement.vestedThrough)}</span>. Your vested
            releases are {VESTED_RELEASES}. They stay licensed to you after the subscription ends, and the package feed
            keeps serving them.
          </p>
        )}
        <p>
          <Link className={link} href={VESTING_RULES}>
            How vesting works
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

function AccessNow({ entitlement }: Readonly<{ entitlement: EntitlementView }>) {
  const { access, graceEndsAt, vestedThrough, runsTo } = entitlement;

  if (access === 'active') {
    return <p>Your subscription is active, so the package feed serves you every Tenantry Pro release.</p>;
  }

  if (access === 'grace') {
    return (
      <p className={'rounded-md bg-warning-surface px-3 py-2 text-warning'}>
        Your last payment failed. The package feed serves you every release until{' '}
        {graceEndsAt ? formatDate(graceEndsAt) : 'the end of the 30-day grace period'} while Paddle retries it. Update
        your payment method in{' '}
        <Link className={link} href={'/dashboard/pro/billing'}>
          Billing
        </Link>{' '}
        to keep it.
      </p>
    );
  }

  if (vestedThrough) {
    return (
      <>
        <p>
          Your subscription has ended. The package feed serves you the vested releases: {VESTED_RELEASES}. Your
          vested-through date is <span className={'font-medium text-foreground'}>{formatDate(vestedThrough)}</span>
          {runsTo && (
            <>
              , and it moves on to <span className={'font-medium text-foreground'}>{formatDate(runsTo)}</span> as the
              time you have paid for is served
            </>
          )}
          . The vested releases stay licensed to you, and your feed tokens restore them as before.
        </p>
        <p>
          If you subscribe again, the paid time you have kept still counts, and your vested-through date moves on as you
          pay.{' '}
          <Link className={link} href={'/#pricing'}>
            Subscribe again
          </Link>{' '}
          to use other releases.
        </p>
      </>
    );
  }

  if (runsTo) {
    return (
      <p>
        Your subscription has ended, and no releases are vested yet. You have paid for time up to{' '}
        <span className={'font-medium text-foreground'}>{formatDate(runsTo)}</span>, which brings your paid time to 12
        paid months. By that date, the releases published up to it become vested, unless money for that time is
        returned. Until they do, the package feed serves you nothing, and the releases you downloaded are not licensed
        for use.
      </p>
    );
  }

  return (
    <p className={'rounded-md bg-warning-surface px-3 py-2 text-warning'}>
      Your subscription has ended and no releases are vested, so the package feed serves you nothing and your feed
      tokens restore nothing. The releases you downloaded are no longer licensed to you. The paid time you have kept
      still counts towards 12 paid months if you subscribe again.{' '}
      <Link className={link} href={'/#pricing'}>
        Subscribe again
      </Link>{' '}
      to restore Tenantry Pro.
    </p>
  );
}

// How far the customer is towards vesting: an annual term vested when paid, while it lasts, or their paid time (the
// time the money kept pays for), which adds up across subscriptions.
function Progress({ entitlement }: Readonly<{ entitlement: EntitlementView }>) {
  const { annualTerm, paidTime } = entitlement;

  if (annualTerm) {
    return (
      <p>
        Your annual term is paid. A refund, credit or chargeback of any of its payments withdraws its vesting, even
        after the term.
      </p>
    );
  }

  if (!paidTime) {
    return <p>No paid period is recorded yet. Your paid time starts with your first payment.</p>;
  }

  if (paidTime.reached) {
    return (
      <p>
        Your paid time reached 12 paid months on {formatDate(paidTime.vestsAt)}. Your vested-through date moves forward
        as further paid time is served.
      </p>
    );
  }

  return (
    <p>
      Paid time: <span className={'font-medium text-foreground'}>{paidTime.monthsPaid} of 12</span> paid months. Your
      releases start to vest on {formatDate(paidTime.vestsAt)}
      {paidTime.monthsPaid < 12 && ' if you keep paying'}. Paid months add up across subscriptions, gaps included; a
      refund, credit or chargeback takes away the time its money paid for.
    </p>
  );
}
