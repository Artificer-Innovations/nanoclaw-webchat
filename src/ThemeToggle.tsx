import { useState, type CSSProperties } from 'react';
import { applyTheme, getStoredTheme, setStoredTheme, type ThemePreference } from './theme';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
];

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="12" y1="2" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
        <line x1="4.22" y1="4.22" x2="6.34" y2="6.34" />
        <line x1="17.66" y1="17.66" x2="19.78" y2="19.78" />
        <line x1="4.22" y1="19.78" x2="6.34" y2="17.66" />
        <line x1="17.66" y1="6.34" x2="19.78" y2="4.22" />
      </g>
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 20h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 16v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        fill="currentColor"
      />
    </svg>
  );
}

const ICONS: Record<ThemePreference, () => React.ReactNode> = {
  light: SunIcon,
  system: MonitorIcon,
  dark: MoonIcon,
};

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(getStoredTheme);
  const activeIndex = OPTIONS.findIndex((option) => option.value === preference);

  const handleChange = (next: ThemePreference) => {
    setPreference(next);
    setStoredTheme(next);
    applyTheme(next);
  };

  return (
    <div className="sidebar-footer">
      <div
        className="theme-toggle"
        role="radiogroup"
        aria-label="Theme"
        style={{ '--active-index': activeIndex } as CSSProperties}
      >
        <span className="theme-toggle-thumb" aria-hidden="true" />
        {OPTIONS.map((option) => {
          const Icon = ICONS[option.value];
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-label={option.label}
              aria-checked={preference === option.value}
              className={preference === option.value ? 'active' : ''}
              onClick={() => handleChange(option.value)}
            >
              <Icon />
            </button>
          );
        })}
      </div>
    </div>
  );
}
