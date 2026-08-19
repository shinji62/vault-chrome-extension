/**
 * Runs an OIDC authorization request in a normal browser tab instead of
 * `chrome.identity.launchWebAuthFlow`.
 *
 * `launchWebAuthFlow` renders in an isolated window that does not share the
 * profile's cookie jar or device state (no Primary Refresh Token). Enterprise
 * identity providers relying on that state — Entra ID with Conditional Access
 * requiring a managed/compliant device being the common case — authenticate the
 * user and then refuse to issue a token, so no redirect ever fires and the
 * window just sits there. The same request in a normal tab carries the full
 * browsing context and succeeds.
 *
 * A normal tab cannot *load* an `https://<ext-id>.chromiumapp.org/...` URL (no
 * DNS), but `chrome.tabs.onUpdated` reports the URL as soon as navigation is
 * committed, which is all that is needed to capture `code` and `state`.
 */
import { OIDC_TAB_TIMEOUT_MS } from '../types/messages';

export interface OidcTabResult {
  /** The full redirect URL, including the query string carrying code/state. */
  callbackUrl: string;
}

/**
 * Hosts an identity provider drops a user on once it has signed them in but has
 * lost the pending authorization request.
 *
 * With Entra ID federated to another IdP (Okta), authentication leaves Entra,
 * authenticates elsewhere, and returns by cross-site SAML POST. If the original
 * OAuth request context does not survive that round trip, Entra completes the
 * sign-in and sends the browser to the tenant's default landing page instead of
 * back to `redirect_uri`. Re-issuing the request then succeeds immediately,
 * because the session cookie created by the first attempt removes the federation
 * hop entirely — which is why a second login attempt has always worked.
 */
const IDP_LANDING_ORIGINS = [
  'https://portal.azure.com',
  'https://myapps.microsoft.com',
  'https://myaccount.microsoft.com',
  'https://www.office.com',
  'https://m365.cloud.microsoft',
  'https://www.microsoft365.com',
];

/**
 * Describes a URL for logging: origin, path, and the parameters that explain a
 * failure, with credential-bearing values reduced to a presence marker.
 *
 * Logging only the origin (as this first did) hides the very fields that identify
 * why a provider refused — `error`, `error_description`, and whether the request
 * still carried our `state`/`client_id` at all.
 */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    const explain = ['error', 'error_description', 'error_uri', 'prompt'];
    const parts = explain
      .filter((k) => u.searchParams.has(k))
      .map((k) => `${k}=${u.searchParams.get(k)}`);
    for (const marker of ['state', 'client_id', 'code']) {
      if (u.searchParams.has(marker)) parts.push(`${marker}=(present)`);
    }
    return `${u.origin}${u.pathname}${parts.length ? `?${parts.join('&')}` : ''}`;
  } catch {
    return '(unparseable URL)';
  }
}

function isLandingPage(url: string): boolean {
  try {
    return IDP_LANDING_ORIGINS.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

/**
 * Reads an identity-provider error out of the rendered page.
 *
 * Entra reports most refusals (`AADSTS…`) as body text on its own error page
 * rather than as an `error=` query parameter, so watching URLs alone cannot see
 * them. Without this the flow can only report "no redirect happened", which says
 * nothing about why.
 */
async function readPageError(tabId: number): Promise<string | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => /AADSTS\d+[^\n]*/.exec(document.body?.innerText ?? '')?.[0] ?? null,
    });
    const found = result?.result;
    return typeof found === 'string' ? found.slice(0, 300) : null;
  } catch {
    // Injection is refused on internal pages and during navigation; the caller
    // still reports the navigation trail.
    return null;
  }
}

