import { useEffect, useState } from 'react';
import { Settings } from '../types/settings';

interface UseSettingsResult {
  settings: Settings | null;
  /** The namespace that was set at login time — never changes until re-login. */
  rootNamespace: string;
  token: string | null;
  saveSettings: (s: Settings, token: string) => Promise<void>;
  updateNamespace: (namespace: string) => Promise<void>;
  clearSettings: () => Promise<void>;
  loading: boolean;
}

const SETTINGS_KEY = 'vaultSettings';
// Token is stored in chrome.storage.session (in-memory, never persisted to disk,
// cleared on browser close) rather than chrome.storage.local.
const TOKEN_KEY = 'vaultToken';

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rootNamespace, setRootNamespace] = useState<string>('');
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load non-sensitive settings from local storage and token from session storage.
    Promise.all([
      new Promise<Settings | null>((resolve) =>
        chrome.storage.local.get([SETTINGS_KEY], (r) => resolve((r[SETTINGS_KEY] as Settings) ?? null)),
      ),
      new Promise<string | null>((resolve) =>
        chrome.storage.session.get([TOKEN_KEY], (r) => resolve((r[TOKEN_KEY] as string) ?? null)),
      ),
    ]).then(([s, t]) => {
      setSettings(s);
      // Capture the login-time namespace once — never overwritten by updateNamespace.
      setRootNamespace(s?.namespace ?? '');
      setToken(t);
      setLoading(false);
    });

    // Settings changes come from chrome.storage.local.
    const localListener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (SETTINGS_KEY in changes) {
        setSettings((changes[SETTINGS_KEY].newValue as Settings) ?? null);
      }
    };

    // Token changes come from chrome.storage.session.
    const sessionListener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (TOKEN_KEY in changes) {
        setToken((changes[TOKEN_KEY].newValue as string) ?? null);
      }
    };

    chrome.storage.local.onChanged.addListener(localListener);
    chrome.storage.session.onChanged.addListener(sessionListener);
    return () => {
      chrome.storage.local.onChanged.removeListener(localListener);
      chrome.storage.session.onChanged.removeListener(sessionListener);
    };
  }, []);

  const saveSettings = async (s: Settings, tok: string): Promise<void> => {
    // Persist non-sensitive config to local; keep the token in session memory only.
    await chrome.storage.local.set({ [SETTINGS_KEY]: s });
    await chrome.storage.session.set({ [TOKEN_KEY]: tok });
  };

  const updateNamespace = async (namespace: string): Promise<void> => {
    if (!settings) return;
    const updated: Settings = { ...settings, namespace: namespace || undefined };
    await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
  };

  const clearSettings = async (): Promise<void> => {
    await chrome.storage.local.remove([SETTINGS_KEY]);
    await chrome.storage.session.remove([TOKEN_KEY]);
  };

  return { settings, rootNamespace, token, loading, saveSettings, updateNamespace, clearSettings };
}
