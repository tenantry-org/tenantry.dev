import { LegalPage } from '@/components/legal/legal-page';

export const metadata = { title: 'Terms of Service — Tenantry' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="2026-06-28">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of the Tenantry website, the Tenantry
        Pro software, the private package feed, and related services (collectively, the &quot;Services&quot;) provided
        by [COMPANY LEGAL NAME] (&quot;Tenantry&quot;, &quot;we&quot;, &quot;us&quot;). By using the Services you agree
        to these Terms.
      </p>

      <h2>1. Tenantry Core vs Tenantry Pro</h2>
      <p>
        Tenantry Core is open-source software licensed separately under the Apache License 2.0; your use of Core is
        governed by that licence, not these Terms. Tenantry Pro is proprietary software licensed under our{' '}
        <a href="/legal/eula">End User Licence Agreement (EULA)</a> and made available to active subscribers.
      </p>

      <h2>2. Subscriptions and billing</h2>
      <p>
        Paid plans are billed through our merchant of record, Paddle.com. By subscribing you also agree to Paddle&apos;s
        buyer terms. Subscriptions renew automatically until cancelled. Pricing and plan features are described on our
        pricing page and may change on a prospective basis.
      </p>

      <h2>3. Access provisioning</h2>
      <p>
        An active subscription grants access to the private <code>tenantry-pro</code> repository and the private package
        feed via membership of our GitHub organisation. Access is granted after you connect your GitHub account and is
        revoked when your subscription ends (subject to any grace period).
      </p>

      <h2>4. Acceptable use</h2>
      <ul>
        <li>You may not redistribute, resell, or publish the Tenantry Pro packages or source.</li>
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
        We may suspend or terminate access for breach of these Terms. You may cancel at any time; cancellation stops
        future renewals.
      </p>

      <h2>8. Governing law</h2>
      <p>These Terms are governed by the laws of [JURISDICTION], excluding its conflict-of-law rules.</p>

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
