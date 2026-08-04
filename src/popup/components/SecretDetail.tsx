import { useState } from 'react';
import { VaultClient } from '../../api/vaultClient';
import { MetadataPanel } from './MetadataPanel';
import { FILL_CREDENTIALS } from '../../types/messages';

interface SecretDetailProps {
  client: VaultClient;
  mount: string;
  kvVersion: 1 | 2;
  path: string;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

type Tab = 'data' | 'metadata';

// ── inline SVG icons ────────────────────────────────────────────────────────
const EyeIcon = ({ open }: { open: boolean }) =>
  open ? (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6"/>
      <line x1="3" y1="3" x2="17" y2="17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6"/>
    </svg>
  );

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="7" y="7" width="10" height="12" rx="2" stroke="currentColor" strokeWidth="1.6"/>
    <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="1.6"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M4 10l4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M14.5 2.5a2.121 2.121 0 0 1 3 3L6 17H3v-3L14.5 2.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M3 6h14M8 6V4h4v2M5 6l1 11h8l1-11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const FillIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M12.65 10A6 6 0 1 0 12 15h1l1.5 1.5 1.5-1.5 1.5 1.5 1.5-1.5L21 17l-2-2v-3.5L12.65 10zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" fill="currentColor"/>
  </svg>
);

// ── Component ────────────────────────────────────────────────────────────────

