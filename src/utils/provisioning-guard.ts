/**
 * Gates for automated provisioning (GitHub team access + licence issuance).
 *
 * `PROVISIONING_MODE` is the master switch. Only the exact value `auto` enables automated provisioning;
 * anything else — including unset or a typo — means manual mode: purchases and entitlements are still
 * recorded, but nothing grants access or issues a licence automatically. Access is then provisioned by
 * hand (see the assisted-pilot runbook). This fails closed, so a misconfigured deployment never
 * provisions.
 *
 * `PROVISION_ALLOWLIST` (comma-separated emails) further restricts automated provisioning to the listed
 * customers. It is an interim guard for deployments that pair Paddle sandbox with real services.
 * Revocation is never gated: it only ever removes access.
 */
export function automatedProvisioningEnabled(): boolean {
  return process.env.PROVISIONING_MODE?.trim().toLowerCase() === 'auto';
}

export function provisioningAllowed(email: string | null | undefined): boolean {
  if (!automatedProvisioningEnabled()) return false;

  const raw = process.env.PROVISION_ALLOWLIST?.trim();

  if (!raw) return true; // automated mode without an allowlist: every paying customer is provisioned
  if (!email) return false; // allowlist active but email unknown → fail closed

  const allowed = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(email.toLowerCase());
}
