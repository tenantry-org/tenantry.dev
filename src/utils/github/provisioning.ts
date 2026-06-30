import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

/**
 * Grants and revokes paying customers' access to the private Tenantry org via team membership.
 *
 * Membership of the `pro-customers` team grants `read:packages` on the org-scoped GitHub Packages
 * feed. Access is controlled by what that team is wired to (initially: package read only, NOT the
 * private `tenantry-pro` source repo). This code is agnostic to that wiring — it only adds/removes
 * team membership — so source access can be added to the team later without any code change.
 * Revocation is simply removal from the team.
 *
 * Auth is via a GitHub App installed on the org (scoped, auditable, rotatable — preferred over an
 * admin PAT). Configure with these env vars:
 *   GITHUB_APP_ID                 - the App's id
 *   GITHUB_APP_PRIVATE_KEY        - the App's private key (PEM)
 *   GITHUB_APP_INSTALLATION_ID    - the installation id on the org
 *   GITHUB_ORG   (default: tenantry-org)
 *   GITHUB_TEAM  (default: pro-customers)
 */

/** The subset of the GitHub teams API this module uses. Lets tests inject a mock. */
export interface TeamMembershipApi {
  addOrUpdateMembershipForUserInOrg(params: {
    org: string;
    team_slug: string;
    username: string;
    role?: 'member' | 'maintainer';
  }): Promise<unknown>;

  removeMembershipForUserInOrg(params: { org: string; team_slug: string; username: string }): Promise<unknown>;

  getMembershipForUserInOrg(params: {
    org: string;
    team_slug: string;
    username: string;
  }): Promise<{ status: number; data: { state: string } }>;
}

export interface ProvisioningDeps {
  api: TeamMembershipApi;
  org: string;
  team: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured. The GitHub provisioning service cannot run without it.`);
  }

  return value;
}

/** Builds the default deps from env + an App-authenticated Octokit client. */
export function defaultDeps(): ProvisioningDeps {
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: requireEnv('GITHUB_APP_ID'),
      privateKey: requireEnv('GITHUB_APP_PRIVATE_KEY'),
      installationId: requireEnv('GITHUB_APP_INSTALLATION_ID'),
    },
  });

  return {
    api: octokit.rest.teams as unknown as TeamMembershipApi,
    org: process.env.GITHUB_ORG ?? 'tenantry-org',
    team: process.env.GITHUB_TEAM ?? 'pro-customers',
  };
}

/**
 * Adds (or re-confirms) a GitHub user in the pro-customers team. Idempotent.
 */
export async function grantAccess(githubLogin: string, deps: ProvisioningDeps = defaultDeps()): Promise<void> {
  await deps.api.addOrUpdateMembershipForUserInOrg({
    org: deps.org,
    team_slug: deps.team,
    username: githubLogin,
    role: 'member',
  });
}

/**
 * Removes a GitHub user from the pro-customers team. Idempotent — a 404 (already absent) is ignored.
 */
export async function revokeAccess(githubLogin: string, deps: ProvisioningDeps = defaultDeps()): Promise<void> {
  try {
    await deps.api.removeMembershipForUserInOrg({
      org: deps.org,
      team_slug: deps.team,
      username: githubLogin,
    });
  } catch (error) {
    if (isNotFound(error)) return; // already removed — nothing to do
    throw error;
  }
}

/**
 * Returns true when the user is an active member of the pro-customers team.
 */
export async function hasAccess(githubLogin: string, deps: ProvisioningDeps = defaultDeps()): Promise<boolean> {
  try {
    const result = await deps.api.getMembershipForUserInOrg({
      org: deps.org,
      team_slug: deps.team,
      username: githubLogin,
    });

    return result.status === 200 && result.data.state === 'active';
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'status' in error && (error as { status: number }).status === 404
  );
}
