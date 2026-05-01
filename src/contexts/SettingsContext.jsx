import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { fetchSettings, saveSettings } from '../api/settings';
import {
  ACCENT_STORAGE_KEY,
  ACCENT_THEMES,
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  applyAccentColor,
  applyTheme,
  isValidAccent,
  isValidTheme,
  resolveInitialAccent,
  resolveInitialTheme
} from '../utils/appearance';

const SettingsContext = createContext(null);

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(null);
  const [theme, setThemeState] = useState(resolveInitialTheme);
  const [accentColor, setAccentColorState] = useState(resolveInitialAccent);
  const [loading, setLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    try {
      const data = await fetchSettings();
      setSettings(data);
      const nextTheme = isValidTheme(data?.theme) ? data.theme : DEFAULT_THEME;
      const nextAccent = isValidAccent(data?.accentColor) ? data.accentColor : DEFAULT_ACCENT;
      setThemeState(nextTheme);
      setAccentColorState(nextAccent);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        window.localStorage.setItem(ACCENT_STORAGE_KEY, nextAccent);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyAccentColor(accentColor);
  }, [accentColor]);

  const setTheme = useCallback(async (nextTheme) => {
    if (!isValidTheme(nextTheme)) return;
    setThemeState(nextTheme);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    }
    try {
      const updated = await saveSettings({ theme: nextTheme });
      setSettings(updated);
    } catch (error) {
      const fallbackTheme = isValidTheme(settings?.theme) ? settings.theme : DEFAULT_THEME;
      setThemeState(fallbackTheme);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(THEME_STORAGE_KEY, fallbackTheme);
      }
      throw error;
    }
  }, [settings]);

  const setAccentColor = useCallback(async (nextAccent) => {
    if (!isValidAccent(nextAccent)) return;
    setAccentColorState(nextAccent);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, nextAccent);
    }
    try {
      const updated = await saveSettings({ accentColor: nextAccent });
      setSettings(updated);
    } catch (error) {
      const fallbackAccent = isValidAccent(settings?.accentColor) ? settings.accentColor : DEFAULT_ACCENT;
      setAccentColorState(fallbackAccent);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ACCENT_STORAGE_KEY, fallbackAccent);
      }
      throw error;
    }
  }, [settings]);

  const value = useMemo(
    () => ({
      settings,
      setSettings,
      theme,
      setTheme,
      accentColor,
      setAccentColor,
      accentOptions: ACCENT_THEMES,
      loading,
      refreshSettings: loadSettings
    }),
    [settings, theme, setTheme, accentColor, setAccentColor, loading, loadSettings]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

SettingsProvider.propTypes = {
  children: PropTypes.node.isRequired
};

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
};
