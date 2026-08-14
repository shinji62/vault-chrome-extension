import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loginWithOIDC, loginWithToken } from '../api/auth';
import { VaultClient } from '../api/vaultClient';
import { useSettings } from '../hooks/useSettings';
import { AuthMethod, Settings } from '../types/settings';
import { OIDC_STATUS_KEY, OIDC_TAB_TIMEOUT_MS, OidcStatus } from '../types/messages';
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

/** Returns the parent namespace path, clamped to rootNamespace as the floor. */
function parentNamespace(current: string, root: string): string | null {
  if (current === root) return null; // already at root — no parent
  const slash = current.lastIndexOf('/');
  const parent = slash === -1 ? '' : current.substring(0, slash);
  // Don't go above the login-time root
  if (root && !parent.startsWith(root)) return root;
  return parent;
}

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
  /** The login-time namespace that acts as the browsing floor. */
  rootNamespace: string;
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
  return (
    <NamespaceDropdown
      client={props.client}
      rootNamespace={props.rootNamespace}
      value={value}
      onChange={onChange}
    />
  );
}

interface NamespaceDropdownProps {
  client: VaultClient;
  rootNamespace: string;
  value: string;
  onChange: (ns: string) => void;
}

function NamespaceDropdown({ client, rootNamespace, value, onChange }: NamespaceDropdownProps) {
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
        // Not enterprise or no permission — options stays empty
        setOptions([]);
        setLoading(false);
      });
  }, [client]);

  // The root option is the login-time namespace, so "(root)" returns to the
  // configured root rather than escaping to the absolute root namespace.
  const rootOption = rootNamespace;
  const allOptions = [rootOption, ...options];
  const isKnown = allOptions.includes(value);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <select
        id="namespace"
        value={isKnown ? value : '__custom__'}
        onChange={(e) => onChange(e.target.value === '__custom__' ? value : e.target.value)}
        disabled={loading}
        style={{ flex: 1 }}
      >
        {loading
          ? <option value={rootOption}>Loading…</option>
          : <>
              <option value={rootOption}>{rootNamespace || '(root)'}</option>
              {options.map((ns) => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
              {!isKnown && value && (
                <option value="__custom__">{value}</option>
              )}
            </>
        }
      </select>
      {!loading && value.includes('/') && parentNamespace(value, rootNamespace) !== null && (
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
  const { settings, token, loading, saveSettings, saveSettingsOnly, clearSettings, rootNamespace } =
    useSettings();
  const { theme: optTheme, toggle: toggleTheme } = useOptionsTheme();

  const [vaultUrl, setVaultUrl] = useState('');
  const [namespace, setNamespace] = useState('');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('token');
  const [tokenValue, setTokenValue] = useState('');
  const [oidcRole, setOidcRole] = useState('');
  const [oidcMount, setOidcMount] = useState('oidc');
  const [oidcRedirectUri, setOidcRedirectUri] = useState('');
  const [urlError, setUrlError] = useState('');
  // Shown so the user can copy it into the OIDC role's allowed_redirect_uris.
  const defaultRedirectUri = useMemo(() => chrome.identity.getRedirectURL('vault-oidc'), []);
  const [busy, setBusy] = useState(false);
  const [badgeState, setBadgeState] = useState<BadgeState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);

  // PM settings (configured during connection)
  const [pmNamespace, setPmNamespace] = useState('');
  const [pmMount, setPmMount] = useState('');
  const [pmTransitEnabled, setPmTransitEnabled] = useState(false);
  const [pmTransitMount, setPmTransitMount] = useState('transit');

  useEffect(() => {
    if (loading) return;
    if (settings) {
      setVaultUrl(settings.vaultUrl ?? '');
      setNamespace(settings.namespace ?? '');
      setAuthMethod(settings.authMethod ?? 'token');
      setOidcRole(settings.oidcRole ?? '');
      setOidcMount(settings.oidcMount ?? 'oidc');
      setOidcRedirectUri(settings.oidcRedirectUri ?? '');
      setPmNamespace(settings.pmNamespace ?? '');
      setPmMount(settings.pmMount ?? '');
      setPmTransitEnabled(settings.pmTransitEnabled ?? false);
      setPmTransitMount(settings.pmTransitMount || 'transit');
    }
  }, [loading, settings]);

  // The popup is torn down when the OIDC auth window takes focus, so the login
  // outcome is recovered from session storage when it reopens rather than from
  // the (undelivered) sendMessage response.
  useEffect(() => {
    let cancelled = false;

    const applyStatus = (status: OidcStatus | undefined) => {
      if (cancelled) return;
      if (status?.state === 'in-progress') {
        // A worker killed mid-flow leaves 'in-progress' behind for good. Time it
        // out here too, otherwise the button stays on "Working…" permanently and
        // the only escape is reinstalling the extension.
        if (Date.now() - status.startedAt > OIDC_TAB_TIMEOUT_MS) {
          setBusy(false);
          setErrorMessage('Previous OIDC login did not finish. Please try again.');
          setBadgeState('error');
          void chrome.storage.session.remove([OIDC_STATUS_KEY]);
          return;
        }
        setBusy(true);
      } else if (status?.state === 'error') {
        setBusy(false);
        setErrorMessage(status.error);
        setBadgeState('error');
      }
    };

    chrome.storage.session.get([OIDC_STATUS_KEY], (r) =>
      applyStatus(r[OIDC_STATUS_KEY] as OidcStatus | undefined),
    );

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (!(OIDC_STATUS_KEY in changes)) return;
      applyStatus(changes[OIDC_STATUS_KEY]?.newValue as OidcStatus | undefined);
    };
    chrome.storage.session.onChanged.addListener(listener);
    return () => {
      cancelled = true;
      chrome.storage.session.onChanged.removeListener(listener);
    };
  }, []);

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
      oidcRedirectUri:
        authMethod === 'oidc' ? oidcRedirectUri.trim() || undefined : undefined,
      pmNamespace: pmNamespace.trim() || undefined,
      pmMount: pmMount.trim() || undefined,
      pmTransitEnabled,
      pmTransitMount: pmTransitEnabled ? (pmTransitMount.trim() || 'transit') : undefined,
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
        // Persist settings *before* launching the flow. Chrome destroys this
        // popup as soon as the auth window takes focus, so a draft held only in
        // React state is lost — which is why the form came back blank after a
        // failed login. Settings are non-sensitive; the token stays in session.
        await saveSettingsOnly(draft);
        // The background completes the flow and writes the token to storage.
        // The response normally never arrives (this popup is gone by then); the
        // outcome is recovered from OIDC_STATUS_KEY when the popup reopens.
        await loginWithOIDC(draft);
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
    <div className={`options-page${onBack ? ' options-page-inline' : ''}`} style={{ flex: 1, overflowY: 'auto' }}>
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
                      client={new VaultClient(settings, token)}
                      rootNamespace={rootNamespace ?? ''}
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
                    <div className="field">
                      <label htmlFor="oidcRedirectUri">
                        OIDC Redirect URI{' '}
                        <span className="label-optional">(optional — override the default)</span>
                      </label>
                      <input
                        id="oidcRedirectUri"
                        type="text"
                        value={oidcRedirectUri}
                        onChange={(e) => setOidcRedirectUri(e.target.value)}
                        placeholder={defaultRedirectUri}
                      />
                      <p className="field-hint">
                        Must be listed in your Vault OIDC role&apos;s{' '}
                        <code>allowed_redirect_uris</code>. Defaults to{' '}
                        <code>{defaultRedirectUri}</code>.
                      </p>
                    </div>
                  </>
                )}

                {/* Password Manager (configured during connection) */}
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

                {/* PM Transit (passkeys) */}
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                    <input
                      id="pmTransitEnabled"
                      type="checkbox"
                      checked={pmTransitEnabled}
                      onChange={(e) => setPmTransitEnabled(e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    <span>Enable Transit (Passkeys)</span>
                  </label>
                  <p className="text-muted text-sm" style={{ marginTop: 4 }}>
                    Save &amp; read passkeys encrypted via the Vault Transit engine. When disabled,
                    passkeys cannot be saved or read. Requires a per-identity Transit key to be
                    provisioned by an admin (see README).
                  </p>
                </div>
                {pmTransitEnabled && (
                  <div className="field">
                    <label htmlFor="pmTransitMount">
                      Transit Mount <span className="label-optional">(default: transit)</span>
                    </label>
                    <input
                      id="pmTransitMount"
                      type="text"
                      value={pmTransitMount}
                      onChange={(e) => setPmTransitMount(e.target.value)}
                      placeholder="transit"
                    />
                  </div>
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
      </div>
    </div>
  );
}
