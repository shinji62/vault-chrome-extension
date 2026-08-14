import { VaultClient } from '../api/vaultClient';
import { launchOidcInTab } from './oidcTabFlow';
import { Settings } from '../types/settings';
import {
  BackgroundResponse,
  CLEAR_PM_PENDING_SAVE,
  ExtensionMessage,
  FILL_CREDENTIALS,
  GENERATE_PM_PASSWORD,
  GET_PM_PENDING_SAVE,
  GET_PM_PENDING_USERNAME,
  GET_SECRET,
  LIST_PM_PASSWORD_POLICIES,
  LOOKUP_TOKEN,
  OIDC_LOGIN,
  OIDC_STATUS_KEY,
  OidcStatus,
  PendingPmSave,
  PendingPmUsername,
  RENEW_TOKEN,
  SAVE_PM_SECRET,
  SAVE_SECRET,
  SEARCH_PM_SECRETS_BY_URL,
  SEARCH_SECRETS_BY_URL,
  STORE_PM_PENDING_SAVE,
  STORE_PM_PENDING_USERNAME,
  WEB_AUTHN_CREATE,
  WEB_AUTHN_GET,
  WEB_AUTHN_LIST,
  WEB_AUTHN_SIGNAL_ALL_ACCEPTED_CREDENTIALS,
  WEB_AUTHN_SIGNAL_UNKNOWN_CREDENTIAL,
  WebAuthnChoice,
} from '../types/messages';
import { TokenInfo } from '../types/vault';
import { scheduleRenewal, cancelRenewal } from './renewalScheduler';
import { hostnamesMatch } from '../utils/urlMatcher';
import {
  webAuthnCreate,
  webAuthnGet,
  passkeyLabel,
  passkeyLabelFromUserName,
  selectPasskeyCandidates,
  isUserVerificationSatisfiable,
} from '../webauthn/webauthn';
import { assertTrustedWebAuthnSender } from '../webauthn/origin';
import {
  selectSignalledRevokedCredentials,
  selectSignalledUnknownCredential,
} from '../webauthn/signal';
import { withKeepAlive } from './keepAlive';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let client: VaultClient | null = null;
let pmClient: VaultClient | null = null;
let entityId: string = '';

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

function storageSessionRemove(keys: string[]): Promise<void> {
  return new Promise((resolve) => chrome.storage.session.remove(keys, () => resolve()));
}

/** Reads whether the PM Transit (passkey) feature is enabled from settings. */
async function pmTransitEnabled(): Promise<boolean> {
  const stored = await storageLocalGet<Settings>(['vaultSettings']);
  return !!stored.vaultSettings?.pmTransitEnabled;
}

/**
 * Lists stored passkey metadata, throwing unless the passkey store is usable.
 *
 * Signals must not report success when the store could not even be consulted:
 * that would look like "nothing to delete" and hide a credential still sitting
 * in Vault.
 */
async function requirePasskeyStore(): Promise<
  Awaited<ReturnType<VaultClient['listPasskeys']>>
> {
  if (!pmClient || !entityId) throw new Error('Password Manager is not initialised');
  if (!(await pmTransitEnabled())) {
    throw new Error('Transit is not enabled — passkeys are unavailable. Enable it in Settings.');
  }
  return pmClient.listPasskeys(entityId);
}

/** Removes the given passkeys from Vault, returning how many were deleted. */
async function deletePasskeys(rows: Array<{ label: string }>): Promise<number> {
  if (!pmClient) throw new Error('Password Manager is not initialised');
  for (const row of rows) {
    await pmClient.deletePasskey(entityId, row.label);
  }
  return rows.length;
}

