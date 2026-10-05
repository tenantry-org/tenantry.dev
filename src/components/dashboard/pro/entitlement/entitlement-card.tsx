import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/components/dashboard/pro/format-date';
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
            <span className={'font-medium text-foreground'}>{formatDate(entitlement.vestedThrough)}</span>. The releases
            published on or before it are vested: they stay licensed to you after the subscription ends, and the package
            feed keeps serving them to you, with every patch release of a minor version whose x.y.0 release is vested,
            whenever it is published.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AccessNow({ entitlement }: Readonly<{ entitlement: EntitlementView }>) {
  const { access, graceEndsAt, vestedThrough } = entitlement;

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
          Your subscription has ended. The package feed serves you the vested releases: every release published on or
          before your vested-through date,{' '}
          <span className={'font-medium text-foreground'}>{formatDate(vestedThrough)}</span>, and every patch release of
          a minor version whose x.y.0 release is vested, whenever it is published. They stay licensed to you. Your feed
          tokens restore them as before.
        </p>
        <p>
          Subscribing again never takes away the vested releases, and the paid time you have kept still counts: your
          vested-through date moves on again as further paid time is served.{' '}
          <Link className={link} href={'/#pricing'}>
            Subscribe again
          </Link>{' '}
          to use later releases.
        </p>
      </>
    );
  }

  return (
    <p className={'rounded-md bg-warning-surface px-3 py-2 text-warning'}>
      Your subscription has ended and no releases are vested, so the package feed serves you nothing and your feed
      tokens restore nothing. The releases you downloaded are no longer licensed to you. The paid time you have kept
      still counts towards 12 months if you subscribe again.{' '}
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
        Your annual term is paid, so every release published up to the end of the term is vested, including those
        published later in the term. A refund, credit or chargeback of the term&apos;s payment withdraws them, even
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
        Your paid time reached 12 months on {formatDate(paidTime.vestsAt)}. Your vested-through date moves forward as
        further paid time is served.
      </p>
    );
  }

  return (
    <p>
      Paid time: <span className={'font-medium text-foreground'}>{paidTime.monthsPaid} of 12</span> months. If your
      subscription continues, 12 paid months are reached on {formatDate(paidTime.vestsAt)}, and your releases then start
      to vest: those published up to your vested-through date, the end of the paid time you have served. Paid time adds
      up across subscriptions, with or without a gap between them. A refund, credit or chargeback of a payment takes
      away the time that money paid for, so 12 paid months are reached later; a full refund of your latest paid billing
      period, or a chargeback of any payment, also cancels your subscription.
    </p>
  );
}
