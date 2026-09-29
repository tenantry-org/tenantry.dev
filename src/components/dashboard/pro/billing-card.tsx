'use client';

import { useState, useTransition } from 'react';
import { CircleAlert, CircleCheck, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Confirmation } from '@/components/shared/confirmation/confirmation';
import { keepSubscription, openBillingPortal, type BillingPortalTarget } from '@/app/dashboard/pro/billing-actions';
import type { BillingSubscription, ProAccess } from '@/utils/entitlements/get-entitlement';
import { ProOffer } from '@/constants/pro-offer';

interface Props {
  entitlement: NonNullable<ProAccess['entitlement']>;
  subscriptions: BillingSubscription[];
  cardClass: string;
}

type Pending = { kind: 'cancel' | 'keep'; subscriptionId: string } | null;

/**
 * The customer's subscription and billing (6.17). Invoices, invoice details (company and tax ID), payment
 * methods and cancelling are Paddle's hosted customer portal, reached through one-time links; undoing a
 * scheduled cancellation is ours, as the portal does not offer it.
 */
export function BillingCard({ entitlement, subscriptions, cardClass }: Props) {
  const { toast } = useToast();
  const [busy, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<Pending>(null);

  function notify(ok: boolean, title: string, detail: string) {
    toast({
      description: (
        <div className={'flex items-start gap-3'}>
          {ok ? <CircleCheck size={20} color={'#25F497'} /> : <CircleAlert size={20} color={'#F42566'} />}
          <div className={'flex flex-col gap-1'}>
            <span className={'text-primary font-medium text-sm leading-5'}>{title}</span>
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
      if ('error' in result) notify(false, 'Could not keep the subscription', result.error);
      else notify(true, 'Cancellation removed', 'Your subscription will renew as normal.');
    });
  }

  return (
    <Card className={cardClass}>
      <CardHeader className={'p-0'}>
        <CardTitle className={'flex items-center justify-between'}>
          <span>Subscription and billing</span>
          <StatusBadge status={entitlement.status} />
        </CardTitle>
      </CardHeader>
      <CardContent className={'p-0 pt-4 flex flex-col gap-4'}>
        {entitlement.status === 'grace' && <GraceNotice grace={entitlement.grace} />}

        {subscriptions.map((subscription) => (
          <div
            key={subscription.id}
            className={'flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0'}
          >
            <p className={'text-secondary'}>
              <span className={'text-primary font-medium'}>{ProOffer.name}</span>
              {subscription.interval ? `, billed ${subscription.interval === 'year' ? 'yearly' : 'monthly'}` : ''}
              {subscription.status === 'past_due' && ', payment overdue'}
              {subscription.status === 'paused' && ', paused'}
            </p>
            <p className={'text-secondary text-sm'}>
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
          <p className={'text-secondary text-sm'}>
            Invoices, the company name and tax ID on them, and your payment methods are in the billing portal, run by
            Paddle, our reseller.
          </p>
          <Button
            className={'w-fit'}
            variant={'secondary'}
            disabled={busy}
            onClick={() => openPortal({ kind: 'overview' })}
          >
            Manage billing and invoices <ExternalLink className={'ml-2 h-4 w-4'} />
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

function StatusBadge({ status }: Readonly<{ status: string }>) {
  const tone =
    status === 'active'
      ? 'bg-green-500/15 text-green-400'
      : status === 'grace'
        ? 'bg-yellow-500/15 text-yellow-400'
        : 'bg-red-500/15 text-red-400';

  return <span className={`rounded-xs px-2 py-1 text-xs font-medium ${tone}`}>{status}</span>;
}

function GraceNotice({ grace }: Readonly<{ grace: { endsAt: string; ended: boolean } | null }>) {
  const ends = grace ? formatDate(grace.endsAt) : null;

  if (grace?.ended) {
    return (
      <p className={'text-secondary text-sm'}>
        Your last payment failed, and the 30-day grace period ended on {ends}. Update your payment method to restore
        access.
      </p>
    );
  }

  return (
    <p className={'text-secondary text-sm'}>
      Your last payment failed. Your access to the package feed continues{ends ? ` until ${ends}` : ''} while Paddle
      retries it. Update your payment method to keep it.
    </p>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
