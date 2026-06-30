import { reconcileEntitlements } from '@/utils/entitlements/reconcile';

// Reconciliation endpoint, wired for Vercel Cron (see vercel.json). Vercel invokes scheduled jobs with
// a GET request and an `Authorization: Bearer <CRON_SECRET>` header it injects automatically when the
// CRON_SECRET env var is set — so this works out of the box. Manual/external triggers can POST with the
// same bearer secret.
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // reconcile makes per-customer GitHub API calls; give it headroom

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await reconcileEntitlements();
    return Response.json({ status: 'ok', ...result });
  } catch (error) {
    console.error('Reconcile failed:', error);
    return Response.json({ error: 'Reconcile failed' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
