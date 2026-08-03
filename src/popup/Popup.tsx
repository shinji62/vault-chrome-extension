import React, { useCallback, useEffect, useState } from 'react';
import { VaultClient } from '../api/vaultClient';
import { TokenInfo } from '../types/vault';
import { useVaultClient } from '../hooks/useVaultClient';
import { useSettings } from '../hooks/useSettings';
import { useTokenStatus } from '../hooks/useTokenStatus';
import { StatusBar } from './components/StatusBar';
import { MountPicker } from './components/MountPicker';
import { SecretList } from './components/SecretList';
import { SecretDetail } from './components/SecretDetail';
import { SecretForm } from './components/SecretForm';
import { ModeTabBar } from './components/ModeTabBar';
import { PasswordManager } from './components/PasswordManager';
import { VaultLogo } from '../components/VaultLogo';
import { Options } from '../options/Options';

type Screen =
  | { id: 'not-connected' }
  | { id: 'settings' }
  | { id: 'mount-picker' }
  | { id: 'listing'; mount: string; kvVersion: 1 | 2; path: string }
  | { id: 'detail'; mount: string; kvVersion: 1 | 2; path: string }
  | { id: 'editing'; mount: string; kvVersion: 1 | 2; path: string }
  | { id: 'new'; mount: string; kvVersion: 1 | 2; path: string /** current directory */ };

/** Given a full secret path like "a/b/c", returns its parent directory "a/b". */
function parentDir(secretPath: string): string {
  const idx = secretPath.lastIndexOf('/');
  return idx === -1 ? '' : secretPath.substring(0, idx);
}

/** Persists and toggles between light / dark / system theme on <html>. */
function useTheme() {
  const stored = (): 'light' | 'dark' | null => {
    try { return localStorage.getItem('vault-theme') as 'light' | 'dark' | null; } catch { return null; }
  };
  const [theme, setThemeState] = useState<'light' | 'dark' | null>(stored);

  useEffect(() => {
    const val = stored();
    if (val) document.documentElement.setAttribute('data-theme', val);
  }, []);

  const toggle = useCallback(() => {
    const current = document.documentElement.getAttribute('data-theme');
    const isDark = current === 'dark' ||
      (!current && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('vault-theme', next); } catch { /* noop */ }
    setThemeState(next);
  }, []);

  return { theme, toggle };
}

function readMode(): 'secrets' | 'passwords' {
  try {
    const stored = sessionStorage.getItem('vault-pm-mode');
    return stored === 'passwords' ? 'passwords' : 'secrets';
  } catch {
    return 'secrets';
  }
}

