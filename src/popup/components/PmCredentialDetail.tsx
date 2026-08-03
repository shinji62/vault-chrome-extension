import React, { useEffect, useState } from 'react';
import { VaultClient } from '../../api/vaultClient';

interface PmCredentialDetailProps {
  client: VaultClient;
  mount: string;
  path: string;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

// ── inline SVG icons ─────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export function PmCredentialDetail({
  client,
  mount,
  path,
  onBack,
  onEdit,
  onDelete,
}: PmCredentialDetailProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passwordRevealed, setPasswordRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const label = path.split('/').pop() ?? path;

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      client.readSecret(mount, path, 2),
      client.readMetadata(mount, path),
    ])
      .then(([data, meta]) => {
        setUsername((data['username'] as string) ?? '');
        setPassword((data['password'] as string) ?? '');
        setUrl((meta.data.custom_metadata?.['url'] as string) ?? '');
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [client, mount, path]);

  const handleCopy = (value: string, key: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const handleDelete = () => {
    setDeleting(true);
    client
      .deleteSecret(mount, path, 2)
      .then(() => onDelete())
      .catch((e: Error) => {
        setError(e.message);
        setDeleting(false);
        setConfirmDelete(false);
      });
  };

  const fieldRowStyle: React.CSSProperties = {
    padding: '10px 14px',
    borderBottom: '1px solid var(--color-border-subtle)',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    color: 'var(--color-accent)', marginBottom: 4,
  };

  const valueStyle: React.CSSProperties = {
    fontFamily: '"SF Mono", ui-monospace, "Cascadia Code", monospace',
    fontSize: 12, color: 'var(--color-text)', wordBreak: 'break-all', lineHeight: 1.5,
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </div>
        </div>
        <button
          className="btn btn-sm"
          onClick={onEdit}
          aria-label="Edit"
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <EditIcon /> Edit
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={() => setConfirmDelete(true)}
          aria-label="Delete"
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <TrashIcon /> Delete
        </button>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div style={{
          padding: '10px 14px',
          background: 'var(--color-ttl-red-bg)',
          borderBottom: '1px solid var(--color-danger)',
          flexShrink: 0,
        }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-danger)', marginBottom: 8 }}>
            Delete <span style={{ fontFamily: 'monospace' }}>{label}</span>? This cannot be undone.
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

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32, color: 'var(--color-muted)' }}>
            <span className="spinner" /> Loading…
          </div>
        )}

        {!loading && error && (
          <div className="alert alert-error" style={{ margin: 12, borderRadius: 8 }}>{error}</div>
        )}

        {!loading && !error && (
          <>
            {/* URL */}
            {url && (
              <div style={fieldRowStyle}>
                <div style={labelStyle}>URL</div>
                <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...valueStyle, color: 'var(--color-accent)', textDecoration: 'none' }}>
                  {url}
                </a>
              </div>
            )}

            {/* Username */}
            <div style={{ ...fieldRowStyle, display: 'grid', gridTemplateColumns: '1fr auto' }}>
              <div>
                <div style={labelStyle}>Username</div>
                <div style={valueStyle}>{username || '—'}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 10 }}>
                <button
                  className="btn-icon"
                  onClick={() => handleCopy(username, 'username')}
                  aria-label="Copy username"
                  title={copied === 'username' ? 'Copied!' : 'Copy username'}
                  style={{ color: copied === 'username' ? 'var(--color-success)' : undefined }}
                >
                  {copied === 'username' ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            </div>

            {/* Password */}
            <div style={{ ...fieldRowStyle, display: 'grid', gridTemplateColumns: '1fr auto' }}>
              <div>
                <div style={labelStyle}>Password</div>
                <div style={{
                  ...valueStyle,
                  color: passwordRevealed ? 'var(--color-text)' : 'var(--color-muted)',
                  letterSpacing: passwordRevealed ? '0.03em' : '0.15em',
                }}>
                  {passwordRevealed ? password : '••••••••'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 10 }}>
                <button
                  className="btn-icon"
                  onClick={() => setPasswordRevealed((v) => !v)}
                  aria-label={passwordRevealed ? 'Hide password' : 'Reveal password'}
                  title={passwordRevealed ? 'Hide' : 'Reveal'}
                  style={{ color: passwordRevealed ? 'var(--color-accent)' : undefined }}
                >
                  <EyeIcon open={passwordRevealed} />
                </button>
                <button
                  className="btn-icon"
                  onClick={() => handleCopy(password, 'password')}
                  aria-label="Copy password"
                  title={copied === 'password' ? 'Copied!' : 'Copy password'}
                  style={{ color: copied === 'password' ? 'var(--color-success)' : undefined }}
                >
                  {copied === 'password' ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
