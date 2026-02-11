import { useEffect, useState } from 'react';
import { saveSettings } from '../api/settings';
import { useSettings } from '../contexts/SettingsContext';
import { ACCENT_THEMES, DEFAULT_ACCENT } from '../utils/appearance';

const SettingsPage = () => {
  const { settings, refreshSettings, loading } = useSettings();
  const [totalCapital, setTotalCapital] = useState('');
  const [defaultRiskPercent, setDefaultRiskPercent] = useState('');
  const [theme, setTheme] = useState('dark');
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setTotalCapital(settings.totalCapital ?? 0);
    setDefaultRiskPercent(settings.defaultRiskPercent ?? '');
    setTheme(settings.theme === 'light' ? 'light' : 'dark');
    setAccentColor(ACCENT_THEMES[settings.accentColor] ? settings.accentColor : DEFAULT_ACCENT);
  }, [settings]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (Number(totalCapital) < 0) return alert('Total capital cannot be negative');

    setSaving(true);
    try {
      await saveSettings({
        totalCapital: Number(totalCapital),
        defaultRiskPercent: defaultRiskPercent === '' ? null : Number(defaultRiskPercent),
        theme,
        accentColor
      });
      await refreshSettings();
      alert('Settings saved');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p>Loading settings...</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <form onSubmit={handleSubmit} className="surface-card max-w-xl space-y-4 p-5">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Total Capital</span>
          <input
            type="number"
            step="0.01"
            className="field-input"
            value={totalCapital}
            onChange={(e) => setTotalCapital(e.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Default Risk % (optional)</span>
          <input
            type="number"
            step="0.01"
            className="field-input"
            value={defaultRiskPercent}
            onChange={(e) => setDefaultRiskPercent(e.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Theme</span>
          <select className="field-input" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Accent Color</legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(ACCENT_THEMES).map(([key, palette]) => {
              const selected = key === accentColor;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAccentColor(key)}
                  className={`group flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                    selected
                      ? 'border-slate-500 bg-slate-100 text-slate-900 dark:border-slate-400 dark:bg-slate-800 dark:text-slate-100'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <span
                    className="h-4 w-4 rounded-full border border-black/10"
                    style={{ backgroundColor: palette.primary }}
                    aria-hidden="true"
                  />
                  {palette.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={saving}
          className="btn-primary px-4 py-2"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
};

export default SettingsPage;
