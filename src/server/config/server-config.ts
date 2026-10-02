import 'server-only';
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { LegalEntity, legalEntityIncomplete } from '@/constants/legal-entity';
import {
  ConfigError,
  deepFreeze,
  type Env,
  type PaddleEnvironment,
  type PublicConfig,
  readPublicConfig,
} from '@/lib/public-config';

/**
 * Tenantry.Pro's embedded licence public key (SubjectPublicKeyInfo, base64). Production licences must be
 * signed with its private half. Every other environment must use a different keypair, so its licences
 * never validate in production.
 */
export const PRODUCTION_LICENCE_PUBLIC_KEY =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdSVQSNqR05D60p4aCn6RzJnyGHMz0S2iwuT9Ekf6Z0/q92jpkcoCZRUKQjZ6Od7zCSazkaD5FXJz8YxAKKc/jA==';

/**
 * Production's GitHub org and Supabase project. A sandbox server must use neither, so a sandbox purchase
 * (free, with test cards) can never add anyone to the real customer team or write to real customers'
 * records. Each environment has its own services; this makes a misconfiguration fail at startup.
 */
export const PRODUCTION_GITHUB_ORG = 'tenantry-org';
export const PRODUCTION_SUPABASE_URL = 'https://xoqqgenzhqefyeyzahim.supabase.co';

export interface EmailConfig {
  resendApiKey: string;
  /** The no-reply sender. There is no default. */
  from: string;
  /** Where customers' replies go (support); required in production. */
  replyTo: string | null;
}

/** Everything the server is configured with: the public configuration, and the settings only the server has. */
export interface ServerConfig extends PublicConfig {
  /**
   * This environment's own origin, such as https://tenantry.dev, for links in emails and sign-in redirects. Sign-in
   * comes back here, so it completes only for a sign-in started here (its PKCE cookie is this host's).
   */
  siteUrl: string;
  supabase: PublicConfig['supabase'] & { serviceRoleKey: string };
  paddle: PublicConfig['paddle'] & {
    apiKey: string;
    webhookSecret: string;
    /** The product that is Tenantry Pro: a subscription to it entitles to Pro, and to any other product to nothing. */
    proProductId: string;
  };
  /** The customers' org and team, and the GitHub App that manages its members. */
  github: { org: string; team: string; app: { appId: string; privateKey: string; installationId: string } };
  /** Signs licences (licence-issuer.ts): in production, the key whose public half Tenantry.Pro embeds. */
  licenceSigningKey: KeyObject;
  /**
   * The gate for automated provisioning (GitHub team access and licences). Only PROVISIONING_MODE=auto enables it;
   * unset or `manual` records purchases and entitlements but grants nothing, and the operator provisions by hand.
   * Revocation is never gated: it only ever removes access. Which customers can be provisioned is decided by the
   * environment, not a list: each has its own Paddle account, database, GitHub org and signing key, checked here.
   */
  provisioning: 'manual' | 'auto';
  /** Null without RESEND_API_KEY (allowed outside production): emails are then logged, not sent. */
  email: EmailConfig | null;
  /** Where operator alerts go. Null (allowed outside production) only logs them. */
  alertEmail: string | null;
  /** The bearer secret Vercel Cron sends to /api/reconcile. */
  cronSecret: string;
}

/**
 * Validates the server's configuration and fails closed: it throws a `ConfigError` listing every problem, so a
 * server with a missing or inconsistent setting stops at startup (src/instrumentation.ts) instead of defaulting to
 * sandbox, recognising no purchase as Pro, provisioning into another environment's GitHub org, signing licences with
 * another environment's key, or linking to another environment's site. Nothing has a default.
 */