export function SecretDetail({
  client,
  mount,
  kvVersion,
  path,
  onBack,
  onEdit,
  onDelete,
}: SecretDetailProps) {
  const [data, setData] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fillStatus, setFillStatus] = useState<'idle' | 'ok' | 'err'>('idle');
  const [activeTab, setActiveTab] = useState<Tab>('data');

  const handleRetrieve = () => {
    setLoading(true);
    setError(null);
    setData(null);
    setRevealed({});
    client
      .readSecret(mount, path, kvVersion)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  };

  const handleReveal = (key: string) =>
    setRevealed((r) => ({ ...r, [key]: !r[key] }));

  const handleCopy = (key: string) => {
    if (!data) return;
    navigator.clipboard.writeText(data[key] ?? '').then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const handleDelete = () => {
    setDeleting(true);
    client
      .deleteSecret(mount, path, kvVersion)
      .then(() => onDelete())
      .catch((e: Error) => { setError(e.message); setDeleting(false); setConfirmDelete(false); });
  };

  const handleFill = () => {
    setFilling(true);
    setFillStatus('idle');
    const doFill = async () => {
      // Fetch the secret if not already loaded
      const secretData = data ?? await client.readSecret(mount, path, kvVersion);
      if (!data) setData(secretData);

      const username = secretData['username'] ?? '';
      const password = secretData['password'] ?? '';

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab');

      await chrome.tabs.sendMessage(tab.id, {
        type: FILL_CREDENTIALS,
        username,
        password,
      });
    };
    doFill()
      .then(() => { setFillStatus('ok'); setTimeout(() => setFillStatus('idle'), 2000); })
      .catch(() => setFillStatus('err'))
      .finally(() => setFilling(false));
  };

  const secretName = path.split('/').pop() ?? path;
  const secretDir  = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';

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
        <button className="btn btn-ghost btn-sm" onClick={onBack} aria-label="Back to list">
          ← Back
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          {secretDir && (
            <div style={{
              fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.04em',
              color: 'var(--color-muted)', lineHeight: 1.2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {mount}/{secretDir}
            </div>
          )}
          <div style={{
            fontWeight: 700, fontSize: 13,
            color: 'var(--color-text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {secretName}
          </div>
        </div>

        <button
          className="btn btn-sm btn-primary"
          onClick={handleRetrieve}
          disabled={loading}
          aria-label="Retrieve secret"
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null}
          {loading ? 'Retrieving…' : 'Retrieve'}
        </button>
        <button
          className="btn btn-sm"
          onClick={onEdit}
          aria-label="Edit secret"
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <EditIcon /> Edit
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={() => setConfirmDelete(true)}
          aria-label="Delete secret"
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <TrashIcon /> Delete
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={handleFill}
          disabled={filling}
          aria-label="Fill credentials into active tab"
          title="Fill username &amp; password into the active tab's login form"
          style={{ display: 'flex', alignItems: 'center', gap: 4,
            color: fillStatus === 'ok' ? 'var(--color-success)' : fillStatus === 'err' ? 'var(--color-danger)' : undefined }}
        >
          {filling ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <FillIcon />}
          {fillStatus === 'ok' ? 'Filled!' : fillStatus === 'err' ? 'Failed' : 'Fill'}
        </button>
      </div>

      {/* ── Tabs (KV v2) ── */}
      {kvVersion === 2 && (
        <div className="tabs">
          {(['data', 'metadata'] as Tab[]).map((tab) => (
            <button
              key={tab}
              className={`tab-btn${activeTab === tab ? ' active' : ''}`}
              onClick={() => setActiveTab(tab)}
              style={{ flex: 1 }}
            >
              {tab === 'data' ? 'Secret Data' : 'Metadata'}
            </button>
          ))}
        </div>
      )}

      {/* ── Delete confirmation banner ── */}
      {confirmDelete && (
        <div style={{
          padding: '10px 14px',
          background: 'var(--color-ttl-red-bg)',
          borderBottom: '1px solid var(--color-danger)',
          flexShrink: 0,
        }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-danger)', marginBottom: 8 }}>
            Delete <span style={{ fontFamily: 'monospace' }}>{secretName}</span>? This cannot be undone.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-sm btn-danger"
              onClick={handleDelete}
              disabled={deleting}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {deleting ? <span className="spinner" /> : <TrashIcon />}
              {deleting ? 'Deleting…' : 'Confirm delete'}
            </button>
            <button className="btn btn-sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* idle — not yet retrieved */}
        {!loading && !data && !error && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40, color: 'var(--color-muted)' }}>
            <div style={{ fontSize: 12 }}>Click <strong>Retrieve</strong> to load the secret from Vault.</div>
          </div>
        )}

        {/* loading */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32, color: 'var(--color-muted)' }}>
            <span className="spinner" /> Retrieving secret…
          </div>
        )}

        {/* error */}
        {!loading && error && (
          <div className="alert alert-error" style={{ margin: 12, borderRadius: 8 }}>
            {error}
          </div>
        )}

        {/* data tab */}
        {!loading && !error && activeTab === 'data' && data && (
          <div>
            {Object.entries(data).length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-muted)', fontSize: 12 }}>
                No fields in this secret.
              </div>
            ) : (
              Object.entries(data).map(([key, value], idx) => (
                <div
                  key={key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 0,
                    padding: '10px 14px',
                    borderBottom: idx < Object.entries(data).length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                    background: idx % 2 === 0 ? 'var(--color-bg)' : 'var(--color-surface)',
                  }}
                >
                  {/* left: key + value */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                      color: 'var(--color-accent)', marginBottom: 3,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {key}
                    </div>
                    <div style={{
                      fontFamily: '"SF Mono", ui-monospace, "Cascadia Code", monospace',
                      fontSize: 12,
                      color: revealed[key] ? 'var(--color-text)' : 'var(--color-muted)',
                      letterSpacing: revealed[key] ? '0.03em' : '0.15em',
                      wordBreak: 'break-all',
                      lineHeight: 1.5,
                    }}>
                      {revealed[key] ? value : '••••••••'}
                    </div>
                  </div>

                  {/* right: action buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 10, flexShrink: 0 }}>
                    <button
                      className="btn-icon"
                      onClick={() => handleReveal(key)}
                      aria-label={revealed[key] ? `Hide ${key}` : `Reveal ${key}`}
                      title={revealed[key] ? 'Hide' : 'Reveal'}
                      style={{ color: revealed[key] ? 'var(--color-accent)' : undefined }}
                    >
                      <EyeIcon open={revealed[key]} />
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => handleCopy(key)}
                      aria-label={`Copy ${key}`}
                      title={copied === key ? 'Copied!' : 'Copy to clipboard'}
                      style={{ color: copied === key ? 'var(--color-success)' : undefined }}
                    >
                      {copied === key ? <CheckIcon /> : <CopyIcon />}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* metadata tab */}
        {!loading && !error && activeTab === 'metadata' && kvVersion === 2 && (
          <MetadataPanel client={client} mount={mount} path={path} />
        )}
      </div>
    </div>
  );
}
