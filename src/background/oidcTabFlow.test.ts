import { describe, it, expect, vi, beforeEach } from 'vitest';
import { describeUrl, launchOidcInTab } from './oidcTabFlow';

const REDIRECT = 'https://abcdefg.chromiumapp.org/vault-oidc';
const AUTH_URL = 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?client_id=x';

type UpdatedListener = (
  tabId: number,
  change: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab,
) => void;
type RemovedListener = (tabId: number) => void;

/** Captures the listeners the flow registers so tests can drive navigation. */
function captureListeners() {
  const updated: UpdatedListener[] = [];
  const removed: RemovedListener[] = [];
  vi.mocked(chrome.tabs.onUpdated.addListener).mockImplementation(((l: UpdatedListener) => {
    updated.push(l);
  }) as never);
  vi.mocked(chrome.tabs.onRemoved.addListener).mockImplementation(((l: RemovedListener) => {
    removed.push(l);
  }) as never);
  const emit = (
    change: Partial<chrome.tabs.OnUpdatedInfo>,
    tab: Partial<chrome.tabs.Tab>,
    tabId = 42,
  ) =>
    updated.forEach((l) =>
      l(tabId, change as chrome.tabs.OnUpdatedInfo, tab as chrome.tabs.Tab),
    );

  return {
    emit,
    navigate: (url: string, tabId = 42) => emit({}, { url }, tabId),
    close: (tabId = 42) => removed.forEach((l) => l(tabId)),
  };
}

describe('describeUrl', () => {
  it('keeps the parameters that explain a refusal', () => {
    expect(
      describeUrl(
        'https://login.microsoftonline.com/t/oauth2/v2.0/authorize' +
          '?error=invalid_request&error_description=AADSTS900971%3A+No+reply+address',
      ),
    ).toBe(
      'https://login.microsoftonline.com/t/oauth2/v2.0/authorize' +
        '?error=invalid_request&error_description=AADSTS900971: No reply address',
    );
  });

  it('never emits a code, and reduces correlating values to a marker', () => {
    const described = describeUrl(
      'https://abcdefg.chromiumapp.org/vault-oidc?code=SECRET_CODE&state=st_123',
    );
    expect(described).not.toContain('SECRET_CODE');
    expect(described).not.toContain('st_123');
    expect(described).toBe(
      'https://abcdefg.chromiumapp.org/vault-oidc?state=(present)&code=(present)',
    );
  });

  it('drops unrecognised query parameters entirely', () => {
    expect(describeUrl('https://portal.azure.com/signin?login_hint=user@example.com')).toBe(
      'https://portal.azure.com/signin',
    );
  });
});

