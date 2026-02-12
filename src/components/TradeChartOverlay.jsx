import { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers
} from 'lightweight-charts';
import { useSettings } from '../contexts/SettingsContext';
import { fetchMarketCandles } from '../api/trades';

const daysFromNow = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

const toUnixSeconds = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor(date.getTime() / 1000);
};

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

const TIMEFRAME_OPTIONS = [
  { value: '1W', label: 'W' },
  { value: '1D', label: 'D' }
];

const LOOKBACK_DAYS_BY_INTERVAL = {
  '30m': 20,
  '1h': 60,
  '1D': 365,
  '1W': 2000
};
const TIMEFRAME_LABELS = {
  '1D': 'D',
  '1W': 'W'
};

const buildTradeEvents = (trade) => {
  if (!trade) return [];
  const baseEntry = {
    kind: 'ENTRY',
    time: toUnixSeconds(trade.entryDate),
    price: Number(trade.entryPrice || 0),
    qty: Number(trade.entryQty || 0)
  };

  const pyramidEntries = (trade.pyramids || []).map((item) => ({
    kind: 'ENTRY',
    time: toUnixSeconds(item.entryDate || item.date),
    price: Number(item.price || 0),
    qty: Number(item.qty || 0)
  }));

  const exits = (trade.exits || []).map((item) => ({
    kind: 'EXIT',
    time: toUnixSeconds(item.exitDate),
    price: Number(item.exitPrice || 0),
    qty: Number(item.exitQty || 0)
  }));

  return [baseEntry, ...pyramidEntries, ...exits]
    .filter((event) => event.time && event.price > 0 && event.qty > 0)
    .sort((a, b) => new Date(a.time) - new Date(b.time));
};

const nearestCandleTime = (target, candleTimes) => {
  if (!target || !candleTimes.length) return null;
  if (candleTimes.includes(target)) return target;
  const targetTs = Number(target);
  if (!Number.isFinite(targetTs)) return candleTimes[0];
  return candleTimes.reduce((closest, current) => {
    const closestTs = Number(closest);
    const currentTs = Number(current);
    return Math.abs(currentTs - targetTs) < Math.abs(closestTs - targetTs) ? current : closest;
  }, candleTimes[0]);
};

const normalizeChartSettings = (settings) => {
  const raw = settings?.chartSettings || {};
  const validTf = TIMEFRAME_OPTIONS.some((option) => option.value === raw.defaultTimeframe)
    ? raw.defaultTimeframe
    : DEFAULT_CHART_SETTINGS.defaultTimeframe;

  const sourcePeriods = Array.isArray(raw.smaPeriods) ? raw.smaPeriods : DEFAULT_CHART_SETTINGS.smaPeriods;
  const smaPeriods = sourcePeriods.slice(0, 3).map((value, index) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CHART_SETTINGS.smaPeriods[index];
    return Math.round(parsed);
  });
  while (smaPeriods.length < 3) smaPeriods.push(DEFAULT_CHART_SETTINGS.smaPeriods[smaPeriods.length]);

  const hexColor = /^#([0-9a-fA-F]{6})$/;
  const sourceColors = Array.isArray(raw.smaColors) ? raw.smaColors : DEFAULT_CHART_SETTINGS.smaColors;
  const smaColors = sourceColors
    .slice(0, 3)
    .map((value, index) => (hexColor.test(String(value || '')) ? String(value) : DEFAULT_CHART_SETTINGS.smaColors[index]));
  while (smaColors.length < 3) smaColors.push(DEFAULT_CHART_SETTINGS.smaColors[smaColors.length]);
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
  const markerSettings = {
    entryArrowColor: validColor(markerRaw.entryArrowColor, DEFAULT_CHART_SETTINGS.markerSettings.entryArrowColor),
    exitArrowColor: validColor(markerRaw.exitArrowColor, DEFAULT_CHART_SETTINGS.markerSettings.exitArrowColor),
    entryArrowSize: clamp(markerRaw.entryArrowSize, 0.5, 3, DEFAULT_CHART_SETTINGS.markerSettings.entryArrowSize),
    exitArrowSize: clamp(markerRaw.exitArrowSize, 0.5, 3, DEFAULT_CHART_SETTINGS.markerSettings.exitArrowSize),
    entryLabelColor: validColor(markerRaw.entryLabelColor, DEFAULT_CHART_SETTINGS.markerSettings.entryLabelColor),
    exitLabelColor: validColor(markerRaw.exitLabelColor, DEFAULT_CHART_SETTINGS.markerSettings.exitLabelColor),
    labelFontFamily:
      markerRaw.labelFontFamily || DEFAULT_CHART_SETTINGS.markerSettings.labelFontFamily,
    labelFontSize: Math.round(
      clamp(markerRaw.labelFontSize, 10, 24, DEFAULT_CHART_SETTINGS.markerSettings.labelFontSize)
    )
  };

  return { defaultTimeframe: validTf, smaPeriods, smaColors, smaLineWidth, markerSettings };
};

