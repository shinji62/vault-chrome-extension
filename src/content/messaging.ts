import {
  BackgroundResponse,
  CLEAR_PM_PENDING_SAVE,
  GENERATE_PM_PASSWORD,
  GET_PM_PENDING_SAVE,
  GET_SECRET,
  LIST_PM_PASSWORD_POLICIES,
  PendingPmSave,
  SAVE_PM_SECRET,
  SAVE_SECRET,
  SEARCH_PM_SECRETS_BY_URL,
  SEARCH_SECRETS_BY_URL,
  STORE_PM_PENDING_SAVE,
} from '../types/messages';

// ---------------------------------------------------------------------------
// Mode A — typed sendMessage wrappers (Vault Secret Browser)
// ---------------------------------------------------------------------------

export async function searchSecretsByUrl(
  url: string,
): Promise<Array<{ mount: string; path: string; username: string }>> {
  const response: BackgroundResponse<Array<{ mount: string; path: string; username: string }>> =
    await chrome.runtime.sendMessage({ type: SEARCH_SECRETS_BY_URL, url });
  if (!response.success) throw new Error(response.error);
  return response.data;
}

export async function getSecret(
  mount: string,
  path: string,
  kvVersion: 1 | 2,
): Promise<Record<string, string>> {
  const response: BackgroundResponse<Record<string, string>> =
    await chrome.runtime.sendMessage({ type: GET_SECRET, mount, path, kvVersion });
  if (!response.success) throw new Error(response.error);
  return response.data;
}

export async function saveSecret(
  mount: string,
  path: string,
  username: string,
  password: string,
  url: string,
): Promise<void> {
  const response: BackgroundResponse<void> =
    await chrome.runtime.sendMessage({ type: SAVE_SECRET, mount, path, username, password, url });
  if (!response.success) throw new Error(response.error);
}

// ---------------------------------------------------------------------------
// Mode B — Password Manager typed sendMessage wrappers
// ---------------------------------------------------------------------------

export async function searchPmSecretsByUrl(
  url: string,
): Promise<Array<{ mount: string; path: string; username: string }>> {
  const response: BackgroundResponse<Array<{ mount: string; path: string; username: string }>> =
    await chrome.runtime.sendMessage({ type: SEARCH_PM_SECRETS_BY_URL, url });
  if (!response.success) throw new Error(response.error);
  return response.data;
}

export async function savePmSecret(
  username: string,
  password: string,
  url: string,
  label: string,
): Promise<void> {
  const response: BackgroundResponse<void> =
    await chrome.runtime.sendMessage({ type: SAVE_PM_SECRET, username, password, url, label });
  if (!response.success) throw new Error(response.error);
}

export async function listPmPasswordPolicies(): Promise<string[]> {
  const response: BackgroundResponse<string[]> =
    await chrome.runtime.sendMessage({ type: LIST_PM_PASSWORD_POLICIES });
  if (!response.success) throw new Error(response.error);
  return response.data;
}

export async function generatePmPassword(policyName: string): Promise<string> {
  const response: BackgroundResponse<string> =
    await chrome.runtime.sendMessage({ type: GENERATE_PM_PASSWORD, policyName });
  if (!response.success) throw new Error(response.error);
  return response.data;
}

// ---------------------------------------------------------------------------
// Pending auto-save (survives full-page navigation after form submit)
// ---------------------------------------------------------------------------

export async function storePmPendingSave(username: string, password: string): Promise<void> {
  await chrome.runtime.sendMessage({ type: STORE_PM_PENDING_SAVE, username, password });
}

/** Returns a fresh pending save for this tab, or undefined if none / stale. */
export async function getPmPendingSave(): Promise<PendingPmSave | undefined> {
  const response: BackgroundResponse<PendingPmSave | undefined> =
    await chrome.runtime.sendMessage({ type: GET_PM_PENDING_SAVE });
  if (!response.success) throw new Error(response.error);
  return response.data;
}

export async function clearPmPendingSave(): Promise<void> {
  await chrome.runtime.sendMessage({ type: CLEAR_PM_PENDING_SAVE });
}
