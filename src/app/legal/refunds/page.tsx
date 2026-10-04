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
        purchase. After 14 days, subscription payments are generally non-refundable. A refund affects vesting as section
        4 sets out.
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
        The terms used here (subscription, paid period, qualifying period, 12 paid months, annual term, the term&apos;s
        grant, vested releases, vested-through date) are defined in the <a href="/legal/eula">EULA</a>, section 2.
        Vesting follows the money you keep: a refund, a credit or a chargeback of a payment takes away the time that
        money paid for, and any vesting that relied on it, whenever it is approved, as that section sets out. For
        example, a refund of half a month&apos;s payment leaves the first half of that month as a paid period: the
        qualifying period continues, and reaches 12 paid months half a month later than it would have. Any refund of an
        annual term withdraws the term&apos;s grant.
      </p>
      <p>
        When a full refund of your subscription&apos;s current billing period is approved, or any of its payments is
        charged back, your subscription is cancelled immediately, and it ends as the EULA, section 8, sets out; if you
        subscribe again more than one hour later, a new qualifying period starts. A full refund of an earlier billing
        period, a partial refund, or a credit does not cancel your subscription or change your access while it
        continues, and your qualifying period continues, counting only the money you keep. If a chargeback is later
        reversed, the money counts as kept again, but your subscription stays cancelled.
      </p>
      <p>
        If the purchase you are refunded in full within the 14-day window was an annual term, its grant is withdrawn and
        the term gives no paid period. A partial refund of an annual term also withdraws its grant, and the term then
        gives a paid period only for the part of it that the money you keep pays for.
      </p>

      <p className="text-sm text-muted-foreground">
        This document is a template and must be reviewed by qualified legal counsel before launch.
      </p>
    </LegalPage>
  );
}
