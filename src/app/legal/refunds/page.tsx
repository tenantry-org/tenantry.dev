import { LegalPage } from '@/components/legal/legal-page';

export const metadata = { title: 'Refund Policy — Tenantry' };

export default function RefundsPage() {
  return (
    <LegalPage title="Refund Policy" lastUpdated="2026-10-04">
      <p>
        Tenantry Pro is sold through our merchant of record, Paddle.com. Refunds are handled in accordance with this
        policy and Paddle&apos;s buyer terms.
      </p>

      <h2>1. 14-day refund window</h2>
      <p>
        If you are not satisfied with Tenantry Pro, you may request a full refund within 14 days of your initial
        purchase. After 14 days, subscription payments are generally non-refundable. If that purchase was an annual
        term, a refund also withdraws the term&apos;s grant of a perpetual licence (see section 4).
      </p>

      <h2>2. Renewals</h2>
      <p>
        Subscriptions renew automatically. To avoid a renewal charge, cancel before your renewal date from your account
        dashboard. Renewal charges are generally non-refundable, but contact us if you were charged in error.
      </p>

      <h2>3. How to request a refund</h2>
      <p>
        Email <a href="mailto:support@tenantry.dev">support@tenantry.dev</a> with your purchase email and order
        reference. Approved refunds are issued to the original payment method by Paddle.
      </p>

      <h2>4. Effect on access and vesting</h2>
      <p>
        The terms used here (subscription, paid period, qualifying period, annual term, vested-through date) are defined
        in the <a href="/legal/eula">EULA</a>, section 2, which this section follows. Only refunds and chargebacks that
        have been approved have any effect, and a correction of tax alone has none.
      </p>
      <p>
        When a full refund is approved, or a payment is charged back, your subscription is cancelled immediately and the
        package feed stops serving you the releases that are not vested. The refunded or charged-back period does not
        count towards the 12 consecutive paid months, so a new subscription starts a new qualifying period. A full
        refund of an annual term also withdraws the term&apos;s grant.
      </p>
      <p>
        A partial refund does not cancel your subscription or change your access. A partially refunded monthly period
        still counts in full. A partially refunded annual term counts only up to the moment the refund was approved, so
        the qualifying period is broken there unless another paid period starts then, and the term&apos;s grant is
        withdrawn. A partial refund approved exactly at the end of an annual term still withdraws the term&apos;s grant,
        but the whole term counts towards the 12 consecutive paid months.
      </p>
      <p>
        A credit to a payment, which Paddle makes for example when you change from annual to monthly billing during a
        term, has the same effect on vesting as a refund of the same size. It does not cancel your subscription.
      </p>
      <p>
        A refund approved after your qualifying period has vested, or after an annual term has ended, does not take that
        vesting away. A full refund of a month inside the qualifying period breaks the qualifying period at that month
        from then on, so your vested-through date stops advancing until a new qualifying period reaches 12 months.
      </p>
      <p>
        A charged-back payment never counts towards vesting. If vesting already confirmed relied on it, that vesting is
        withdrawn: your vested-through date is worked out again as if the payment had never been made. If the chargeback
        is later reversed, the payment counts again, but your subscription stays cancelled.
      </p>

      <p className="text-sm text-muted-foreground">
        This document is a template and must be reviewed by qualified legal counsel before launch.
      </p>
    </LegalPage>
  );
}
