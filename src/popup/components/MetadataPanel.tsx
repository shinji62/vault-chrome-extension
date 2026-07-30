import React, { useEffect, useState } from 'react';
import { VaultClient } from '../../api/vaultClient';

interface MetadataPanelProps {
  client: VaultClient;
  mount: string;
  path: string;
}

export function MetadataPanel({ client, mount, path }: MetadataPanelProps) {
  const [pairs, setPairs] = useState<[string, string][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    client
      .readMetadata(mount, path)
      .then((meta) => {
        const cm = meta.data.custom_metadata ?? {};
        setPairs(Object.entries(cm));
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [client, mount, path]);

  const handleSave = () => {
    setSaving(true);
    const record = Object.fromEntries(pairs.filter(([k]) => k.trim() !== ''));
    client
      .updateMetadata(mount, path, record)
      .then(() => {
        setSaving(false);
        setEditing(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setSaving(false);
      });
  };

  const updatePair = (index: number, field: 'key' | 'value', val: string) => {
    setPairs((prev) => {
      const next = [...prev];
      next[index] = field === 'key' ? [val, next[index][1]] : [next[index][0], val];
      return next;
    });
  };

  const removePair = (index: number) => {
    setPairs((prev) => prev.filter((_, i) => i !== index));
  };

  if (loading) return <div className="text-muted text-sm">Loading metadata…</div>;
  if (error) return <div className="text-danger text-sm">Error: {error}</div>;

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 10 }}>
        <span className="font-bold text-sm">Custom Metadata</span>
        {!editing && (
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>

      {pairs.length === 0 && !editing && (
        <div className="text-muted text-sm">No custom metadata.</div>
      )}

      {pairs.map(([key, value], i) => (
        <div key={i} className="flex gap-2" style={{ marginBottom: 6, alignItems: 'center' }}>
          {editing ? (
            <>
              <label className="visually-hidden" htmlFor={`meta-key-${i}`}>Key {i + 1}</label>
              <input
                id={`meta-key-${i}`}
                value={key}
                onChange={(e) => updatePair(i, 'key', e.target.value)}
                placeholder="key"
                style={{ flex: 1 }}
              />
              <label className="visually-hidden" htmlFor={`meta-val-${i}`}>Value {i + 1}</label>
              <input
                id={`meta-val-${i}`}
                value={value}
                onChange={(e) => updatePair(i, 'value', e.target.value)}
                placeholder="value"
                style={{ flex: 2 }}
              />
              <button
                className="btn btn-sm btn-danger"
                onClick={() => removePair(i)}
                aria-label={`Remove ${key || `row ${i + 1}`}`}
              >
                ✕
              </button>
            </>
          ) : (
            <>
              <span
                className="text-sm"
                style={{ flex: 1, color: key === 'url' ? 'var(--color-accent)' : 'var(--color-muted)', wordBreak: 'break-all' }}
              >
                {key === 'url' ? '🔗 Site URL' : key}
              </span>
              <span className="text-sm font-mono" style={{ flex: 2, wordBreak: 'break-all' }}>{value}</span>
            </>
          )}
        </div>
      ))}

      {editing && (
        <div className="flex gap-2" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-sm"
            onClick={() => setPairs((prev) => [...prev, ['', '']])}
          >
            + Add field
          </button>
          <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn-sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
