import { useEffect, useState } from 'react';
import { VaultClient } from '../../api/vaultClient';
import { PasskeyRecord } from '../../types/vault';

interface PmPasskeyDetailProps {
  client: VaultClient;
  entityId: string;
  label: string;
  onBack: () => void;
  onDelete: () => void;
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function PmPasskeyDetail({ client, entityId, label, onBack, onDelete }: PmPasskeyDetailProps) {
  const [record, setRecord] = useState<(PasskeyRecord & { privateJwk: JsonWebKey }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSecret, setShowSecret] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    client
      .readPasskey(entityId, label)
      .then((r) => {
        setRecord(r);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [client, entityId, label]);

  const handleDelete = async () => {
    if (!window.confirm(`Delete passkey "${label}"?`)) return;
    setDeleting(true);
    setError(null);
    try {
      await client.deletePasskey(entityId, label);
      onDelete();
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  };

  const fieldLabel: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase',
    color: 'var(--color-muted)', marginBottom: 5,
  };

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
        <button className="btn btn-ghost btn-sm" onClick={onBack} aria-label="Back">
          ← Back
        </button>
        <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32, color: 'var(--color-muted)' }}>
            <span className="spinner" /> Loading…
          </div>
        )}

        {!loading && error && (
          <div className="alert alert-error" style={{ marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontWeight: 700, flexShrink: 0 }}>✕</span>
            <span>{error}</span>
          </div>
        )}

        {!loading && record && (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={fieldLabel}>Relying Party</label>
              <div style={{ fontSize: 13, color: 'var(--color-text)' }}>{record.rpId || '—'}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={fieldLabel}>Username</label>
              <div style={{ fontSize: 13, color: 'var(--color-text)' }}>{record.username || '—'}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={fieldLabel}>Credential ID</label>
              <div style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: '"SF Mono", ui-monospace, monospace', wordBreak: 'break-all' }}>
                {record.credentialId || '—'}
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={fieldLabel}>Algorithm</label>
              <div style={{ fontSize: 13, color: 'var(--color-text)' }}>{record.algorithm || '—'}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={fieldLabel}>Counter</label>
              <div style={{ fontSize: 13, color: 'var(--color-text)' }}>{record.counter ?? '—'}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={fieldLabel}>Transit Key Version</label>
              <div style={{ fontSize: 13, color: 'var(--color-text)' }}>{record.keyVersion ?? '—'}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={fieldLabel}>Created</label>
              <div style={{ fontSize: 13, color: 'var(--color-text)' }}>{fmtDate(record.createdAt)}</div>
            </div>

            {/* Private key */}
            <div style={{ marginBottom: 14 }}>
              <label style={fieldLabel}>Private Key (JWK)</label>
              {showSecret ? (
                <pre style={{
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  fontFamily: '"SF Mono", ui-monospace, monospace', fontSize: 12,
                  padding: 10, background: 'var(--color-surface)', border: 'var(--border)', borderRadius: 'var(--radius-md)',
                  maxHeight: 180, overflowY: 'auto',
                }}>
                  {JSON.stringify(record.privateJwk, null, 2)}
                </pre>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>Encrypted — revealed on request.</div>
              )}
              <button
                className="btn btn-sm"
                onClick={() => setShowSecret((v) => !v)}
                style={{ marginTop: 6 }}
              >
                {showSecret ? 'Hide private key' : 'Reveal private key'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting} style={{ fontSize: 12 }}>
                {deleting ? <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> : 'Delete'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
