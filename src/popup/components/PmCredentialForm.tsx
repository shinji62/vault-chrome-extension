import React, { useEffect, useState } from 'react';
import { VaultClient } from '../../api/vaultClient';

interface PmCredentialFormProps {
  client: VaultClient;
  mount: string;
  entityId: string;
  isNew: boolean;
  /** Existing full path when editing */
  path?: string;
  onSave: (newPath: string) => void;
  onCancel: () => void;
}

const SaveIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M13 13H3a1 1 0 0 1-1-1V3l3-0v3h6V3l2 2v8a1 1 0 0 1-1 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    <rect x="5" y="3" width="6" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

export function PmCredentialForm({
  client,
  mount,
  entityId,
  isNew,
  path,
  onSave,
  onCancel,
}: PmCredentialFormProps) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [labelTouched, setLabelTouched] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Password generation
  const [policies, setPolicies] = useState<string[] | null>(null);
  const [loadingPolicies, setLoadingPolicies] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [showPolicyPicker, setShowPolicyPicker] = useState(false);

  // Pre-fill URL from active tab (new form only)
  useEffect(() => {
    if (!isNew) return;
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (tab?.url) {
          setUrl(tab.url);
          if (!labelTouched) {
            try {
              setLabel(new URL(tab.url).hostname);
            } catch {
              // ignore malformed URL
            }
          }
        }
      })
      .catch(() => {/* noop */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  // Auto-derive label from URL when URL changes (unless user has manually edited label)
  useEffect(() => {
    if (!isNew || labelTouched) return;
    try {
      setLabel(new URL(url).hostname);
    } catch {
      // ignore
    }
  }, [url, isNew, labelTouched]);

  // Load existing data when editing
  useEffect(() => {
    if (isNew || !path) return;
    setLoading(true);
    setError(null);
    Promise.all([
      client.readSecret(mount, path, 2),
      client.readMetadata(mount, path),
    ])
      .then(([data, meta]) => {
        setUsername((data['username'] as string) ?? '');
        setPassword((data['password'] as string) ?? '');
        const storedUrl = (meta.data.custom_metadata?.['url'] as string) ?? '';
        setUrl(storedUrl);
        // Label = leaf segment of path
        setLabel(path.split('/').pop() ?? '');
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [client, mount, path, isNew]);

  const handleLoadPolicies = async () => {
    setShowPolicyPicker(true);
    if (policies !== null) return;
    setLoadingPolicies(true);
    setGenError(null);
    try {
      const list = await client.listPasswordPolicies();
      setPolicies(list);
      if (list.length > 0) setSelectedPolicy(list[0]);
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setLoadingPolicies(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedPolicy) return;
    setGenerating(true);
    setGenError(null);
    try {
      const generated = await client.generatePassword(selectedPolicy);
      setPassword(generated);
      setShowPolicyPicker(false);
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!label.trim()) { setError('Label is required.'); return; }
    if (!password.trim()) { setError('Password is required.'); return; }
    setError(null);
    setSaving(true);
    try {
      const savePath = `password-manager/${entityId}/${label.trim()}`;
      await client.createOrUpdateSecret(mount, savePath, { username, password }, 2);
      // Always write metadata so clearing the URL removes any stored match.
      await client.updateMetadata(mount, savePath, { url: url.trim() });
      setSaving(false);
      onSave(savePath);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const fieldLabel: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase',
    color: 'var(--color-muted)', marginBottom: 5,
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flex: 1, color: 'var(--color-muted)' }}>
        <span className="spinner" /> Loading…
      </div>
    );
  }

  return (
    <div className="flex-col" style={{ flex: 1, overflow: 'hidden' }}>
      {/* Page header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        borderBottom: 'var(--border)',
        background: 'var(--color-surface)',
        flexShrink: 0,
      }}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} aria-label="Cancel">
          ← Cancel
        </button>
        <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13, color: 'var(--color-text)' }}>
          {isNew ? 'New password' : 'Edit password'}
        </div>
        <button
          className="btn btn-sm btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ display: 'flex', alignItems: 'center', gap: 5 }}
        >
          {saving
            ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Saving…</>
            : <><SaveIcon /> Save</>
          }
        </button>
      </div>

      {/* Form body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontWeight: 700, flexShrink: 0 }}>✕</span>
            <span>{error}</span>
          </div>
        )}

        {/* URL */}
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="pm-url" style={fieldLabel}>URL</label>
          <input
            id="pm-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </div>

        {/* Label */}
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="pm-label" style={fieldLabel}>
            Label <span style={{ color: 'var(--color-danger)' }}>*</span>
            <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 4 }}>(credential name)</span>
          </label>
          <input
            id="pm-label"
            type="text"
            value={label}
            onChange={(e) => { setLabel(e.target.value); setLabelTouched(true); }}
            placeholder="github.com"
            disabled={!isNew}
            style={!isNew ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
          />
          {!isNew && (
            <div style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 4 }}>
              Label cannot be changed when editing. Delete and re-add to rename.
            </div>
          )}
        </div>

        {/* Username */}
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="pm-username" style={fieldLabel}>Username</label>
          <input
            id="pm-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username or email"
            autoComplete="off"
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <label htmlFor="pm-password" style={{ ...fieldLabel, marginBottom: 0 }}>
              Password <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleLoadPolicies}
              style={{ fontSize: 11, padding: '2px 8px' }}
            >
              Generate ↓
            </button>
          </div>
          <input
            id="pm-password"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            autoComplete="new-password"
            style={{ fontFamily: '"SF Mono", ui-monospace, monospace', fontSize: 12 }}
          />
        </div>

        {/* Policy picker */}
        {showPolicyPicker && (
          <div style={{
            marginBottom: 14, padding: 10,
            background: 'var(--color-surface)',
            border: 'var(--border)',
            borderRadius: 'var(--radius-md)',
            borderLeft: '3px solid var(--color-accent)',
          }}>
            {loadingPolicies && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-muted)' }}>
                <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Loading policies…
              </div>
            )}
            {genError && (
              <div style={{ fontSize: 12, color: 'var(--color-danger)', marginBottom: 6 }}>{genError}</div>
            )}
            {!loadingPolicies && policies !== null && policies.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>No password policies found.</div>
            )}
            {!loadingPolicies && policies && policies.length > 0 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  value={selectedPolicy}
                  onChange={(e) => setSelectedPolicy(e.target.value)}
                  style={{ flex: 1, fontSize: 12 }}
                >
                  {policies.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleGenerate}
                  disabled={generating}
                  style={{ flexShrink: 0 }}
                >
                  {generating ? <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> : 'Use'}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => setShowPolicyPicker(false)}
                  style={{ flexShrink: 0 }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        )}

        {/* Cancel */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn" onClick={onCancel} style={{ fontSize: 12 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
