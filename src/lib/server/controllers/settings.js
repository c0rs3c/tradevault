import Settings from '../models/Settings';
import { clearTradeReadCaches } from './trades';

const DEFAULT_CHART_SETTINGS = {
  defaultTimeframe: '1D',
  smaPeriods: [10, 20, 50],
  smaColors: ['#2563eb', '#f59e0b', '#16a34a'],
  smaLineWidth: 'thin',
  smaScaleLabelsVisible: false,
  markerSettings: {
    entryArrowColor: '#000000',
    exitArrowColor: '#2563eb',
    entryArrowSize: 1,
    exitArrowSize: 1,
    entryLabelColor: '#000000',
    exitLabelColor: '#000000',
    labelFontFamily: 'Trebuchet MS, Roboto, sans-serif',
    labelFontSize: 12
  },
  purpleDotVolumeSettings: {
    visible: true,
    leftPaneVisible: true,
    rightPaneVisible: true,
    combineConditions: true,
    volumeAbove: 1000000,
    percentThreshold: 5,
    color: '#a855f7',
    size: 1,
    position: 'belowBar'
  }
};

const DEFAULT_DEEP_DIVE_EARNINGS_SETTINGS = {
  thresholds: {
    sales: { lower: null, upper: null },
    netProfit: { lower: null, upper: null },
    earnings: { lower: null, upper: null },
    opmPercent: { lower: null, upper: null },
    promoters: { lower: null, upper: null },
    fiis: { lower: null, upper: null },
    diis: { lower: null, upper: null }
  }
};

const DEFAULT_DASHBOARD_CARDS = {
  totalRealizedPnl: true,
  monthlyPnl: true,
  totalCapitalAtRisk: true,
  totalPositionSize: true,
  totalUnrealizedPnl: true,
  avgR: false,
  avgHoldingDays: true,
  winRate: true,
  avgWinnerLoser: true,
  profitFactor: false,
  maxDrawdown: false,
  tradesOpenCount: true
};

const normalizeDashboardCards = (raw = {}) => {
  const normalized = {};
  Object.entries(DEFAULT_DASHBOARD_CARDS).forEach(([key, fallback]) => {
    normalized[key] = typeof raw[key] === 'boolean' ? raw[key] : fallback;
  });
  return normalized;
};

const normalizeDashboardExcludedOpenPositions = (raw = []) => {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((value) => String(value || '').trim()).filter(Boolean))];
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
  const smaScaleLabelsVisible =
    typeof raw.smaScaleLabelsVisible === 'boolean'
      ? raw.smaScaleLabelsVisible
      : DEFAULT_CHART_SETTINGS.smaScaleLabelsVisible;
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
  const dotRaw = raw.purpleDotVolumeSettings || {};
  const purpleDotVolumeSettings = {
    visible:
      typeof dotRaw.visible === 'boolean'
        ? dotRaw.visible
        : DEFAULT_CHART_SETTINGS.purpleDotVolumeSettings.visible,
    leftPaneVisible:
      typeof dotRaw.leftPaneVisible === 'boolean'
        ? dotRaw.leftPaneVisible
        : DEFAULT_CHART_SETTINGS.purpleDotVolumeSettings.leftPaneVisible,
    rightPaneVisible:
      typeof dotRaw.rightPaneVisible === 'boolean'
        ? dotRaw.rightPaneVisible
        : DEFAULT_CHART_SETTINGS.purpleDotVolumeSettings.rightPaneVisible,
    combineConditions:
      typeof dotRaw.combineConditions === 'boolean'
        ? dotRaw.combineConditions
        : DEFAULT_CHART_SETTINGS.purpleDotVolumeSettings.combineConditions,
    volumeAbove: clamp(dotRaw.volumeAbove, 0, 1_000_000_000_000, DEFAULT_CHART_SETTINGS.purpleDotVolumeSettings.volumeAbove),
    percentThreshold: clamp(
      dotRaw.percentThreshold,
      0,
      10_000,
      DEFAULT_CHART_SETTINGS.purpleDotVolumeSettings.percentThreshold
    ),
    color: validColor(dotRaw.color, DEFAULT_CHART_SETTINGS.purpleDotVolumeSettings.color),
    size: clamp(dotRaw.size, 0.5, 3, DEFAULT_CHART_SETTINGS.purpleDotVolumeSettings.size),
    position:
      dotRaw.position === 'aboveBar' || dotRaw.position === 'belowBar'
        ? dotRaw.position
        : DEFAULT_CHART_SETTINGS.purpleDotVolumeSettings.position
  };

  return {
    defaultTimeframe,
    smaPeriods,
    smaColors,
    smaLineWidth,
    smaScaleLabelsVisible,
    markerSettings,
    purpleDotVolumeSettings
  };
};

