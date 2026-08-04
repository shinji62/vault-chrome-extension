import { useEffect, useState } from 'react';
import { VaultClient } from '../../api/vaultClient';

interface PmCredentialListProps {
  client: VaultClient;
  mount: string;
  entityId: string;
  onSelect: (path: string) => void;
  onAdd: () => void;
}

interface CredentialRow {
  path: string;
  label: string;
  username: string;
}

export function PmCredentialList({ client, mount, entityId, onSelect, onAdd }: PmCredentialListProps) {
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const prefix = `password-manager/${entityId}`;

    client
      .listSecrets(mount, prefix, 2)
      .then(async (keys) => {
        // Filter out folder entries (ending with /)
        const leafKeys = keys.filter((k) => !k.endsWith('/'));
        const results: CredentialRow[] = [];
        for (const key of leafKeys) {
          const path = `${prefix}/${key}`;
          try {
            const data = await client.readSecret(mount, path, 2);
            results.push({
              path,
              label: key,
              username: (data['username'] as string) ?? '',
            });
          } catch {
            results.push({ path, label: key, username: '' });
          }
        }
        setRows(results);
        setLoading(false);
      })
      .catch((e: Error) => {
        // 404 means no secrets yet
        if (e.message.includes('404') || e.message.toLowerCase().includes('not found')) {
          setRows([]);
          setLoading(false);
        } else {
          setError(e.message);
          setLoading(false);
        }
      });
  }, [client, mount, entityId]);

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
          Passwords
        </span>
        <button
          className="btn btn-sm btn-primary"
          onClick={onAdd}
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          + Add
        </button>
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
            <div style={{ fontSize: 28 }}>🔑</div>
            <div style={{ fontSize: 12 }}>No passwords saved yet.</div>
            <button className="btn btn-sm btn-primary" onClick={onAdd} style={{ marginTop: 4 }}>
              Add your first password
            </button>
          </div>
        )}

        {!loading && !error && rows.map((row, idx) => (
          <button
            key={row.path}
            onClick={() => onSelect(row.path)}
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
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)' }}>{row.label}</span>
            {row.username && (
              <span style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: '"SF Mono", ui-monospace, monospace' }}>
                {row.username}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
