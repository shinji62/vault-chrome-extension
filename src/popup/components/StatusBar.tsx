import React, { useEffect, useRef, useState } from 'react';
import { VaultClient } from '../../api/vaultClient';
import { TokenInfo, TokenSelfLookup } from '../../types/vault';
import { VaultLogo } from '../../components/VaultLogo';

interface StatusBarProps {
  connected: boolean;
  namespace?: string;
  /** The namespace the user logged in with — acts as the browsing root. */
  rootNamespace?: string;
  client: VaultClient | null;
  tokenInfo: TokenInfo | null;
  onNamespaceChange: (ns: string) => void;
  onOpenSettings: () => void;
  /** Optional theme-toggle button rendered in the header. */
  themeToggle?: React.ReactNode;
}

function formatTTL(seconds: number): string {
  if (seconds <= 0) return 'Expired';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function ttlBadgeClass(ttl: number): string {
  if (ttl >= 1800) return 'badge badge-success';
  if (ttl >= 300) return 'badge badge-warning';
  return 'badge badge-danger';
}

// ---------------------------------------------------------------------------
// Compact namespace picker rendered inside the header
// ---------------------------------------------------------------------------

interface HeaderNamespacePickerProps {
  client: VaultClient;
  namespace: string;
  rootNamespace: string;
  onChange: (ns: string) => void;
}

/** Returns the parent namespace path, clamped to rootNamespace as the floor. */
function parentNamespace(current: string, root: string): string | null {
  if (current === root) return null; // already at root — no parent
  const slash = current.lastIndexOf('/');
  const parent = slash === -1 ? '' : current.substring(0, slash);
  // Don't go above the login-time root
  if (root && !parent.startsWith(root)) return root;
  return parent;
}

function HeaderNamespacePicker({ client, namespace, rootNamespace, onChange }: HeaderNamespacePickerProps) {
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
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
  }, [client]); // client identity changes after namespace is persisted to storage — no need to also depend on namespace

  const parent = parentNamespace(namespace, rootNamespace);

  // The root option value is the login-time namespace (or '' for the global root).
  const rootOption = rootNamespace;
  const allOptions = [rootOption, ...options];
  const isKnown = allOptions.includes(namespace);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {parent !== null && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onChange(parent)}
          title={`Go to parent namespace${parent ? `: ${parent}` : ' (root)'}`}
          aria-label="Go to parent namespace"
          style={{ flexShrink: 0, padding: '2px 7px' }}
        >
          ↑
        </button>
      )}
      <select
        className="ns-picker-select"
        value={isKnown ? namespace : '__custom__'}
        onChange={(e) => onChange(e.target.value === '__custom__' ? namespace : e.target.value)}
        disabled={loading}
        aria-label="Namespace"
      >
        {loading && <option value={rootOption}>Loading…</option>}
        {!loading && <option value={rootOption}>{rootNamespace || '(root)'}</option>}
        {!loading && options.map((ns) => (
          <option key={ns} value={ns}>{ns}</option>
        ))}
        {!loading && !isKnown && namespace && (
          <option value="__custom__">{namespace}</option>
        )}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolsMenu — wrench icon + dropdown with "Token info" and "Generate password"
// ---------------------------------------------------------------------------

type ToolsView = 'menu' | 'token-info' | 'generate-password';

