import { useEffect, useState } from 'react';
import { VaultClient } from '../../api/vaultClient';
import { Settings } from '../../types/settings';
import { PmSetup } from './PmSetup';
import { PmCredentialList } from './PmCredentialList';
import { PmCredentialDetail } from './PmCredentialDetail';
import { PmCredentialForm } from './PmCredentialForm';

interface PasswordManagerProps {
  client: VaultClient;
  settings: Settings;
  onOpenSettings: () => void;
}

type PmScreen =
  | { id: 'list' }
  | { id: 'detail'; path: string }
  | { id: 'editing'; path: string }
  | { id: 'new' };

export function PasswordManager({ client, settings, onOpenSettings }: PasswordManagerProps) {
  const [entityId, setEntityId] = useState<string | null>(null);
  const [pmScreen, setPmScreen] = useState<PmScreen>({ id: 'list' });

  const mount = settings.pmMount || 'secret';

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

  if (pmScreen.id === 'list') {
    return (
      <PmCredentialList
        client={client}
        mount={mount}
        entityId={entityId}
        onSelect={(path) => setPmScreen({ id: 'detail', path })}
        onAdd={() => setPmScreen({ id: 'new' })}
      />
    );
  }

  if (pmScreen.id === 'detail') {
    return (
      <PmCredentialDetail
        client={client}
        mount={mount}
        path={pmScreen.path}
        onBack={() => setPmScreen({ id: 'list' })}
        onEdit={() => setPmScreen({ id: 'editing', path: pmScreen.path })}
        onDelete={() => setPmScreen({ id: 'list' })}
      />
    );
  }

  if (pmScreen.id === 'editing') {
    return (
      <PmCredentialForm
        client={client}
        mount={mount}
        entityId={entityId}
        isNew={false}
        path={pmScreen.path}
        onSave={() => setPmScreen({ id: 'detail', path: pmScreen.path })}
        onCancel={() => setPmScreen({ id: 'detail', path: pmScreen.path })}
      />
    );
  }

  // id === 'new'
  return (
    <PmCredentialForm
      client={client}
      mount={mount}
      entityId={entityId}
      isNew={true}
      onSave={(newPath) => setPmScreen({ id: 'detail', path: newPath })}
      onCancel={() => setPmScreen({ id: 'list' })}
    />
  );
}
