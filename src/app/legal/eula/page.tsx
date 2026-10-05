import { LegalPage } from '@/components/legal/legal-page';
import { LegalEntity } from '@/constants/legal-entity';

export const metadata = { title: 'End User Licence Agreement | Tenantry Pro' };

export default function EulaPage() {
  return (
    <LegalPage title="End User Licence Agreement (Tenantry Pro)" lastUpdated="2026-10-05">
      <p>
        This End User Licence Agreement (&quot;EULA&quot;) is between you (or the entity you represent) and{' '}
        {LegalEntity.name}, {LegalEntity.registration}, whose registered office is at {LegalEntity.address}, the
        licensor (&quot;Tenantry&quot;). It governs your use of the Tenantry Pro software packages (the
        &quot;Software&quot;). Tenantry Core is licensed separately under Apache 2.0 and is not covered by this EULA.
      </p>

      <h2>1. Licence grant</h2>
      <p>
        Subject to your compliance with this EULA, Tenantry grants you a non-exclusive, non-transferable licence to
        install and use the Software in any number of your own applications, in development, testing and production.
        Your employees, and contractors working for you, may use it on your behalf; one subscription covers all of them.
        The licence covers:
      </p>
      <ul>
        <li>every release of the Software, while your subscription is active (section 2);</li>
        <li>the vested releases (section 2), perpetually, including after your subscription ends.</li>
      </ul>
      <p>It ends only as section 8 provides.</p>

      <h2>2. Subscriptions and vesting</h2>
      <p>
        Your subscription is active while any Tenantry Pro subscription you hold is in force, and for up to 30 days
        after a renewal payment first fails, while Paddle tries to collect it. It ends when it is cancelled or paused,
        or when those 30 days pass without the payment being collected. All dates and times in this section are in UTC.
      </p>
      <p>
        Vesting follows the money you keep: paid time adds up across consecutive billing periods and vests at 12 months,
        and money returned to you takes away the time it paid for. Each payment for a billing period of any of your
        Tenantry Pro subscriptions, at a monthly or yearly price this site has offered, gives a paid period: the part of
        that billing period that the money kept from the payment pays for, counted from the start of the billing period.
        A payment kept in full gives the whole billing period, even if the subscription was cancelled or paused before
        the period ended. If part of a payment has been returned to you, the paid period is the same share of the
        billing period as the share of the payment you kept: if half of a month&apos;s payment is refunded, the paid
        period is the first half of that month. A payment of which everything has been returned, or for which nothing
        was charged (a trial, or a period discounted to zero), gives no paid period. Amounts are compared before tax. A
        discount does not count as money returned, so a discounted payment that you keep gives the whole billing period.
      </p>
      <p>
        Money is returned to you by a refund, a credit or a chargeback once it has been approved. A correction of tax
        alone returns nothing. If a chargeback or a credit is reversed, the money it returned counts as kept again. Your
        paid periods, and everything that follows from them in this section, are always worked out from your payments as
        they stand: money returned after a vesting takes away the time it paid for and any vesting that relied on that
        time, and a reversal restores it.
      </p>
      <p>
        A qualifying period is a series of billing periods, at a monthly or yearly price this site has offered, in which
        each billing period starts no more than one hour after the end of the billing periods before it. A billing
        period whose subscription ended before the period did reaches only to when the subscription ended, though its
        paid period still counts in full. A gap of more than one hour breaks a qualifying period, for example when your
        subscription ends and no billing period follows within the hour, or a renewal is not paid; the next billing
        period then starts a new qualifying period from zero. Money returned does not by itself break a qualifying
        period: a billing period of which part or all of the payment was returned, or for which nothing was charged,
        continues it, and adds only its paid period, if any. But a full refund of your subscription&apos;s latest paid
        billing period, or a chargeback of any of its payments, cancels the subscription at once (refund policy, section
        4); that is the subscription ending, so a new subscription more than one hour later starts a new qualifying
        period. If a chargeback is reversed, the subscription stays cancelled. A qualifying period starts at the start
        of its first billing period for which something was charged.
      </p>
      <p>
        The paid time of a qualifying period is the total length of its paid periods, counting any time in which they
        overlap, as when you change plan, once. It vests when the paid time served, from its start to the present time,
        adds up to the length of the 12 calendar months from its start (&quot;12 paid months&quot;). If every billing
        period in it so far was kept in full, it vests at the end of one of them that falls no more than three days
        short of that, which allows for billing dates at the end of shorter months. Once it has vested, its
        vested-through date is its start plus the paid time served in it so far: the date moves on as more paid time is
        served, and is never later than the present time. For example, if half of the sixth month&apos;s payment is
        refunded and you pay for 13 months, the qualifying period has 12 and a half months of paid time: it vests half a
        month into the thirteenth month, and its vested-through date reaches 12 and a half months after its start at the
        end of the thirteenth month.
      </p>
      <p>
        When you pay a yearly price this site has offered for an annual billing period (an &quot;annual term&quot;),
        Tenantry grants you at once, on condition that you keep the whole payment, that every release whose release date
        is on or before the end of the term is vested (the &quot;term&apos;s grant&quot;). From when you pay, the end of
        the term is a vested-through date, even if your subscription ends before the term does. Any refund, credit or
        chargeback of the payment withdraws the term&apos;s grant, at any time, including after the term has ended. The
        part of the term that the money kept pays for is still a paid period.
      </p>
      <p>
        Your vested-through date is the latest vested-through date of any of your qualifying periods or annual terms.
        Your subscription ending, or a new qualifying period starting, does not reduce it; only money returned to you
        can, as set out above.
      </p>
      <p>
        Each release of the Software has a release date: the date Tenantry records for it when it is published on the
        package feed. A patch release that Tenantry publishes as a security fix takes the release date of the first
        release of the minor version it patches (for example, 1.4.3 takes the date of 1.4.0). A release is vested if its
        release date is on or before your vested-through date.
      </p>

      <h2>3. The package feed and feed tokens</h2>
      <p>
        Tenantry delivers the Software through a private NuGet package feed that Tenantry runs (the &quot;package
        feed&quot;). While your subscription is active, the package feed serves you every release. After your
        subscription ends, it serves you the vested releases, and nothing if you have no vested-through date. It does
        not affect copies you have already downloaded: whether you may use those is set by section 1.
      </p>
      <p>
        You access the package feed with feed tokens, which you create and revoke on your Pro access page. They are
        credentials for your account. You may give them to your employees and contractors and use them in your own build
        systems, and you must keep them secret. Unlike your licence key, a feed token may not be included in an
        application you distribute.
      </p>

      <h2>4. Distribution in your applications</h2>
      <p>
        You may distribute the Software in object-code form as an embedded part of your applications, to your customers
        and end users, including in applications they install or host themselves. They may use it only as part of your
        application, not on its own. Your licence key may be included in an application you distribute, as part of its
        configuration; your feed tokens may not (section 3).
      </p>

      <h2>5. Restrictions</h2>
      <ul>
        <li>
          Except as section 4 allows, you may not redistribute, sublicense, resell, or publish the Software or its
          source code.
        </li>
        <li>You may not remove or alter licensing, provenance, or copyright notices.</li>
        <li>You may not share your feed tokens with non-licensed parties.</li>
      </ul>

      <h2>6. Licence keys</h2>
      <p>
        Tenantry issues you a signed licence key, which the Software verifies offline when your application starts: it
        does not start without a valid key. The key does not expire or change, so you configure it once, and you keep it
        after your subscription ends. Ending your subscription, a refund or a chargeback does not revoke it. It
        identifies you as a licensee. It does not decide which releases you may use: this EULA does. Your application
        keeps starting with the key after your subscription ends, whether or not the release it uses is still licensed
        to you (section 8).
      </p>

      <h2>7. Ownership</h2>
      <p>
        The Software is licensed, not sold. Tenantry retains all intellectual-property rights in the Software. You
        retain all rights in your own applications.
      </p>

      <h2>8. Term and termination</h2>
      <p>
        When your subscription ends, your licence to releases that are not vested ends with it, including the copies you
        have already downloaded. Your licence to the vested releases continues. If you have no vested-through date, your
        licence to every release ends. Your licence key keeps working in either case; that does not extend your licence
        (section 6).
      </p>
      <p>
        Your licence also ends if you materially breach this EULA and do not remedy the breach within 30 days of
        Tenantry&apos;s written notice. When your licence to a release ends, you must stop using that release and remove
        it from your applications; copies already distributed under section 4 before it ended may remain with your
        customers.
      </p>

      <h2>9. Warranty and liability</h2>
      <p>
        The Software is provided &quot;as is&quot; without warranty. To the maximum extent permitted by law, Tenantry is
        not liable for indirect or consequential damages arising from use of the Software.
      </p>

      <h2>10. Contact</h2>
      <p>
        Licensing enquiries: <a href="mailto:legal@tenantry.dev">legal@tenantry.dev</a>.
      </p>

      <p className="text-sm text-muted-foreground">
        This document is a template and must be reviewed by qualified legal counsel before launch.
      </p>
    </LegalPage>
  );
}
