import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEASE_SECONDS } from './customer-lease';
import { LOCK_SECONDS } from './worker';

// Leases and job claims expire so that a function that dies holding one does not block the customer for
// good. That is safe only if the function cannot still be working when it expires: Vercel stops each route
// at its maxDuration, so every route that takes a lease or runs jobs must declare one that is shorter.
const ROUTES = {
  'src/app/auth/callback/route.ts': LEASE_SECONDS, // links GitHub
  'src/app/dashboard/pro/page.tsx': LEASE_SECONDS, // the Connect GitHub action
  'src/app/api/webhook/route.ts': LOCK_SECONDS, // runs jobs
  'src/app/api/reconcile/route.ts': LOCK_SECONDS, // runs jobs
};

describe('lease and claim expiry', () => {
  it.each(Object.entries(ROUTES))('%s stops before its lease or claim can expire', (path, expirySeconds) => {
    const declared = /^export const maxDuration = (\d+);/m.exec(readFileSync(path, 'utf8'));

    expect(declared, `${path} declares no maxDuration`).not.toBeNull();
    expect(Number(declared?.[1])).toBeLessThan(expirySeconds);
  });
});