export async function launchOidcInTab(
  authUrl: string,
  redirectUri: string,
  timeoutMs: number = OIDC_TAB_TIMEOUT_MS,
): Promise<OidcTabResult> {
  const tab = await chrome.tabs.create({ url: authUrl, active: true });
  const tabId = tab.id;
  if (tabId === undefined) throw new Error('Could not open a tab for the OIDC flow');

  const isAuthOrigin = (url: string): boolean => {
    try {
      return new URL(url).origin === new URL(authUrl).origin;
    } catch {
      return false;
    }
  };

  return new Promise<OidcTabResult>((resolve, reject) => {
    let settled = false;
    /**
     * Where the retry stands. `retrying` means the re-issued request has been
     * asked for but has not yet been seen loading: a landing page fires several
     * navigations of its own (`/signin/index/@tenant`, then
     * `/auth/login/@tenant`), and treating those as a second landing aborts the
     * retry milliseconds after issuing it — before it can even commit.
     */
    let retry: 'untried' | 'retrying' | 'observed' = 'untried';
    /** Distinct origins visited, in order — reported when the flow gives up. */
    const trail: string[] = [];
    /** First `AADSTS…` seen on an IdP page, if any. */
    let pageError: string | null = null;

    const describeFailure = (reason: string): string =>
      [
        reason,
        pageError ? `Identity provider says: ${pageError}` : null,
        `Path taken: ${trail.join(' → ') || '(no navigation observed)'}`,
      ]
        .filter(Boolean)
        .join(' ');

    // Without this the promise can hang forever when the provider neither
    // redirects nor reports an error (e.g. it drops the user on its own portal),
    // leaving the UI stuck on "Working…" with no way out.
    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            describeFailure(
              `No redirect to ${redirectUri} within ${Math.round(timeoutMs / 1000)}s. ` +
                'The identity provider did not return to the extension.',
            ),
          ),
        ),
      );
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onUpdated = (
      updatedTabId: number,
      change: chrome.tabs.OnUpdatedInfo,
      updatedTab: chrome.tabs.Tab,
    ) => {
      if (updatedTabId !== tabId) return;

      // The redirect to `<id>.chromiumapp.org` has no DNS entry, so that
      // navigation may never commit: `tab.url` keeps the previous page and the
      // target appears only as `changeInfo.url` or `tab.pendingUrl`. Reading
      // `tab.url` alone can therefore miss the redirect completely.
      const url = change.url ?? updatedTab.pendingUrl ?? updatedTab.url ?? '';
      if (!url) return;

      const described = describeUrl(url);
      if (trail[trail.length - 1] !== described) {
        trail.push(described);
        console.log('[OIDC] tab navigated to', described);
      }

      if (url.startsWith(redirectUri)) {
        finish(() => {
          // Best-effort: the flow already succeeded, so a failed close (tab
          // gone) must not turn into a login error.
          chrome.tabs.remove(tabId).catch(() => {});
          resolve({ callbackUrl: url });
        });
        return;
      }

      // The re-issued request has reached the provider, so the retry has now
      // genuinely been spent and a further landing is decisive.
      if (retry === 'retrying' && isAuthOrigin(url)) retry = 'observed';

      // Entra's refusals are rendered as page text, so scan its pages once they
      // finish loading. Fire-and-forget: the trail must not stall on this.
      if (change.status === 'complete' && isAuthOrigin(url)) {
        void readPageError(tabId).then((found) => {
          if (found && !pageError) {
            pageError = found;
            console.error('[OIDC] identity provider error on page', found);
          }
        });
      }

      // Signed in, but dropped on a landing page instead of redirected back.
      // Re-issue the request once: the session now exists, so it completes
      // without another trip through the federated IdP.
      if (isLandingPage(url)) {
        // Still waiting for the re-issued request to load: the portal is simply
        // navigating within itself. Nothing to decide yet.
        if (retry === 'retrying') return;

        if (retry === 'untried') {
          retry = 'retrying';
          console.log('[OIDC] provider landed on its own page; re-issuing the request once');
          chrome.tabs.update(tabId, { url: authUrl }).catch((err: unknown) => {
            finish(() =>
              reject(new Error(`Could not retry the OIDC request: ${String(err)}`)),
            );
          });
          return;
        }
        // Second landing: the session already exists, so waiting for the timeout
        // cannot change the outcome. Fail now, with the page scanned, so the
        // reason reaches the UI in seconds instead of minutes.
        void (async () => {
          const found = await readPageError(tabId);
          if (found && !pageError) pageError = found;
          finish(() => {
            chrome.tabs.remove(tabId).catch(() => {});
            reject(
              new Error(
                describeFailure(
                  'Signed in, but the identity provider returned to its own portal ' +
                    'instead of the extension, twice.',
                ),
              ),
            );
          });
        })();
        return;
      }

      // Only trust an error reported by the redirect target or by the provider
      // we sent the user to. A federated login passes through other hosts whose
      // own `error=` parameters say nothing about our request.
      const isOwnError = url.startsWith(redirectUri) || isAuthOrigin(url);
      if (isOwnError && /[?&]error=/.test(url)) {
        const params = new URL(url).searchParams;
        const description = params.get('error_description') ?? '(no description)';
        console.error('[OIDC] identity provider returned an error', {
          error: params.get('error'),
          description,
        });
        finish(() => {
          chrome.tabs.remove(tabId).catch(() => {});
          reject(new Error(`Identity provider error: ${description}`));
        });
      }
    };

    const onRemoved = (removedTabId: number) => {
      if (removedTabId !== tabId) return;
      finish(() =>
        reject(
          new Error(
            describeFailure(
              'OIDC tab was closed before the login completed. Finish every ' +
                'prompt from your identity provider and let the tab close itself.',
            ),
          ),
        ),
      );
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}
