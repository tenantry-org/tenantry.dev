import 'server-only';

/**
 * The gate for automated provisioning (GitHub team access + licence issuance).
 *
 * Only `PROVISIONING_MODE=auto` enables it; anything else, including unset or a typo, means manual mode:
 * purchases and entitlements are still recorded, but nothing grants access or issues a licence
 * automatically, and the operator provisions by hand. This fails closed, so a misconfigured deployment
 * never provisions. Revocation is never gated: it only ever removes access.
 *
 * Which customers can be provisioned is decided by the environment, not a list: each environment has its
 * own Paddle account, database, GitHub org and signing key, and a sandbox server refuses to start with
 * production's (src/server/config/server-config.ts).
 */
export function automatedProvisioningEnabled(): boolean {
  return process.env.PROVISIONING_MODE?.trim().toLowerCase() === 'auto';
}
