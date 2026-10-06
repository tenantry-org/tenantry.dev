import { LegalPage } from '@/components/legal/legal-page';
import { LegalEntity } from '@/constants/legal-entity';

export const metadata = { title: 'Privacy Policy | Tenantry' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="2026-10-06">
      <p>
        This Privacy Policy explains how {LegalEntity.name} (&quot;Tenantry&quot;, &quot;we&quot;) collects, uses, and
        protects personal data when you use our website and Services.
      </p>

      <h2>1. Data we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> email address and authentication identifiers (via Supabase Auth).
        </li>
        <li>
          <strong>GitHub identity:</strong> when you sign in with GitHub, the identifiers GitHub passes to Supabase
          Auth, used only to sign you in.
        </li>
        <li>
          <strong>Billing data:</strong> processed by Paddle.com as merchant of record. We receive subscription status,
          customer identifiers and, for each Tenantry Pro payment, its billing period, amounts, currency and any
          refunds, credits or chargebacks, not payment-card details.
        </li>
        <li>
          <strong>Entitlement records:</strong> subscription status, the licence keys issued to your account, and the
          vesting worked out from your payments (your paid time and each annual term, and the date each vests through).
          For each feed token: the name you give it, its first few characters, when it was created and revoked, and when
          it was last used, recorded at most once an hour. We store a hash of each feed token, not the token itself. For
          each package download: the feed token, the package and version, the time, and your network rather than your IP
          address (its first three numbers for IPv4, its first three groups for IPv6), kept for 90 days to spot a token
          that is shared or misused.
        </li>
        <li>
          <strong>Usage and performance data:</strong> pages visited, referring site, country, browser, device type and
          page-load measurements, collected by Vercel Web Analytics and Speed Insights without cookies and without
          identifying you (see section 4).
        </li>
      </ul>

      <h2>2. How we use data</h2>
      <ul>
        <li>To provide the Services: package-feed access and licence keys.</li>
        <li>To manage subscriptions and respond to support requests.</li>
        <li>
          To send service emails: when your access starts and when it ends, when a feed token is created on your
          account, and when releases become vested or your vested releases change. Paddle sends receipts and invoices.
        </li>
        <li>To understand, in aggregate, how the website is used and how fast it is, so we can improve it.</li>
      </ul>

      <h2>3. Processors</h2>
      <p>
        We share data with sub-processors that operate the Services on our behalf, each under its own terms: Paddle
        (billing, as merchant of record), Supabase (authentication and database), GitHub (sign-in, if you use it),
        Vercel (hosting, Web Analytics and Speed Insights) and Resend (email). Some of them process data outside the UK
        and the EEA, under appropriate safeguards such as standard contractual clauses.
      </p>

      <h2>4. Cookies and analytics</h2>
      <p>
        We set only the cookies needed to keep you signed in. Paddle sets its own cookies when it shows prices or takes
        a payment, to prevent fraud and complete the checkout. Our analytics set no cookies: Vercel Web Analytics counts
        visits using a hash of the request that is discarded within 24 hours and cannot be used to identify you, and
        Speed Insights records how quickly pages load. Neither follows you across other websites.
      </p>

      <h2>5. Data retention</h2>
      <p>
        We retain account and entitlement data for as long as your account is active and as required for legal and
        accounting purposes. Package download records are deleted after 90 days. You may request deletion subject to
        those obligations.
      </p>

      <h2>6. Your rights</h2>
      <p>
        Depending on your jurisdiction you may have rights to access, correct, export, or delete your personal data, and
        to complain to a data-protection authority (in the UK, the Information Commissioner&apos;s Office). Contact us
        to exercise them.
      </p>

      <h2>7. Contact</h2>
      <p>
        Privacy enquiries: <a href="mailto:privacy@tenantry.dev">privacy@tenantry.dev</a>. Data controller:{' '}
        {LegalEntity.name}, {LegalEntity.address}.
      </p>

      <p className="text-sm text-muted-foreground">
        This document is a template and must be reviewed by qualified legal counsel before launch.
      </p>
    </LegalPage>
  );
}
