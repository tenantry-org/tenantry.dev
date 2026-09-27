/**
 * Allowlist gate for provisioning.
 *
 * When `PROVISION_ALLOWLIST` is set (comma-separated emails) only those customers receive GitHub
 * access + a licence. This lets a staging deployment run against the REAL services with Paddle
 * **sandbox** without letting random (free) sandbox checkouts obtain real access — non-allowlisted
 * purchases are recorded but provisioning is withheld.
 *
 * Leave `PROVISION_ALLOWLIST` **unset in production** so every paying customer is provisioned.
 */
export function provisioningAllowed(email: string | null | undefined): boolean {
  const raw = process.env.PROVISION_ALLOWLIST?.trim();

  if (!raw) return true; // no allowlist → production behaviour: everyone is provisioned
  if (!email) return false; // allowlist active but email unknown → fail closed

  const allowed = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(email.toLowerCase());
}
