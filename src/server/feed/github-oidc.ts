import 'server-only';
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

/**
 * Publishing from Tenantry Pro's release workflow with a GitHub Actions OIDC token instead of a stored key: the publish
 * job asks GitHub for a token (`id-token: write`) whose audience is this deployment's `<site>/feed`, and sends it as
 * `Authorization: Bearer <token>`. GitHub signs it, so there is no key to leak or rotate. The token is accepted only
 * from release.yml in tenantry-org/tenantry-pro (matched by its numeric ids as well as its name) running for a v* tag,
 * pushed by a login in FEED_PUBLISH_ACTORS: anyone who can write to the repository can push a tag, so the list of
 * release managers is what limits who publishes. https://docs.github.com/en/actions/reference/security/oidc describes
 * the claims.
 */

export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const PRO_REPOSITORY = 'tenantry-org/tenantry-pro';
// The repository's and the org's numeric ids, which GitHub never reuses (the token carries them as strings). A name
// can be registered again after a rename or a deletion, so a token from a new tenantry-org/tenantry-pro fails these.
// `gh api repos/tenantry-org/tenantry-pro --jq '.id, .owner.id'` prints them.
const PRO_REPOSITORY_ID = '1275766040';
const PRO_REPOSITORY_OWNER_ID = '271523501';
const RELEASE_WORKFLOW_AT_TAG = `${PRO_REPOSITORY}/.github/workflows/release.yml@refs/tags/v`;

/** GitHub's signing keys for Actions OIDC tokens, fetched when first needed and kept, as jose caches them. */
export const githubOidcKeys: JWTVerifyGetKey = createRemoteJWKSet(new URL(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`));

/** The audience a release's token must carry for the deployment at `siteUrl`: https://tenantry.dev/feed in production. */
export function publishAudience(siteUrl: string): string {
  return `${siteUrl}/feed`;
}

/**
 * Why a release workflow's OIDC token may not publish to the deployment at `siteUrl`, or null when it may. The reasons
 * name the claim that failed and never the token.
 */
export async function releaseTokenRefusal(
  token: string,
  { siteUrl, keys, actors }: { siteUrl: string; keys: JWTVerifyGetKey; actors: string[] },
): Promise<string | null> {
  let claims: Record<string, unknown>;
  try {
    ({ payload: claims } = await jwtVerify(token, keys, {
      issuer: GITHUB_OIDC_ISSUER,
      audience: publishAudience(siteUrl),
      algorithms: ['RS256'],
    }));
  } catch (error) {
    // GitHub's keys out of reach is an outage, not a refusal: it becomes a 500, and the release can be run again. That
    // is a network failure, a timeout, or an answer that is not 200 or not JSON, the only case where jose throws its
    // base JOSEError (ERR_JOSE_GENERIC).
    if (
      !(error instanceof errors.JOSEError) ||
      error instanceof errors.JWKSTimeout ||
      error.code === errors.JOSEError.code
    ) {
      throw error;
    }
    return `The GitHub OIDC token is not valid for ${publishAudience(siteUrl)}: ${error.message}`;
  }

  if (
    claims.repository !== PRO_REPOSITORY ||
    claims.repository_id !== PRO_REPOSITORY_ID ||
    claims.repository_owner_id !== PRO_REPOSITORY_OWNER_ID
  ) {
    return `The GitHub OIDC token is not from ${PRO_REPOSITORY}.`;
  }
  if (
    claims.ref_type !== 'tag' ||
    typeof claims.job_workflow_ref !== 'string' ||
    !claims.job_workflow_ref.startsWith(RELEASE_WORKFLOW_AT_TAG)
  ) {
    return 'The GitHub OIDC token is not from release.yml running for a v* tag.';
  }
  const actor = typeof claims.actor === 'string' ? claims.actor : '';
  if (!actors.some((allowed) => allowed.toLowerCase() === actor.toLowerCase())) {
    return `${actor || 'The workflow run'} is not in FEED_PUBLISH_ACTORS, the logins that may publish.`;
  }

  return null;
}
