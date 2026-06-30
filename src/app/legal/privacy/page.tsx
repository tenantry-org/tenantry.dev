import { LegalPage } from '@/components/legal/legal-page';

export const metadata = { title: 'Privacy Policy — Tenantry' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="2026-06-28">
      <p>
        This Privacy Policy explains how [COMPANY LEGAL NAME] (&quot;Tenantry&quot;) collects, uses, and protects
        personal data when you use our website and Services.
      </p>

      <h2>1. Data we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> email address and authentication identifiers (via Supabase Auth).
        </li>
        <li>
          <strong>GitHub identity:</strong> when you connect GitHub, your GitHub username and numeric id, used solely to
          provision repository and package-feed access.
        </li>
        <li>
          <strong>Billing data:</strong> processed by Paddle.com as merchant of record. We receive subscription status
          and customer identifiers, not full payment-card details.
        </li>
        <li>
          <strong>Entitlement records:</strong> tier, status, and issued licence tokens associated with your account.
        </li>
      </ul>

      <h2>2. How we use data</h2>
      <ul>
        <li>To provide and provision the Services (access grants, licence issuance).</li>
        <li>To manage subscriptions and respond to support requests.</li>
        <li>To send transactional emails (receipts, onboarding, expiry notices).</li>
      </ul>

      <h2>3. Processors</h2>
      <p>
        We share data with sub-processors that operate the Services: Paddle (billing), Supabase (auth and database),
        GitHub (access provisioning), our hosting provider, and our email provider. Each processes data on our behalf
        under its own terms.
      </p>

      <h2>4. Data retention</h2>
      <p>
        We retain account and entitlement data for as long as your account is active and as required for legal and
        accounting purposes. You may request deletion subject to those obligations.
      </p>

      <h2>5. Your rights</h2>
      <p>
        Depending on your jurisdiction you may have rights to access, correct, export, or delete your personal data.
        Contact us to exercise them.
      </p>

      <h2>6. Contact</h2>
      <p>
        Privacy enquiries: <a href="mailto:privacy@tenantry.dev">privacy@tenantry.dev</a>. Data controller: [COMPANY
        LEGAL NAME], [REGISTERED ADDRESS].
      </p>

      <p className="text-sm text-muted-foreground">
        This document is a template and must be reviewed by qualified legal counsel before launch.
      </p>
    </LegalPage>
  );
}