describe('launchOidcInTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chrome.tabs.create).mockResolvedValue({ id: 42 } as never);
    vi.mocked(chrome.tabs.remove).mockResolvedValue(undefined);
  });

  it('resolves with the callback URL once the redirect is observed', async () => {
    const listeners = captureListeners();
    const flow = launchOidcInTab(AUTH_URL, REDIRECT);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

    listeners.navigate(`${REDIRECT}?code=abc123&state=xyz`);

    await expect(flow).resolves.toEqual({
      callbackUrl: `${REDIRECT}?code=abc123&state=xyz`,
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(42);
  });

  it('ignores navigation in other tabs', async () => {
    const listeners = captureListeners();
    const flow = launchOidcInTab(AUTH_URL, REDIRECT);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

    listeners.navigate(`${REDIRECT}?code=wrong`, 99);
    listeners.close(99);
    // Still pending: neither event belonged to our tab.
    listeners.navigate(`${REDIRECT}?code=right`, 42);

    await expect(flow).resolves.toEqual({ callbackUrl: `${REDIRECT}?code=right` });
  });

  it('rejects with the provider description when the IdP reports an error', async () => {
    const listeners = captureListeners();
    const flow = launchOidcInTab(AUTH_URL, REDIRECT);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

    listeners.navigate(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' +
        '?error=access_denied&error_description=AADSTS90401%3A%20Access%20denied.',
    );

    await expect(flow).rejects.toThrow(/AADSTS90401: Access denied\./);
    expect(chrome.tabs.remove).toHaveBeenCalledWith(42);
  });

  it('rejects when the user closes the tab first', async () => {
    const listeners = captureListeners();
    const flow = launchOidcInTab(AUTH_URL, REDIRECT);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

    listeners.close();

    await expect(flow).rejects.toThrow(/closed before the login completed/);
  });

  it('still resolves when closing the tab fails', async () => {
    vi.mocked(chrome.tabs.remove).mockRejectedValue(new Error('No tab with id 42'));
    const listeners = captureListeners();
    const flow = launchOidcInTab(AUTH_URL, REDIRECT);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

    listeners.navigate(`${REDIRECT}?code=abc`);

    await expect(flow).resolves.toEqual({ callbackUrl: `${REDIRECT}?code=abc` });
  });

  it('captures the redirect when it only appears as changeInfo.url', async () => {
    const listeners = captureListeners();
    const flow = launchOidcInTab(AUTH_URL, REDIRECT);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

    // chromiumapp.org has no DNS entry, so the navigation may never commit:
    // tab.url still points at the provider while changeInfo.url has the target.
    listeners.emit(
      { url: `${REDIRECT}?code=abc` },
      { url: 'https://login.microsoftonline.com/x' },
    );

    await expect(flow).resolves.toEqual({ callbackUrl: `${REDIRECT}?code=abc` });
  });

  it('captures the redirect when it only appears as pendingUrl', async () => {
    const listeners = captureListeners();
    const flow = launchOidcInTab(AUTH_URL, REDIRECT);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

    listeners.emit(
      {},
      { pendingUrl: `${REDIRECT}?code=xyz`, url: 'https://login.microsoftonline.com/x' },
    );

    await expect(flow).resolves.toEqual({ callbackUrl: `${REDIRECT}?code=xyz` });
  });

  it('reports an AADSTS error rendered on the provider page', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(chrome.scripting.executeScript).mockResolvedValue([
        { result: 'AADSTS50105: The signed in user is not assigned to a role' },
      ] as never);
      const listeners = captureListeners();
      const flow = launchOidcInTab(AUTH_URL, REDIRECT, 1000);
      await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

      // Entra renders refusals as page text, never as an `error=` parameter.
      listeners.emit(
        { status: 'complete' },
        { url: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize' },
      );
      await vi.advanceTimersByTimeAsync(1500);

      await expect(flow).rejects.toThrow(/AADSTS50105: The signed in user is not assigned/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still reports the trail when the page cannot be scanned', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(chrome.scripting.executeScript).mockRejectedValue(
        new Error('Cannot access contents of the page'),
      );
      const listeners = captureListeners();
      const flow = launchOidcInTab(AUTH_URL, REDIRECT, 1000);
      await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

      listeners.emit(
        { status: 'complete' },
        { url: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize' },
      );
      await vi.advanceTimersByTimeAsync(1500);

      await expect(flow).rejects.toThrow(/Path taken: https:\/\/login\.microsoftonline\.com/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the path taken when it gives up', async () => {
    vi.useFakeTimers();
    try {
      const listeners = captureListeners();
      const flow = launchOidcInTab(AUTH_URL, REDIRECT, 1000);
      await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

      listeners.navigate('https://login.microsoftonline.com/common/oauth2/authorize');
      listeners.navigate('https://example.okta.com/app/signin');
      listeners.navigate('https://login.microsoftonline.com/common/login');
      listeners.navigate('https://portal.azure.com/#home');
      await vi.advanceTimersByTimeAsync(1500);

      // The trail must survive into the message the options page displays,
      // because the service worker console is easy to miss.
      await expect(flow).rejects.toThrow(
        /login\.microsoftonline\.com\/common\/oauth2\/authorize → https:\/\/example\.okta\.com\/app\/signin/,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-issues the request when the provider lands on its own portal', async () => {
    const listeners = captureListeners();
    const flow = launchOidcInTab(AUTH_URL, REDIRECT);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

    // Federated login (Entra -> Okta -> Entra) signs the user in but loses the
    // pending request, so Entra drops them on the Azure portal.
    listeners.navigate('https://portal.azure.com/#home');
    expect(chrome.tabs.update).toHaveBeenCalledWith(42, { url: AUTH_URL });

    // The retry now has a session and completes without the federation hop.
    listeners.navigate(`${REDIRECT}?code=second&state=xyz`);
    await expect(flow).resolves.toEqual({
      callbackUrl: `${REDIRECT}?code=second&state=xyz`,
    });
  });

  it('retries the landing page only once, then fails without waiting', async () => {
    const listeners = captureListeners();
    const flow = launchOidcInTab(AUTH_URL, REDIRECT, 60_000);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

    listeners.navigate('https://portal.azure.com/signin');
    listeners.navigate('https://login.microsoftonline.com/t/oauth2/v2.0/authorize');
    listeners.navigate('https://portal.azure.com/signin');

    // A retry loop would hammer the IdP indefinitely.
    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);

    // Resolves well inside the 60s timeout: a second landing is already decisive.
    await expect(flow).rejects.toThrow(/returned to its own portal instead of the extension/);
  });

  it('survives the landing page navigating within itself before the retry loads', async () => {
    const listeners = captureListeners();
    const flow = launchOidcInTab(AUTH_URL, REDIRECT);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

    // The portal is a SPA: one landing emits several navigations. Counting them
    // as separate landings killed the retry before it could even commit.
    listeners.navigate('https://portal.azure.com/signin/index/@tenant');
    listeners.navigate('https://portal.azure.com/auth/login/@tenant');

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);

    listeners.navigate('https://login.microsoftonline.com/t/oauth2/v2.0/authorize');
    listeners.navigate(`${REDIRECT}?code=second`);
    await expect(flow).resolves.toEqual({ callbackUrl: `${REDIRECT}?code=second` });
  });

  it('does not treat the federated IdP as a landing page', async () => {
    const listeners = captureListeners();
    const flow = launchOidcInTab(AUTH_URL, REDIRECT);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

    // Okta is a normal step in the chain, not somewhere to recover from.
    listeners.navigate('https://example.okta.com/app/signin?error=session_expired');
    expect(chrome.tabs.update).not.toHaveBeenCalled();

    listeners.navigate(`${REDIRECT}?code=ok`);
    await expect(flow).resolves.toEqual({ callbackUrl: `${REDIRECT}?code=ok` });
  });

  it('rejects when the provider never redirects back', async () => {
    vi.useFakeTimers();
    try {
      const listeners = captureListeners();
      const flow = launchOidcInTab(AUTH_URL, REDIRECT, 1000);
      await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

      // The provider authenticates the user and drops them somewhere else
      // entirely — no redirect, no error parameter. This is the state that
      // previously wedged the UI on "Working…" forever.
      listeners.navigate('https://portal.azure.com/');
      await vi.advanceTimersByTimeAsync(1500);

      await expect(flow).rejects.toThrow(/No redirect to .* within 1s/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not time out once the redirect has been captured', async () => {
    vi.useFakeTimers();
    try {
      const listeners = captureListeners();
      const flow = launchOidcInTab(AUTH_URL, REDIRECT, 1000);
      await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

      listeners.navigate(`${REDIRECT}?code=abc`);
      await expect(flow).resolves.toEqual({ callbackUrl: `${REDIRECT}?code=abc` });

      // Firing the timer after success must not produce an unhandled rejection.
      await vi.advanceTimersByTimeAsync(5000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes both listeners so a later navigation cannot settle it twice', async () => {
    const listeners = captureListeners();
    const flow = launchOidcInTab(AUTH_URL, REDIRECT);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());

    listeners.navigate(`${REDIRECT}?code=first`);
    await expect(flow).resolves.toEqual({ callbackUrl: `${REDIRECT}?code=first` });

    expect(chrome.tabs.onUpdated.removeListener).toHaveBeenCalled();
    expect(chrome.tabs.onRemoved.removeListener).toHaveBeenCalled();
    // A late close event must not produce an unhandled rejection.
    listeners.close();
  });
});
