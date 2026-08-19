import { useEffect, useState } from 'react';
import { VaultClient } from '../../api/vaultClient';
import { Settings } from '../../types/settings';
import { PmSetup } from './PmSetup';
import { PmCredentialList } from './PmCredentialList';
import { PmCredentialDetail } from './PmCredentialDetail';
import { PmCredentialForm } from './PmCredentialForm';
import { PmPasskeyList } from './PmPasskeyList';
import { PmPasskeyDetail } from './PmPasskeyDetail';

interface PasswordManagerProps {
  client: VaultClient;
  settings: Settings;
  onOpenSettings: () => void;
}

type PmSubMode = 'passwords' | 'passkeys';

type PmScreen =
  | { id: 'list' }
  | { id: 'detail'; path: string }
  | { id: 'editing'; path: string }
  | { id: 'new' };

type PmPasskeyScreen =
  | { id: 'list' }
  | { id: 'detail'; label: string };

export function PasswordManager({ client, settings, onOpenSettings }: PasswordManagerProps) {
  const [entityId, setEntityId] = useState<string | null>(null);
  const [subMode, setSubMode] = useState<PmSubMode>('passwords');
  const [pmScreen, setPmScreen] = useState<PmScreen>({ id: 'list' });
  const [pkScreen, setPkScreen] = useState<PmPasskeyScreen>({ id: 'list' });

  const mount = settings.pmMount || 'secret';
  const transitEnabled = !!settings.pmTransitEnabled;

  useEffect(() => {
    chrome.storage.local.get(['vaultEntityId'], (result) => {
      setEntityId((result['vaultEntityId'] as string) ?? '');
    });
  }, []);

  // PM not configured
  if (!settings.pmNamespace && !settings.pmMount) {
    return <PmSetup onOpenSettings={onOpenSettings} />;
  }

  // Waiting for entityId to load
  if (entityId === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flex: 1, color: 'var(--color-muted)' }}>
        <span className="spinner" /> Loading…
      </div>
    );
  }

  // Sub-mode tab bar (Passwords | Passkeys)
  const tabBar = (
    <div style={{
      display: 'flex', gap: 4, padding: '6px 12px',
      borderBottom: 'var(--border)', background: 'var(--color-surface)', flexShrink: 0,
    }}>
      {(['passwords', 'passkeys'] as PmSubMode[]).map((m) => (
        <button
          key={m}
          onClick={() => { setSubMode(m); }}
          style={{
            flex: 1, padding: '5px 0', fontSize: 12, fontWeight: 600,
            color: subMode === m ? 'var(--color-text)' : 'var(--color-muted)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            borderBottom: subMode === m ? '2px solid var(--color-brand)' : '2px solid transparent',
          }}
        >
          {m === 'passwords' ? '🔑 Passwords' : '🔐 Passkeys'}
        </button>
      ))}
    </div>
  );

  // ── Passkeys mode ────────────────────────────────────────────────────────
  if (subMode === 'passkeys') {
    if (!transitEnabled) {
      return (
        <div className="flex-col" style={{ flex: 1, overflow: 'hidden' }}>
          {tabBar}
          <div className="flex-col flex-center gap-2 section" style={{ flex: 1, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 30 }}>🔐</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text)' }}>
              Passkeys are disabled
            </div>
            <p className="text-muted text-sm" style={{ maxWidth: 260, margin: '0 auto' }}>
              Enable <b>Transit (Passkeys)</b> in Settings to save or read passkeys from this
              extension.
            </p>
            <button className="btn btn-sm btn-primary" onClick={onOpenSettings} style={{ marginTop: 6 }}>
              Open Settings
            </button>
          </div>
        </div>
      );
    }

    if (pkScreen.id === 'list') {
      return (
        <>
          {tabBar}
          <PmPasskeyList
            client={client}
            entityId={entityId}
            onSelect={(label) => setPkScreen({ id: 'detail', label })}
          />
        </>
      );
    }

    return (
      <>
        {tabBar}
        <PmPasskeyDetail
          client={client}
          entityId={entityId}
          label={pkScreen.label}
          onBack={() => setPkScreen({ id: 'list' })}
          onDelete={() => setPkScreen({ id: 'list' })}
        />
      </>
    );
  }

  // ── Passwords mode ───────────────────────────────────────────────────────
  if (pmScreen.id === 'list') {
    return (
      <>
        {tabBar}
        <PmCredentialList
          client={client}
          mount={mount}
          entityId={entityId}
          onSelect={(path) => setPmScreen({ id: 'detail', path })}
          onAdd={() => setPmScreen({ id: 'new' })}
        />
      </>
    );
  }

  if (pmScreen.id === 'detail') {
    return (
      <>
        {tabBar}
        <PmCredentialDetail
          client={client}
          mount={mount}
          path={pmScreen.path}
          onBack={() => setPmScreen({ id: 'list' })}
          onEdit={() => setPmScreen({ id: 'editing', path: pmScreen.path })}
          onDelete={() => setPmScreen({ id: 'list' })}
        />
      </>
    );
  }

  if (pmScreen.id === 'editing') {
    return (
      <>
        {tabBar}
        <PmCredentialForm
          client={client}
          mount={mount}
          entityId={entityId}
          isNew={false}
          path={pmScreen.path}
          onSave={() => setPmScreen({ id: 'detail', path: pmScreen.path })}
          onCancel={() => setPmScreen({ id: 'detail', path: pmScreen.path })}
        />
      </>
    );
  }

  return (
    <>
      {tabBar}
      <PmCredentialForm
        client={client}
        mount={mount}
        entityId={entityId}
        isNew={true}
        onSave={(newPath) => setPmScreen({ id: 'detail', path: newPath })}
        onCancel={() => setPmScreen({ id: 'list' })}
      />
    </>
  );
}
