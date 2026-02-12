import Settings from '../models/Settings';
import { clearTradeReadCaches } from './trades';

const DEFAULT_CHART_SETTINGS = {
  defaultTimeframe: '1D',
  smaPeriods: [10, 20, 50],
  smaColors: ['#2563eb', '#f59e0b', '#16a34a'],
  smaLineWidth: 'thin',
  markerSettings: {
    entryArrowColor: '#000000',
    exitArrowColor: '#2563eb',
    entryArrowSize: 1,
    exitArrowSize: 1,
    entryLabelColor: '#000000',
    exitLabelColor: '#000000',
    labelFontFamily: 'Trebuchet MS, Roboto, sans-serif',
    labelFontSize: 12
  }
};

const normalizeChartSettings = (raw = {}) => {
  const allowedTimeframes = new Set(['30m', '1h', '1D', '1W']);
  const defaultTimeframe = allowedTimeframes.has(raw.defaultTimeframe)
    ? raw.defaultTimeframe
    : DEFAULT_CHART_SETTINGS.defaultTimeframe;

  const sourcePeriods = Array.isArray(raw.smaPeriods) ? raw.smaPeriods : DEFAULT_CHART_SETTINGS.smaPeriods;
  const smaPeriods = sourcePeriods
    .slice(0, 3)
    .map((value, index) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CHART_SETTINGS.smaPeriods[index];
      return Math.round(parsed);
    });
  while (smaPeriods.length < 3) {
    smaPeriods.push(DEFAULT_CHART_SETTINGS.smaPeriods[smaPeriods.length]);
  }

  const sourceColors = Array.isArray(raw.smaColors) ? raw.smaColors : DEFAULT_CHART_SETTINGS.smaColors;
  const hexColor = /^#([0-9a-fA-F]{6})$/;
  const smaColors = sourceColors
    .slice(0, 3)
    .map((value, index) => (hexColor.test(String(value || '')) ? String(value) : DEFAULT_CHART_SETTINGS.smaColors[index]));
  while (smaColors.length < 3) {
    smaColors.push(DEFAULT_CHART_SETTINGS.smaColors[smaColors.length]);
  }
  const allowedWidths = new Set(['thin', 'medium', 'thick']);
  const smaLineWidth = allowedWidths.has(raw.smaLineWidth)
    ? raw.smaLineWidth
    : DEFAULT_CHART_SETTINGS.smaLineWidth;
  const markerRaw = raw.markerSettings || {};
  const validColor = (value, fallback) =>
    /^#([0-9a-fA-F]{6})$/.test(String(value || '')) ? String(value) : fallback;
  const clamp = (value, min, max, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, num));
  };
  const allowedFonts = [
    'Trebuchet MS, Roboto, sans-serif',
    'Arial, sans-serif',
    'Georgia, serif',
    'Courier New, monospace',
    'Verdana, sans-serif'
  ];
  const markerSettings = {
    entryArrowColor: validColor(markerRaw.entryArrowColor, DEFAULT_CHART_SETTINGS.markerSettings.entryArrowColor),
    exitArrowColor: validColor(markerRaw.exitArrowColor, DEFAULT_CHART_SETTINGS.markerSettings.exitArrowColor),
    entryArrowSize: clamp(markerRaw.entryArrowSize, 0.5, 3, DEFAULT_CHART_SETTINGS.markerSettings.entryArrowSize),
    exitArrowSize: clamp(markerRaw.exitArrowSize, 0.5, 3, DEFAULT_CHART_SETTINGS.markerSettings.exitArrowSize),
    entryLabelColor: validColor(markerRaw.entryLabelColor, DEFAULT_CHART_SETTINGS.markerSettings.entryLabelColor),
    exitLabelColor: validColor(markerRaw.exitLabelColor, DEFAULT_CHART_SETTINGS.markerSettings.exitLabelColor),
    labelFontFamily: allowedFonts.includes(markerRaw.labelFontFamily)
      ? markerRaw.labelFontFamily
      : DEFAULT_CHART_SETTINGS.markerSettings.labelFontFamily,
    labelFontSize: Math.round(
      clamp(markerRaw.labelFontSize, 10, 24, DEFAULT_CHART_SETTINGS.markerSettings.labelFontSize)
    )
  };

  return {
    defaultTimeframe,
    smaPeriods,
    smaColors,
    smaLineWidth,
    markerSettings
  };
};

const getOrCreateSettings = async () => {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({
      totalCapital: 0,
      theme: 'dark',
      accentColor: 'emerald',
      chartSettings: DEFAULT_CHART_SETTINGS
    });
    return settings;
  }
  let updated = false;
  if (!settings.theme) {
    settings.theme = 'dark';
    updated = true;
  }
  if (!settings.accentColor) {
    settings.accentColor = 'emerald';
    updated = true;
  }
  const normalizedChart = normalizeChartSettings(settings.chartSettings || {});
  if (
    !settings.chartSettings ||
    settings.chartSettings.defaultTimeframe !== normalizedChart.defaultTimeframe ||
    JSON.stringify(settings.chartSettings.smaPeriods || []) !== JSON.stringify(normalizedChart.smaPeriods) ||
    JSON.stringify(settings.chartSettings.smaColors || []) !== JSON.stringify(normalizedChart.smaColors) ||
    settings.chartSettings.smaLineWidth !== normalizedChart.smaLineWidth ||
    JSON.stringify(settings.chartSettings.markerSettings || {}) !== JSON.stringify(normalizedChart.markerSettings)
  ) {
    settings.chartSettings = normalizedChart;
    updated = true;
  }
  if (updated) await settings.save();
  return settings;
};

export const getSettings = async () => {
  return getOrCreateSettings();
};

export const updateSettings = async (payload) => {
  const settings = await getOrCreateSettings();
  const { totalCapital, defaultRiskPercent, theme, accentColor, chartSettings } = payload;

  if (totalCapital !== undefined) settings.totalCapital = totalCapital;
  if (defaultRiskPercent !== undefined) settings.defaultRiskPercent = defaultRiskPercent;
  if (theme !== undefined) settings.theme = theme;
  if (accentColor !== undefined) settings.accentColor = accentColor;
  if (chartSettings !== undefined) {
    const mergedChart = normalizeChartSettings({
      ...settings.chartSettings?.toObject?.(),
      ...chartSettings
    });
    settings.chartSettings = mergedChart;
  }

  await settings.save();
  clearTradeReadCaches();
  return settings;
};
