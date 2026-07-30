import { Settings } from '../types/settings';
import { VaultClient } from './vaultClient';
import { OIDC_LOGIN } from '../types/messages';

export async function loginWithToken(settings: Settings, token: string): Promise<string> {
  const client = new VaultClient({ ...settings, token });
  await client.lookupToken();
  return token;
}

export async function loginWithOIDC(settings: Settings): Promise<void> {
  const mount = (settings.oidcMount ?? 'oidc').replace(/^\/|\/$/g, '');

  // The background opens a tab, completes the OIDC flow, and saves
  // settings+token to storage. We await the response so errors (e.g.
  // auth_url failures) propagate back to the caller.
  const response = await chrome.runtime.sendMessage({
    type: OIDC_LOGIN,
    vaultUrl: settings.vaultUrl,
    mount,
    role: settings.oidcRole || undefined,
    namespace: settings.namespace,
    redirectUri: settings.oidcRedirectUri || undefined,
    settings,
  });

  if (response && !response.success) {
    throw new Error(response.error ?? 'OIDC login failed');
  }
}