const buildSmaData = (candles, period) => {
  const window = [];
  let sum = 0;
  const output = [];
  candles.forEach((bar) => {
    const close = Number(bar.close || 0);
    window.push(close);
    sum += close;
    if (window.length > period) {
      sum -= window.shift();
    }
    if (window.length === period) {
      output.push({
        time: bar.time,
        value: Number((sum / period).toFixed(4))
      });
    }
  });
  return output;
};

const defaultPaneData = () => ({
  candles: [],
  loading: false,
  error: '',
  resolvedSymbol: ''
});

const buildFetchRange = ({ trade, tradeEvents, timeframe }) => {
  const eventTimes = tradeEvents
    .map((event) => new Date(Number(event.time) * 1000))
    .filter((d) => !Number.isNaN(d.getTime()));
  const earliest = eventTimes.length
    ? new Date(Math.min(...eventTimes.map((d) => d.getTime())))
    : new Date(trade.entryDate);
  const latest = eventTimes.length
    ? new Date(Math.max(...eventTimes.map((d) => d.getTime())))
    : daysFromNow(0);
  const from = new Date(earliest);
  const lookbackDays = LOOKBACK_DAYS_BY_INTERVAL[timeframe] || LOOKBACK_DAYS_BY_INTERVAL['1D'];
  from.setDate(from.getDate() - lookbackDays);
  const to = new Date(Math.max(latest.getTime(), Date.now()));
  to.setDate(to.getDate() + 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10)
  };
};

