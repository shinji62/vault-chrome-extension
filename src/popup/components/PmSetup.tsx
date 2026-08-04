interface PmSetupProps {
  onOpenSettings: () => void;
}

export function PmSetup({ onOpenSettings }: PmSetupProps) {
  return (
    <div className="flex-col flex-center gap-3 section" style={{ flex: 1, paddingTop: 40, paddingBottom: 40 }}>
      <div style={{
        width: 56, height: 56, borderRadius: 14,
        background: 'var(--color-surface)',
        border: 'var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 26,
      }}>
        🔒
      </div>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: 'var(--color-text)' }}>
          Password Manager
        </div>
        <p className="text-muted text-sm text-center" style={{ maxWidth: 240, margin: '0 auto' }}>
          Configure a dedicated namespace to start saving passwords.
        </p>
      </div>

      <button
        className="btn btn-primary"
        onClick={onOpenSettings}
        style={{ marginTop: 4, padding: '7px 18px' }}
      >
        Set up in Settings
      </button>
    </div>
  );
}