function ToolsMenu({ client }: { client: VaultClient }) {
  const [open, setOpen]       = useState(false);
  const [view, setView]       = useState<ToolsView>('menu');
  const dropdownRef           = useRef<HTMLDivElement>(null);

  // ── token-info state ──
  const [tokenSelf, setTokenSelf]       = useState<TokenSelfLookup | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError]     = useState<string | null>(null);

  // ── generate-password state ──
  const [policies, setPolicies]           = useState<string[] | null>(null);
  const [loadingPolicies, setLoadingPolicies] = useState(false);
  const [generating, setGenerating]       = useState(false);
  const [result, setResult]               = useState<{ password: string; copied: boolean } | null>(null);
  const [genError, setGenError]           = useState<string | null>(null);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => {
    if (open) { setOpen(false); return; }
    setView('menu');
    setOpen(true);
  };

  const openTokenInfo = async () => {
    setView('token-info');
    if (tokenSelf) return; // already loaded
    setTokenLoading(true);
    setTokenError(null);
    try {
      const res = await client.lookupTokenSelf();
      setTokenSelf(res);
    } catch (e) {
      setTokenError((e as Error).message);
    } finally {
      setTokenLoading(false);
    }
  };

  const openGeneratePassword = async () => {
    setView('generate-password');
    setResult(null);
    setGenError(null);
    if (policies === null) {
      setLoadingPolicies(true);
      try {
        const list = await client.listPasswordPolicies();
        setPolicies(list);
      } catch (e) {
        setGenError((e as Error).message);
      } finally {
        setLoadingPolicies(false);
      }
    }
  };

  const doGenerate = async (policy: string) => {
    setGenerating(true);
    setGenError(null);
    setResult(null);
    try {
      const password = await client.generatePassword(policy);
      await navigator.clipboard.writeText(password);
      setResult({ password, copied: true });
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const copyResult = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.password);
    setResult({ ...result, copied: true });
  };

  // ── shared dropdown shell ──
  const dropdownStyle: React.CSSProperties = {
    position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 100,
    width: 240,
    background: 'var(--color-bg)',
    border: 'var(--border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: '0 4px 14px rgba(0,0,0,0.14)',
    overflow: 'hidden',
  };

  const sectionHeaderStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
    color: 'var(--color-muted)',
    background: 'var(--color-surface)',
    borderBottom: 'var(--border)',
    display: 'flex', alignItems: 'center', gap: 6,
  };

  const menuItemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', textAlign: 'left',
    padding: '9px 14px',
    fontSize: 13,
    background: 'none', border: 'none',
    borderBottom: '1px solid var(--color-border-subtle)',
    cursor: 'pointer', color: 'var(--color-text)',
  };

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        type="button"
        className="btn-ghost-header"
        onClick={handleOpen}
        aria-label="Tools"
        title="Tools"
        style={{ fontSize: 16, padding: '3px 8px' }}
      >
        🔧
      </button>

      {open && (
        <div style={dropdownStyle}>

          {/* ── main menu ── */}
          {view === 'menu' && (
            <>
              <div style={sectionHeaderStyle}>Tools</div>
              <button
                style={menuItemStyle}
                onClick={openTokenInfo}
                onMouseOver={(e) => (e.currentTarget.style.background = 'var(--color-surface)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
              >
                <span style={{ fontSize: 15 }}>🪪</span> Token info
              </button>
              <button
                style={{ ...menuItemStyle, borderBottom: 'none' }}
                onClick={openGeneratePassword}
                onMouseOver={(e) => (e.currentTarget.style.background = 'var(--color-surface)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
              >
                <span style={{ fontSize: 15 }}>🔑</span> Generate password
              </button>
            </>
          )}

          {/* ── token info view ── */}
          {view === 'token-info' && (
            <>
              <div style={sectionHeaderStyle}>
                <button
                  type="button"
                  onClick={() => setView('menu')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-muted)', fontSize: 12, lineHeight: 1 }}
                  aria-label="Back"
                >
                  ←
                </button>
                Token info
              </div>
              {tokenLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', fontSize: 12, color: 'var(--color-muted)' }}>
                  <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Loading…
                </div>
              ) : tokenError ? (
                <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--color-danger)' }}>{tokenError}</div>
              ) : tokenSelf ? (
                <div style={{ padding: '10px 12px', fontSize: 12 }}>
                  {(
                    [
                      ['Display name', tokenSelf.data.display_name || '—'],
                      ['Token type',   tokenSelf.data.type],
                      ['Accessor',     tokenSelf.data.accessor],
                      ['Entity ID',    tokenSelf.data.entity_id || '—'],
                      ['Policies',     (tokenSelf.data.policies ?? []).join(', ') || '—'],
                      ['TTL',          `${tokenSelf.data.ttl}s`],
                      ['Creation TTL', `${tokenSelf.data.creation_ttl}s`],
                      ['Expire time',  tokenSelf.data.expire_time ?? '—'],
                      ['Renewable',    tokenSelf.data.renewable ? 'Yes' : 'No'],
                      ['Orphan',       tokenSelf.data.orphan ? 'Yes' : 'No'],
                      ['Num uses',     String(tokenSelf.data.num_uses)],
                      ['Path',         tokenSelf.data.path],
                      ['Issue time',   tokenSelf.data.issue_time],
                    ] as [string, string][]
                  ).map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5, lineHeight: 1.4 }}>
                      <span style={{ color: 'var(--color-muted)', flexShrink: 0 }}>{label}</span>
                      <span style={{ fontFamily: '"SF Mono", ui-monospace, monospace', fontSize: 11, wordBreak: 'break-all', textAlign: 'right' }}>{val}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}

          {/* ── generate password view ── */}
          {view === 'generate-password' && (
            <>
              <div style={sectionHeaderStyle}>
                <button
                  type="button"
                  onClick={() => { setView('menu'); setResult(null); setGenError(null); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-muted)', fontSize: 12, lineHeight: 1 }}
                  aria-label="Back"
                >
                  ←
                </button>
                Generate password
              </div>

              {loadingPolicies || generating ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', fontSize: 12, color: 'var(--color-muted)' }}>
                  <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
                  {loadingPolicies ? 'Loading policies…' : 'Generating…'}
                </div>
              ) : genError ? (
                <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--color-danger)' }}>{genError}</div>
              ) : result ? (
                <div style={{ padding: '10px 12px' }}>
                  <div style={{
                    fontSize: 11, fontFamily: '"SF Mono", ui-monospace, monospace',
                    color: 'var(--color-text)', wordBreak: 'break-all',
                    background: 'var(--color-surface)', border: 'var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 8px', marginBottom: 8,
                  }}>
                    {result.password}
                  </div>
                  <button className="btn btn-sm" style={{ width: '100%', fontSize: 11 }} onClick={copyResult}>
                    {result.copied ? '✓ Copied!' : 'Copy'}
                  </button>
                </div>
              ) : policies && policies.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--color-muted)' }}>
                  No password policies found.
                </div>
              ) : (
                <div>
                  {(policies ?? []).map((p) => (
                    <button
                      key={p}
                      onClick={() => doGenerate(p)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 14px',
                        fontSize: 12, fontFamily: '"SF Mono", ui-monospace, monospace',
                        background: 'none', border: 'none', borderBottom: '1px solid var(--color-border-subtle)',
                        cursor: 'pointer', color: 'var(--color-text)',
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.background = 'var(--color-surface)')}
                      onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusBar
// ---------------------------------------------------------------------------

export function StatusBar({ connected, namespace, rootNamespace, client, tokenInfo, onNamespaceChange, onOpenSettings, themeToggle }: StatusBarProps) {
  const [displayTtl, setDisplayTtl] = useState<number | null>(null);

  useEffect(() => {
    if (!connected || !tokenInfo) {
      setDisplayTtl(null);
      return;
    }

    setDisplayTtl(tokenInfo.ttl);

    const interval = window.setInterval(() => {
      setDisplayTtl((current) => {
        if (current === null || current <= 0) return 0;
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [connected, tokenInfo]);

  const currentTtl = displayTtl ?? tokenInfo?.ttl ?? 0;

  const hardExpirySoon =
    tokenInfo &&
    currentTtl > 0 &&
    tokenInfo.explicit_max_ttl > 0 &&
    currentTtl < 600 &&
    tokenInfo.explicit_max_ttl <= currentTtl + 60;

  return (
    <>
      {/* ── Brand header ── */}
      <div className="app-header">
        <div className="app-header-logo">
          <VaultLogo size={26} />
        </div>
        <div className="app-header-title">Vault Secrets</div>

        <button
          type="button"
          className="btn-ghost-header"
          onClick={onOpenSettings}
          aria-label="Open settings"
          style={{ fontSize: 16, padding: '3px 8px', position: 'relative', zIndex: 1 }}
        >
          ⚙
        </button>
        {connected && client && <ToolsMenu client={client} />}
        {themeToggle}
      </div>

      {/* ── Token / connection status bar ── */}
      {connected && (
        <div className="status-bar">
          <span className="status-dot status-dot-connected" />
          <span className="text-sm" style={{ color: 'var(--color-success)', fontWeight: 500 }}>Connected</span>

          {client && (
            <>
              <div className="ns-picker-wrapper">
                <span className="ns-picker-label">NS</span>
                <HeaderNamespacePicker
                  client={client}
                  namespace={namespace ?? rootNamespace ?? ''}
                  rootNamespace={rootNamespace ?? ''}
                  onChange={onNamespaceChange}
                />
              </div>
            </>
          )}

          {tokenInfo && (
            <>
              <span className={`ml-auto ${ttlBadgeClass(currentTtl)}`}>
                TTL {formatTTL(currentTtl)}
              </span>

              {hardExpirySoon && (
                <span className="text-danger font-bold text-sm">⚠ Hard expiry soon</span>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
