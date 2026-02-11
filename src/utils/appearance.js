export const THEME_STORAGE_KEY = 'trade-journal-theme';
export const ACCENT_STORAGE_KEY = 'trade-journal-accent';

export const ACCENT_THEMES = {
  emerald: {
    label: 'Emerald',
    primary: '#245b4a',
    hover: '#1f4f41',
    soft: '#e2ebe4',
    softDark: 'rgba(36, 91, 74, 0.24)',
    text: '#193f33',
    textDark: '#d1fae5',
    border: 'rgba(36, 91, 74, 0.45)',
    borderDark: 'rgba(36, 91, 74, 0.65)',
    focus: 'rgba(36, 91, 74, 0.35)'
  },
  sky: {
    label: 'Sky',
    primary: '#0369a1',
    hover: '#075985',
    soft: '#e0f2fe',
    softDark: 'rgba(3, 105, 161, 0.24)',
    text: '#0c4a6e',
    textDark: '#bae6fd',
    border: 'rgba(3, 105, 161, 0.45)',
    borderDark: 'rgba(3, 105, 161, 0.65)',
    focus: 'rgba(3, 105, 161, 0.35)'
  },
  rose: {
    label: 'Rose',
    primary: '#be123c',
    hover: '#9f1239',
    soft: '#ffe4e6',
    softDark: 'rgba(190, 18, 60, 0.24)',
    text: '#881337',
    textDark: '#fecdd3',
    border: 'rgba(190, 18, 60, 0.45)',
    borderDark: 'rgba(190, 18, 60, 0.65)',
    focus: 'rgba(190, 18, 60, 0.35)'
  },
  amber: {
    label: 'Amber',
    primary: '#b45309',
    hover: '#92400e',
    soft: '#fef3c7',
    softDark: 'rgba(180, 83, 9, 0.24)',
    text: '#78350f',
    textDark: '#fde68a',
    border: 'rgba(180, 83, 9, 0.45)',
    borderDark: 'rgba(180, 83, 9, 0.65)',
    focus: 'rgba(180, 83, 9, 0.35)'
  },
  violet: {
    label: 'Violet',
    primary: '#7c3aed',
    hover: '#6d28d9',
    soft: '#ede9fe',
    softDark: 'rgba(124, 58, 237, 0.24)',
    text: '#5b21b6',
    textDark: '#ddd6fe',
    border: 'rgba(124, 58, 237, 0.45)',
    borderDark: 'rgba(124, 58, 237, 0.65)',
    focus: 'rgba(124, 58, 237, 0.35)'
  }
};

export const DEFAULT_THEME = 'dark';
export const DEFAULT_ACCENT = 'emerald';

export const isValidTheme = (theme) => theme === 'light' || theme === 'dark';
export const isValidAccent = (accent) => Object.prototype.hasOwnProperty.call(ACCENT_THEMES, accent);

export const resolveInitialTheme = () => {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isValidTheme(storedTheme) ? storedTheme : DEFAULT_THEME;
};

export const resolveInitialAccent = () => {
  if (typeof window === 'undefined') return DEFAULT_ACCENT;
  const storedAccent = window.localStorage.getItem(ACCENT_STORAGE_KEY);
  return isValidAccent(storedAccent) ? storedAccent : DEFAULT_ACCENT;
};

export const applyTheme = (theme) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
};

export const applyAccentColor = (accent) => {
  if (typeof document === 'undefined') return;
  const key = isValidAccent(accent) ? accent : DEFAULT_ACCENT;
  const palette = ACCENT_THEMES[key];
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', palette.primary);
  root.style.setProperty('--brand-hover', palette.hover);
  root.style.setProperty('--brand-soft', palette.soft);
  root.style.setProperty('--brand-soft-dark', palette.softDark);
  root.style.setProperty('--brand-text', palette.text);
  root.style.setProperty('--brand-text-dark', palette.textDark);
  root.style.setProperty('--brand-border', palette.border);
  root.style.setProperty('--brand-border-dark', palette.borderDark);
  root.style.setProperty('--brand-focus', palette.focus);
};
