import { once } from 'node:events';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { reconcileRefusal, unreachable } from './reconcile-answer.mjs';

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

  it('says why the site did not answer, from the cause Node’s fetch gives under "fetch failed"', () => {
    const refused = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3000'), { code: 'ECONNREFUSED' }),
    });
    expect(unreachable('http://localhost:3000', refused)).toBe(
      'The site at http://localhost:3000 did not answer: connect ECONNREFUSED 127.0.0.1:3000.',
    );

    const everyAddressRefused = new TypeError('fetch failed', {
      cause: Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' }),
    });
    expect(unreachable('http://localhost:3000', everyAddressRefused)).toBe(
      'The site at http://localhost:3000 did not answer: ECONNREFUSED.',
    );
  });

  it('says why for an address nothing listens on', async () => {
    // A port that was free a moment ago: listened on, then closed.
    const server = createServer().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    await new Promise((resolve) => server.close(resolve));

    const error = await fetch(`http://127.0.0.1:${port}/api/reconcile`, { method: 'POST' }).catch((caught) => caught);

    expect(unreachable(`http://127.0.0.1:${port}`, error)).toBe(
      `The site at http://127.0.0.1:${port} did not answer: connect ECONNREFUSED 127.0.0.1:${port}.`,
    );
  });
});
