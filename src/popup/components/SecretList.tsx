import React, { useEffect, useState } from 'react';
import { VaultClient } from '../../api/vaultClient';

interface SecretListProps {
  client: VaultClient;
  mount: string;
  kvVersion: 1 | 2;
  path: string;
  onNavigate: (newPath: string) => void;
  onSelect: (secretPath: string) => void;
}

export function SecretList({
  client,
  mount,
  kvVersion,
  path,
  onNavigate,
  onSelect,
}: SecretListProps) {
  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    client
      .listSecrets(mount, path, kvVersion)
      .then((k) => {
        setKeys(k);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [client, mount, kvVersion, path]);

  const segments = path ? path.split('/').filter(Boolean) : [];

  return (
    <div className="flex-col" style={{ flex: 1, overflow: 'hidden' }}>
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <button className="breadcrumb-link" onClick={() => onNavigate('')}>
          {mount}
        </button>
        {segments.map((seg, i) => {
          const segPath = segments.slice(0, i + 1).join('/');
          return (
            <React.Fragment key={segPath}>
              <span className="breadcrumb-sep">/</span>
              <button className="breadcrumb-link" onClick={() => onNavigate(segPath)}>
                {seg}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Content */}
      <div className="secret-list">
        {loading && <div className="section text-muted text-sm">Loading…</div>}
        {error && <div className="section text-sm text-danger">Error: {error}</div>}
        {!loading && !error && keys.length === 0 && (
          <div className="section text-muted text-sm">No secrets found.</div>
        )}
        {!loading &&
          !error &&
          keys.map((key) => {
            const isFolder = key.endsWith('/');
            const fullPath = path
              ? `${path}/${key.replace(/\/$/, '')}`
              : key.replace(/\/$/, '');
            return (
              <button
                key={key}
                className="secret-item"
                style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', color: 'inherit' }}
                onClick={() => (isFolder ? onNavigate(fullPath) : onSelect(fullPath))}
              >
                <span className="secret-item-icon">
                  {isFolder ? (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.379a1.5 1.5 0 0 1 1.06.44l.583.582A1.5 1.5 0 0 0 8.582 3.5H13.5A1.5 1.5 0 0 1 15 5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12V3.5Z" fill="currentColor"/>
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect x="3" y="1" width="10" height="14" rx="2" fill="currentColor" opacity="0.2"/>
                      <path d="M6 7h4M6 10h4M6 4h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      <circle cx="11.5" cy="11.5" r="3" fill="var(--color-bg)" stroke="currentColor" strokeWidth="1.2"/>
                      <path d="M10.8 11.5h1.4M11.5 10.8v1.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                    </svg>
                  )}
                </span>
                <span className="secret-item-name">{key}</span>
                {isFolder && (
                  <svg className="secret-item-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
}
