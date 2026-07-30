import { VaultClient } from '../api/vaultClient';
import { Settings } from '../types/settings';
import {
  BackgroundResponse,
  ExtensionMessage,
  GET_SECRET,
  LOOKUP_TOKEN,
  OIDC_LOGIN,
  RENEW_TOKEN,
  SAVE_SECRET,
  SEARCH_SECRETS_BY_URL,
} from '../types/messages';
import { TokenInfo } from '../types/vault';
import { scheduleRenewal, cancelRenewal } from './renewalScheduler';
import { hostnamesMatch } from '../utils/urlMatcher';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let client: VaultClient | null = null;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function storageLocalGet<T>(keys: string[]): Promise<Record<string, T>> {
  return new Promise((resolve) => chrome.storage.local.get(keys, (result) => resolve(result as Record<string, T>)));
}

function storageLocalSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(items, () => resolve()));
}

function storageSessionGet<T>(keys: string[]): Promise<Record<string, T>> {
  return new Promise((resolve) => chrome.storage.session.get(keys, (result) => resolve(result as Record<string, T>)));
}

function storageSessionSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.session.set(items, () => resolve()));
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Startup — load settings + token, schedule renewal if token already exists
// ---------------------------------------------------------------------------

async function initialise(): Promise<void> {
  const [localStored, sessionStored] = await Promise.all([
    storageLocalGet<unknown>(['vaultSettings']),
    storageSessionGet<unknown>(['vaultToken']),
  ]);
  const settings = localStored['vaultSettings'] as Settings | undefined;
  const token = sessionStored['vaultToken'] as string | undefined;

  console.log('[vault] initialise storage snapshot', {
    hasSettings: !!settings,
    hasToken: !!token,
    namespace: settings?.namespace,
  });

  if (settings && token) {
    client = new VaultClient(settings, token);
    try {
      const tokenInfo = await client.lookupToken();
      scheduleRenewal(tokenInfo);
    } catch (e) {
      console.warn('[vault] Could not look up token on startup:', e);
    }
  }
}

initialise();

// ---------------------------------------------------------------------------
// Re-instantiate client when settings or token change
// ---------------------------------------------------------------------------

// Re-build the client whenever settings (local) or token (session) changes.
function rebuildClient(): void {
  Promise.all([
    storageLocalGet<unknown>(['vaultSettings']),
    storageSessionGet<unknown>(['vaultToken']),
  ]).then(([localStored, sessionStored]) => {
    const settings = localStored['vaultSettings'] as Settings | undefined;
    const token = sessionStored['vaultToken'] as string | undefined;

    console.log('[vault] rebuilt background client from storage', {
      hasSettings: !!settings,
      hasToken: !!token,
      namespace: settings?.namespace,
    });

    client = (settings && token) ? new VaultClient(settings, token) : null;
  });
}

chrome.storage.local.onChanged.addListener((changes) => {
  if (!('vaultSettings' in changes)) return;
  console.log('[vault] local storage changed (settings)', changes.vaultSettings);
  rebuildClient();
});

chrome.storage.session.onChanged.addListener((changes) => {
  if (!('vaultToken' in changes)) return;
  console.log('[vault] session storage changed (token)', { hasToken: !!changes.vaultToken?.newValue });
  rebuildClient();
});

// ---------------------------------------------------------------------------
// Alarm handler — fire renewal
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'vault-token-renew') return;
  if (!client) return;

  try {
    const tokenInfo: TokenInfo = await client.renewToken();

    if (!tokenInfo.renewable) {
      cancelRenewal();
      await storageLocalSet({ vaultTokenWarning: 'not_renewable', vaultTokenInfo: null });
      return;
    }

    // Persist fresh tokenInfo so the popup countdown resets automatically
    await storageLocalSet({ vaultTokenWarning: null, vaultTokenInfo: tokenInfo });
    scheduleRenewal(tokenInfo);
  } catch (e) {
    console.error('[vault] Token renewal failed:', e);
    await storageLocalSet({ vaultTokenWarning: 'renewal_failed' });
  }
});

// ---------------------------------------------------------------------------
// SEARCH_SECRETS_BY_URL helper
// ---------------------------------------------------------------------------