export function validateServerConfig(
  env: Env = process.env,
  productionLicencePublicKey: string = PRODUCTION_LICENCE_PUBLIC_KEY,
  legalEntity: Record<string, string> = LegalEntity,
): ServerConfig {
  const problems: string[] = [];
  const value = (name: string) => env[name]?.trim() || undefined;
  const required = (name: string, consequence: string) => {
    const configured = value(name);
    if (!configured) problems.push(`${name} is not set: ${consequence}`);
    return configured ?? '';
  };

  const publicConfig = readPublicConfig(env, problems);
  const { environment } = publicConfig.paddle;
  const production = environment === 'production';

  const siteUrl = siteOrigin(
    required('NEXT_PUBLIC_SITE_URL', "emails and sign-in redirects need this environment's own address"),
    problems,
  );
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY', 'webhooks and provisioning cannot write');
  const apiKey = required('PADDLE_API_KEY', 'the Paddle API cannot be called');
  const webhookSecret = required('PADDLE_NOTIFICATION_WEBHOOK_SECRET', 'Paddle webhooks cannot be verified');
  const proProductId = required('PADDLE_PRO_PRODUCT_ID', 'no purchase could be recognised as Tenantry Pro');
  if (proProductId && !/^pro_[a-z0-9]+$/.test(proProductId)) {
    problems.push(`PADDLE_PRO_PRODUCT_ID must be a Paddle product id ("pro_…"); it is "${proProductId}"`);
  }
  const cronSecret = required('CRON_SECRET', 'the reconcile job cannot be authorised');

  const github = {
    org: required('GITHUB_ORG', 'there is no default org, so provisioning cannot fall back to another environment’s'),
    team: required(
      'GITHUB_TEAM',
      'there is no default team, so provisioning cannot fall back to another environment’s',
    ),
    app: {
      appId: required('GITHUB_APP_ID', 'GitHub access can be neither granted nor revoked'),
      privateKey: required('GITHUB_APP_PRIVATE_KEY', 'GitHub access can be neither granted nor revoked'),
      installationId: required('GITHUB_APP_INSTALLATION_ID', 'GitHub access can be neither granted nor revoked'),
    },
  };

  const mode = value('PROVISIONING_MODE');
  const provisioning = mode?.toLowerCase() ?? 'manual';
  if (provisioning !== 'manual' && provisioning !== 'auto') {
    problems.push(`PROVISIONING_MODE must be "manual" or "auto", or unset for manual (it is "${mode}")`);
  }

  const licenceSigningKey = signingKey(
    value('LICENCE_SIGNING_PRIVATE_KEY'),
    environment,
    productionLicencePublicKey,
    problems,
  );

  // Email is optional outside production, but never half configured: a sender would otherwise default to production's.
  const resendApiKey = value('RESEND_API_KEY');
  if (production && !resendApiKey) {
    problems.push('RESEND_API_KEY is not set: customers would get no welcome or revocation emails');
  }
  const from =
    production || resendApiKey
      ? required('EMAIL_FROM', 'emails need a sender, and there is no default')
      : value('EMAIL_FROM');
  const replyTo = production
    ? required('EMAIL_REPLY_TO', 'customers replying to an email would reach the no-reply sender')
    : value('EMAIL_REPLY_TO');
  const alertEmail = production
    ? required(
        'ALERT_EMAIL',
        'failures that need the operator, such as a licence that cannot be issued, would go unnoticed',
      )
    : value('ALERT_EMAIL');

  if (environment === 'sandbox') {
    if (github.org.toLowerCase() === PRODUCTION_GITHUB_ORG) {
      problems.push(
        `GITHUB_ORG is production's org (${PRODUCTION_GITHUB_ORG}): a sandbox purchase would grant real access`,
      );
    }
    if (sameOrigin(publicConfig.supabase.url, PRODUCTION_SUPABASE_URL)) {
      problems.push(
        "NEXT_PUBLIC_SUPABASE_URL is production's database: sandbox events would write real customers' records",
      );
    }
  }

  // Production only: sandbox purchases are test transactions, so the sandbox can sell before the entity is set.
  if (production && publicConfig.checkoutEnabled && legalEntityIncomplete(legalEntity)) {
    problems.push(
      'NEXT_PUBLIC_CHECKOUT_ENABLED is on but the legal entity (src/constants/legal-entity.ts) still has placeholders: ' +
        'customers would buy under Terms that name no one',
    );
  }

  if (problems.length > 0 || !licenceSigningKey) throw new ConfigError('server configuration', problems);

  return deepFreeze({
    ...publicConfig,
    siteUrl,
    supabase: { ...publicConfig.supabase, serviceRoleKey },
    paddle: { ...publicConfig.paddle, apiKey, webhookSecret, proProductId },
    github,
    licenceSigningKey,
    provisioning: provisioning as ServerConfig['provisioning'],
    email: resendApiKey ? { resendApiKey, from: from ?? '', replyTo: replyTo || null } : null,
    alertEmail: alertEmail || null,
    cronSecret,
  });
}

let validated: ServerConfig | undefined;

/**
 * The server's configuration, validated from the environment on first use and then kept. instrumentation.ts calls
 * it when a server starts, so a server whose configuration is invalid takes no requests. Server code reads its
 * settings here and nowhere else (eslint.config.mjs); it is never read during the build.
 */
export function serverConfig(): ServerConfig {
  return (validated ??= validateServerConfig());
}

// The origin of the configured site URL, which must be nothing more than an origin.
function siteOrigin(url: string, problems: string[]): string {
  if (!url) return '';

  const parsed = URL.canParse(url) ? new URL(url) : null;
  if (
    !parsed ||
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    problems.push(`NEXT_PUBLIC_SITE_URL must be the site's origin, such as https://tenantry.dev (it is "${url}")`);
    return '';
  }

  return parsed.origin;
}

function signingKey(
  pem: string | undefined,
  environment: PaddleEnvironment | undefined,
  productionLicencePublicKey: string,
  problems: string[],
): KeyObject | undefined {
  if (!pem) {
    problems.push('LICENCE_SIGNING_PRIVATE_KEY is not set: licences cannot be issued');
    return undefined;
  }

  let key: KeyObject;
  let publicKey: string;
  try {
    key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      problems.push('LICENCE_SIGNING_PRIVATE_KEY must be a P-256 EC private key, as Tenantry.Pro verifies ES256');
      return undefined;
    }
    publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
  } catch {
    problems.push('LICENCE_SIGNING_PRIVATE_KEY is not a valid PKCS#8 private key (PEM)');
    return undefined;
  }

  if (environment === 'production' && publicKey !== productionLicencePublicKey) {
    problems.push(
      'LICENCE_SIGNING_PRIVATE_KEY is not the production key: Tenantry.Pro would reject every licence it signs',
    );
  }

  if (environment === 'sandbox' && publicKey === productionLicencePublicKey) {
    problems.push(
      'LICENCE_SIGNING_PRIVATE_KEY is the production key: sandbox needs its own keypair, so sandbox licences never ' +
        'validate in production',
    );
  }

  return key;
}

// Whether a configured URL points at the given origin, whatever its path or trailing slashes.
function sameOrigin(url: string | undefined, origin: string): boolean {
  return url !== undefined && URL.canParse(url) && new URL(url).origin === origin;
}