const normalizeThresholdPair = (raw = {}, fallback = { lower: null, upper: null }) => {
  const normalizeNumber = (value, fallbackValue) => {
    if (value === '' || value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : fallbackValue;
  };
  return {
    lower: normalizeNumber(raw.lower, fallback.lower),
    upper: normalizeNumber(raw.upper, fallback.upper)
  };
};

const normalizeDeepDiveEarningsSettings = (raw = {}) => {
  const source = raw.thresholds || {};
  return {
    thresholds: {
      sales: normalizeThresholdPair(source.sales, DEFAULT_DEEP_DIVE_EARNINGS_SETTINGS.thresholds.sales),
      netProfit: normalizeThresholdPair(source.netProfit, DEFAULT_DEEP_DIVE_EARNINGS_SETTINGS.thresholds.netProfit),
      earnings: normalizeThresholdPair(source.earnings, DEFAULT_DEEP_DIVE_EARNINGS_SETTINGS.thresholds.earnings),
      opmPercent: normalizeThresholdPair(source.opmPercent, DEFAULT_DEEP_DIVE_EARNINGS_SETTINGS.thresholds.opmPercent),
      promoters: normalizeThresholdPair(source.promoters, DEFAULT_DEEP_DIVE_EARNINGS_SETTINGS.thresholds.promoters),
      fiis: normalizeThresholdPair(source.fiis, DEFAULT_DEEP_DIVE_EARNINGS_SETTINGS.thresholds.fiis),
      diis: normalizeThresholdPair(source.diis, DEFAULT_DEEP_DIVE_EARNINGS_SETTINGS.thresholds.diis)
    }
  };
};

const getOrCreateSettings = async () => {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({
      totalCapital: 0,
      theme: 'light',
      accentColor: 'emerald',
      dashboardCards: DEFAULT_DASHBOARD_CARDS,
      dashboardExcludedOpenPositions: [],
      chartSettings: DEFAULT_CHART_SETTINGS
      ,
      deepDiveEarningsSettings: DEFAULT_DEEP_DIVE_EARNINGS_SETTINGS
    });
    return settings;
  }
  let updated = false;
  if (!settings.theme) {
    settings.theme = 'light';
    updated = true;
  }
  if (!settings.accentColor) {
    settings.accentColor = 'emerald';
    updated = true;
  }
  const normalizedDashboardCards = normalizeDashboardCards(settings.dashboardCards || {});
  if (
    !settings.dashboardCards ||
    JSON.stringify(settings.dashboardCards || {}) !== JSON.stringify(normalizedDashboardCards)
  ) {
    settings.dashboardCards = normalizedDashboardCards;
    updated = true;
  }
  const normalizedDashboardExcludedOpenPositions = normalizeDashboardExcludedOpenPositions(
    settings.dashboardExcludedOpenPositions || []
  );
  if (
    JSON.stringify(settings.dashboardExcludedOpenPositions || []) !==
    JSON.stringify(normalizedDashboardExcludedOpenPositions)
  ) {
    settings.dashboardExcludedOpenPositions = normalizedDashboardExcludedOpenPositions;
    updated = true;
  }
  const normalizedChart = normalizeChartSettings(settings.chartSettings || {});
  if (
    !settings.chartSettings ||
    settings.chartSettings.defaultTimeframe !== normalizedChart.defaultTimeframe ||
    JSON.stringify(settings.chartSettings.smaPeriods || []) !== JSON.stringify(normalizedChart.smaPeriods) ||
    JSON.stringify(settings.chartSettings.smaColors || []) !== JSON.stringify(normalizedChart.smaColors) ||
    settings.chartSettings.smaLineWidth !== normalizedChart.smaLineWidth ||
    settings.chartSettings.smaScaleLabelsVisible !== normalizedChart.smaScaleLabelsVisible ||
    JSON.stringify(settings.chartSettings.markerSettings || {}) !== JSON.stringify(normalizedChart.markerSettings) ||
    JSON.stringify(settings.chartSettings.purpleDotVolumeSettings || {}) !==
      JSON.stringify(normalizedChart.purpleDotVolumeSettings)
  ) {
    settings.chartSettings = normalizedChart;
    updated = true;
  }
  const normalizedDeepDiveEarningsSettings = normalizeDeepDiveEarningsSettings(
    settings.deepDiveEarningsSettings || {}
  );
  if (
    !settings.deepDiveEarningsSettings ||
    JSON.stringify(settings.deepDiveEarningsSettings || {}) !==
      JSON.stringify(normalizedDeepDiveEarningsSettings)
  ) {
    settings.deepDiveEarningsSettings = normalizedDeepDiveEarningsSettings;
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
  const {
    totalCapital,
    defaultRiskPercent,
    theme,
    accentColor,
    dashboardCards,
    dashboardExcludedOpenPositions,
    chartSettings,
    deepDiveEarningsSettings
  } = payload;

  if (totalCapital !== undefined) settings.totalCapital = totalCapital;
  if (defaultRiskPercent !== undefined) settings.defaultRiskPercent = defaultRiskPercent;
  if (theme !== undefined) settings.theme = theme;
  if (accentColor !== undefined) settings.accentColor = accentColor;
  if (dashboardCards !== undefined) {
    settings.dashboardCards = normalizeDashboardCards({
      ...settings.dashboardCards?.toObject?.(),
      ...dashboardCards
    });
  }
  if (dashboardExcludedOpenPositions !== undefined) {
    settings.dashboardExcludedOpenPositions = normalizeDashboardExcludedOpenPositions(
      dashboardExcludedOpenPositions
    );
  }
  if (chartSettings !== undefined) {
    const mergedChart = normalizeChartSettings({
      ...settings.chartSettings?.toObject?.(),
      ...chartSettings
    });
    settings.chartSettings = mergedChart;
  }
  if (deepDiveEarningsSettings !== undefined) {
    const mergedDeepDiveEarningsSettings = normalizeDeepDiveEarningsSettings({
      ...settings.deepDiveEarningsSettings?.toObject?.(),
      ...deepDiveEarningsSettings,
      thresholds: {
        ...(settings.deepDiveEarningsSettings?.toObject?.().thresholds || {}),
        ...(deepDiveEarningsSettings?.thresholds || {})
      }
    });
    settings.deepDiveEarningsSettings = mergedDeepDiveEarningsSettings;
  }

  await settings.save();
  clearTradeReadCaches();
  return settings;
};
