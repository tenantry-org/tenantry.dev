import { describe, expect, it } from 'vitest';
import { reconcileRefusal } from './reconcile-answer.mjs';

describe('reconcile answer', () => {
  it('takes only a 200 with the route’s JSON result as a reconcile that ran', () => {
    expect(reconcileRefusal(200, '{"status":"ok","customers":1}')).toBeNull();
    expect(reconcileRefusal(200, '{"status":"failed"}')).toBe(
      'The reconcile answered 200, but not with its JSON result.',
    );
  });

  it('refuses a login page, which a followed redirect from a protected deployment ends at', () => {
    expect(reconcileRefusal(200, '<!DOCTYPE html><html><body>Log in to Vercel</body></html>')).toBe(
      'The reconcile answered 200, but not with its JSON result.',
    );
    expect(reconcileRefusal(302, '')).toContain("usually means the deployment's protection is on");
  });

  it('refuses any other status, such as a wrong CRON_SECRET or a failed run', () => {
    expect(reconcileRefusal(401, '{"error":"Unauthorized"}')).toBe('The reconcile answered 401.');
    expect(reconcileRefusal(500, '{"error":"Reconcile failed"}')).toBe('The reconcile answered 500.');
  });
});
