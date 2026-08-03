interface ModeTabBarProps {
  mode: 'secrets' | 'passwords';
  onSelect: (m: 'secrets' | 'passwords') => void;
}

export function ModeTabBar({ mode, onSelect }: ModeTabBarProps) {
  return (
    <div style={{
      display: 'flex',
      borderBottom: 'var(--border)',
      background: 'var(--color-surface)',
      flexShrink: 0,
    }}>
      {(['secrets', 'passwords'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onSelect(m)}
          style={{
            flex: 1,
            padding: '7px 0',
            fontSize: 12,
            fontWeight: mode === m ? 600 : 400,
            color: mode === m ? 'var(--color-accent)' : 'var(--color-muted)',
            background: 'none',
            border: 'none',
            borderBottom: mode === m ? '2px solid var(--color-accent)' : '2px solid transparent',
            cursor: 'pointer',
            transition: 'color 0.15s, border-color 0.15s',
            textTransform: 'capitalize',
            letterSpacing: '0.02em',
          }}
          aria-selected={mode === m}
          role="tab"
        >
          {m === 'secrets' ? 'Secrets' : 'Passwords'}
        </button>
      ))}
    </div>
  );
}