// Auto-save prompt freshness window. A pending save older than this (e.g. from a
// previous session or a stale tab) is dropped instead of re-shown.
const PENDING_SAVE_TTL_MS = 60_000;
const pendingSaveKey = (tabId: number): string => `pmPendingSave_${tabId}`;
const pendingUsernameKey = (tabId: number): string => `pmPendingUsername_${tabId}`;

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
    try {
      const self = await client.lookupTokenSelf();
      entityId = self.data.entity_id || self.data.accessor;
      await storageLocalSet({ vaultEntityId: entityId });
    } catch (e) {
      console.warn('[vault] Could not look up token self on startup:', e);
    }
    pmClient = new VaultClient(
      { ...settings, namespace: settings.pmNamespace || undefined },
      token,
    );
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
  ]).then(async ([localStored, sessionStored]) => {
    const settings = localStored['vaultSettings'] as Settings | undefined;
    const token = sessionStored['vaultToken'] as string | undefined;

    console.log('[vault] rebuilt background client from storage', {
      hasSettings: !!settings,
      hasToken: !!token,
      namespace: settings?.namespace,
    });

    if (settings && token) {
      client = new VaultClient(settings, token);
      try {
        const self = await client.lookupTokenSelf();
        entityId = self.data.entity_id || self.data.accessor;
        await storageLocalSet({ vaultEntityId: entityId });
      } catch (e) {
        console.warn('[vault] Could not look up token self on rebuild:', e);
      }
      pmClient = new VaultClient(
        { ...settings, namespace: settings.pmNamespace || undefined },
        token,
      );
    } else {
      client = null;
      pmClient = null;
      entityId = '';
    }
  });
}

