export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'webchat_theme';

export function getStoredTheme(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

export function setStoredTheme(pref: ThemePreference): void {
  localStorage.setItem(THEME_STORAGE_KEY, pref);
}

export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === 'system') {
    delete root.dataset.theme;
    return;
  }
  root.dataset.theme = pref;
}