const TradeChartOverlay = ({ open, trade, onClose, onPrevTrade, onNextTrade }) => {
  const { theme, settings } = useSettings();
  const singleChartRef = useRef(null);
  const leftChartRef = useRef(null);
  const rightChartRef = useRef(null);
  const viewportRef = useRef({
    single: { logicalRange: null },
    left: { logicalRange: null },
    right: { logicalRange: null }
  });
  const [layoutMode, setLayoutMode] = useState('double');
  const [singleTimeframe, setSingleTimeframe] = useState('1D');
  const [leftTimeframe, setLeftTimeframe] = useState('1D');
  const [rightTimeframe, setRightTimeframe] = useState('1W');
  const [paneData, setPaneData] = useState({
    single: defaultPaneData(),
    left: defaultPaneData(),
    right: defaultPaneData()
  });
  const chartPrefs = useMemo(() => normalizeChartSettings(settings), [settings]);
  const [showEntryMarkers, setShowEntryMarkers] = useState(true);
  const [showExitMarkers, setShowExitMarkers] = useState(true);

  const tradeEvents = useMemo(() => buildTradeEvents(trade), [trade]);
  const displayResolvedSymbol =
    layoutMode === 'double'
      ? paneData.left.resolvedSymbol || paneData.right.resolvedSymbol
      : paneData.single.resolvedSymbol;
  const updatePaneData = (key, patch) => {
    setPaneData((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch }
    }));
  };

  useEffect(() => {
    if (!open) return;
    setLayoutMode('double');
    setSingleTimeframe('1D');
    setLeftTimeframe('1D');
    setRightTimeframe('1W');
    setShowEntryMarkers(true);
    setShowExitMarkers(true);
    viewportRef.current = {
      single: { logicalRange: null },
      left: { logicalRange: null },
      right: { logicalRange: null }
    };
    setPaneData({
      single: defaultPaneData(),
      left: defaultPaneData(),
      right: defaultPaneData()
    });
  }, [open, chartPrefs.defaultTimeframe, trade?._id]);

  useEffect(() => {
    if (!open) return undefined;
    const handleEsc = (event) => {
      const targetTag = event?.target?.tagName?.toLowerCase?.();
      const isTypingTarget = ['input', 'textarea', 'select'].includes(targetTag);
      if (isTypingTarget) return;
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        onPrevTrade();
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        onNextTrade();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose, onPrevTrade, onNextTrade]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !trade?.symbol || layoutMode !== 'single') return;
    const controller = new AbortController();
    const loadCandles = async () => {
      const range = buildFetchRange({ trade, tradeEvents, timeframe: singleTimeframe });
      updatePaneData('single', { loading: true, error: '' });
      try {
        const response = await fetchMarketCandles({
          symbol: trade.symbol,
          from: range.from,
          to: range.to,
          interval: singleTimeframe,
          expectedPrice: Number(trade?.entryPrice || 0) || undefined,
          signal: controller.signal
        });
        updatePaneData('single', {
          candles: response?.candles || [],
          resolvedSymbol: response?.symbol || trade.symbol,
          error: ''
        });
      } catch (err) {
        if (err?.name === 'CanceledError') return;
        updatePaneData('single', {
          error: err.response?.data?.message || 'Failed to load chart data',
          candles: []
        });
      } finally {
        updatePaneData('single', { loading: false });
      }
    };
    loadCandles();
    return () => controller.abort();
  }, [open, layoutMode, trade, tradeEvents, singleTimeframe]);

  useEffect(() => {
    if (!open || !trade?.symbol || layoutMode !== 'double') return;
    const controller = new AbortController();
    const loadCandles = async (paneKey, timeframe) => {
      const range = buildFetchRange({ trade, tradeEvents, timeframe });
      updatePaneData(paneKey, { loading: true, error: '' });
      try {
        const response = await fetchMarketCandles({
          symbol: trade.symbol,
          from: range.from,
          to: range.to,
          interval: timeframe,
          expectedPrice: Number(trade?.entryPrice || 0) || undefined,
          signal: controller.signal
        });
        updatePaneData(paneKey, {
          candles: response?.candles || [],
          resolvedSymbol: response?.symbol || trade.symbol,
          error: ''
        });
      } catch (err) {
        if (err?.name === 'CanceledError') return;
        updatePaneData(paneKey, {
          error: err.response?.data?.message || 'Failed to load chart data',
          candles: []
        });
      } finally {
        updatePaneData(paneKey, { loading: false });
      }
    };
    loadCandles('left', leftTimeframe);
    loadCandles('right', rightTimeframe);
    return () => controller.abort();
  }, [open, layoutMode, trade, tradeEvents, leftTimeframe, rightTimeframe]);

  useEffect(() => {
    if (!open) return undefined;
    const isDark = theme === 'dark';
    const widthMap = { thin: 1, medium: 2, thick: 3 };
    const getPriceFromEvent = (eventParam, series) => {
      const data = eventParam?.seriesData?.get(series);
      if (!data) return null;
      if (typeof data.close === 'number') return data.close;
      if (typeof data.value === 'number') return data.value;
      return null;
    };
    const ensureTimeVisible = (chart, time) => {
      if (!time) return;
      const timeScale = chart.timeScale();
      const targetIndex = timeScale.timeToIndex(time, true);
      const numericIndex = Number(targetIndex);
      if (!Number.isFinite(numericIndex)) return;

      const logical = timeScale.getVisibleLogicalRange();
      if (!logical) return;
      if (numericIndex >= logical.from && numericIndex <= logical.to) return;

      const window = Math.max(10, logical.to - logical.from);
      const right = numericIndex + Math.max(2, Math.floor(window * 0.15));
      timeScale.setVisibleLogicalRange({
        from: right - window,
        to: right
      });
    };

    const renderPaneChart = ({ paneKey, timeframe, container, candles }) => {
      if (!container || !candles.length) return null;
      const chartBgColor = isDark ? '#020617' : '#ffffff';
      const chart = createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight || 500,
        layout: {
          background: {
            type: ColorType.Solid,
            color: chartBgColor
          },
          textColor: isDark ? '#cbd5e1' : '#334155',
          fontFamily: chartPrefs.markerSettings.labelFontFamily,
          fontSize: chartPrefs.markerSettings.labelFontSize,
          attributionLogo: true
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { visible: false }
        },
        rightPriceScale: {
          borderColor: isDark ? '#334155' : '#cbd5e1'
        },
        timeScale: {
          borderColor: isDark ? '#334155' : '#cbd5e1'
        },
        crosshair: {
          vertLine: { color: '#64748b' },
          horzLine: { color: '#64748b' }
        }
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#16a34a',
        downColor: '#dc2626',
        borderVisible: false,
        borderUpColor: '#16a34a',
        borderDownColor: '#dc2626',
        wickUpColor: '#16a34a',
        wickDownColor: '#dc2626',
        priceScaleId: 'right'
      });
      candleSeries.setData(candles);
      chart.priceScale('right').applyOptions({
        scaleMargins: { top: 0.08, bottom: 0.32 }
      });
      chart.priceScale('right').setAutoScale(true);

      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: 'volume',
        priceFormat: { type: 'volume' },
        scaleMargins: { top: 0.88, bottom: 0.02 }
      });
      volumeSeries.setData(
        candles.map((bar) => ({
          time: bar.time,
          value: Number(bar.volume || 0),
          color: Number(bar.close) >= Number(bar.open) ? 'rgba(22,163,74,0.45)' : 'rgba(220,38,38,0.45)'
        }))
      );
      chart.priceScale('volume').applyOptions({
        visible: false,
        borderVisible: false,
        scaleMargins: { top: 0.88, bottom: 0.02 }
      });
      chart.priceScale('volume').setAutoScale(true);

      chartPrefs.smaPeriods.forEach((period, index) => {
        const smaData = buildSmaData(candles, period);
        const series = chart.addSeries(LineSeries, {
          lineWidth: widthMap[chartPrefs.smaLineWidth] || 1,
          color: chartPrefs.smaColors[index],
          priceLineVisible: false,
          lastValueVisible: true,
          title: `SMA ${period}`
        });
        series.setData(smaData);
      });

      const candleTimes = candles.map((bar) => bar.time);
      const markers = tradeEvents
        .filter((event) => {
          if (event.kind === 'ENTRY') return showEntryMarkers;
          if (event.kind === 'EXIT') return showExitMarkers;
          return true;
        })
        .flatMap((event, index) => {
          const time = nearestCandleTime(event.time, candleTimes);
          if (time === null) return [];

          const isEntry = event.kind === 'ENTRY';
          const position = isEntry ? 'belowBar' : 'aboveBar';

          return [
            {
              id: `${paneKey}-${event.kind}-${index}-arrow`,
              time,
              position,
              color: isEntry
                ? chartPrefs.markerSettings.entryArrowColor
                : chartPrefs.markerSettings.exitArrowColor,
              shape: isEntry ? 'arrowUp' : 'arrowDown',
              size: isEntry
                ? chartPrefs.markerSettings.entryArrowSize
                : chartPrefs.markerSettings.exitArrowSize
            },
            {
              id: `${paneKey}-${event.kind}-${index}-text`,
              time,
              position,
              color: isEntry
                ? chartPrefs.markerSettings.entryLabelColor
                : chartPrefs.markerSettings.exitLabelColor,
              shape: isEntry ? 'arrowUp' : 'arrowDown',
              size: 0,
              text: `${isEntry ? 'E' : 'X'} ${Number(event.price).toFixed(2)} x${event.qty}`
            }
          ];
        });
      createSeriesMarkers(candleSeries, markers);

      const savedViewport = viewportRef.current[paneKey];
      if (savedViewport?.logicalRange) {
        chart.timeScale().setVisibleLogicalRange(savedViewport.logicalRange);
      } else {
        const windowSize = timeframe === '1W' ? 80 : 140;
        const latestEntryEventTime = [...tradeEvents]
          .reverse()
          .find((event) => event.kind === 'ENTRY')?.time;
        const latestAnchorTime = latestEntryEventTime || tradeEvents[tradeEvents.length - 1]?.time || null;
        const latestTradeEventIndex = latestAnchorTime
          ? chart.timeScale().timeToIndex(latestAnchorTime, true)
          : null;
        const rawAnchor = Number.isFinite(Number(latestTradeEventIndex))
          ? Number(latestTradeEventIndex)
          : candles.length - 1;
        const anchor = Math.max(0, Math.min(candles.length - 1, rawAnchor));
        const right = anchor + Math.max(8, Math.floor(windowSize * 0.2));
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(-1, right - windowSize),
          to: right
        });
      }

      const resizeObserver = new ResizeObserver(() => {
        chart.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight || 500
        });
      });
      resizeObserver.observe(container);
      const forgetAutoScaleOnRightScaleWheel = (event) => {
        const rect = container.getBoundingClientRect();
        const localX = event.clientX - rect.left;
        const rightScaleZoneWidth = 56;
        const isOnRightScale = localX >= container.clientWidth - rightScaleZoneWidth;
        if (!isOnRightScale) return;
        chart.priceScale('right').applyOptions({ autoScale: false });
      };
      container.addEventListener('wheel', forgetAutoScaleOnRightScaleWheel, { passive: true });

      const cleanup = () => {
        viewportRef.current[paneKey] = {
          logicalRange: chart.timeScale().getVisibleLogicalRange()
        };
        resizeObserver.disconnect();
        container.removeEventListener('wheel', forgetAutoScaleOnRightScaleWheel);
        chart.remove();
      };
      return { cleanup, chart, candleSeries };
    };

    const cleanups = [];
    if (layoutMode === 'single') {
      const result = renderPaneChart({
        paneKey: 'single',
        timeframe: singleTimeframe,
        container: singleChartRef.current,
        candles: paneData.single.candles
      });
      if (result) cleanups.push(result.cleanup);
    } else {
      const leftResult = renderPaneChart({
        paneKey: 'left',
        timeframe: leftTimeframe,
        container: leftChartRef.current,
        candles: paneData.left.candles
      });
      if (leftResult) cleanups.push(leftResult.cleanup);
      const rightResult = renderPaneChart({
        paneKey: 'right',
        timeframe: rightTimeframe,
        container: rightChartRef.current,
        candles: paneData.right.candles
      });
      if (rightResult) cleanups.push(rightResult.cleanup);

      if (leftResult && rightResult) {
        let syncing = false;
        let activePane = 'left';
        const leftToRight = (param) => {
          if (param?.point) activePane = 'left';
          if (syncing) return;
          if (!param?.time || !param?.point) {
            rightResult.chart.clearCrosshairPosition();
            return;
          }
          const price = getPriceFromEvent(param, leftResult.candleSeries);
          if (price === null) return;
          syncing = true;
          rightResult.chart.setCrosshairPosition(price, param.time, rightResult.candleSeries);
          syncing = false;
        };
        const rightToLeft = (param) => {
          if (param?.point) activePane = 'right';
          if (syncing) return;
          if (!param?.time || !param?.point) {
            leftResult.chart.clearCrosshairPosition();
            return;
          }
          const price = getPriceFromEvent(param, rightResult.candleSeries);
          if (price === null) return;
          syncing = true;
          leftResult.chart.setCrosshairPosition(price, param.time, leftResult.candleSeries);
          syncing = false;
        };
        leftResult.chart.subscribeCrosshairMove(leftToRight);
        rightResult.chart.subscribeCrosshairMove(rightToLeft);

        const leftClickToRight = (param) => {
          if (syncing || !param?.time) return;
          activePane = 'left';
          const price = getPriceFromEvent(param, leftResult.candleSeries);
          if (price === null) return;
          syncing = true;
          ensureTimeVisible(rightResult.chart, param.time);
          rightResult.chart.setCrosshairPosition(price, param.time, rightResult.candleSeries);
          syncing = false;
        };
        const rightClickToLeft = (param) => {
          if (syncing || !param?.time) return;
          activePane = 'right';
          const price = getPriceFromEvent(param, rightResult.candleSeries);
          if (price === null) return;
          syncing = true;
          ensureTimeVisible(leftResult.chart, param.time);
          leftResult.chart.setCrosshairPosition(price, param.time, leftResult.candleSeries);
          syncing = false;
        };
        leftResult.chart.subscribeClick(leftClickToRight);
        rightResult.chart.subscribeClick(rightClickToLeft);

        // Ensure both panes start aligned on the same date range.
        const initialLeftRange = leftResult.chart.timeScale().getVisibleRange();
        const initialRightRange = rightResult.chart.timeScale().getVisibleRange();
        if (initialLeftRange) {
          rightResult.chart.timeScale().setVisibleRange(initialLeftRange);
        } else if (initialRightRange) {
          leftResult.chart.timeScale().setVisibleRange(initialRightRange);
        }

        const areRangesEqual = (a, b) => {
          if (!a || !b) return false;
          const fromDiff = Math.abs(Number(a.from) - Number(b.from));
          const toDiff = Math.abs(Number(a.to) - Number(b.to));
          return fromDiff < 1e-6 && toDiff < 1e-6;
        };
        const syncVisibleRange = (sourceChart, targetChart, sourcePane) => {
          if (syncing || activePane !== sourcePane) return;
          const sourceRange = sourceChart.timeScale().getVisibleRange();
          if (!sourceRange) return;
          const targetRange = targetChart.timeScale().getVisibleRange();
          if (areRangesEqual(sourceRange, targetRange)) return;
          syncing = true;
          targetChart.timeScale().setVisibleRange(sourceRange);
          syncing = false;
        };
        const leftRangeToRight = () => syncVisibleRange(leftResult.chart, rightResult.chart, 'left');
        const rightRangeToLeft = () => syncVisibleRange(rightResult.chart, leftResult.chart, 'right');
        leftResult.chart.timeScale().subscribeVisibleTimeRangeChange(leftRangeToRight);
        rightResult.chart.timeScale().subscribeVisibleTimeRangeChange(rightRangeToLeft);

        const leftContainer = leftChartRef.current;
        const rightContainer = rightChartRef.current;
        const setActiveLeft = () => {
          activePane = 'left';
        };
        const setActiveRight = () => {
          activePane = 'right';
        };
        leftContainer?.addEventListener('mouseenter', setActiveLeft);
        leftContainer?.addEventListener('wheel', setActiveLeft, { passive: true });
        rightContainer?.addEventListener('mouseenter', setActiveRight);
        rightContainer?.addEventListener('wheel', setActiveRight, { passive: true });

        cleanups.push(() => {
          leftResult.chart.unsubscribeCrosshairMove(leftToRight);
          rightResult.chart.unsubscribeCrosshairMove(rightToLeft);
          leftResult.chart.unsubscribeClick(leftClickToRight);
          rightResult.chart.unsubscribeClick(rightClickToLeft);
          leftResult.chart.timeScale().unsubscribeVisibleTimeRangeChange(leftRangeToRight);
          rightResult.chart.timeScale().unsubscribeVisibleTimeRangeChange(rightRangeToLeft);
          leftContainer?.removeEventListener('mouseenter', setActiveLeft);
          leftContainer?.removeEventListener('wheel', setActiveLeft);
          rightContainer?.removeEventListener('mouseenter', setActiveRight);
          rightContainer?.removeEventListener('wheel', setActiveRight);
        });
      }
    }
    return () => cleanups.forEach((fn) => fn());
  }, [
    open,
    layoutMode,
    singleTimeframe,
    leftTimeframe,
    rightTimeframe,
    paneData,
    tradeEvents,
    theme,
    chartPrefs,
    showEntryMarkers,
    showExitMarkers
  ]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-950/70 p-3 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="mx-auto flex h-full w-full max-w-[98vw] flex-col rounded-lg border border-slate-700/70 bg-slate-950 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700/70 px-3 py-2">
          <div>
            <p className="text-sm text-slate-300">Trade Chart</p>
            <h3 className="text-lg font-semibold text-white">
              {trade?.symbol}{' '}
              {displayResolvedSymbol && displayResolvedSymbol !== trade?.symbol
                ? `(${displayResolvedSymbol})`
                : ''}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded border border-slate-600">
              {[
                { value: 'double', label: '2 Pane' },
                { value: 'single', label: '1 Pane' }
              ].map((layout) => {
                const active = layoutMode === layout.value;
                return (
                  <button
                    key={layout.value}
                    type="button"
                    onClick={() => {
                      setLayoutMode(layout.value);
                      if (layout.value === 'single') setSingleTimeframe('1D');
                    }}
                    className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-sky-500 text-white'
                        : 'bg-slate-900 text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {layout.label}
                  </button>
                );
              })}
            </div>
            {layoutMode === 'single' ? (
              <div className="inline-flex overflow-hidden rounded border border-slate-600">
                {TIMEFRAME_OPTIONS.map((option) => {
                  const active = singleTimeframe === option.value;
                  return (
                    <button
                      key={`single-${option.value}`}
                      type="button"
                      onClick={() => setSingleTimeframe(option.value)}
                      className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
                        active
                          ? 'bg-violet-500 text-white'
                          : 'bg-slate-900 text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="inline-flex overflow-hidden rounded border border-slate-600">
                  {TIMEFRAME_OPTIONS.map((option) => {
                    const active = leftTimeframe === option.value;
                    return (
                      <button
                        key={`left-${option.value}`}
                        type="button"
                        onClick={() => setLeftTimeframe(option.value)}
                        className={`px-2 py-1 text-xs font-semibold transition-colors ${
                          active
                            ? 'bg-violet-500 text-white'
                            : 'bg-slate-900 text-slate-200 hover:bg-slate-800'
                        }`}
                        title="Left pane timeframe"
                      >
                        L:{option.label}
                      </button>
                    );
                  })}
                </div>
                <div className="inline-flex overflow-hidden rounded border border-slate-600">
                  {TIMEFRAME_OPTIONS.map((option) => {
                    const active = rightTimeframe === option.value;
                    return (
                      <button
                        key={`right-${option.value}`}
                        type="button"
                        onClick={() => setRightTimeframe(option.value)}
                        className={`px-2 py-1 text-xs font-semibold transition-colors ${
                          active
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-900 text-slate-200 hover:bg-slate-800'
                        }`}
                        title="Right pane timeframe"
                      >
                        R:{option.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <label className="inline-flex items-center gap-1.5 rounded border border-slate-600 px-2 py-1 text-xs text-slate-100">
              <input
                type="checkbox"
                checked={showEntryMarkers}
                onChange={(event) => setShowEntryMarkers(event.target.checked)}
              />
              Entries
            </label>
            <label className="inline-flex items-center gap-1.5 rounded border border-slate-600 px-2 py-1 text-xs text-slate-100">
              <input
                type="checkbox"
                checked={showExitMarkers}
                onChange={(event) => setShowExitMarkers(event.target.checked)}
              />
              Exits
            </label>
            <button
              type="button"
              className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800"
              onClick={onClose}
            >
              Close (Esc)
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {layoutMode === 'single' ? (
            <div className="relative h-full w-full">
              {paneData.single.loading && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">
                  Loading chart data...
                </div>
              )}
              {!paneData.single.loading && paneData.single.error && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-rose-300">
                  {paneData.single.error}
                </div>
              )}
              {!paneData.single.loading && !paneData.single.error && !paneData.single.candles.length && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">
                  No candle data available.
                </div>
              )}
              {!paneData.single.loading && !paneData.single.error && !!paneData.single.candles.length && (
                <>
                  <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-slate-900/80 px-2 py-1 text-xs font-semibold text-white">
                    {TIMEFRAME_LABELS[singleTimeframe] || singleTimeframe}
                  </div>
                  <div ref={singleChartRef} className="h-full w-full" />
                </>
              )}
            </div>
          ) : (
            <div className="grid h-full grid-cols-2 gap-1">
              {[
                { key: 'left', ref: leftChartRef, tf: leftTimeframe },
                { key: 'right', ref: rightChartRef, tf: rightTimeframe }
              ].map((pane) => {
                const data = paneData[pane.key];
                return (
                  <div key={pane.key} className="relative h-full w-full border border-slate-800/70">
                    {data.loading && (
                      <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">
                        Loading chart data...
                      </div>
                    )}
                    {!data.loading && data.error && (
                      <div className="absolute inset-0 flex items-center justify-center text-sm text-rose-300">
                        {data.error}
                      </div>
                    )}
                    {!data.loading && !data.error && !data.candles.length && (
                      <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">
                        No candle data available.
                      </div>
                    )}
                    {!data.loading && !data.error && !!data.candles.length && (
                      <>
                        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-slate-900/80 px-2 py-1 text-xs font-semibold text-white">
                          {TIMEFRAME_LABELS[pane.tf] || pane.tf}
                        </div>
                        <div ref={pane.ref} className="h-full w-full" />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

TradeChartOverlay.propTypes = {
  open: PropTypes.bool.isRequired,
  trade: PropTypes.shape({
    symbol: PropTypes.string,
    entryDate: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
    entryPrice: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    entryQty: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    pyramids: PropTypes.arrayOf(PropTypes.object),
    exits: PropTypes.arrayOf(PropTypes.object)
  }),
  onClose: PropTypes.func.isRequired,
  onPrevTrade: PropTypes.func,
  onNextTrade: PropTypes.func
};

TradeChartOverlay.defaultProps = {
  trade: null,
  onPrevTrade: () => {},
  onNextTrade: () => {}
};

export default TradeChartOverlay;
