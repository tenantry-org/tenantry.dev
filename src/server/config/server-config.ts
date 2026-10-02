import 'server-only';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { parseProProductId } from '@/constants/pro-product';
import { LegalEntity, legalEntityIncomplete } from '@/constants/legal-entity';

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
 * records. Each environment has its own services (D6); this makes a misconfiguration fail at startup.
 */
export const PRODUCTION_GITHUB_ORG = 'tenantry-org';
export const PRODUCTION_SUPABASE_URL = 'https://xoqqgenzhqefyeyzahim.supabase.co';

export type PaddleEnvironment = 'sandbox' | 'production';

export class ServerConfigError extends Error {
  constructor(readonly problems: string[]) {
    const list = problems.map((problem) => `  - ${problem}`).join('\n');
    super(`The server configuration is invalid:\n${list}`);
    this.name = 'ServerConfigError';
  }
}

type Env = Record<string, string | undefined>;

/**
 * Validates the server's configuration and fails closed: it throws a `ServerConfigError` listing every
 * problem, so a server with a missing or inconsistent setting stops at startup (src/instrumentation.ts)
 * instead of defaulting to sandbox, recognising no purchase as Pro, provisioning into another environment's
 * GitHub org, or signing licences with another environment's key.
 */
export function validateServerConfig(
  env: Env = process.env,
  productionLicencePublicKey: string = PRODUCTION_LICENCE_PUBLIC_KEY,
  legalEntity: Record<string, string> = LegalEntity,
): { paddleEnvironment: PaddleEnvironment } {
  const problems: string[] = [];
  const value = (name: string) => env[name]?.trim() || undefined;
  const required = (name: string, consequence: string) => {
    if (!value(name)) problems.push(`${name} is not set: ${consequence}`);
  };

  const paddleEnvironment = value('NEXT_PUBLIC_PADDLE_ENV');
  if (paddleEnvironment !== 'sandbox' && paddleEnvironment !== 'production') {
    const actual = paddleEnvironment ? `"${paddleEnvironment}"` : 'not set';
    problems.push(`NEXT_PUBLIC_PADDLE_ENV must be "sandbox" or "production" (it is ${actual}); there is no default`);
  }

  required('NEXT_PUBLIC_SUPABASE_URL', 'the site cannot reach its database');
  required('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'the site cannot reach its database');
  required('SUPABASE_SERVICE_ROLE_KEY', 'webhooks and provisioning cannot write');
  required('PADDLE_API_KEY', 'the Paddle API cannot be called');
  required('NEXT_PUBLIC_PADDLE_CLIENT_TOKEN', 'Paddle checkout cannot load, so nothing can be bought');
  required('PADDLE_NOTIFICATION_WEBHOOK_SECRET', 'Paddle webhooks cannot be verified');
  required('CRON_SECRET', 'the reconcile job cannot be authorised');
  required('GITHUB_ORG', 'there is no default org, so provisioning cannot fall back to another environment’s');
  required('GITHUB_TEAM', 'there is no default team, so provisioning cannot fall back to another environment’s');
  required('GITHUB_APP_ID', 'GitHub access can be neither granted nor revoked');
  required('GITHUB_APP_PRIVATE_KEY', 'GitHub access can be neither granted nor revoked');
  required('GITHUB_APP_INSTALLATION_ID', 'GitHub access can be neither granted nor revoked');

  const mode = value('PROVISIONING_MODE');
  if (mode && !['manual', 'auto'].includes(mode.toLowerCase())) {
    problems.push(`PROVISIONING_MODE must be "manual" or "auto", or unset for manual (it is "${mode}")`);
  }

  const monthly = value('NEXT_PUBLIC_PADDLE_PRICE_MONTHLY');
  const yearly = value('NEXT_PUBLIC_PADDLE_PRICE_YEARLY');
  for (const [name, price] of [
    ['NEXT_PUBLIC_PADDLE_PRICE_MONTHLY', monthly],
    ['NEXT_PUBLIC_PADDLE_PRICE_YEARLY', yearly],
  ] as const) {
    if (!price) problems.push(`${name} is not set: the Pro offer cannot be bought`);
    else if (!/^pri_[a-z0-9]+$/.test(price))
      problems.push(`${name} must be a Paddle price id ("pri_…"); it is "${price}"`);
  }
  if (monthly && monthly === yearly) {
    problems.push('NEXT_PUBLIC_PADDLE_PRICE_MONTHLY and NEXT_PUBLIC_PADDLE_PRICE_YEARLY are the same price');
  }

  try {
    parseProProductId(value('PADDLE_PRO_PRODUCT_ID'));
  } catch (error) {
    problems.push((error as Error).message);
  }

  checkSigningKey(value('LICENCE_SIGNING_PRIVATE_KEY'), paddleEnvironment, productionLicencePublicKey, problems);

  if (paddleEnvironment === 'sandbox') {
    if (value('GITHUB_ORG')?.toLowerCase() === PRODUCTION_GITHUB_ORG) {
      problems.push(
        `GITHUB_ORG is production's org (${PRODUCTION_GITHUB_ORG}): a sandbox purchase would grant real access`,
      );
    }
    if (sameOrigin(value('NEXT_PUBLIC_SUPABASE_URL'), PRODUCTION_SUPABASE_URL)) {
      problems.push(
        "NEXT_PUBLIC_SUPABASE_URL is production's database: sandbox events would write real customers' records",
      );
    }
  }

  if (paddleEnvironment === 'production') {
    required('NEXT_PUBLIC_SITE_URL', 'redirects and emails need the public site URL');
    required('RESEND_API_KEY', 'customers would get no welcome or revocation emails');
    required('EMAIL_FROM', 'customers would get no welcome or revocation emails');
    required('EMAIL_REPLY_TO', 'customers replying to an email would reach the no-reply sender');
    required(
      'ALERT_EMAIL',
      'failures that need the operator, such as a licence that cannot be issued, would go unnoticed',
    );
  }

  // Production only: sandbox purchases are test transactions, so the sandbox can sell before the entity is set.
  if (
    paddleEnvironment === 'production' &&
    value('NEXT_PUBLIC_CHECKOUT_ENABLED') === 'true' &&
    legalEntityIncomplete(legalEntity)
  ) {
    problems.push(
      'NEXT_PUBLIC_CHECKOUT_ENABLED is on but the legal entity (src/constants/legal-entity.ts) still has placeholders: ' +
        'customers would buy under Terms that name no one',
    );
  }

  if (problems.length > 0) throw new ServerConfigError(problems);

  return { paddleEnvironment: paddleEnvironment as PaddleEnvironment };
}

function checkSigningKey(
  pem: string | undefined,
  paddleEnvironment: string | undefined,
  productionLicencePublicKey: string,
  problems: string[],
) {
  if (!pem) {
    problems.push('LICENCE_SIGNING_PRIVATE_KEY is not set: licences cannot be issued');
    return;
  }

  let publicKey: string;
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      problems.push('LICENCE_SIGNING_PRIVATE_KEY must be a P-256 EC private key, as Tenantry.Pro verifies ES256');
      return;
    }
    publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
  } catch {
    problems.push('LICENCE_SIGNING_PRIVATE_KEY is not a valid PKCS#8 private key (PEM)');
    return;
  }

  if (paddleEnvironment === 'production' && publicKey !== productionLicencePublicKey) {
    problems.push(
      'LICENCE_SIGNING_PRIVATE_KEY is not the production key: Tenantry.Pro would reject every licence it signs',
    );
  }

  if (paddleEnvironment === 'sandbox' && publicKey === productionLicencePublicKey) {
    problems.push(
      'LICENCE_SIGNING_PRIVATE_KEY is the production key: sandbox needs its own keypair, so sandbox licences never ' +
        'validate in production',
    );
  }
}

// Whether a configured URL points at the given origin, whatever its path or trailing slashes.
function sameOrigin(url: string | undefined, origin: string): boolean {
  return url !== undefined && URL.canParse(url) && new URL(url).origin === origin;
}
