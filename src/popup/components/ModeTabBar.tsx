interface ModeTabBarProps {
  mode: 'secrets' | 'passwords';
  onSelect: (m: 'secrets' | 'passwords') => void;
}

export function ModeTabBar({ mode, onSelect }: ModeTabBarProps) {
  return (
    <div className="tabs" role="tablist">
      {(['secrets', 'passwords'] as const).map((m) => (
        <button
          key={m}
          className={`tab-btn${mode === m ? ' active' : ''}`}
          style={{ flex: 1 }}
          onClick={() => onSelect(m)}
          aria-selected={mode === m}
          role="tab"
        >
          {m === 'secrets' ? 'Secrets' : 'Passwords'}
        </button>
      ))}
    </div>
  );
}
