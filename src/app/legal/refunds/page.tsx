import { LegalPage } from '@/components/legal/legal-page';

export const metadata = { title: 'Refund Policy | Tenantry' };

export default function RefundsPage() {
  return (
    <LegalPage title="Refund Policy" lastUpdated="2026-10-06">
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
        A refund, credit or chargeback takes away the paid time its money paid for, and any vesting that relied on it,
        as the <a href="/legal/eula#vesting">EULA, section 2</a>, sets out. Any refund of an annual term withdraws the
        term&apos;s grant.
      </p>
      <p>
        A full refund of your subscription&apos;s latest paid billing period, or a chargeback of any of its payments,
        cancels the subscription at once, and it stays cancelled if the chargeback is reversed; the paid time you have
        kept still counts if you subscribe again. A partial refund, a credit or a full refund of an earlier billing
        period does not cancel it.
      </p>

      <p className="text-sm text-muted-foreground">
        This document is a template and must be reviewed by qualified legal counsel before launch.
      </p>
    </LegalPage>
  );
}
