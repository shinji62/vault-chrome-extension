import { useEffect, useState } from 'react';
import { VaultClient } from '../../api/vaultClient';

interface SecretFormProps {
  client: VaultClient;
  mount: string;
  kvVersion: 1 | 2;
  /**
   * For editing: the full secret path (e.g. "folder/my-secret").
   * For new:     the current directory (e.g. "folder" or "").
   */
  path: string;
  isNew: boolean;
  initialData?: Record<string, string>;
  onSave: () => void;
  onCancel: () => void;
}

// ── inline SVG icons ────────────────────────────────────────────────────────

const PlusIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 5h12M6 5V3h4v2M4 5l.8 9h6.4L12 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SaveIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M13 13H3a1 1 0 0 1-1-1V3l3-0v3h6V3l2 2v8a1 1 0 0 1-1 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    <rect x="5" y="3" width="6" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

// ── Component ────────────────────────────────────────────────────────────────

export function SecretForm({
  client,
  mount,
  kvVersion,
  path,
  isNew,
  onSave,
  onCancel,
}: SecretFormProps) {
  const [secretName, setSecretName]   = useState('');
  const [pairs, setPairs]             = useState<[string, string][]>([['', '']]);
  const [saving, setSaving]           = useState(false);
  const [loadingData, setLoadingData] = useState(!isNew);
  const [error, setError]             = useState<string | null>(null);
  const [urlMeta, setUrlMeta]         = useState('');
  const [showUrlPrompt, setShowUrlPrompt] = useState(false);

  // Load existing data when editing
  useEffect(() => {
    if (isNew) return;
    setLoadingData(true);
    setError(null);
    client
      .readSecret(mount, path, kvVersion)
      .then((data) => { setPairs(Object.entries(data)); setLoadingData(false); setError(null); })
      .catch((e: Error) => { setError(e.message); setLoadingData(false); });
  }, [client, mount, path, kvVersion, isNew]);

  const updateKey   = (i: number, val: string) =>
    setPairs((p) => { const n = [...p] as [string, string][]; n[i] = [val, n[i][1]]; return n; });
  const updateValue = (i: number, val: string) =>
    setPairs((p) => { const n = [...p] as [string, string][]; n[i] = [n[i][0], val]; return n; });
  const removePair  = (i: number) =>
    setPairs((p) => p.filter((_, idx) => idx !== i));
  const addPair     = () =>
    setPairs((p) => [...p, ['', '']]);

  const resolvedPath = isNew
    ? (path ? `${path}/${secretName.trim()}` : secretName.trim())
    : path;

  const handleSave = async () => {
    if (isNew && !secretName.trim()) { setError('Secret name is required.'); return; }
    setError(null);
    setSaving(true);
    try {
      const data = Object.fromEntries(pairs.filter(([k]) => k.trim() !== ''));
      await client.createOrUpdateSecret(mount, resolvedPath, data, kvVersion);
      if (kvVersion === 2 && isNew && urlMeta.trim()) {
        await client.updateMetadata(mount, resolvedPath, { url: urlMeta.trim() });
      }
      setSaving(false);
      onSave();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    if (kvVersion === 2 && isNew && !showUrlPrompt) {
      if (!secretName.trim()) { setError('Secret name is required.'); return; }
      setShowUrlPrompt(true);
      return;
    }
    handleSave();
  };

  // ── derived display values ──
  const secretLabel = isNew ? 'New Secret' : (path.split('/').pop() ?? path);
  const secretDir   = !isNew && path.includes('/')
    ? path.substring(0, path.lastIndexOf('/'))
    : '';

  if (loadingData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flex: 1, color: 'var(--color-muted)' }}>
        <span className="spinner" /> Loading…
      </div>
    );
  }

  return (
    <div className="flex-col" style={{ flex: 1, overflow: 'hidden' }}>

      {/* ── Page header ── */}
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
        <div style={{ flex: 1, minWidth: 0 }}>
          {!isNew && secretDir && (
            <div style={{
              fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.04em',
              color: 'var(--color-muted)', lineHeight: 1.2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {mount}/{secretDir}
            </div>
          )}
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text)' }}>
            {isNew ? 'New secret' : `Edit · ${secretLabel}`}
          </div>
        </div>

        <button
          className="btn btn-sm btn-primary"
          onClick={handleSaveClick}
          disabled={saving}
          style={{ display: 'flex', alignItems: 'center', gap: 5 }}
        >
          {saving
            ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Saving…</>
            : <><SaveIcon /> {showUrlPrompt ? 'Save Secret' : (kvVersion === 2 && isNew ? 'Next →' : 'Save')}</>
          }
        </button>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>

        {/* Error */}
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontWeight: 700, flexShrink: 0 }}>✕</span>
            <span>{error}</span>
          </div>
        )}

        {/* ── Secret name (new only) ── */}
        {isNew && (
          <div style={{ marginBottom: 18 }}>
            <label htmlFor="secretName" style={{
              display: 'block', fontSize: 11, fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--color-muted)', marginBottom: 6,
            }}>
              Secret name <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <div style={{
              display: 'flex', alignItems: 'center',
              border: 'var(--border)', borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-sm)',
              transition: 'border-color 0.15s',
            }}>
              {path && (
                <span style={{
                  padding: '7px 10px',
                  fontSize: 12, fontFamily: 'monospace',
                  color: 'var(--color-muted)',
                  borderRight: 'var(--border)',
                  background: 'var(--color-surface)',
                  flexShrink: 0, whiteSpace: 'nowrap',
                }}>
                  {path}/
                </span>
              )}
              <input
                id="secretName"
                type="text"
                value={secretName}
                onChange={(e) => setSecretName(e.target.value)}
                placeholder="my-secret"
                autoFocus
                style={{
                  flex: 1, border: 'none', background: 'transparent',
                  padding: '7px 10px', fontSize: 13,
                  fontFamily: '"SF Mono", ui-monospace, monospace',
                  color: 'var(--color-text)', boxShadow: 'none',
                  outline: 'none',
                }}
              />
            </div>
          </div>
        )}

        {/* ── KV v2 URL prompt ── */}
        {showUrlPrompt && kvVersion === 2 && isNew && (
          <div style={{
            marginBottom: 18,
            padding: 12,
            background: 'var(--color-surface)',
            border: 'var(--border)',
            borderRadius: 'var(--radius-md)',
            borderLeft: '3px solid var(--color-accent)',
          }}>
            <label htmlFor="urlMeta" style={{
              display: 'block', fontSize: 11, fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--color-muted)', marginBottom: 6,
            }}>
              Site URL <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — used for auto-fill)</span>
            </label>
            <input
              id="urlMeta"
              type="url"
              value={urlMeta}
              onChange={(e) => setUrlMeta(e.target.value)}
              placeholder="https://example.com"
              autoFocus
            />
          </div>
        )}

        {/* ── Fields header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 8,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--color-muted)',
          }}>
            Fields
          </span>
          <button
            className="btn btn-sm"
            onClick={addPair}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px' }}
          >
            <PlusIcon /> Add field
          </button>
        </div>

        {/* ── KV rows ── */}
        <div style={{
          border: 'var(--border)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)',
        }}>
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 32px',
            gap: 0,
            padding: '5px 10px',
            background: 'var(--color-surface)',
            borderBottom: 'var(--border)',
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>Key</span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>Value</span>
            <span />
          </div>

          {pairs.length === 0 && (
            <div style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--color-muted)', fontSize: 12 }}>
              No fields yet. Click <strong>Add field</strong> to add one.
            </div>
          )}

          {pairs.map(([key, value], i) => (
            <div
              key={i}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 32px',
                gap: 0,
                borderBottom: i < pairs.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                background: i % 2 === 0 ? 'var(--color-bg)' : 'var(--color-surface)',
              }}
            >
              {/* Key cell */}
              <div style={{ borderRight: '1px solid var(--color-border-subtle)' }}>
                <label className="visually-hidden" htmlFor={`kv-key-${i}`}>Key {i + 1}</label>
                <input
                  id={`kv-key-${i}`}
                  value={key}
                  onChange={(e) => updateKey(i, e.target.value)}
                  placeholder="key"
                  style={{
                    width: '100%', border: 'none', background: 'transparent',
                    padding: '8px 10px', borderRadius: 0, boxShadow: 'none',
                    fontSize: 12, fontFamily: '"SF Mono", ui-monospace, monospace',
                    color: 'var(--color-accent)', letterSpacing: '0.02em',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Value cell */}
              <div style={{ borderRight: '1px solid var(--color-border-subtle)' }}>
                <label className="visually-hidden" htmlFor={`kv-val-${i}`}>Value {i + 1}</label>
                <input
                  id={`kv-val-${i}`}
                  value={value}
                  onChange={(e) => updateValue(i, e.target.value)}
                  placeholder="value"
                  style={{
                    width: '100%', border: 'none', background: 'transparent',
                    padding: '8px 10px', borderRadius: 0, boxShadow: 'none',
                    fontSize: 12, fontFamily: '"SF Mono", ui-monospace, monospace',
                    color: 'var(--color-text)', letterSpacing: '0.02em',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Delete cell */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <button
                  className="btn-icon"
                  onClick={() => removePair(i)}
                  aria-label={`Remove row ${i + 1}`}
                  title="Remove field"
                  style={{ color: 'var(--color-muted)', padding: 4 }}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ── Bottom actions (secondary Cancel) ── */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onCancel} style={{ fontSize: 12 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
