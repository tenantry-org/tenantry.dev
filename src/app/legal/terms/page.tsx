import { LegalPage } from '@/components/legal/legal-page';
import { LegalEntity } from '@/constants/legal-entity';

export const metadata = { title: 'Terms of Service | Tenantry' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="2026-10-06">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of the Tenantry website, the Tenantry
        Pro software, the package feed, and related services (collectively, the &quot;Services&quot;) provided by{' '}
        {LegalEntity.name}, {LegalEntity.registration} (&quot;Tenantry&quot;, &quot;we&quot;, &quot;us&quot;). By using
        the Services you agree to these Terms.
      </p>

      <h2>1. Tenantry Core vs Tenantry Pro</h2>
      <p>
        Tenantry Core is open-source software licensed separately under the Apache License 2.0; your use of Core is
        governed by that licence, not these Terms. Tenantry Pro is proprietary software licensed under our{' '}
        <a href="/legal/eula">End User Licence Agreement (EULA)</a>, which sets out which releases you may use while you
        subscribe and after your subscription ends. It is delivered through the package feed (section 3).
      </p>

      <h2>2. Subscriptions and billing</h2>
      <p>
        Tenantry Pro is billed through our merchant of record, Paddle.com. By subscribing you also agree to
        Paddle&apos;s buyer terms. Subscriptions renew automatically until cancelled. The price and what Pro includes
        are described on our pricing page and may change on a prospective basis.
      </p>

      <h2>3. Access provisioning</h2>
      <p>
        Tenantry Pro is delivered through the package feed, a private NuGet feed that Tenantry runs, which you access
        with feed tokens that you create and revoke on your Pro access page. While your subscription is active, the
        package feed serves every release of Tenantry Pro. Your subscription stays active for up to 30 days after a
        renewal payment first fails, while Paddle tries to collect it. After your subscription ends, the package feed
        serves only the vested releases (EULA, section 2), and none if no release is vested. You are also issued a
        licence key, which does not expire and stays the same after your subscription ends. The key does not decide
        which releases you may use; the <a href="/legal/eula">EULA</a> does.
      </p>

      <h2>4. Acceptable use</h2>
      <ul>
        <li>
          Except as the <a href="/legal/eula">EULA</a> (section 4) allows, you may not redistribute, resell or publish
          the Tenantry Pro packages or source.
        </li>
        <li>You may not circumvent the licence or access controls.</li>
        <li>You may not use the Services in violation of applicable law.</li>
      </ul>

      <h2>5. Warranty disclaimer</h2>
      <p>
        The Services are provided &quot;as is&quot; without warranties of any kind, to the maximum extent permitted by
        law.
      </p>

      <h2>6. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Tenantry will not be liable for any indirect, incidental, or
        consequential damages, or for any loss of data, revenue, or profits.
      </p>

      <h2>7. Termination</h2>
      <p>
        We may suspend or end your access to the website and the package feed if you breach these Terms. Your licence to
        Tenantry Pro ends only as the EULA, section 8, provides. You may cancel at any time; cancellation stops future
        renewals. It does not affect the vested releases, which only a refund, credit or chargeback of the payments they
        rely on can withdraw (EULA, section 2).
      </p>

      <h2>8. Governing law</h2>
      <p>These Terms are governed by the laws of England and Wales, excluding its conflict-of-law rules.</p>

      <h2>9. Contact</h2>
      <p>
        Questions about these Terms: <a href="mailto:legal@tenantry.dev">legal@tenantry.dev</a>.
      </p>

      <p className="text-sm text-muted-foreground">
        This document is a template and must be reviewed by qualified legal counsel before launch.
      </p>
    </LegalPage>
  );
}
