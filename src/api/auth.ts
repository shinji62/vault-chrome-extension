import { Settings } from '../types/settings';
import { VaultClient } from './vaultClient';
import { OIDC_LOGIN } from '../types/messages';

export async function loginWithToken(settings: Settings, token: string): Promise<string> {
  const client = new VaultClient(settings, token);
  await client.lookupToken();
  return token;
}

export async function loginWithOIDC(settings: Settings): Promise<void> {
  const mount = (settings.oidcMount ?? 'oidc').replace(/^\/|\/$/g, '');

  // The background completes the OIDC flow and saves settings+token to storage.
  //
  // This response usually never arrives: Chrome closes the popup the moment the
  // auth window takes focus, which tears down the message channel. That is not
  // a login failure — the background keeps running and records the outcome
  // under OIDC_STATUS_KEY, which the UI reads when it reopens. Only a response
  // that actually arrives and reports failure is treated as an error.
  let response: { success: boolean; error?: string } | undefined;
  try {
    response = await chrome.runtime.sendMessage({
      type: OIDC_LOGIN,
      vaultUrl: settings.vaultUrl,
      mount,
      role: settings.oidcRole || undefined,
      namespace: settings.namespace,
      redirectUri: settings.oidcRedirectUri || undefined,
      settings,
    });
  } catch {
    return;
  }

  if (response && !response.success) {
    throw new Error(response.error ?? 'OIDC login failed');
  }
}
