import {
  BackgroundResponse,
  GET_SECRET,
  SAVE_SECRET,
  SEARCH_SECRETS_BY_URL,
} from '../types/messages';

// ---------------------------------------------------------------------------
// Typed sendMessage wrappers
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
