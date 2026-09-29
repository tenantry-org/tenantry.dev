import { LegalPage } from '@/components/legal/legal-page';
import { LegalEntity } from '@/constants/legal-entity';

export const metadata = { title: 'End User Licence Agreement — Tenantry Pro' };

export default function EulaPage() {
  return (
    <LegalPage title="End User Licence Agreement (Tenantry Pro)" lastUpdated="2026-09-29">
      <p>
        This End User Licence Agreement (&quot;EULA&quot;) is between you (or the entity you represent) and{' '}
        {LegalEntity.name}, {LegalEntity.registration} (&quot;Tenantry&quot;) and governs your use of the Tenantry Pro
        software packages (the &quot;Software&quot;). Tenantry Core is licensed separately under Apache 2.0 and is not
        covered by this EULA.
      </p>

      <h2>1. Licence grant</h2>
      <p>
        Subject to your compliance with this EULA, Tenantry grants you a non-exclusive, non-transferable, revocable
        licence to install and use the Software in your own applications, including production use. An active
        subscription gives you access to the private package feed and so to new versions of the Software; your licence
        covers the versions you obtain while it is active, including after it ends (section 5).
      </p>

      <h2>2. Restrictions</h2>
      <ul>
        <li>You may not redistribute, sublicense, resell, or publish the Software or its source code.</li>
        <li>You may not remove or alter licensing, provenance, or copyright notices.</li>
        <li>You may not share your private feed credentials or organisation access with non-licensed parties.</li>
      </ul>

      <h2>3. Licence keys</h2>
      <p>
        Tenantry issues you a signed licence key, which the Software verifies offline when your application starts: it
        does not start without a valid key. The key does not expire, so you configure it once. It identifies you as a
        licensee; it does not police your usage. The commercial gate is access to the private package feed.
      </p>

      <h2>4. Ownership</h2>
      <p>
        The Software is licensed, not sold. Tenantry retains all intellectual-property rights in the Software. You
        retain all rights in your own applications.
      </p>

      <h2>5. Term and termination</h2>
      <p>
        When your subscription ends, your access to the private package feed ends, and with it access to new versions.
        You may continue to use the versions of the Software you obtained while your subscription was active, under this
        EULA, with the licence key issued to you. If your payment is refunded in full or charged back, your licence
        ends: you must stop using the Software and remove it from your applications.
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
