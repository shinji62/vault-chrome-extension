/**
 * Keeps the MV3 service worker alive across a long-running async operation.
 *
 * Chrome reaps an idle service worker after ~30s. A pending
 * `chrome.identity.launchWebAuthFlow` callback does not reset that timer, so a
 * user who spends a while at the IdP (typing credentials, completing MFA) can
 * have the worker torn down mid-login — silently discarding the token, because
 * nothing is persisted until the flow returns.
 *
 * Calling an extension API resets the idle timer, so a periodic no-op ping is
 * enough. 20s leaves margin under the 30s timeout.
 */
const PING_INTERVAL_MS = 20_000;

export async function withKeepAlive<T>(
  operation: () => Promise<T>,
  intervalMs: number = PING_INTERVAL_MS,
): Promise<T> {
  const timer = setInterval(() => {
    // Any extension API call resets the idle timer; getPlatformInfo is cheap
    // and has no side effects.
    //
    // Called defensively: this API only returns a promise on Chrome 116+, and
    // on older builds it returns undefined, so assuming a thenable would throw
    // inside the interval on exactly the browsers needing the keepalive most.
    try {
      const maybePromise = chrome.runtime.getPlatformInfo() as unknown;
      if (typeof (maybePromise as Promise<unknown>)?.catch === 'function') {
        (maybePromise as Promise<unknown>).catch(() => {
          /* worker is going away regardless — nothing useful to do */
        });
      }
    } catch {
      /* ping is best-effort */
    }
  }, intervalMs);

  try {
    return await operation();
  } finally {
    clearInterval(timer);
  }
}
