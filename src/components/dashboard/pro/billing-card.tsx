'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { CircleAlert, CircleCheck, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Confirmation } from '@/components/shared/confirmation/confirmation';
import { keepSubscription, openBillingPortal, type BillingPortalTarget } from '@/app/dashboard/pro/billing-actions';
import type { BillingSubscription, ProAccess } from '@/server/billing/pro-access';
import { ProOffer } from '@/constants/pro-offer';

interface Props {
  /** The customer's access; null for a customer who never had any. */
  entitlement: ProAccess['entitlement'];
  subscriptions: BillingSubscription[];
  cardClass: string;
}

type Pending = { kind: 'cancel' | 'keep'; subscriptionId: string } | null;

/**
 * The customer's subscription and billing (6.17). Invoices, invoice details (company and tax ID), payment
 * methods and cancelling are Paddle's hosted customer portal, reached through one-time links. A scheduled
 * cancellation can be undone here (Keep subscription) or in the portal (Don't cancel). Shown to former customers
 * too: one whose grace period ended updates the failed payment method here, and invoices stay available.
 */
export function BillingCard({ entitlement, subscriptions, cardClass }: Props) {
  const { toast } = useToast();
  const [busy, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<Pending>(null);
  // Subscriptions just kept here. Our records change only when Paddle's webhook arrives, seconds later, so
  // until then the card shows them renewing on the date they would have ended (their period end).
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const shown = subscriptions.map((subscription) =>
    kept.has(subscription.id) && subscription.endsAt
      ? { ...subscription, endsAt: null, renewsAt: subscription.endsAt }
      : subscription,
  );
  // When every Pro subscription is set to end, access ends with the last of them.
  const status = entitlement?.status ?? 'revoked';
  const endsAt =
    status === 'active' && shown.length > 0 && shown.every((subscription) => subscription.endsAt)
      ? shown
          .map((subscription) => subscription.endsAt!)
          .sort((a, b) => a.localeCompare(b))
          .at(-1)!
      : null;

  function notify(ok: boolean, title: string, detail: string) {
    toast({
      description: (
        <div className={'flex items-start gap-3'}>
          {ok ? (
            <CircleCheck className={'h-5 w-5 shrink-0 text-success'} />
          ) : (
            <CircleAlert className={'h-5 w-5 shrink-0 text-destructive'} />
          )}
          <div className={'flex flex-col gap-1'}>
            <span className={'text-sm leading-5 font-medium'}>{title}</span>
            <span className={'text-muted-foreground text-sm leading-5'}>{detail}</span>
          </div>
        </div>
      ),
    });
  }

  function openPortal(target: BillingPortalTarget) {
    startTransition(async () => {
      const result = await openBillingPortal(target);
      if ('error' in result) notify(false, 'Could not open billing', result.error);
      else window.location.assign(result.url);
    });
  }

  function confirm() {
    const pending = confirming;
    setConfirming(null);
    if (!pending) return;

    if (pending.kind === 'cancel') {
      openPortal({ kind: 'cancel', subscriptionId: pending.subscriptionId });
      return;
    }

    startTransition(async () => {
      const result = await keepSubscription(pending.subscriptionId);
      if ('error' in result) {
        notify(false, 'Could not keep the subscription', result.error);
        return;
      }
      setKept((previous) => new Set(previous).add(pending.subscriptionId));
      notify(true, 'Cancellation removed', 'Your subscription will renew as normal.');
    });
  }

  return (
    <Card className={cardClass}>
      <CardHeader className={'p-0'}>
        <CardTitle className={'flex items-center justify-between'}>
          <span>Subscription and billing</span>
          <StatusBadge status={status} endsAt={endsAt} />
        </CardTitle>
      </CardHeader>
      <CardContent className={'p-0 pt-4 flex flex-col gap-4'}>
        {status === 'grace' && <GraceNotice grace={entitlement?.grace ?? null} />}
        {status === 'revoked' && (
          <EndedNotice paymentFailed={shown.some((subscription) => subscription.status === 'past_due')} />
        )}

        {shown.map((subscription) => (
          <div
            key={subscription.id}
            className={'flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0'}
          >
            <p className={'text-muted-foreground'}>
              <span className={'font-medium text-foreground'}>{ProOffer.name}</span>
              {subscription.interval ? `, billed ${subscription.interval === 'year' ? 'yearly' : 'monthly'}` : ''}
              {subscription.status === 'past_due' && ', payment overdue'}
              {subscription.status === 'paused' && ', paused'}
            </p>
            <p className={'text-sm text-muted-foreground'}>
              {subscription.endsAt
                ? `Cancelled: it ends on ${formatDate(subscription.endsAt)}, and does not renew.`
                : subscription.renewsAt && ['active', 'trialing'].includes(subscription.status)
                  ? `Renews on ${formatDate(subscription.renewsAt)}.`
                  : null}
            </p>
            <div className={'flex flex-wrap gap-2'}>
              <Button
                size={'sm'}
                variant={'outline'}
                disabled={busy}
                onClick={() => openPortal({ kind: 'payment-method', subscriptionId: subscription.id })}
              >
                Update payment method
              </Button>
              {subscription.endsAt ? (
                <Button
                  size={'sm'}
                  disabled={busy}
                  onClick={() => setConfirming({ kind: 'keep', subscriptionId: subscription.id })}
                >
                  Keep subscription
                </Button>
              ) : (
                <Button
                  size={'sm'}
                  variant={'outline'}
                  disabled={busy}
                  onClick={() => setConfirming({ kind: 'cancel', subscriptionId: subscription.id })}
                >
                  Cancel subscription
                </Button>
              )}
            </div>
          </div>
        ))}

        <div className={'flex flex-col gap-2 border-t border-border pt-4'}>
          <p className={'text-sm text-muted-foreground'}>
            Invoices, the company name and tax ID on them, and your payment methods are in the billing portal, run by
            Paddle, our reseller.
          </p>
          <Button
            className={'w-fit'}
            variant={'outline'}
            disabled={busy}
            onClick={() => openPortal({ kind: 'overview' })}
          >
            Manage billing and invoices <ExternalLink className={'h-4 w-4'} />
          </Button>
        </div>
      </CardContent>

      <Confirmation
        isOpen={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={confirm}
        title={confirming?.kind === 'keep' ? 'Keep your subscription?' : 'Cancel your subscription?'}
        description={
          confirming?.kind === 'keep'
            ? 'The scheduled cancellation is removed, and the subscription renews as normal.'
            : 'It ends at the end of the billing period you have paid for. Until then nothing changes. After it, your access to the private package feed ends, so you cannot install new versions of Tenantry Pro; the versions you already have keep working with your licence key. Paddle, our reseller, asks you to confirm on the next page.'
        }
        confirmLabel={confirming?.kind === 'keep' ? 'Keep subscription' : 'Continue to cancel'}
        destructive={confirming?.kind === 'cancel'}
      />
    </Card>
  );
}

function StatusBadge({ status, endsAt }: Readonly<{ status: string; endsAt: string | null }>) {
  if (endsAt) {
    return (
      <span className={'rounded-full bg-warning-surface px-2.5 py-0.5 text-xs font-medium text-warning'}>
        Ends {new Date(endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
      </span>
    );
  }

  if (status === 'revoked') {
    return (
      <span className={'rounded-full bg-destructive-surface px-2.5 py-0.5 text-xs font-medium text-destructive'}>
        Ended
      </span>
    );
  }

  const tone =
    status === 'active'
      ? 'bg-success-surface text-success'
      : status === 'grace'
        ? 'bg-warning-surface text-warning'
        : 'bg-destructive-surface text-destructive';

  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${tone}`}>{status}</span>;
}

function GraceNotice({ grace }: Readonly<{ grace: { endsAt: string; ended: boolean } | null }>) {
  const ends = grace ? formatDate(grace.endsAt) : null;

  if (grace?.ended) {
    return (
      <p className={'rounded-md bg-warning-surface px-3 py-2 text-sm text-warning'}>
        Your last payment failed, and the 30-day grace period ended on {ends}. Update your payment method to restore
        access.
      </p>
    );
  }

  return (
    <p className={'rounded-md bg-warning-surface px-3 py-2 text-sm text-warning'}>
      Your last payment failed. Your access to the package feed continues{ends ? ` until ${ends}` : ''} while Paddle
      retries it. Update your payment method to keep it.
    </p>
  );
}

// Access has ended: the grace period of a failed payment ran out, or every subscription ended.
function EndedNotice({ paymentFailed }: Readonly<{ paymentFailed: boolean }>) {
  if (paymentFailed) {
    return (
      <p className={'rounded-md bg-warning-surface px-3 py-2 text-sm text-warning'}>
        Your last payment failed and the 30-day grace period is over, so your access to the package feed has ended.
        Update your payment method so Paddle can collect it: access returns when it does.
      </p>
    );
  }

  return (
    <p className={'text-muted-foreground'}>
      Your Tenantry Pro subscription has ended. Your invoices stay available below, and you can{' '}
      <Link className={'text-link underline underline-offset-4'} href={'/#pricing'}>
        subscribe again
      </Link>{' '}
      at any time.
    </p>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
