import { generateKeyPairSync } from 'node:crypto';
import type { ServerConfig } from '@/server/config/server-config';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

/** A complete sandbox configuration for tests, with automated provisioning on; `overrides` replaces whole sections. */
export function testServerConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    siteUrl: 'https://sandbox.example.com',
    supabase: { url: 'http://127.0.0.1:54321', anonKey: 'anon-key', serviceRoleKey: 'service-role-key' },
    paddle: {
      environment: 'sandbox',
      clientToken: 'test_client_token',
      prices: { month: 'pri_01month', year: 'pri_01year' },
      apiKey: 'paddle-api-key',
      webhookSecret: 'webhook-secret',
      proProductId: 'pro_01',
    },
    checkoutEnabled: true,
    licenceSigningKey: privateKey,
    provisioning: 'auto',
    email: { resendApiKey: 're_test', from: 'Tenantry <noreply@example.com>', replyTo: 'support@example.com' },
    alertEmail: 'ops@example.com',
    cronSecret: 'cron-secret',
    // The SHA-256 of 'publish-key'.
    feedPublishKeySha256: 'e8d9f85fc129e2165c7c8bb1d8878428335d12491f89d98092c91b11f7331788',
    feedPublishActors: ['release-manager'],
    ...overrides,
  };
}