export function Popup() {
  const client = useVaultClient();
  const { settings, rootNamespace, loading: settingsLoading, updateNamespace } = useSettings();
  const { tokenInfo: fetchedTokenInfo, loading: tokenLoading } = useTokenStatus();
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [screen, setScreen] = useState<Screen>({ id: 'not-connected' });
  const returnScreen = React.useRef<Screen>({ id: 'not-connected' });
  const { theme, toggle: toggleTheme } = useTheme();
  const [mode, setModeState] = useState<'secrets' | 'passwords'>(readMode);

  const setMode = (m: 'secrets' | 'passwords') => {
    try { sessionStorage.setItem('vault-pm-mode', m); } catch { /* noop */ }
    setModeState(m);
  };

  useEffect(() => {
    console.log('[vault] popup state', {
      settingsLoading,
      tokenLoading,
      hasClient: !!client,
      hasSettings: !!settings,
      screen,
    });
  }, [client, screen, settings, settingsLoading, tokenLoading]);

  useEffect(() => {
    if (!tokenLoading && fetchedTokenInfo) {
      setTokenInfo(fetchedTokenInfo);
    }
  }, [fetchedTokenInfo, tokenLoading]);

  useEffect(() => {
    if (!settingsLoading && client && screen.id === 'not-connected') {
      console.log('[vault] switching popup to mount-picker screen');
      setScreen({ id: 'mount-picker' });
    }
    if (!settingsLoading && !client && screen.id !== 'settings') {
      console.log('[vault] switching popup to not-connected screen');
      setScreen({ id: 'not-connected' });
    }
  }, [settingsLoading, client, screen.id]);

  const openSettings = () => {
    returnScreen.current = screen;
    setScreen({ id: 'settings' });
  };

  if (settingsLoading) {
    return (
      <div className="flex-col full-height flex-center" style={{ gap: 10 }}>
        <span className="spinner" />
        <span className="text-muted text-sm">Loading…</span>
      </div>
    );
  }

  const connected = !!client;

  // ── SETTINGS SCREEN (inline, replaces full popup) ──────────────────────────
  if (screen.id === 'settings') {
    return (
      <div className="flex-col full-height">
        <Options onBack={() => setScreen(
          returnScreen.current.id === 'not-connected' && connected
              ? { id: 'mount-picker' }
            : returnScreen.current
        )} />
      </div>
    );
  }

  // ── NOT CONNECTED ──────────────────────────────────────────────────────────
  if (!connected || screen.id === 'not-connected') {
    const isDark = theme === 'dark' ||
      (!theme && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    return (
      <div className="flex-col full-height">
        {/* Header */}
        <div className="app-header">
          <VaultLogo size={26} />
          <div style={{ flex: 1 }}>
            <div className="app-header-title">Vault Secrets</div>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-header-muted)', marginRight: 8 }}>
            Not connected
          </span>
          <button
            className="btn-ghost-header"
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ padding: '3px 7px', fontSize: 14, lineHeight: 1 }}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? '☀' : '🌙'}
          </button>
        </div>

        {/* Splash */}
        <div className="flex-col flex-center gap-3 section" style={{ flex: 1, paddingTop: 40, paddingBottom: 40 }}>
          {/* Icon */}
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: 'var(--color-brand-subtle)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <VaultLogo size={36} />
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: 'var(--color-text)' }}>
              Welcome to Vault Secrets
            </div>
            <p className="text-muted text-sm text-center" style={{ maxWidth: 240, margin: '0 auto' }}>
              Connect to a HashiCorp Vault instance to start managing your secrets.
            </p>
          </div>

          <button className="btn btn-primary" onClick={openSettings} style={{ marginTop: 8, padding: '8px 20px' }}>
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  const vaultClient = client as VaultClient;

  // ── CONNECTED SCREENS ──────────────────────────────────────────────────────
  const isDarkConnected = theme === 'dark' ||
    (!theme && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <div className="flex-col full-height">
      <StatusBar
        connected={true}
        namespace={settings?.namespace}
        rootNamespace={rootNamespace}
        client={vaultClient}
        tokenInfo={tokenInfo}
        onNamespaceChange={updateNamespace}
        onOpenSettings={openSettings}
        themeToggle={
          <button
            className="btn-ghost-header"
            onClick={toggleTheme}
            title={isDarkConnected ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ padding: '3px 7px', fontSize: 14, lineHeight: 1, marginLeft: 4 }}
            aria-label={isDarkConnected ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkConnected ? '☀' : '🌙'}
          </button>
        }
      />

      {/* Mode tab bar */}
      <ModeTabBar mode={mode} onSelect={setMode} />

      {/* ── Passwords mode ── */}
      {mode === 'passwords' && settings && (
        <PasswordManager
          client={vaultClient}
          settings={settings}
          onOpenSettings={openSettings}
        />
      )}

      {/* ── Secrets mode ── */}
      {mode === 'secrets' && (
        <>
          {/* Mount toolbar — shown when inside a KV mount */}
          {(screen.id === 'listing' || screen.id === 'detail') && (
            <div className="mount-toolbar">
              <button
                className="btn btn-ghost btn-sm"
                style={{ flexShrink: 0 }}
                onClick={() => setScreen({ id: 'mount-picker' })}
                title="Back to mount picker"
              >
                ← {screen.mount}
              </button>
              {screen.id === 'listing' && screen.mount && (
                <button
                  className="btn btn-sm btn-primary"
                  style={{ flexShrink: 0, marginLeft: 'auto' }}
                  onClick={() =>
                    setScreen({
                      id: 'new',
                      mount: screen.mount,
                      kvVersion: screen.kvVersion,
                      path: screen.path,
                    })
                  }
                >
                  + New
                </button>
              )}
            </div>
          )}

          {/* Mount picker screen */}
          {screen.id === 'mount-picker' && (
            <MountPicker
              client={vaultClient}
              onSelectKV={(mount, kvVersion) =>
                setScreen({ id: 'listing', mount, kvVersion, path: '' })
              }
            />
          )}

          {/* Screens */}
          {screen.id === 'listing' && screen.mount && (
            <SecretList
              client={vaultClient}
              mount={screen.mount}
              kvVersion={screen.kvVersion}
              path={screen.path}
              onNavigate={(path) =>
                setScreen({ id: 'listing', mount: screen.mount, kvVersion: screen.kvVersion, path })
              }
              onSelect={(secretPath) =>
                setScreen({ id: 'detail', mount: screen.mount, kvVersion: screen.kvVersion, path: secretPath })
              }
            />
          )}

          {screen.id === 'detail' && (
            <SecretDetail
              client={vaultClient}
              mount={screen.mount}
              kvVersion={screen.kvVersion}
              path={screen.path}
              onBack={() =>
                setScreen({
                  id: 'listing',
                  mount: screen.mount,
                  kvVersion: screen.kvVersion,
                  path: parentDir(screen.path),
                })
              }
              onEdit={() => {
                setScreen({ id: 'editing', mount: screen.mount, kvVersion: screen.kvVersion, path: screen.path });
              }}
              onDelete={() =>
                setScreen({
                  id: 'listing',
                  mount: screen.mount,
                  kvVersion: screen.kvVersion,
                  path: parentDir(screen.path),
                })
              }
            />
          )}

          {(screen.id === 'editing' || screen.id === 'new') && (
            <SecretForm
              client={vaultClient}
              mount={screen.mount}
              kvVersion={screen.kvVersion}
              path={screen.path}
              isNew={screen.id === 'new'}
              onSave={() =>
                setScreen({
                  id: 'listing',
                  mount: screen.mount,
                  kvVersion: screen.kvVersion,
                  // editing: path is the secret itself → go to parent dir
                  // new: path is the current directory → stay in it
                  path: screen.id === 'editing' ? parentDir(screen.path) : screen.path,
                })
              }
              onCancel={() => {
                if (screen.id === 'editing') {
                  setScreen({ id: 'detail', mount: screen.mount, kvVersion: screen.kvVersion, path: screen.path });
                } else {
                  setScreen({ id: 'listing', mount: screen.mount, kvVersion: screen.kvVersion, path: screen.path });
                }
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