async function searchSecretsByUrl(
  pageUrl: string,
): Promise<Array<{ mount: string; path: string; username: string }>> {
  if (!client) throw new Error('Vault client not initialised');

  const mounts = await client.listMounts();

  // Filter to KV v2 mounts only
  const kv2Mounts = Object.entries(mounts)
    .filter(([, info]) => info.type === 'kv' && info.options?.version === '2')
    .map(([mountKey]) => mountKey.replace(/\/$/, '')); // strip trailing slash

  const results: Array<{ mount: string; path: string; username: string }> = [];

  for (const mount of kv2Mounts) {
    // Recursively collect all leaf secret paths
    const secretPaths: string[] = [];

    async function collectPaths(prefix: string): Promise<void> {
      let keys: string[];
      try {
        keys = await client!.listSecrets(mount, prefix, 2);
      } catch {
        return; // path might be empty or not listable
      }
      for (const key of keys) {
        const fullKey = prefix ? `${prefix}/${key}` : key;
        if (key.endsWith('/')) {
          await collectPaths(fullKey.replace(/\/$/, ''));
        } else {
          secretPaths.push(fullKey);
        }
      }
    }

    await collectPaths('');

    // Check metadata of each secret for url match
    for (const secretPath of secretPaths) {
      try {
        const metadata = await client.readMetadata(mount, secretPath);
        const storedUrl = metadata.data?.custom_metadata?.url;
        if (!storedUrl) continue;

        if (hostnamesMatch(storedUrl, pageUrl)) {
          // Read username field from secret data
          const data = await client.readSecret(mount, secretPath, 2);
          const username = data['username'] ?? '';
          results.push({ mount, path: secretPath, username });
        }
      } catch {
        // Skip secrets that can't be read
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse): true => {
    handleMessage(message)
      .then(sendResponse)
      .catch((e: unknown) => {
        const error = e instanceof Error ? e.message : String(e);
        sendResponse({ success: false, error } satisfies BackgroundResponse<never>);
      });

    // Return true to keep the message channel open for async sendResponse
    return true;
  },
);

async function handleMessage(message: ExtensionMessage): Promise<BackgroundResponse<unknown>> {
  switch (message.type) {
    case LOOKUP_TOKEN: {
      if (!client) return { success: false, error: 'Vault client not initialised' };
      const tokenInfo = await client.lookupToken();
      return { success: true, data: tokenInfo };
    }

    case RENEW_TOKEN: {
      if (!client) return { success: false, error: 'Vault client not initialised' };
      const tokenInfo = await client.renewToken(message.increment);
      scheduleRenewal(tokenInfo);
      // Persist fresh tokenInfo so the popup countdown resets automatically
      await storageLocalSet({ vaultTokenWarning: null, vaultTokenInfo: tokenInfo });
      return { success: true, data: tokenInfo };
    }

    case SEARCH_SECRETS_BY_URL: {
      const matches = await searchSecretsByUrl(message.url);
      return { success: true, data: matches };
    }

    case GET_SECRET: {
      if (!client) return { success: false, error: 'Vault client not initialised' };
      const data = await client.readSecret(message.mount, message.path, message.kvVersion);
      return { success: true, data };
    }

    case SAVE_SECRET: {
      if (!client) return { success: false, error: 'Vault client not initialised' };
      const { mount, path, username, password, url } = message;
      await client.createOrUpdateSecret(mount, path, { username, password }, 2);
      await client.updateMetadata(mount, path, { url });
      return { success: true, data: undefined };
    }

    case OIDC_LOGIN: {
      const token = await oidcLoginWithTab(message.vaultUrl, message.mount, message.role, message.namespace, message.redirectUri);
      // Save settings to local storage; token goes to session storage only.
      const settings: Settings = { ...message.settings, namespace: message.namespace || undefined };
      await storageLocalSet({ vaultSettings: settings });
      await storageSessionSet({ vaultToken: token });
      return { success: true, data: token };
    }

    default: {
      const exhaustive: never = message;
      return { success: false, error: `Unknown message type: ${(exhaustive as ExtensionMessage).type}` };
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[vault] Vault Password Manager installed.');
});

// ---------------------------------------------------------------------------
// OIDC login via real browser tab (mirrors the Vault UI flow)
// ---------------------------------------------------------------------------

async function oidcLoginWithTab(
  vaultUrl: string,
  mount: string,
  role: string | undefined,
  namespace: string | undefined,
  redirectUriOverride?: string,
): Promise<string> {
  const baseUrl = vaultUrl.replace(/\/$/, '');
  // Default to the Vault UI callback URL (already in allowed_redirect_uris for UI users).
  // The user can override this in Settings if their role uses a different URI.
  const redirectUri = redirectUriOverride?.trim() || `${baseUrl}/ui/vault/auth/${mount}/oidc/callback`;
  console.debug('[OIDC] using redirect_uri:', redirectUri);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (namespace) headers['X-Vault-Namespace'] = namespace;

  // 1. Get the IdP authorization URL from Vault
  const authUrlRes = await fetch(`${baseUrl}/v1/auth/${mount}/oidc/auth_url`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ role: role || undefined, redirect_uri: redirectUri }),
  });

  if (!authUrlRes.ok) {
    let vaultErrors: string[] = [];
    try {
      const errBody = (await authUrlRes.json()) as { errors?: string[] };
      if (Array.isArray(errBody.errors)) vaultErrors = errBody.errors;
    } catch { /* ignore */ }
    const detail = vaultErrors.length ? vaultErrors.join('; ') : '(no error body)';
    console.error('[OIDC] auth_url failed', { status: authUrlRes.status, vaultErrors });
    throw new Error(`Failed to get OIDC auth URL: ${authUrlRes.status} — ${detail}`);
  }

  const authUrlData = (await authUrlRes.json()) as { data?: { auth_url?: string } };
  const authUrl = authUrlData?.data?.auth_url;
  console.debug('[OIDC] auth_url received:', authUrl ?? '(empty)');

  if (!authUrl?.startsWith('http')) {
    throw new Error(`Vault returned an invalid auth URL: "${authUrl ?? '(none)'}"`);
  }

  // 2. Open the IdP login page in a new tab and wait for Vault's callback URL
  const callbackUrl = await openTabAndWaitForCallback(authUrl, redirectUri);

  // 3. Extract code + state from the callback URL and exchange with Vault.
  // Vault's OIDC callback API is GET /v1/auth/<mount>/oidc/callback?state=…&code=…&redirect_uri=…
  const params = new URL(callbackUrl).searchParams;
  const code = params.get('code');
  const state = params.get('state');
  console.debug('[OIDC] callback received', { state, code: code ? '(present)' : '(missing)' });

  const callbackApiUrl = new URL(`${baseUrl}/v1/auth/${mount}/oidc/callback`);
  if (state) callbackApiUrl.searchParams.set('state', state);
  if (code) callbackApiUrl.searchParams.set('code', code);
  callbackApiUrl.searchParams.set('redirect_uri', redirectUri);

  const callbackRes = await fetch(callbackApiUrl.toString(), {
    method: 'GET',
    headers,
  });

  if (!callbackRes.ok) {
    let vaultErrors: string[] = [];
    try {
      const errBody = (await callbackRes.json()) as { errors?: string[] };
      if (Array.isArray(errBody.errors)) vaultErrors = errBody.errors;
    } catch { /* ignore */ }
    const detail = vaultErrors.length ? vaultErrors.join('; ') : '(no error body)';
    throw new Error(`OIDC callback failed: ${callbackRes.status} — ${detail}`);
  }

  const callbackData = (await callbackRes.json()) as { auth: { client_token: string } };
  return callbackData.auth.client_token;
}

function openTabAndWaitForCallback(authUrl: string, redirectUri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let tabId: number | undefined;
    let settled = false;

    function settle(fn: () => void) {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      fn();
    }

    function checkUrl(url: string) {
      console.debug('[OIDC] tab url:', url);
      if (url.startsWith(redirectUri)) {
        settle(() => {
          chrome.tabs.remove(tabId!);
          resolve(url);
        });
      }
    }

    // onUpdated fires on every state change; query the actual tab URL each time
    // because changeInfo.url is only set on the *first* navigation, not on
    // subsequent same-origin navigations or when the Vault UI JS updates history.
    function onUpdated(updatedTabId: number) {
      if (updatedTabId !== tabId) return;
      chrome.tabs.get(updatedTabId, (tab) => {
        if (chrome.runtime.lastError || !tab.url) return;
        checkUrl(tab.url);
      });
    }

    function onRemoved(removedTabId: number) {
      if (removedTabId !== tabId) return;
      settle(() => reject(new Error('OIDC login tab was closed')));
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs.create({ url: authUrl }, (tab) => {
      if (!tab.id) {
        settle(() => reject(new Error('Failed to open OIDC login tab')));
        return;
      }
      tabId = tab.id;
    });
  });
}
