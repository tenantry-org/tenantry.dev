/**
 * Whether /api/reconcile ran, from its answer, for scripts/rehearse.mjs. The route answers 200 with a JSON body whose
 * status is "ok" when it ran. Anything else means the queued job did not run. A deployment's protection answers with a
 * redirect to a login page, so the caller asks fetch not to follow redirects: followed, it ends at that page with 200.
 */

/** Null when the reconcile ran, or why it did not, from the answer's status code and body. */
export function reconcileRefusal(status, body) {
  if (status >= 300 && status < 400) {
    return (
      `The reconcile answered ${status}, a redirect, which usually means the deployment's protection is on for ` +
      'this address.'
    );
  }
  if (status !== 200) return `The reconcile answered ${status}.`;
  if (!answeredOk(body)) return 'The reconcile answered 200, but not with its JSON result.';
  return null;
}

function answeredOk(body) {
  try {
    return JSON.parse(body)?.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Why the site could not be asked to reconcile, from the error fetch rejects with. Node's fetch rejects with "fetch
 * failed" whatever went wrong and puts the reason in its cause, such as a refused connection or an unknown host. When
 * every address of a host refuses, the cause is an AggregateError with no message, only a code.
 */
export function unreachable(siteUrl, error) {
  const cause = error?.cause;
  const reason = cause?.message || cause?.code || error?.message || String(error);
  return `The site at ${siteUrl} did not answer: ${reason}.`;
}
