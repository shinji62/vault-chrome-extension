import React, { useEffect, useState } from 'react';
import { VaultClient } from '../../api/vaultClient';
import { VaultMount } from '../../types/vault';

export type MountEntry =
  | { type: 'kv'; path: string; version: 1 | 2 }
  | { type: 'ssh'; path: string };

interface MountPickerProps {
  client: VaultClient;
  onSelectKV: (mount: string, kvVersion: 1 | 2) => void;
}

function engineIcon(type: 'kv' | 'ssh'): string {
  return type === 'kv' ? '🗂' : '🔑';
}

function engineLabel(entry: MountEntry): string {
  if (entry.type === 'kv') return `KV v${entry.version}`;
  return 'SSH';
}

export function MountPicker({ client, onSelectKV }: MountPickerProps) {
  const [mounts, setMounts] = useState<MountEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .listMounts()
      .then((all: Record<string, VaultMount>) => {
        // The API response is either a wrapped { data: { "mount/": {...} } }
        // or a flat { "mount/": {...} } object.  Detect the wrapped form by
        // checking that the top-level `data` value is itself a record of mount
        // objects (has at least one value with a `type` string field).
        const looksLikeWrapped = (v: unknown): boolean => {
          if (!v || typeof v !== 'object') return false;
          const vals = Object.values(v as Record<string, unknown>);
          return vals.length > 0 && vals.some(
            (x) => x && typeof x === 'object' && 'type' in (x as object) && typeof (x as Record<string,unknown>).type === 'string'
          );
        };

        const mountsData =
          'data' in all && looksLikeWrapped(all.data)
            ? (all.data as Record<string, VaultMount>)
            : all;

        const entries: MountEntry[] = Object.entries(mountsData)
          .filter(([key, m]) =>
            key !== '' &&
            typeof m === 'object' && m !== null &&
            (m?.type === 'kv' || m?.type === 'ssh')
          )
          .map(([key, m]) => {
            const path = key.replace(/\/$/, '');
            if (m.type === 'kv') {
              const version = (m.options?.version === '2' ? 2 : 1) as 1 | 2;
              return { type: 'kv' as const, path, version };
            }
            return { type: 'ssh' as const, path };
          });

        setMounts(entries);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [client]);

  if (loading) {
    return (
      <div className="flex-col flex-center" style={{ flex: 1, gap: 10 }}>
        <span className="spinner" />
        <span className="text-muted text-sm">Loading mounts…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="section">
        <span className="text-danger text-sm">Mounts error: {error}</span>
      </div>
    );
  }

  return (
    <div className="section flex-col" style={{ flex: 1, gap: 8, overflowY: 'auto' }}>
      <div className="text-muted text-sm" style={{ marginBottom: 4 }}>
        Select a secret engine to browse:
      </div>

      {mounts.length === 0 && (
        <div className="text-muted text-sm">No KV or SSH mounts found.</div>
      )}

      {mounts.map((entry) => (
        <button
          key={entry.path}
          className="mount-pick-btn"
          disabled={entry.type === 'ssh'}
          title={entry.type === 'ssh' ? 'SSH engine — coming soon' : undefined}
          onClick={() => {
            if (entry.type === 'kv') onSelectKV(entry.path, entry.version);
          }}
        >
          <span className="mount-pick-icon">{engineIcon(entry.type)}</span>
          <span className="mount-pick-path">{entry.path}</span>
          <span className="mount-pick-badge">{engineLabel(entry)}</span>
          {entry.type === 'ssh' && (
            <span className="mount-pick-soon">soon</span>
          )}
        </button>
      ))}
    </div>
  );
}
