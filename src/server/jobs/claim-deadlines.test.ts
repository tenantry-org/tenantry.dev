import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCK_SECONDS } from './worker';

// Job claims expire so that a function that dies holding one does not block the customer for good. That is safe only
// if the function cannot still be working when it expires: Vercel stops each route at its maxDuration, so every route
// that runs jobs must declare one that is shorter.
const ROUTES = ['src/app/api/webhook/route.ts', 'src/app/api/reconcile/route.ts'];

describe('claim expiry', () => {
  it.each(ROUTES)('%s stops before its claim can expire', (path) => {
    const declared = /^export const maxDuration = (\d+);/m.exec(readFileSync(path, 'utf8'));

    expect(declared, `${path} declares no maxDuration`).not.toBeNull();
    expect(Number(declared?.[1])).toBeLessThan(LOCK_SECONDS);
  });
});
