import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { useSettings } from './useSettings';
import { Settings } from '../types/settings';

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const draft: Settings = {
  vaultUrl: 'https://vault.example.com',
  authMethod: 'oidc',
  oidcMount: 'oidc',
  oidcRole: 'default',
};

/** Mounts the hook and returns a live handle to its latest return value. */
async function mountHook() {
  const handle: { current: ReturnType<typeof useSettings> | null } = { current: null };

  function Probe() {
    handle.current = useSettings();
    return null;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(createElement(Probe));
  });
  return handle;
}

describe('useSettings', () => {
  beforeEach(() => {
    vi.mocked(chrome.storage.local.set).mockClear();
    vi.mocked(chrome.storage.session.set).mockClear();
    vi.mocked(chrome.storage.local.get).mockImplementation(
      ((_keys: string[], cb: (r: Record<string, unknown>) => void) => cb({})) as never,
    );
    vi.mocked(chrome.storage.session.get).mockImplementation(
      ((_keys: string[], cb: (r: Record<string, unknown>) => void) => cb({})) as never,
    );
  });

  it('saveSettingsOnly persists config without inventing a token', async () => {
    const hook = await mountHook();
    expect(hook.current?.loading).toBe(false);

    await act(async () => {
      await hook.current!.saveSettingsOnly(draft);
    });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ vaultSettings: draft });
    // A tokenless save must never touch session storage — that would strand an
    // undefined token and make the UI look connected when it is not.
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
  });

  it('saveSettings writes settings to local and the token to session', async () => {
    const hook = await mountHook();

    await act(async () => {
      await hook.current!.saveSettings(draft, 'hvs.token');
    });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ vaultSettings: draft });
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ vaultToken: 'hvs.token' });
  });
});
