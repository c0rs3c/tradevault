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
  const [chartDefaultTimeframe, setChartDefaultTimeframe] = useState('1D');
  const [smaPeriods, setSmaPeriods] = useState(['10', '20', '50']);
  const [smaColors, setSmaColors] = useState(['#2563eb', '#f59e0b', '#16a34a']);
  const [smaLineWidth, setSmaLineWidth] = useState('thin');
  const [smaScaleLabelsVisible, setSmaScaleLabelsVisible] = useState(false);
  const [entryArrowColor, setEntryArrowColor] = useState('#000000');
  const [exitArrowColor, setExitArrowColor] = useState('#2563eb');
  const [entryArrowSize, setEntryArrowSize] = useState('1');
  const [exitArrowSize, setExitArrowSize] = useState('1');
  const [entryLabelColor, setEntryLabelColor] = useState('#000000');
  const [exitLabelColor, setExitLabelColor] = useState('#000000');
  const [labelFontFamily, setLabelFontFamily] = useState('Trebuchet MS, Roboto, sans-serif');
  const [labelFontSize, setLabelFontSize] = useState('12');
  const [purpleDotVisible, setPurpleDotVisible] = useState(true);
  const [purpleDotLeftPaneVisible, setPurpleDotLeftPaneVisible] = useState(true);
  const [purpleDotRightPaneVisible, setPurpleDotRightPaneVisible] = useState(true);
  const [purpleDotCombineConditions, setPurpleDotCombineConditions] = useState(true);
  const [purpleDotVolumeAbove, setPurpleDotVolumeAbove] = useState('1000000');
  const [purpleDotPercentThreshold, setPurpleDotPercentThreshold] = useState('5');
  const [purpleDotColor, setPurpleDotColor] = useState('#a855f7');
  const [purpleDotSize, setPurpleDotSize] = useState('1');
  const [purpleDotPosition, setPurpleDotPosition] = useState('belowBar');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setTotalCapital(settings.totalCapital ?? 0);
    setDefaultRiskPercent(settings.defaultRiskPercent ?? '');
    setTheme(settings.theme === 'light' ? 'light' : 'dark');
    setAccentColor(ACCENT_THEMES[settings.accentColor] ? settings.accentColor : DEFAULT_ACCENT);
    const tf = settings?.chartSettings?.defaultTimeframe;
    setChartDefaultTimeframe(['30m', '1h', '1D', '1W'].includes(tf) ? tf : '1D');
    const nextPeriods = [...(settings?.chartSettings?.smaPeriods || [10, 20, 50])].slice(0, 3);
    while (nextPeriods.length < 3) nextPeriods.push([10, 20, 50][nextPeriods.length]);
    setSmaPeriods(nextPeriods.map((v) => String(v)));
    const nextColors = [...(settings?.chartSettings?.smaColors || ['#2563eb', '#f59e0b', '#16a34a'])].slice(0, 3);
    while (nextColors.length < 3) nextColors.push(['#2563eb', '#f59e0b', '#16a34a'][nextColors.length]);
    setSmaColors(nextColors);
    const width = settings?.chartSettings?.smaLineWidth;
    setSmaLineWidth(['thin', 'medium', 'thick'].includes(width) ? width : 'thin');
    setSmaScaleLabelsVisible(Boolean(settings?.chartSettings?.smaScaleLabelsVisible));
    const marker = settings?.chartSettings?.markerSettings || {};
    setEntryArrowColor(marker.entryArrowColor || '#000000');
    setExitArrowColor(marker.exitArrowColor || '#2563eb');
    setEntryArrowSize(String(marker.entryArrowSize ?? 1));
    setExitArrowSize(String(marker.exitArrowSize ?? 1));
    setEntryLabelColor(marker.entryLabelColor || '#000000');
    setExitLabelColor(marker.exitLabelColor || '#000000');
    setLabelFontFamily(marker.labelFontFamily || 'Trebuchet MS, Roboto, sans-serif');
    setLabelFontSize(String(marker.labelFontSize ?? 12));
    const purpleDot = settings?.chartSettings?.purpleDotVolumeSettings || {};
    setPurpleDotVisible(purpleDot.visible ?? true);
    setPurpleDotLeftPaneVisible(purpleDot.leftPaneVisible ?? true);
    setPurpleDotRightPaneVisible(purpleDot.rightPaneVisible ?? true);
    setPurpleDotCombineConditions(purpleDot.combineConditions ?? true);
    setPurpleDotVolumeAbove(String(purpleDot.volumeAbove ?? 1000000));
    setPurpleDotPercentThreshold(String(purpleDot.percentThreshold ?? 5));
    setPurpleDotColor(purpleDot.color || '#a855f7');
    setPurpleDotSize(String(purpleDot.size ?? 1));
    setPurpleDotPosition(purpleDot.position === 'aboveBar' ? 'aboveBar' : 'belowBar');
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
        accentColor,
        chartSettings: {
          defaultTimeframe: chartDefaultTimeframe,
          smaPeriods: smaPeriods.map((value, index) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed <= 0) return [10, 20, 50][index];
            return Math.round(parsed);
          }),
          smaColors,
          smaLineWidth,
          smaScaleLabelsVisible,
          markerSettings: {
            entryArrowColor,
            exitArrowColor,
            entryArrowSize: Number(entryArrowSize) || 1,
            exitArrowSize: Number(exitArrowSize) || 1,
            entryLabelColor,
            exitLabelColor,
            labelFontFamily,
            labelFontSize: Number(labelFontSize) || 12
          },
          purpleDotVolumeSettings: {
            visible: purpleDotVisible,
            leftPaneVisible: purpleDotLeftPaneVisible,
            rightPaneVisible: purpleDotRightPaneVisible,
            combineConditions: purpleDotCombineConditions,
            volumeAbove: Math.max(0, Number(purpleDotVolumeAbove) || 0),
            percentThreshold: Math.max(0, Number(purpleDotPercentThreshold) || 0),
            color: purpleDotColor,
            size: Number(purpleDotSize) || 1,
            position: purpleDotPosition === 'aboveBar' ? 'aboveBar' : 'belowBar'
          }
        }
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

        <section className="space-y-2 pt-1" aria-labelledby="tradingview-settings-heading">
          <div className="h-px w-full bg-slate-200 dark:bg-slate-700" />
          <h2
            id="tradingview-settings-heading"
            className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300"
          >
            TradingView Related Settings
          </h2>
        </section>

        <fieldset className="space-y-2 rounded border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-sm font-medium">Trade Chart</legend>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Default Timeframe</span>
            <select
              className="field-input"
              value={chartDefaultTimeframe}
              onChange={(e) => setChartDefaultTimeframe(e.target.value)}
            >
              <option value="30m">30m</option>
              <option value="1h">1h</option>
              <option value="1D">Daily</option>
              <option value="1W">Weekly</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">SMA Thickness</span>
            <select
              className="field-input"
              value={smaLineWidth}
              onChange={(e) => setSmaLineWidth(e.target.value)}
            >
              <option value="thin">Thin</option>
              <option value="medium">Medium</option>
              <option value="thick">Thick</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={smaScaleLabelsVisible}
              onChange={(e) => setSmaScaleLabelsVisible(e.target.checked)}
            />
            <span className="text-sm font-medium">Show SMA Labels On Scale</span>
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="space-y-1">
                <span className="text-sm font-medium">SMA {index + 1}</span>
                <input
                  type="number"
                  min="1"
                  className="field-input"
                  value={smaPeriods[index] || ''}
                  onChange={(e) =>
                    setSmaPeriods((prev) => prev.map((item, i) => (i === index ? e.target.value : item)))
                  }
                />
                <input
                  type="color"
                  className="h-10 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                  value={smaColors[index] || '#000000'}
                  onChange={(e) =>
                    setSmaColors((prev) => prev.map((item, i) => (i === index ? e.target.value : item)))
                  }
                />
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Entry Arrow Color</span>
              <input
                type="color"
                className="h-10 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                value={entryArrowColor}
                onChange={(e) => setEntryArrowColor(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Exit Arrow Color</span>
              <input
                type="color"
                className="h-10 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                value={exitArrowColor}
                onChange={(e) => setExitArrowColor(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Entry Arrow Size</span>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="3"
                className="field-input"
                value={entryArrowSize}
                onChange={(e) => setEntryArrowSize(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Exit Arrow Size</span>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="3"
                className="field-input"
                value={exitArrowSize}
                onChange={(e) => setExitArrowSize(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Entry Label Color</span>
              <input
                type="color"
                className="h-10 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                value={entryLabelColor}
                onChange={(e) => setEntryLabelColor(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Exit Label Color</span>
              <input
                type="color"
                className="h-10 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                value={exitLabelColor}
                onChange={(e) => setExitLabelColor(e.target.value)}
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-sm font-medium">Label Font</span>
              <select
                className="field-input"
                value={labelFontFamily}
                onChange={(e) => setLabelFontFamily(e.target.value)}
              >
                <option value="Trebuchet MS, Roboto, sans-serif">Trebuchet</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="Courier New, monospace">Courier New</option>
                <option value="Verdana, sans-serif">Verdana</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Label Font Size</span>
              <input
                type="number"
                min="10"
                max="24"
                className="field-input"
                value={labelFontSize}
                onChange={(e) => setLabelFontSize(e.target.value)}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-2 rounded border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-sm font-medium">Purple Dot Volume Indicator</legend>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={purpleDotVisible}
              onChange={(e) => setPurpleDotVisible(e.target.checked)}
            />
            <span className="text-sm font-medium">Show indicator (Single Pane)</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={purpleDotLeftPaneVisible}
              onChange={(e) => setPurpleDotLeftPaneVisible(e.target.checked)}
            />
            <span className="text-sm font-medium">Show in Left Pane</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={purpleDotRightPaneVisible}
              onChange={(e) => setPurpleDotRightPaneVisible(e.target.checked)}
            />
            <span className="text-sm font-medium">Show in Right Pane</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={purpleDotCombineConditions}
              onChange={(e) => setPurpleDotCombineConditions(e.target.checked)}
            />
            <span className="text-sm font-medium">Combine conditions</span>
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Volume Above</span>
              <input
                type="number"
                min="0"
                step="1"
                className="field-input"
                value={purpleDotVolumeAbove}
                onChange={(e) => setPurpleDotVolumeAbove(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">% Threshold</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className="field-input"
                value={purpleDotPercentThreshold}
                onChange={(e) => setPurpleDotPercentThreshold(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Dot Color</span>
              <input
                type="color"
                className="h-10 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                value={purpleDotColor}
                onChange={(e) => setPurpleDotColor(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Dot Size</span>
              <input
                type="number"
                min="0.5"
                max="3"
                step="0.1"
                className="field-input"
                value={purpleDotSize}
                onChange={(e) => setPurpleDotSize(e.target.value)}
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-sm font-medium">Dot Position</span>
              <select
                className="field-input"
                value={purpleDotPosition}
                onChange={(e) => setPurpleDotPosition(e.target.value)}
              >
                <option value="belowBar">Below Bar</option>
                <option value="aboveBar">Above Bar</option>
              </select>
            </label>
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
