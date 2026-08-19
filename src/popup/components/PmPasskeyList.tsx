import { useEffect, useState } from 'react';
import { VaultClient } from '../../api/vaultClient';

interface PmPasskeyListProps {
  client: VaultClient;
  entityId: string;
  onSelect: (label: string) => void;
}

interface PasskeyRow {
  label: string;
  rpId?: string;
  username?: string;
}

export function PmPasskeyList({ client, entityId, onSelect }: PmPasskeyListProps) {
  const [rows, setRows] = useState<PasskeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    client
      .listPasskeys(entityId)
      .then((result) => {
        setRows(result);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [client, entityId]);

  return (
    <div className="flex-col" style={{ flex: 1, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: 'var(--border)',
        background: 'var(--color-surface)',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)' }}>
          Passkeys
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32, color: 'var(--color-muted)' }}>
            <span className="spinner" /> Loading…
          </div>
        )}

        {!loading && error && (
          <div className="alert alert-error" style={{ margin: 12, borderRadius: 8 }}>
            {error}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 8, padding: 40, color: 'var(--color-muted)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 28 }}>🔐</div>
            <div style={{ fontSize: 12 }}>No passkeys saved yet.</div>
            <div style={{ fontSize: 11, maxWidth: 220 }}>Passkeys are created automatically when a site asks to register one.</div>
          </div>
        )}

        {!loading && !error && rows.map((row, idx) => (
          <button
            key={row.label}
            onClick={() => onSelect(row.label)}
            style={{
              display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start',
              width: '100%', textAlign: 'left',
              padding: '10px 14px',
              background: idx % 2 === 0 ? 'var(--color-bg)' : 'var(--color-surface)',
              border: 'none',
              borderBottom: '1px solid var(--color-border-subtle)',
              cursor: 'pointer',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'var(--color-brand-subtle)')}
            onMouseOut={(e) => (e.currentTarget.style.background = idx % 2 === 0 ? 'var(--color-bg)' : 'var(--color-surface)')}
          >
            {/* Labels carry a credential-id suffix to stay unique, so the site
                and account are shown instead and the label is the subtitle. */}
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)' }}>
              {[row.rpId, row.username].filter(Boolean).join(' · ') || row.label}
            </span>
            <span style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: '"SF Mono", ui-monospace, monospace' }}>
              {row.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
