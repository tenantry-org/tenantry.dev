import { reconcileEntitlements } from '@/server/billing/reconcile-entitlements';
import { serverConfig } from '@/server/config/server-config';

// Reconciliation endpoint, wired for Vercel Cron (see vercel.json). Vercel invokes scheduled jobs with
// a GET request and an `Authorization: Bearer <CRON_SECRET>` header it injects automatically when the
// CRON_SECRET env var is set — so this works out of the box. Manual/external triggers can POST with the
// same bearer secret. Reconciling runs through the webhook inbox (see reconcile-entitlements.ts), so it also
// retries any event whose processing failed. It reads the request's headers, so it is never prerendered.
export const maxDuration = 60; // reconcile makes per-customer GitHub API calls; give it headroom

function authorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${serverConfig().cronSecret}`;
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Leaves headroom within maxDuration; jobs the drain does not reach run in later drains.
    const result = await reconcileEntitlements({ budgetMs: 45_000 });
    return Response.json({ status: 'ok', ...result });
  } catch (error) {
    console.error('Reconcile failed:', error);
    return Response.json({ error: 'Reconcile failed' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
