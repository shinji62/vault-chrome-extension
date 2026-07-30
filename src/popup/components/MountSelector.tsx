import React, { useEffect, useRef, useState } from 'react';
import { VaultClient } from '../../api/vaultClient';
import { VaultMount } from '../../types/vault';

interface MountSelectorProps {
  client: VaultClient;
  selectedMount: string;
  onSelect: (mount: string, kvVersion: 1 | 2) => void;
}

export function MountSelector({ client, selectedMount, onSelect }: MountSelectorProps) {
  const [mounts, setMounts] = useState<Array<{ path: string; version: 1 | 2 }>>([]);
  const [error, setError] = useState<string | null>(null);
  const selectedMountRef = useRef(selectedMount);
  const onSelectRef = useRef(onSelect);
  selectedMountRef.current = selectedMount;
  onSelectRef.current = onSelect;

  useEffect(() => {
    console.log('[vault] loading mounts for selector');
    client
      .listMounts()
      .then((all: Record<string, VaultMount>) => {
        console.log('[vault] mounts loaded', all);
        const mountsData = 'data' in all && all.data && typeof all.data === 'object'
          ? all.data as Record<string, VaultMount>
          : all;
        const kvMounts = Object.entries(mountsData)
          .filter(([, m]) => m?.type === 'kv')
          .map(([key, m]) => ({
            path: key.replace(/\/$/, ''),
            version: (m.options?.version === '2' ? 2 : 1) as 1 | 2,
          }));
        setMounts(kvMounts);
        if (kvMounts.length > 0 && !selectedMountRef.current) {
          onSelectRef.current(kvMounts[0].path, kvMounts[0].version);
        }
      })
      .catch((e: Error) => {
        console.error('[vault] mounts load failed', e);
        setError(e.message);
      });
  }, [client]);

  if (error) {
    return <span className="text-danger text-sm">Mounts error: {error}</span>;
  }

  return (
    <select
      id="mount-selector"
      aria-label="KV Mount"
      value={selectedMount}
      onChange={(e) => {
        const found = mounts.find((m) => m.path === e.target.value);
        if (found) onSelect(found.path, found.version);
      }}
    >
      {mounts.map((m) => (
        <option key={m.path} value={m.path}>
          🗂 {m.path} (KV v{m.version})
        </option>
      ))}
      {mounts.length === 0 && <option disabled>No KV mounts found</option>}
    </select>
  );
}
