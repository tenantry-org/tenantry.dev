import { LegalPage } from '@/components/legal/legal-page';
import { LegalEntity } from '@/constants/legal-entity';

export const metadata = { title: 'End User Licence Agreement — Tenantry Pro' };

export default function EulaPage() {
  return (
    <LegalPage title="End User Licence Agreement (Tenantry Pro)" lastUpdated="2026-10-04">
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
        A paid period is a billing period of any of your Tenantry Pro subscriptions whose payment has been completed and
        charged more than zero after discounts. It counts from the start of the billing period to its end, or to when
        the subscription was cancelled, or paused and not resumed, if that was sooner. Refunds, credits and chargebacks
        change what counts, as set out below.
      </p>
      <p>
        A qualifying period is a series of paid periods in which each starts no more than one hour after the end of the
        series so far. Paid periods that overlap, as when you change plan, count once. Any gap of more than one hour
        breaks a qualifying period: for example when your subscription ends and no paid period follows within the hour,
        a renewal is not paid, or a period does not count, including a period discounted to zero. The next paid period
        then starts a new qualifying period from zero.
      </p>
      <p>
        A qualifying period vests when it has lasted 12 calendar months (&quot;12 consecutive paid months&quot;). It
        vests earlier, at the end of one of its paid periods, if that period runs to the end of its billing period and
        ends no more than three days before the 12 months are reached, which allows for billing dates at the end of
        shorter months. A paid period cut short by a cancellation, a pause, a refund or a credit does not vest it early.
        The moment it vests is then a vested-through date. While the same qualifying period continues, the end of each
        further paid period, once reached, becomes its new vested-through date.
      </p>
      <p>
        When you pay for an annual billing period (an &quot;annual term&quot;), Tenantry grants you at once, on
        condition that you complete the term, that every release whose release date is on or before the end of the term
        is vested (the &quot;term&apos;s grant&quot;). The term&apos;s grant is confirmed when the term ends, and the
        end of the term is then a vested-through date. It is withdrawn if the subscription is cancelled, or paused and
        not resumed, before the term ends, if by the end of the term the payment has been refunded or credited in full
        or in part (other than a correction of tax), or if the payment is charged back at any time.
      </p>
      <p>
        Only refunds, credits and chargebacks that have been approved have any effect, and a correction of tax alone has
        none. A paid period stops counting when a full refund or credit of its payment is approved. A partial refund or
        credit leaves a monthly paid period counting in full. An annual term partially refunded or credited counts only
        up to when the refund or credit was approved. A refund or credit approved after a vesting was confirmed does not
        undo that vesting. From then on the refunded period counts only as this paragraph sets out, which can break the
        qualifying period it was part of.
      </p>
      <p>
        A payment that is charged back does not count towards any qualifying period or annual term. Vesting already
        confirmed is worked out again as if that payment had never been made, and is withdrawn if it relied on the
        payment. If the chargeback is reversed, the payment counts again.
      </p>
      <p>
        Your vested-through date is the latest vested-through date of any of your qualifying periods or annual terms.
        Your subscription ending, or a new qualifying period starting, does not reduce it; only a chargeback can, as set
        out above.
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
