import { LegalPage } from '@/components/legal/legal-page';

export const metadata = { title: 'End User Licence Agreement — Tenantry Pro' };

export default function EulaPage() {
  return (
    <LegalPage title="End User Licence Agreement (Tenantry Pro)" lastUpdated="2026-06-28">
      <p>
        This End User Licence Agreement (&quot;EULA&quot;) is between you (or the entity you represent) and [COMPANY
        LEGAL NAME] (&quot;Tenantry&quot;) and governs your use of the Tenantry Pro software packages (the
        &quot;Software&quot;). Tenantry Core is licensed separately under Apache 2.0 and is not covered by this EULA.
      </p>

      <h2>1. Licence grant</h2>
      <p>
        Subject to an active subscription and your compliance with this EULA, Tenantry grants you a non-exclusive,
        non-transferable, revocable licence to install and use the Software in your own applications, including
        production use, for the duration of your subscription.
      </p>

      <h2>2. Restrictions</h2>
      <ul>
        <li>You may not redistribute, sublicense, resell, or publish the Software or its source code.</li>
        <li>You may not remove or alter licensing, provenance, or copyright notices.</li>
        <li>You may not share your private feed credentials or organisation access with non-licensed parties.</li>
      </ul>

      <h2>3. Licence keys</h2>
      <p>
        Tenantry issues a signed licence key tied to your subscription. Runtime licence checks are non-fatal by default
        and exist for provenance and identity; they do not police your usage. The commercial gate is access to the
        private package feed.
      </p>

      <h2>4. Ownership</h2>
      <p>
        The Software is licensed, not sold. Tenantry retains all intellectual-property rights in the Software. You
        retain all rights in your own applications.
      </p>

      <h2>5. Term and termination</h2>
      <p>
        This EULA applies while your subscription is active. On termination you must stop using the Software and remove
        the Pro packages from new builds; access to the private feed and repository is revoked.
      </p>

      <h2>6. Warranty and liability</h2>
      <p>
        The Software is provided &quot;as is&quot; without warranty. To the maximum extent permitted by law, Tenantry is
        not liable for indirect or consequential damages arising from use of the Software.
      </p>

      <h2>7. Contact</h2>
      <p>
        Licensing enquiries: <a href="mailto:legal@tenantry.dev">legal@tenantry.dev</a>.
      </p>

      <p className="text-sm text-muted-foreground">
        This document is a template and must be reviewed by qualified legal counsel before launch.
      </p>
    </LegalPage>
  );
}
