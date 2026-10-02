import 'server-only';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { requireEnv } from '@/utils/config/env';

/**
 * Grants and revokes paying customers' access to the private Tenantry org via team membership.
 *
 * Membership of the `pro-customers` team grants `read:packages` on the org-scoped GitHub Packages
 * feed. Access is controlled by what that team is wired to (initially: package read only, NOT the
 * private `tenantry-pro` source repo). This code is agnostic to that wiring — it only adds/removes
 * team membership — so source access can be added to the team later without any code change.
 * Revocation is removal from the team, and cancelling the org invitation if it was never accepted.
 *
 * GitHub users can rename themselves, and a freed name can be taken by someone else, so the stored login is
 * never trusted: callers resolve the current login from the account's durable id (`currentLogin`) before
 * granting, checking or removing access.
 *
 * Adding someone who is not yet an org member sends them an org invitation: their membership is 'pending'
 * until they accept, and GitHub drops the invitation after 7 days. Callers record the outcome
 * (`customer_access.github_state`), and reconcile promotes or re-sends invitations (reconcile-customer.ts).
 *
 * Auth is via a GitHub App installed on the org (scoped, auditable, rotatable — preferred over an
 * admin PAT). Configure with these env vars:
 *   GITHUB_APP_ID                 - the App's id
 *   GITHUB_APP_PRIVATE_KEY        - the App's private key (PEM)
 *   GITHUB_APP_INSTALLATION_ID    - the installation id on the org
 *   GITHUB_ORG                    - the org (no default: each environment has its own)
 *   GITHUB_TEAM                   - the customer team in that org (no default)
 */

/** The subset of the GitHub teams API this module uses. Lets tests inject a mock. */
export interface TeamMembershipApi {
  addOrUpdateMembershipForUserInOrg(params: {
    org: string;
    team_slug: string;
    username: string;
    role?: 'member' | 'maintainer';
  }): Promise<{ data: { state: string } }>;

  removeMembershipForUserInOrg(params: { org: string; team_slug: string; username: string }): Promise<unknown>;

  getMembershipForUserInOrg(params: {
    org: string;
    team_slug: string;
    username: string;
  }): Promise<{ status: number; data: { state: string } }>;
}

/** The subset of the GitHub orgs API this module uses: pending org invitations. */
export interface OrgInvitationApi {
  listPendingInvitations(params: {
    org: string;
    per_page?: number;
    page?: number;
  }): Promise<{ data: { id: number; login: string | null }[] }>;

  cancelInvitation(params: { org: string; invitation_id: number }): Promise<unknown>;
}

/** The subset of the GitHub users API this module uses: a user by their durable id. */
export interface UserApi {
  getById(params: { account_id: number }): Promise<{ data: { login: string } }>;
}

export interface ProvisioningDeps {
  api: TeamMembershipApi;
  invitations: OrgInvitationApi;
  users: UserApi;
  org: string;
  team: string;
}

/** A team membership: 'active', or 'pending' while the org invitation it sent is not yet accepted. */
export type Membership = 'active' | 'pending';

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
    invitations: octokit.rest.orgs as unknown as OrgInvitationApi,
    users: { getById: ({ account_id }) => octokit.request('GET /user/{account_id}', { account_id }) },
    org: requireEnv('GITHUB_ORG'),
    team: requireEnv('GITHUB_TEAM'),
  };
}

/** The account's login now, or null once the account has been deleted. */
export async function currentLogin(githubId: number, deps: ProvisioningDeps = defaultDeps()): Promise<string | null> {
  try {
    return (await deps.users.getById({ account_id: githubId })).data.login;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Adds (or re-confirms) a GitHub user in the pro-customers team and returns their membership: 'pending'
 * when GitHub sent them an org invitation to accept. Idempotent; for someone whose invitation has lapsed it
 * sends a new one.
 */
export async function grantAccess(githubLogin: string, deps: ProvisioningDeps = defaultDeps()): Promise<Membership> {
  const { data } = await deps.api.addOrUpdateMembershipForUserInOrg({
    org: deps.org,
    team_slug: deps.team,
    username: githubLogin,
    role: 'member',
  });

  return data.state === 'active' ? 'active' : 'pending';
}

/**
 * Removes a GitHub user from the pro-customers team and cancels their org invitation if it is still
 * pending, so a lapsed customer cannot accept it later. Idempotent: an absent membership or invitation is
 * ignored.
 */
export async function revokeAccess(githubLogin: string, deps: ProvisioningDeps = defaultDeps()): Promise<void> {
  try {
    await deps.api.removeMembershipForUserInOrg({
      org: deps.org,
      team_slug: deps.team,
      username: githubLogin,
    });
  } catch (error) {
    if (!isNotFound(error)) throw error; // a 404 means already removed
  }

  const invitation = await findPendingInvitation(githubLogin, deps);
  if (invitation === null) return;

  try {
    await deps.invitations.cancelInvitation({ org: deps.org, invitation_id: invitation });
  } catch (error) {
    if (!isNotFound(error)) throw error; // accepted, expired or cancelled meanwhile
  }
}

/**
 * The user's membership of the pro-customers team: 'active', 'pending' (invited, not yet accepted), or
 * null when there is none, including once GitHub has dropped an unaccepted invitation.
 */
export async function membershipOf(
  githubLogin: string,
  deps: ProvisioningDeps = defaultDeps(),
): Promise<Membership | null> {
  try {
    const result = await deps.api.getMembershipForUserInOrg({
      org: deps.org,
      team_slug: deps.team,
      username: githubLogin,
    });

    return result.data.state === 'active' ? 'active' : 'pending';
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Whether the user holds a pending org invitation. Checked apart from the team membership: a removal that
 * took the user out of the team but failed to cancel the invitation leaves no membership, but an
 * invitation that can still be accepted.
 */
export async function hasPendingInvitation(
  githubLogin: string,
  deps: ProvisioningDeps = defaultDeps(),
): Promise<boolean> {
  return (await findPendingInvitation(githubLogin, deps)) !== null;
}

// The id of the user's pending org invitation, or null. GitHub logins are case-insensitive.
async function findPendingInvitation(githubLogin: string, deps: ProvisioningDeps): Promise<number | null> {
  const login = githubLogin.toLowerCase();

  for (let page = 1; ; page += 1) {
    const { data } = await deps.invitations.listPendingInvitations({ org: deps.org, per_page: 100, page });
    const invitation = data.find((candidate) => candidate.login?.toLowerCase() === login);

    if (invitation) return invitation.id;
    if (data.length < 100) return null;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'status' in error && (error as { status: number }).status === 404
  );
}