chrome.storage.local.onChanged.addListener((changes) => {
  if (!('vaultSettings' in changes)) return;
  console.debug('[vault] local storage changed (settings)');
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

// Mode A has to discover secrets by walking KV, which costs one metadata read
// per secret. These bounds keep a large Vault from turning a single page load
// into thousands of sequential requests.
const SEARCH_MAX_DEPTH = 6;
const SEARCH_MAX_SECRETS_PER_MOUNT = 500;
const SEARCH_CONCURRENCY = 8;

/** Runs `worker` over `items` with at most `limit` requests in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function searchSecretsByUrl(
  pageUrl: string,
): Promise<Array<{ mount: string; path: string; username: string }>> {
  if (!client) throw new Error('Vault client not initialised');
  const vault = client;

  const mounts = await vault.listMounts();

  // Filter to KV v2 mounts only
  const kv2Mounts = Object.entries(mounts)
    .filter(([, info]) => info.type === 'kv' && info.options?.version === '2')
    .map(([mountKey]) => mountKey.replace(/\/$/, '')); // strip trailing slash

  const results: Array<{ mount: string; path: string; username: string }> = [];

  async function collectPaths(
    mount: string,
    secretPaths: string[],
    prefix: string,
    depth: number,
  ): Promise<void> {
    if (depth > SEARCH_MAX_DEPTH || secretPaths.length >= SEARCH_MAX_SECRETS_PER_MOUNT) return;

    let keys: string[];
    try {
      keys = await vault.listSecrets(mount, prefix, 2);
    } catch {
      return; // path might be empty or not listable
    }

    for (const key of keys) {
      if (secretPaths.length >= SEARCH_MAX_SECRETS_PER_MOUNT) return;
      const fullKey = prefix ? `${prefix}/${key}` : key;
      if (key.endsWith('/')) {
        await collectPaths(mount, secretPaths, fullKey.replace(/\/$/, ''), depth + 1);
      } else {
        secretPaths.push(fullKey);
      }
    }
  }

  for (const mount of kv2Mounts) {
    const secretPaths: string[] = [];
    await collectPaths(mount, secretPaths, '', 0);

    if (secretPaths.length >= SEARCH_MAX_SECRETS_PER_MOUNT) {
      console.warn(
        `[vault] mount "${mount}" hit the ${SEARCH_MAX_SECRETS_PER_MOUNT}-secret scan cap; results may be incomplete.`,
      );
    }

    // Only secrets whose custom_metadata.url matches are read, so secret
    // material is never fetched just to compare a hostname.
    const matched = await mapWithConcurrency(secretPaths, SEARCH_CONCURRENCY, async (secretPath) => {
      try {
        const metadata = await vault.readMetadata(mount, secretPath);
        const storedUrl = metadata.data?.custom_metadata?.url;
        if (!storedUrl || !hostnamesMatch(storedUrl, pageUrl)) return null;

        const data = await vault.readSecret(mount, secretPath, 2);
        return { mount, path: secretPath, username: data['username'] ?? '' };
      } catch {
        return null; // skip secrets that can't be read
      }
    });

    for (const row of matched) {
      if (row) results.push(row);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse): true => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((e: unknown) => {
        const error = e instanceof Error ? e.message : String(e);
        sendResponse({ success: false, error } satisfies BackgroundResponse<never>);
      });

    // Return true to keep the message channel open for async sendResponse
    return true;
  },
);

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse<unknown>> {
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

    case SEARCH_PM_SECRETS_BY_URL: {
      if (!pmClient || !entityId) return { success: false, error: 'PM client not initialised or entity ID missing' };
      const localStore = await storageLocalGet<unknown>(['vaultSettings']);
      const pmSettings = localStore['vaultSettings'] as Settings | undefined;
      const mount = pmSettings?.pmMount || 'secret';
      const basePath = `password-manager/${entityId}`;
      let keys: string[];
      try {
        keys = await pmClient.listSecrets(mount, basePath, 2);
      } catch {
        return { success: true, data: [] };
      }
      const pmResults: Array<{ mount: string; path: string; username: string; password: string }> =
        [];
      for (const key of keys) {
        if (key.endsWith('/')) continue; // skip sub-directories
        const secretPath = `${basePath}/${key}`;
        try {
          const metadata = await pmClient.readMetadata(mount, secretPath);
          const storedUrl = metadata.data?.custom_metadata?.url;
          if (!storedUrl || !hostnamesMatch(storedUrl, message.url)) continue;
          const data = await pmClient.readSecret(mount, secretPath, 2);
          const username = (data['username'] as string) ?? '';
          const password = (data['password'] as string) ?? '';
          pmResults.push({ mount, path: secretPath, username, password });
        } catch {
          // skip unreadable secrets
        }
      }
      return { success: true, data: pmResults };
    }

    case SAVE_PM_SECRET: {
      if (!pmClient || !entityId) return { success: false, error: 'PM client not initialised or entity ID missing' };
      const localStore2 = await storageLocalGet<unknown>(['vaultSettings']);
      const pmSettings2 = localStore2['vaultSettings'] as Settings | undefined;
      const mount = pmSettings2?.pmMount || 'secret';
      const path = `password-manager/${entityId}/${message.label}`;
      await pmClient.createOrUpdateSecret(mount, path, { username: message.username, password: message.password }, 2);
      await pmClient.updateMetadata(mount, path, { url: message.url });
      return { success: true, data: undefined };
    }

    case LIST_PM_PASSWORD_POLICIES: {
      if (!pmClient) return { success: false, error: 'PM client not initialised' };
      const policies = await pmClient.listPasswordPolicies();
      return { success: true, data: policies };
    }

    case GENERATE_PM_PASSWORD: {
      if (!pmClient) return { success: false, error: 'PM client not initialised' };
      const generated = await pmClient.generatePassword(message.policyName);
      return { success: true, data: generated };
    }

    case STORE_PM_PENDING_SAVE: {
      if (sender.tab?.id == null) return { success: true, data: undefined };
      const pending: PendingPmSave = {
        username: message.username,
        password: message.password,
        storedAt: Date.now(),
      };
      await storageSessionSet({ [pendingSaveKey(sender.tab.id)]: pending });
      return { success: true, data: undefined };
    }

    case GET_PM_PENDING_SAVE: {
      if (sender.tab?.id == null) return { success: true, data: undefined };
      const key = pendingSaveKey(sender.tab.id);
      const stored = await storageSessionGet<PendingPmSave>([key]);
      const pending = stored[key];
      if (!pending) return { success: true, data: undefined };
      if (Date.now() - pending.storedAt > PENDING_SAVE_TTL_MS) {
        await storageSessionRemove([key]);
        return { success: true, data: undefined };
      }
      return { success: true, data: pending };
    }

    case STORE_PM_PENDING_USERNAME: {
      if (sender.tab?.id == null) return { success: true, data: undefined };
      const pendingUsername: PendingPmUsername = {
        username: message.username,
        hostname: message.hostname,
        storedAt: Date.now(),
      };
      await storageSessionSet({ [pendingUsernameKey(sender.tab.id)]: pendingUsername });
      return { success: true, data: undefined };
    }

    case GET_PM_PENDING_USERNAME: {
      if (sender.tab?.id == null) return { success: true, data: undefined };
      const key = pendingUsernameKey(sender.tab.id);
      const stored = await storageSessionGet<PendingPmUsername>([key]);
      const pending = stored[key];
      if (!pending) return { success: true, data: undefined };
      if (Date.now() - pending.storedAt > PENDING_SAVE_TTL_MS) {
        await storageSessionRemove([key]);
        return { success: true, data: undefined };
      }
      return { success: true, data: pending };
    }

    case WEB_AUTHN_LIST: {
      if (!pmClient || !entityId) {
        return { success: false, error: 'Password Manager is not initialised' };
      }
      const transit = await pmTransitEnabled();
      if (!transit) {
        return { success: false, error: 'Transit is not enabled — passkeys are unavailable. Enable it in Settings.' };
      }
      // Checked here, before the chooser is shown, so an unsatisfiable request
      // falls back to the platform authenticator instead of asking the user to
      // pick a passkey that could never be used.
      if (!isUserVerificationSatisfiable(message.userVerification)) {
        return {
          success: false,
          error: 'WebAuthn: userVerification="required" is not supported by this software authenticator.',
        };
      }
      try {
        assertTrustedWebAuthnSender(sender, message.origin, message.rpId);
        const rows = await pmClient.listPasskeys(entityId);
        const choices: WebAuthnChoice[] = selectPasskeyCandidates(
          rows,
          message.rpId,
          message.allowCredentials,
        ).map((row) => ({
          label: row.label,
          username: row.username,
          rpId: row.rpId as string,
        }));
        return { success: true, data: choices };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case WEB_AUTHN_CREATE: {
      if (!pmClient || !entityId) {
        return { success: false, error: 'Password Manager is not initialised' };
      }
      const transit = await pmTransitEnabled();
      if (!transit) {
        return { success: false, error: 'Transit is not enabled — passkeys are unavailable. Enable it in Settings.' };
      }
      try {
        assertTrustedWebAuthnSender(sender, message.origin, message.rpId);
        const result = await webAuthnCreate({
          rp: { id: message.rpId, name: message.rpName },
          user: {
            id: message.userHandle,
            name: message.userName,
            displayName: message.userDisplayName,
          },
          challenge: message.challenge,
          pubKeyCredParams: message.pubKeyCredParams,
          origin: message.origin,
          userVerification: message.userVerification,
        });
        await pmClient.savePasskey(entityId, {
          label: message.label
            ? passkeyLabelFromUserName(message.label, result.secret.credentialId)
            : passkeyLabel(result.secret.rpId, result.secret.userName, result.secret.credentialId),
          rpId: result.secret.rpId,
          username: result.secret.userName || undefined,
          credentialId: result.secret.credentialId,
          userHandle: result.secret.userHandle,
          algorithm: result.secret.algorithm,
          counter: result.secret.counter,
          privateJwk: result.secret.privateJwk,
        });
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case WEB_AUTHN_GET: {
      if (!pmClient || !entityId) {
        return { success: false, error: 'Password Manager is not initialised' };
      }
      const transit = await pmTransitEnabled();
      if (!transit) {
        return { success: false, error: 'Transit is not enabled — passkeys are unavailable. Enable it in Settings.' };
      }
      try {
        assertTrustedWebAuthnSender(sender, message.origin, message.rpId);
        const rows = await pmClient.listPasskeys(entityId);
        const candidates = selectPasskeyCandidates(rows, message.rpId, message.allowCredentials);
        if (candidates.length === 0) {
          return { success: false, error: 'No passkey for this site' };
        }
        // The label comes from the page's process, so it is re-checked against
        // the candidate set: a forged one must not reach an unrelated identity
        // or a credential the relying party excluded from allowCredentials.
        const chosen = candidates.find((r) => r.label === message.label);
        if (!chosen) {
          return { success: false, error: 'Selected passkey is not usable for this site' };
        }
        const record = await pmClient.readPasskey(entityId, chosen.label);
        const result = await webAuthnGet({
          rpId: record.rpId,
          challenge: message.challenge,
          origin: message.origin,
          userHandle: record.userHandle,
          credentialId: record.credentialId,
          privateJwk: record.privateJwk,
          signCount: Number(record.counter) || 0,
          userVerification: message.userVerification,
        });
        await pmClient.savePasskey(entityId, {
          label: record.label,
          rpId: record.rpId,
          username: record.username,
          credentialId: record.credentialId,
          userHandle: record.userHandle,
          algorithm: Number(record.algorithm),
          counter: result.newSignCount,
          privateJwk: record.privateJwk,
          createdAt: record.createdAt,
        });
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case WEB_AUTHN_SIGNAL_UNKNOWN_CREDENTIAL: {
      try {
        assertTrustedWebAuthnSender(sender, message.origin, message.rpId);
        const rows = await requirePasskeyStore();
        const doomed = selectSignalledUnknownCredential(
          rows,
          message.rpId,
          message.credentialId,
        );
        return { success: true, data: { deleted: await deletePasskeys(doomed) } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case WEB_AUTHN_SIGNAL_ALL_ACCEPTED_CREDENTIALS: {
      try {
        assertTrustedWebAuthnSender(sender, message.origin, message.rpId);
        const rows = await requirePasskeyStore();
        const doomed = selectSignalledRevokedCredentials(
          rows,
          message.rpId,
          message.userId,
          message.allAcceptedCredentialIds,
        );
        return { success: true, data: { deleted: await deletePasskeys(doomed) } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case CLEAR_PM_PENDING_SAVE: {
      if (sender.tab?.id == null) return { success: true, data: undefined };
      await storageSessionRemove([pendingSaveKey(sender.tab.id)]);
      return { success: true, data: undefined };
    }

    // FILL_CREDENTIALS targets the content script (popup -> active tab) and is
    // never routed to the background worker.
    case FILL_CREDENTIALS: {
      return { success: false, error: 'FILL_CREDENTIALS is handled by the content script' };
    }

    case SAVE_SECRET: {
      if (!client) return { success: false, error: 'Vault client not initialised' };
      const { mount, path, username, password, url } = message;
      await client.createOrUpdateSecret(mount, path, { username, password }, 2);
      await client.updateMetadata(mount, path, { url });
      return { success: true, data: undefined };
    }

    case OIDC_LOGIN: {
      // The initiating popup is destroyed as soon as the auth window takes
      // focus, so it will almost never receive this response. Progress is
      // mirrored into session storage instead, and the worker is pinned alive
      // for the whole interactive flow so the token is not lost mid-login.
      await storageSessionSet({
        [OIDC_STATUS_KEY]: { state: 'in-progress', startedAt: Date.now() } satisfies OidcStatus,
      });

      let token: string;
      try {
        token = await withKeepAlive(() =>
          oidcLogin(
            message.vaultUrl,
            message.mount,
            message.role,
            message.namespace,
            message.redirectUri,
          ),
        );
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        await storageSessionSet({
          [OIDC_STATUS_KEY]: { state: 'error', error, failedAt: Date.now() } satisfies OidcStatus,
        });
        throw e;
      }

      // Token first: writing settings triggers the local-storage listener, and
      // rebuildClient() needs both halves present or it nulls out the client.
      const settings: Settings = { ...message.settings, namespace: message.namespace || undefined };
      await storageSessionSet({ vaultToken: token });
      await storageLocalSet({ vaultSettings: settings });
      await storageSessionRemove([OIDC_STATUS_KEY]);
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
// OIDC login via chrome.identity.
//
// The flow only completes when the IdP redirects the browser to `redirectUri`
// (an https://<ext-id>.chromiumapp.org/... URL). Chrome closes the auth window
// itself at that point. Closing the window by hand beforehand surfaces as
// "The user did not approve access", even if the user did authenticate — the
// IdP simply had not issued the final redirect yet.
// ---------------------------------------------------------------------------

async function oidcLogin(
  vaultUrl: string,
  mount: string,
  role: string | undefined,
  namespace: string | undefined,
  redirectUriOverride?: string,
): Promise<string> {
  const baseUrl = vaultUrl.replace(/\/$/, '');
  // chrome.identity routes the OAuth redirect back to the extension, so the
  // redirect_uri must be the extension's own URL. It must be listed in the
  // Vault OIDC role's allowed_redirect_uris (the user can override it in
  // Settings if their role requires a custom path).
  const redirectUri =
    redirectUriOverride?.trim() || chrome.identity.getRedirectURL('vault-oidc');
  console.log('[OIDC] using redirect_uri:', redirectUri);

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

  if (!authUrl?.startsWith('http')) {
    throw new Error(`Vault returned an invalid auth URL: "${authUrl ?? '(none)'}"`);
  }

  // Log the OAuth parameters Vault actually asked the IdP for. `state` and
  // `nonce` are deliberately omitted — single-use, but still not worth logging.
  //
  // These are what an IdP matches against its own app registration, so a
  // redirect that never fires is usually explained here: a redirect_uri that
  // differs by case/trailing slash, an unexpected response_mode (form_post is
  // delivered as a POST, which launchWebAuthFlow will not intercept), or a
  // client_id registered under the wrong platform type.
  try {
    const authParams = new URL(authUrl).searchParams;
    console.log('[OIDC] auth request parameters', {
      idpHost: new URL(authUrl).host,
      client_id: authParams.get('client_id'),
      redirect_uri: authParams.get('redirect_uri'),
      response_type: authParams.get('response_type'),
      response_mode: authParams.get('response_mode') ?? '(default: query)',
      scope: authParams.get('scope'),
      redirectUriMatchesExtension: authParams.get('redirect_uri') === redirectUri,
    });
    // Opening this in a normal tab shows what the auth window hides: any IdP
    // error page (e.g. Entra's AADSTS codes) and the final URL it redirects to.
    // Contains single-use state/nonce, so it is one-shot and not worth sharing.
    console.log('[OIDC] full auth_url (open in a normal tab to see IdP errors):', authUrl);
  } catch {
    console.log('[OIDC] auth_url could not be parsed for logging');
  }

  // 2. Run the interactive OAuth flow, which resolves with the callback URL
  // (carrying ?code=…&state=…) once the IdP redirects to `redirectUri`.
  //
  // If the auth window never closes by itself, Chrome did not recognise the
  // final redirect as belonging to this extension — i.e. the IdP did not send
  // the browser to `redirectUri` above. Compare that exact string (logged) with
  // the IdP client's allowed redirect URIs; a mismatch anywhere in scheme,
  // host, path or trailing slash leaves the window open with no callback.
  const flowStartedAt = Date.now();

  // Prefer a normal tab: launchWebAuthFlow's isolated window lacks the
  // profile's cookies and device state, which providers enforcing device-based
  // Conditional Access require. See oidcTabFlow.ts.
  try {
    const { callbackUrl } = await launchOidcInTab(authUrl, redirectUri);
    console.log('[OIDC] tab flow completed', { elapsedMs: Date.now() - flowStartedAt });
    return await exchangeOidcCallback(baseUrl, mount, headers, callbackUrl, redirectUri);
  } catch (tabErr) {
    // A provider-side denial or a tab we could not open are both terminal;
    // retrying in the weaker isolated window would only obscure the reason.
    console.error('[OIDC] tab flow failed', {
      elapsedMs: Date.now() - flowStartedAt,
      error: tabErr instanceof Error ? tabErr.message : String(tabErr),
    });
    throw tabErr;
  }
}

/**
 * Exchanges the `code`/`state` from an OIDC redirect for a Vault token via
 * GET /v1/auth/<mount>/oidc/callback.
 */
async function exchangeOidcCallback(
  baseUrl: string,
  mount: string,
  headers: Record<string, string>,
  callbackUrl: string,
  redirectUri: string,
): Promise<string> {
  const params = new URL(callbackUrl).searchParams;
  const code = params.get('code');
  const state = params.get('state');
  console.log('[OIDC] callback received', { code: code ? '(present)' : '(missing)' });

  const callbackApiUrl = new URL(`${baseUrl}/v1/auth/${mount}/oidc/callback`);
  if (state) callbackApiUrl.searchParams.set('state', state);
  if (code) callbackApiUrl.searchParams.set('code', code);
  callbackApiUrl.searchParams.set('redirect_uri', redirectUri);

  const callbackRes = await fetch(callbackApiUrl.toString(), { method: 'GET', headers });

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

