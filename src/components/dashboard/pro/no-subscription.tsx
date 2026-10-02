import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { NoSubscriptionView } from '@/server/billing/pro-pages';

/** Shown instead of a Pro page that is not for the login: how to get Pro, and why a purchase may not show. */
export function NoSubscription({ view }: Readonly<{ view: NoSubscriptionView }>) {
  return (
    <Card className={'p-6'}>
      <CardHeader className={'p-0'}>
        <CardTitle>No active Tenantry Pro subscription</CardTitle>
      </CardHeader>
      <CardContent className={'p-0 pt-4 flex flex-col gap-4'}>
        <p className={'text-muted-foreground'}>
          Subscribe to Tenantry Pro to get the private package feed and your licence key.
        </p>
        {!view.customer && view.accountEmail && (
          <p className={'text-muted-foreground'}>
            Purchases are matched to accounts by email address, and none was made with{' '}
            <span className={'font-medium text-foreground'}>{view.accountEmail}</span>. If you bought Tenantry Pro with
            another address, log in with an account for that address, or email{' '}
            <a className={'text-link underline underline-offset-4'} href={'mailto:support@tenantry.dev'}>
              support@tenantry.dev
            </a>
            .
          </p>
        )}
        {view.customer && (
          <p className={'text-muted-foreground'}>
            Your invoices, and the payment method of a subscription whose payment failed, are in{' '}
            <Link className={'text-link underline underline-offset-4'} href={'/dashboard/pro/billing'}>
              Billing
            </Link>
            .
          </p>
        )}
        <Button asChild className={'w-fit'}>
          <Link href={'/#pricing'}>View pricing</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
