import React, { useCallback, useEffect, useRef, useState } from 'react';
import { loginWithOIDC, loginWithToken } from '../api/auth';
import { VaultClient } from '../api/vaultClient';
import { useSettings } from '../hooks/useSettings';
import { AuthMethod, Settings } from '../types/settings';
import { TokenInfo } from '../types/vault';
import { VaultLogo } from '../components/VaultLogo';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ConnectionState = 'idle' | 'connected' | 'error';

// ---------------------------------------------------------------------------
// TTL display helpers
// ---------------------------------------------------------------------------

function formatTTL(ttl: number): string {
  if (ttl >= 3600) {
    const h = Math.floor(ttl / 3600);
    const m = Math.floor((ttl % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const m = Math.floor(ttl / 60);
  const s = ttl % 60;
  return `${m}m ${s}s`;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

type BadgeState = ConnectionState;

interface StatusBadgeProps {
  state: BadgeState;
  tokenInfo: TokenInfo | null;
  errorMessage: string;
}

function StatusBadge({ state, tokenInfo, errorMessage }: StatusBadgeProps) {
  if (state === 'connected' && tokenInfo) {
    return (
      <div className="badge badge-success" style={{ marginBottom: 20, alignSelf: 'flex-start' }}>
        ✓ Connected &mdash; TTL: {formatTTL(tokenInfo.ttl)}
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="alert alert-error" style={{ marginBottom: 20 }}>
        ✕ {errorMessage}
      </div>
    );
  }
  return (
    <div className="badge badge-neutral" style={{ marginBottom: 20, alignSelf: 'flex-start' }}>
      — Not connected
    </div>
  );
}

// ---------------------------------------------------------------------------
// Namespace picker
// ---------------------------------------------------------------------------

interface NamespacePickerProps {
  /** Free-text input mode (before login). */
  freeText: true;
  vaultUrl?: never;
  client?: never;
  value: string;
  onChange: (ns: string) => void;
}

interface NamespacePickerAuthProps {
  /** Dropdown mode (after login) — uses the authenticated client. */
  freeText?: false;
  vaultUrl?: never;
  client: VaultClient;
  value: string;
  onChange: (ns: string) => void;
}

function NamespacePicker(props: NamespacePickerProps | NamespacePickerAuthProps) {
  const { value, onChange } = props;

  // ── Free-text mode (before login) ──────────────────────────────────────
  if (props.freeText) {
    return (
      <input
        id="namespace"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. admin/team"
      />
    );
  }

  // ── Authenticated dropdown mode (after login) ───────────────────────────
  return <NamespaceDropdown client={props.client} value={value} onChange={onChange} />;
}

interface NamespaceDropdownProps {
  client: VaultClient;
  value: string;
  onChange: (ns: string) => void;
}

function NamespaceDropdown({ client, value, onChange }: NamespaceDropdownProps) {
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    client
      .listNamespaces()
      .then((ns) => {
        setOptions(ns);
        setLoading(false);
      })
      .catch(() => {
        setOptions([]);
        setLoading(false);
      });
  }, [client]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <select
        id="namespace"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        style={{ flex: 1 }}
      >
        {loading
          ? <option value="">Loading…</option>
          : <>
              <option value="">(root)</option>
              {options.map((ns) => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
            </>
        }
      </select>
      {!loading && value.includes('/') && (
        <button
          type="button"
          className="btn btn-sm"
          title="Switch to parent namespace"
          onClick={() => onChange(value.substring(0, value.lastIndexOf('/')))}
          style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          ↑ Parent
        </button>
      )}
      {!loading && value !== '' && (
        <button
          type="button"
          className="btn btn-sm"
          title="Switch to root namespace"
          onClick={() => onChange('')}
          style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          ↩ Root
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Options component
// ---------------------------------------------------------------------------

interface OptionsProps {
  onBack?: () => void;
}

/** Same theme hook — reads/writes data-theme on <html>. */
function useOptionsTheme() {
  const stored = (): 'light' | 'dark' | null => {
    try { return localStorage.getItem('vault-theme') as 'light' | 'dark' | null; } catch { return null; }
  };
  const [theme, setThemeState] = useState<'light' | 'dark' | null>(stored);

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

export function Options({ onBack }: OptionsProps = {}) {
  const { settings, token, loading, saveSettings, clearSettings } = useSettings();
  const { theme: optTheme, toggle: toggleTheme } = useOptionsTheme();

  const [vaultUrl, setVaultUrl] = useState('');
  const [namespace, setNamespace] = useState('');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('token');
  const [tokenValue, setTokenValue] = useState('');
  const [oidcRole, setOidcRole] = useState('');
  const [oidcMount, setOidcMount] = useState('oidc');
  const [urlError, setUrlError] = useState('');
  const [busy, setBusy] = useState(false);
  const [badgeState, setBadgeState] = useState<BadgeState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);

  // PM settings state
  const [pmNamespace, setPmNamespace] = useState('');
  const [pmMount, setPmMount] = useState('');
  const [pmSaveStatus, setPmSaveStatus] = useState<'' | 'saved'>('');

  useEffect(() => {
    if (loading) return;
    if (settings) {
      setVaultUrl(settings.vaultUrl ?? '');
      setNamespace(settings.namespace ?? '');
      setAuthMethod(settings.authMethod ?? 'token');
      setOidcRole(settings.oidcRole ?? '');
      setOidcMount(settings.oidcMount ?? 'oidc');
      setPmNamespace(settings.pmNamespace ?? '');
      setPmMount(settings.pmMount ?? '');
    }
  }, [loading, settings]);

  useEffect(() => {
    if (loading) return;
    if (!token || !settings) {
      setBadgeState('idle');
      setTokenInfo(null);
      return;
    }
    const client = new VaultClient(settings, token);
    client
      .lookupToken()
      .then((info) => {
        setTokenInfo(info);
        setBadgeState('connected');
        setBusy(false); // clears the OIDC "Working…" spinner once storage fires
      })
      .catch(() => {
        setTokenInfo(null);
        setBadgeState('idle');
        setBusy(false);
      });
  }, [loading, token, settings]);

  function validateUrl(value: string): boolean {
    if (!value.startsWith('https://')) {
      setUrlError('Vault URL must start with https://');
      return false;
    }
    setUrlError('');
    return true;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!validateUrl(vaultUrl)) return;

    const draft: Settings = {
      vaultUrl: vaultUrl.replace(/\/$/, ''),
      namespace: namespace || undefined,
      authMethod,
      oidcRole: authMethod === 'oidc' ? oidcRole : undefined,
      oidcMount: authMethod === 'oidc' ? (oidcMount.trim() || 'oidc') : undefined,
    };

    setBusy(true);
    setErrorMessage('');
    try {
      if (authMethod === 'token') {
        const resolvedToken = await loginWithToken(draft, tokenValue);
        await saveSettings(draft, resolvedToken);
        const client = new VaultClient(draft, resolvedToken);
        const info = await client.lookupToken();
        setTokenInfo(info);
        setBadgeState('connected');
        setBusy(false);
      } else {
        // OIDC: background opens a tab, completes the flow, and writes
        // settings+token to storage. We await the response so any error
        // (e.g. auth_url failure) is surfaced to the user immediately.
        await loginWithOIDC(draft);
        // On success the storage listener in useSettings will update
        // settings/token, triggering the useEffect that sets badgeState
        // to 'connected'. Clear busy here so the spinner stops.
        setBusy(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setBadgeState('error');
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!token || !settings) return;
    setBusy(true);
    try {
      const client = new VaultClient(settings, token);
      await client.revokeToken();
    } catch {
      // best-effort revoke — clear storage regardless
    } finally {
      await clearSettings();
      setTokenValue('');
      setBadgeState('idle');
      setTokenInfo(null);
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="options-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div className="options-page" style={{ flex: 1, overflowY: 'auto' }}>
      {/* ── Brand header ── */}
      <div className="options-header">
        {onBack && (
          <button className="btn-ghost-header" onClick={onBack} aria-label="Back to secrets" style={{ marginRight: 4 }}>
            ← Back
          </button>
        )}
        {!onBack && <VaultLogo size={32} />}
        <div style={{ flex: 1 }}>
          <div className="options-header-title">Settings</div>
          <div className="options-header-sub">Vault connection</div>
        </div>
        {(() => {
          const isDark = optTheme === 'dark' ||
            (!optTheme && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
          return (
            <button
              className="btn-ghost-header"
              onClick={toggleTheme}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              style={{ padding: '3px 7px', fontSize: 14, lineHeight: 1 }}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? '☀' : '🌙'}
            </button>
          );
        })()}
      </div>

      {/* ── Body ── */}
      <div className="options-body">
        <div className="options-card">
          <div className="flex-col" style={{ gap: 0 }}>
            <StatusBadge state={badgeState} tokenInfo={tokenInfo} errorMessage={errorMessage} />

            <form onSubmit={handleSave} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <fieldset disabled={badgeState === 'connected' || busy} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Vault URL */}
                <div className="field">
                  <label htmlFor="vaultUrl">
                    Vault URL <span className="text-danger">*</span>
                  </label>
                  <input
                    id="vaultUrl"
                    type="url"
                    value={vaultUrl}
                    onChange={(e) => {
                      setVaultUrl(e.target.value);
                      if (urlError) validateUrl(e.target.value);
                    }}
                    className={urlError ? 'input-error' : ''}
                    placeholder="https://vault.example.com"
                    required
                  />
                  {urlError && <span className="field-error">{urlError}</span>}
                </div>

                {/* Namespace */}
                <div className="field">
                  <label htmlFor="namespace">
                    Namespace <span className="label-optional">(optional)</span>
                  </label>
                  {settings && token ? (
                    <NamespacePicker
                      client={new VaultClient({ ...settings, namespace: undefined }, token)}
                      value={namespace}
                      onChange={setNamespace}
                    />
                  ) : (
                    <NamespacePicker
                      freeText
                      value={namespace}
                      onChange={setNamespace}
                    />
                  )}
                </div>

                {/* Auth method */}
                <div className="field">
                  <label>Auth Method</label>
                  <div className="radio-group">
                    {(['token', 'oidc'] as AuthMethod[]).map((m) => (
                      <label key={m} className="radio-option">
                        <input
                          type="radio"
                          name="authMethod"
                          value={m}
                          checked={authMethod === m}
                          onChange={() => setAuthMethod(m)}
                        />
                        {m === 'token' ? 'Token' : 'OIDC'}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Conditional: Token */}
                {authMethod === 'token' && (
                  <div className="field">
                    <label htmlFor="tokenValue">Token</label>
                    <input
                      id="tokenValue"
                      type="password"
                      value={tokenValue}
                      onChange={(e) => setTokenValue(e.target.value)}
                      placeholder="hvs.XXXXXXXX"
                      autoComplete="current-password"
                    />
                  </div>
                )}

                {/* Conditional: OIDC fields */}
                {authMethod === 'oidc' && (
                  <>
                    <div className="field">
                      <label htmlFor="oidcMount">
                        OIDC Mount Path <span className="label-optional">(default: oidc)</span>
                      </label>
                      <input
                        id="oidcMount"
                        type="text"
                        value={oidcMount}
                        onChange={(e) => setOidcMount(e.target.value)}
                        placeholder="oidc"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="oidcRole">
                        OIDC Role <span className="label-optional">(optional)</span>
                      </label>
                      <input
                        id="oidcRole"
                        type="text"
                        value={oidcRole}
                        onChange={(e) => setOidcRole(e.target.value)}
                        placeholder="default"
                      />
                    </div>
                  </>
                )}

                {/* Actions */}
                <div className="flex gap-2" style={{ paddingTop: 4 }}>
                  <button type="submit" className="btn btn-primary">
                    {busy ? <><span className="spinner" style={{ marginRight: 6 }} />Working…</> : authMethod === 'token' ? 'Verify & Save' : 'Login with OIDC'}
                  </button>
                </div>
              </fieldset>

              {/* Disconnect sits outside the fieldset so it stays enabled when connected */}
              {token && (
                <div className="flex gap-2">
                  <button type="button" className="btn" disabled={busy} onClick={handleDisconnect}>
                    Disconnect
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>

        {/* ── Password Manager card (only when connected) ── */}
        {badgeState === 'connected' && settings && (
          <div className="options-card" style={{ marginTop: 12 }}>
            <div className="flex-col" style={{ gap: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)' }}>
                Password Manager
              </div>

              <div className="field">
                <label htmlFor="pmNamespace">
                  PM Namespace <span className="label-optional">(optional — leave empty for root)</span>
                </label>
                <input
                  id="pmNamespace"
                  type="text"
                  value={pmNamespace}
                  onChange={(e) => setPmNamespace(e.target.value)}
                  placeholder="e.g. team/passwords"
                />
              </div>

              <div className="field">
                <label htmlFor="pmMount">
                  KV v2 Mount <span className="label-optional">(default: secret)</span>
                </label>
                <input
                  id="pmMount"
                  type="text"
                  value={pmMount}
                  onChange={(e) => setPmMount(e.target.value)}
                  placeholder="secret"
                />
              </div>

              <div className="flex gap-2" style={{ alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    const updated = {
                      ...settings,
                      pmNamespace: pmNamespace.trim() || undefined,
                      pmMount: pmMount.trim() || undefined,
                    };
                    await chrome.storage.local.set({ vaultSettings: updated });
                    setPmSaveStatus('saved');
                    setTimeout(() => setPmSaveStatus(''), 2000);
                  }}
                >
                  Save PM Settings
                </button>
                {pmSaveStatus === 'saved' && (
                  <span className="badge badge-success" style={{ fontSize: 12 }}>Saved ✓</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
