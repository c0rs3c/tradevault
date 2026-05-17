'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  createSeriesMarkers
} from 'lightweight-charts';
import { fetchMarketCandles } from '../api/trades';

const previewCandleCache = new Map();

const formatNumber = (value, digits = 2) => {
  if (!Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
};

const formatPctChange = (value) => {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${formatNumber(value)}%`;
};

const formatMarketCapCr = (value) => {
  if (!Number.isFinite(Number(value))) return '—';
  return `MCap ₹${formatNumber(Number(value) / 10000000)} Cr`;
};

const formatRupeeVolumeCr = (value) => {
  if (!Number.isFinite(Number(value))) return '—';
  return `Turnover ₹${formatNumber(value)} Cr`;
};

const formatValueLabel = (value, column) => {
  if (!Number.isFinite(Number(value))) return '—';
  return `₹${formatNumber(value)} Cr`;
};

const formatDateLabel = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};

const toUnixSeconds = (value) => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
};

const addDays = (value, days) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

const SMA_RIBBON_BULLISH = 'rgba(134, 239, 172, 0.28)';
const SMA_RIBBON_BEARISH = 'rgba(252, 165, 165, 0.28)';
const SMA_LINE_CONFIGS = [
  { period: 10, color: 'rgba(74, 222, 128, 0.22)', lineWidth: 1 },
  { period: 20, color: 'rgba(248, 113, 113, 0.22)', lineWidth: 1 },
  { period: 50, color: '#16a34a', lineWidth: 1 }
];

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
        time: Number(bar.time),
        value: Number((sum / period).toFixed(4))
      });
    }
  });
  return output;
};

const drawRibbonSegment = (ctx, start, end, fillStyle) => {
  ctx.beginPath();
  ctx.moveTo(start.x, start.fastY);
  ctx.lineTo(end.x, end.fastY);
  ctx.lineTo(end.x, end.slowY);
  ctx.lineTo(start.x, start.slowY);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
};

const createSmaRibbonOverlay = ({ container, chart, fastSeries, slowSeries, fastData, slowData }) => {
  if (!container || !chart || !fastSeries || !slowSeries || !fastData.length || !slowData.length) {
    return { redraw: () => {}, cleanup: () => {} };
  }

  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '12';
  container.appendChild(canvas);

  const slowByTime = new Map(slowData.map((point) => [String(point.time), point.value]));

  const render = () => {
    const width = container.clientWidth;
    const height = container.clientHeight || 330;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    const points = fastData
      .map((point) => {
        const slowValue = slowByTime.get(String(point.time));
        if (!Number.isFinite(slowValue)) return null;
        const x = chart.timeScale().timeToCoordinate(point.time);
        const fastY = fastSeries.priceToCoordinate(point.value);
        const slowY = slowSeries.priceToCoordinate(slowValue);
        if (![x, fastY, slowY].every((value) => Number.isFinite(value))) return null;
        return {
          x,
          fastY,
          slowY,
          diff: point.value - slowValue
        };
      })
      .filter(Boolean);

    for (let index = 1; index < points.length; index += 1) {
      const prev = points[index - 1];
      const curr = points[index];
      const prevBullish = prev.diff >= 0;
      const currBullish = curr.diff >= 0;

      if (prevBullish === currBullish || prev.diff === curr.diff) {
        drawRibbonSegment(ctx, prev, curr, prevBullish ? SMA_RIBBON_BULLISH : SMA_RIBBON_BEARISH);
        continue;
      }

      const t = prev.diff / (prev.diff - curr.diff);
      const crossPoint = {
        x: prev.x + (curr.x - prev.x) * t,
        fastY: prev.fastY + (curr.fastY - prev.fastY) * t,
        slowY: prev.slowY + (curr.slowY - prev.slowY) * t,
        diff: 0
      };

      drawRibbonSegment(ctx, prev, crossPoint, prevBullish ? SMA_RIBBON_BULLISH : SMA_RIBBON_BEARISH);
      drawRibbonSegment(ctx, crossPoint, curr, currBullish ? SMA_RIBBON_BULLISH : SMA_RIBBON_BEARISH);
    }
  };

  render();
  chart.timeScale().subscribeVisibleTimeRangeChange(render);

  return {
    redraw: render,
    cleanup: () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(render);
      canvas.remove();
    }
  };
};

const pctToneClass = (value) => {
  if (!Number.isFinite(value)) return 'text-slate-400 dark:text-slate-500';
  if (value > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (value < 0) return 'text-red-600 dark:text-red-400';
  return 'text-slate-500 dark:text-slate-400';
};

const valueToneClass = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 'text-slate-400 dark:text-slate-500';
  if (numericValue < 0) return 'text-red-600 dark:text-red-400';
  return 'text-slate-900 dark:text-slate-100';
};

const MiniBarChart = ({ values = [] }) => {
  const [hoveredBarKey, setHoveredBarKey] = useState(null);
  const numericValues = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!numericValues.length) {
    return <div className="text-[10px] text-slate-400 dark:text-slate-500">No data</div>;
  }

  const width = 92;
  const height = 36;
  const topPadding = 3;
  const bottomPadding = 3;
  const chartHeight = height - topPadding - bottomPadding;
  const minValue = Math.min(...numericValues, 0);
  const maxValue = Math.max(...numericValues, 0);
  const range = maxValue - minValue || 1;
  const step = width / numericValues.length;
  const barWidth = Math.max(5, step - 3);
  const zeroY = topPadding + ((maxValue - 0) / range) * chartHeight;
  const bars = numericValues.map((value, index) => {
    const barHeight = (Math.abs(value) / range) * chartHeight;
    const x = index * step + (step - barWidth) / 2;
    const y = value >= 0 ? zeroY - barHeight : zeroY;
    return {
      key: `${index}-${value}`,
      value,
      x,
      y,
      height: Math.max(barHeight, 1.5)
    };
  });

  return (
    <div className="relative h-9 w-[92px]">
      <div
        className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-slate-300 dark:border-slate-700"
        style={{ top: `${(zeroY / height) * 100}%` }}
      />
      {bars.map((bar) => (
        <div
          key={bar.key}
          className="absolute"
          onMouseEnter={() => setHoveredBarKey(bar.key)}
          onMouseLeave={() => setHoveredBarKey((current) => (current === bar.key ? null : current))}
          style={{
            left: `${(bar.x / width) * 100}%`,
            top: `${(bar.y / height) * 100}%`,
            width: `${(barWidth / width) * 100}%`,
            height: `${(bar.height / height) * 100}%`
          }}
        >
          <div
            className={`h-full w-full rounded-sm ${bar.value < 0 ? 'bg-red-500 dark:bg-red-400' : 'bg-slate-700 dark:bg-slate-200'}`}
          />
          {hoveredBarKey === bar.key ? (
            <div className="pointer-events-none absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-medium text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
              {formatNumber(bar.value)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
};

const compareNullableNumbers = (a, b, direction = 'desc') => {
  const aValid = Number.isFinite(a);
  const bValid = Number.isFinite(b);
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  return direction === 'asc' ? a - b : b - a;
};

const SortArrow = ({ active = false, direction = 'desc' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={`h-3 w-3 ${active ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'} ${
      direction === 'asc' ? 'rotate-180' : ''
    }`}
    aria-hidden="true"
  >
    <path d="M12 5v14" strokeLinecap="round" />
    <path d="m8 15 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CollapseArrow = ({ open = true }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`}
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LoadingPulseRow = ({ visibleColumnsCount = 0 }) => (
  <tr className="animate-pulse">
    <td className="sticky left-0 border-b border-slate-200 bg-white px-2 py-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="space-y-2">
        <div className="h-5 w-28 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-4 w-36 rounded bg-slate-100 dark:bg-slate-900" />
        <div className="h-4 w-24 rounded bg-slate-100 dark:bg-slate-900" />
        <div className="h-4 w-20 rounded bg-slate-100 dark:bg-slate-900" />
      </div>
    </td>
    {Array.from({ length: visibleColumnsCount }).map((_, index) => (
      <td key={index} className="border-b border-slate-200 px-2 py-3 dark:border-slate-800">
        <div className="ml-auto h-6 w-20 rounded bg-slate-200 dark:bg-slate-800" />
      </td>
    ))}
  </tr>
);

const TradingViewPreviewTooltip = ({
  active = false,
  symbol = '',
  companyName = '',
  periods = []
}) => {
  const chartContainerRef = useRef(null);
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const quarterAnchors = useMemo(
    () =>
      (Array.isArray(periods) ? periods : [])
        .map((period) => ({
          ...period,
          time: toUnixSeconds(period.anchorDate)
        }))
        .filter((period) => Number.isFinite(period.time))
        .sort((left, right) => left.time - right.time),
    [periods]
  );

  useEffect(() => {
    if (!active || !symbol || quarterAnchors.length < 2) return undefined;

    const controller = new AbortController();
    const from = addDays(quarterAnchors[0].anchorDate, -21);
    const to = addDays(quarterAnchors[quarterAnchors.length - 1].anchorDate, 21);
    const cacheKey = `${symbol}:${from}:${to}`;

    const loadCandles = async () => {
      setLoading(true);
      setError('');
      if (previewCandleCache.has(cacheKey)) {
        setCandles(previewCandleCache.get(cacheKey) || []);
        setLoading(false);
        return;
      }
      try {
        const response = await fetchMarketCandles({
          symbol,
          from,
          to,
          interval: '1D',
          signal: controller.signal
        });
        const nextCandles = Array.isArray(response?.candles) ? response.candles : [];
        previewCandleCache.set(cacheKey, nextCandles);
        setCandles(nextCandles);
      } catch (nextError) {
        if (controller.signal.aborted) return;
        setCandles([]);
        setError(nextError?.response?.data?.message || 'Failed to load chart');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    loadCandles();
    return () => controller.abort();
  }, [active, quarterAnchors, symbol]);

  useEffect(() => {
    if (!active || !chartContainerRef.current || !candles.length) return undefined;

    const isDarkMode = document.documentElement.classList.contains('dark');
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 330,
      layout: {
        background: {
          type: ColorType.Solid,
          color: isDarkMode ? '#020617' : '#ffffff'
        },
        textColor: isDarkMode ? '#cbd5e1' : '#334155'
      },
      grid: {
        vertLines: { color: isDarkMode ? 'rgba(51,65,85,0.25)' : 'rgba(148,163,184,0.18)' },
        horzLines: { color: isDarkMode ? 'rgba(51,65,85,0.25)' : 'rgba(148,163,184,0.18)' }
      },
      rightPriceScale: {
        borderColor: isDarkMode ? '#334155' : '#cbd5e1'
      },
      timeScale: {
        borderColor: isDarkMode ? '#334155' : '#cbd5e1',
        timeVisible: true,
        secondsVisible: false
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: isDarkMode ? '#38bdf8' : '#0f172a' },
        horzLine: { color: isDarkMode ? '#38bdf8' : '#0f172a' }
      }
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#16a34a',
      downColor: '#dc2626',
      borderVisible: false,
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626'
    });

    candleSeries.setData(
      candles.map((bar) => ({
        time: Number(bar.time),
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close)
      }))
    );

    const smaSeriesMap = new Map();
    const smaDataMap = new Map();
    SMA_LINE_CONFIGS.forEach(({ period, color, lineWidth }) => {
      const smaData = buildSmaData(candles, period);
      const series = chart.addSeries(LineSeries, {
        lineWidth,
        color,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      series.setData(smaData);
      smaSeriesMap.set(period, series);
      smaDataMap.set(period, smaData);
    });

    const ribbonOverlay = createSmaRibbonOverlay({
      container: chartContainerRef.current,
      chart,
      fastSeries: smaSeriesMap.get(10),
      slowSeries: smaSeriesMap.get(20),
      fastData: smaDataMap.get(10) || [],
      slowData: smaDataMap.get(20) || []
    });

    const candleTimes = candles.map((bar) => Number(bar.time)).filter(Number.isFinite);
    const nearestTime = (target) =>
      candleTimes.reduce((closest, current) => (
        Math.abs(current - target) < Math.abs(closest - target) ? current : closest
      ), candleTimes[0]);

    const quarterMarkers = quarterAnchors.map((period, index) => ({
      id: `${symbol}-${period.periodEnd}-${index}`,
      time: nearestTime(period.time),
      position: index % 2 === 0 ? 'aboveBar' : 'belowBar',
      color: '#0284c7',
      shape: 'circle',
      size: 1,
      text: period.periodLabel
    }));
    createSeriesMarkers(candleSeries, quarterMarkers);

    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect?.width;
      if (Number.isFinite(nextWidth) && nextWidth > 0) {
        chart.applyOptions({ width: nextWidth });
        ribbonOverlay.redraw();
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      ribbonOverlay.cleanup();
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [active, candles, quarterAnchors, symbol]);

  if (!active) return null;

  return (
    <div
      className="pointer-events-auto absolute left-full top-0 z-[70] hidden w-[630px] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl group-hover/symbol:block group-focus-within/symbol:block dark:border-slate-700 dark:bg-slate-950"
      style={{ marginLeft: '-1px' }}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">
            TradingView Preview
          </p>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{symbol}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{companyName || 'Selected quarters in view'}</p>
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500">
          {quarterAnchors.length ? `${quarterAnchors.length} quarters` : 'No quarters'}
        </p>
      </div>

      {quarterAnchors.length < 2 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Select at least 2 quarters to render the chart preview.
        </div>
      ) : loading ? (
        <div className="flex h-[330px] items-center justify-center rounded-xl border border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Loading chart...
        </div>
      ) : error ? (
        <div className="flex h-[330px] items-center justify-center rounded-xl border border-red-200 px-3 text-center text-xs text-red-600 dark:border-red-900/60 dark:text-red-400">
          {error}
        </div>
      ) : candles.length ? (
        <div className="h-[330px] w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          <div ref={chartContainerRef} className="relative h-full w-full" />
        </div>
      ) : (
        <div className="flex h-[330px] items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No price candles found for this date range.
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {quarterAnchors.map((period) => (
          <span
            key={`${symbol}-${period.periodEnd}`}
            className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100"
          >
            {period.periodLabel}
          </span>
        ))}
      </div>
    </div>
  );
};

const StockCell = ({ row }) => {
  const [previewActive, setPreviewActive] = useState(false);

  return (
    <div className="w-full text-left">
      <div
        className="group/symbol relative inline-block max-w-full"
        onMouseEnter={() => setPreviewActive(true)}
        onMouseLeave={() => {
          setPreviewActive(false);
        }}
        onFocus={() => setPreviewActive(true)}
        onBlur={() => {
          setPreviewActive(false);
        }}
      >
        <span
          className="block cursor-pointer text-sm font-semibold leading-tight text-slate-900 dark:text-slate-100"
          tabIndex={0}
        >
          {row.symbol}
        </span>
        <TradingViewPreviewTooltip
          active={previewActive}
          symbol={row.symbol}
          companyName={row.companyName}
          periods={row.chartPreviewPeriods}
        />
      </div>
    <span className="mt-0.5 block truncate text-[10px] font-normal normal-case leading-tight text-slate-500 dark:text-slate-400">
      {row.companyName || '—'}
    </span>
    <span className="mt-1 block text-[10px] font-normal normal-case leading-tight text-slate-500 dark:text-slate-400">
      {formatMarketCapCr(row.marketCap)}
    </span>
    <span className="block text-[10px] font-normal normal-case leading-tight text-slate-500 dark:text-slate-400">
      {formatRupeeVolumeCr(row.rupeeVolumeCrore)}
    </span>
    </div>
  );
};

export default function StockScreenerBlock({
  title = 'Stocks',
  subtitle = '',
  rows = [],
  loading = false,
  error = '',
  emptyStateMessage = '',
  filters,
  onFilterChange,
  sortConfig,
  onSort,
  columnOptions = [],
  visibleColumnKeys = [],
  onToggleColumn,
  onSelectRow,
  showFilters = true,
  showColumnSelector = true,
  columnSelectorLabel = 'Columns',
  showHeader = true,
  headerActions = null,
  columnValueFilters = {},
  onColumnFilterChange,
  onToggleColumnGroup,
  trendColumns = []
}) {
  const [controlsOpen, setControlsOpen] = useState(true);
  const visibleColumns = useMemo(
    () => columnOptions.filter((column) => visibleColumnKeys.includes(column.key)),
    [columnOptions, visibleColumnKeys]
  );
  const groupedColumnOptions = useMemo(() => {
    const groups = {
      yoy: [],
      qoq: [],
      other: []
    };

    columnOptions.forEach((column) => {
      const headerText = String(column?.headerLines?.join(' ') || '').toLowerCase();
      if (headerText.includes('yoy')) {
        groups.yoy.push(column);
        return;
      }
      if (headerText.includes('qoq')) {
        groups.qoq.push(column);
        return;
      }
      groups.other.push(column);
    });

    return groups;
  }, [columnOptions]);
  const groupedVisibleColumnOptions = useMemo(
    () => ({
      yoy: groupedColumnOptions.yoy.filter((column) => visibleColumnKeys.includes(column.key)),
      qoq: groupedColumnOptions.qoq.filter((column) => visibleColumnKeys.includes(column.key)),
      other: groupedColumnOptions.other.filter((column) => visibleColumnKeys.includes(column.key))
    }),
    [groupedColumnOptions, visibleColumnKeys]
  );

  const sortedRows = useMemo(() => {
    const nextRows = [...rows];
    nextRows.sort((left, right) => {
      if (sortConfig.key === 'symbol' || sortConfig.key === 'companyName') {
        const leftValue = String(left?.[sortConfig.key] || '');
        const rightValue = String(right?.[sortConfig.key] || '');
        return sortConfig.direction === 'asc'
          ? leftValue.localeCompare(rightValue)
          : rightValue.localeCompare(leftValue);
      }
      return compareNullableNumbers(left?.[sortConfig.key], right?.[sortConfig.key], sortConfig.direction)
        || left.symbol.localeCompare(right.symbol);
    });
    return nextRows;
  }, [rows, sortConfig]);

  return (
    <section className="surface-card space-y-4 p-6">
      {showHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{subtitle}</p> : null}
          </div>
          <div className="flex items-center gap-3">
            {headerActions}
            {(showFilters || showColumnSelector) ? (
              <button
                type="button"
                onClick={() => setControlsOpen((current) => !current)}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:text-slate-100"
                aria-expanded={controlsOpen}
              >
                <CollapseArrow open={controlsOpen} />
                <span>{controlsOpen ? 'Collapse Filters' : 'Expand Filters'}</span>
              </button>
            ) : null}
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {formatNumber(sortedRows.length, 0)} stocks
            </p>
          </div>
        </div>
      ) : null}

      {(showFilters || showColumnSelector) ? (
        <div
          className={`grid transition-all duration-200 ease-out ${controlsOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
        >
          <div className="space-y-4 overflow-hidden">
            {showFilters ? (
              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Market Cap Range (Cr)</span>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={filters.minMarketCapCr}
                      onChange={(event) => onFilterChange('minMarketCapCr', event.target.value)}
                      placeholder="Min"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={filters.maxMarketCapCr}
                      onChange={(event) => onFilterChange('maxMarketCapCr', event.target.value)}
                      placeholder="Max"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Market Turnover Range (Cr)</span>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={filters.minRupeeVolumeCr}
                      onChange={(event) => onFilterChange('minRupeeVolumeCr', event.target.value)}
                      placeholder="Min"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={filters.maxRupeeVolumeCr}
                      onChange={(event) => onFilterChange('maxRupeeVolumeCr', event.target.value)}
                      placeholder="Max"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Stock Price Range</span>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={filters.minPrice}
                      onChange={(event) => onFilterChange('minPrice', event.target.value)}
                      placeholder="Min"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={filters.maxPrice}
                      onChange={(event) => onFilterChange('maxPrice', event.target.value)}
                      placeholder="Max"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </label>
              </div>
            ) : null}

            {showColumnSelector ? (
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="space-y-4">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{columnSelectorLabel}</p>

            {groupedColumnOptions.yoy.length ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">YoY</p>
                  {typeof onToggleColumnGroup === 'function' ? (
                    <button
                      type="button"
                      onClick={() => onToggleColumnGroup('yoy', groupedColumnOptions.yoy.some((column) => !visibleColumnKeys.includes(column.key)))}
                      className="text-xs font-medium text-sky-700 transition hover:text-sky-600 dark:text-sky-300"
                    >
                      {groupedColumnOptions.yoy.every((column) => visibleColumnKeys.includes(column.key)) ? 'Uncheck All' : 'Check All'}
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {groupedColumnOptions.yoy.map((column) => {
                    const checked = visibleColumnKeys.includes(column.key);
                    return (
                      <label
                        key={column.key}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:text-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleColumn(column.key)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-900"
                        />
                        <span>{column.selectorLabel || column.headerLines.join(' ')}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {groupedColumnOptions.qoq.length ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">QoQ</p>
                  {typeof onToggleColumnGroup === 'function' ? (
                    <button
                      type="button"
                      onClick={() => onToggleColumnGroup('qoq', groupedColumnOptions.qoq.some((column) => !visibleColumnKeys.includes(column.key)))}
                      className="text-xs font-medium text-sky-700 transition hover:text-sky-600 dark:text-sky-300"
                    >
                      {groupedColumnOptions.qoq.every((column) => visibleColumnKeys.includes(column.key)) ? 'Uncheck All' : 'Check All'}
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {groupedColumnOptions.qoq.map((column) => {
                    const checked = visibleColumnKeys.includes(column.key);
                    return (
                      <label
                        key={column.key}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:text-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleColumn(column.key)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-900"
                        />
                        <span>{column.selectorLabel || column.headerLines.join(' ')}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {groupedColumnOptions.other.length ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Other</p>
                <div className="flex flex-wrap items-center gap-3">
                  {groupedColumnOptions.other.map((column) => {
                    const checked = visibleColumnKeys.includes(column.key);
                    return (
                      <label
                        key={column.key}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:text-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleColumn(column.key)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-900"
                        />
                        <span>{column.selectorLabel || column.headerLines.join(' ')}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {typeof onColumnFilterChange === 'function' && (groupedVisibleColumnOptions.yoy.length || groupedVisibleColumnOptions.qoq.length || groupedVisibleColumnOptions.other.length) ? (
              <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Column Filters</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Leave these blank to ignore column-level screening and use only the market cap, turnover, and price filters.
                </p>

                {groupedVisibleColumnOptions.yoy.length ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">YoY</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      {groupedVisibleColumnOptions.yoy.map((column) => (
                        <label key={`${column.key}-filter`} className="space-y-2">
                          <span className="text-xs text-slate-700 dark:text-slate-200">{column.selectorLabel || column.headerLines.join(' ')}</span>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="number"
                              step="0.01"
                              value={columnValueFilters[column.key]?.min || ''}
                              onChange={(event) => onColumnFilterChange(column.key, 'min', event.target.value)}
                              placeholder="Min %"
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                            <input
                              type="number"
                              step="0.01"
                              value={columnValueFilters[column.key]?.max || ''}
                              onChange={(event) => onColumnFilterChange(column.key, 'max', event.target.value)}
                              placeholder="Max %"
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                {groupedVisibleColumnOptions.qoq.length ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">QoQ</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      {groupedVisibleColumnOptions.qoq.map((column) => (
                        <label key={`${column.key}-filter`} className="space-y-2">
                          <span className="text-xs text-slate-700 dark:text-slate-200">{column.selectorLabel || column.headerLines.join(' ')}</span>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="number"
                              step="0.01"
                              value={columnValueFilters[column.key]?.min || ''}
                              onChange={(event) => onColumnFilterChange(column.key, 'min', event.target.value)}
                              placeholder="Min %"
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                            <input
                              type="number"
                              step="0.01"
                              value={columnValueFilters[column.key]?.max || ''}
                              onChange={(event) => onColumnFilterChange(column.key, 'max', event.target.value)}
                              placeholder="Max %"
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
          <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900 dark:border-slate-700 dark:border-t-slate-100" />
          <span>Searching stocks...</span>
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {!loading && !error && !sortedRows.length && emptyStateMessage ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{emptyStateMessage}</p>
      ) : null}

      {(loading || (!error && sortedRows.length)) ? (
        <div className="relative max-h-[calc(100vh-var(--app-header-offset,64px)-2rem)] overflow-auto rounded-xl">
          <table className="w-full min-w-max overflow-visible border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-[4] min-w-[196px] w-[196px] border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 shadow-[0_1px_0_0_rgba(226,232,240,1)] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 dark:shadow-[0_1px_0_0_rgba(30,41,59,1)]">
                  <button
                    type="button"
                    onClick={() => onSort('symbol')}
                    className="flex min-h-[52px] w-full items-center justify-center gap-1 text-center hover:text-sky-600 dark:hover:text-sky-300"
                  >
                    <span className="flex flex-col items-center leading-tight">
                      <span>Stock</span>
                    </span>
                    <SortArrow active={sortConfig.key === 'symbol'} direction={sortConfig.direction} />
                  </button>
                </th>
                {trendColumns.map((column) => (
                  <th
                    key={column.key}
                    className="sticky top-0 z-[3] w-[112px] border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 shadow-[0_1px_0_0_rgba(226,232,240,1)] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 dark:shadow-[0_1px_0_0_rgba(30,41,59,1)]"
                  >
                    <span className="flex min-h-[52px] items-center justify-center">{column.label}</span>
                  </th>
                ))}
                {visibleColumns.map((column) => (
                  <th
                    key={column.key}
                    className="sticky top-0 z-[3] border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 shadow-[0_1px_0_0_rgba(226,232,240,1)] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 dark:shadow-[0_1px_0_0_rgba(30,41,59,1)]"
                  >
                    <div className="flex min-h-[52px] flex-col items-end justify-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => onSort(column.key)}
                        className="flex w-full items-center justify-end gap-1 text-right hover:text-sky-600 dark:hover:text-sky-300"
                      >
                        <span className="flex flex-col items-end leading-tight">
                          {column.headerLines.map((line) => (
                            <span key={`${column.key}-${line}`}>{line}</span>
                          ))}
                        </span>
                        <SortArrow active={sortConfig.key === column.key} direction={sortConfig.direction} />
                      </button>
                      {column.swingKey ? (
                        <button
                          type="button"
                          onClick={() => onSort(column.swingKey)}
                          className="flex items-center justify-end gap-1 text-[9px] font-semibold normal-case tracking-normal text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-300"
                        >
                          <span>Swing</span>
                          <SortArrow active={sortConfig.key === column.swingKey} direction={sortConfig.direction} />
                        </button>
                      ) : null}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>
                  <LoadingPulseRow visibleColumnsCount={visibleColumns.length} />
                  <LoadingPulseRow visibleColumnsCount={visibleColumns.length} />
                  <LoadingPulseRow visibleColumnsCount={visibleColumns.length} />
                </>
              ) : null}
              {sortedRows.map((row) => (
                <tr key={row.symbol} className="group">
                  <td className="sticky left-0 z-[1] min-w-[196px] w-[196px] overflow-visible border-b border-slate-200 bg-white px-2 py-2 group-hover:z-[45] dark:border-slate-800 dark:bg-slate-950">
                    <StockCell row={row} />
                  </td>
                  {trendColumns.map((column) => (
                    <td
                      key={`${row.symbol}-${column.key}`}
                      className="border-b border-slate-200 px-2 py-2 text-center dark:border-slate-800"
                    >
                      <div className="flex justify-center">
                        <MiniBarChart values={row[column.key]} />
                      </div>
                    </td>
                  ))}
                  {visibleColumns.map((column) => (
                    <td
                      key={`${row.symbol}-${column.key}`}
                      className="border-b border-slate-200 px-2 py-2 text-right font-medium dark:border-slate-800"
                    >
                      {column.valueKey ? (
                        <div className={`text-sm font-bold ${valueToneClass(row[column.valueKey])}`}>
                          {formatValueLabel(row[column.valueKey], column)}
                        </div>
                      ) : null}
                      <div className={`text-xs font-semibold ${pctToneClass(row[column.key])}`}>
                        {formatPctChange(row[column.key])}
                      </div>
                      {column.swingKey ? (
                        <div className={`text-xs font-semibold ${pctToneClass(row[column.swingKey])}`}>
                          Swing {formatPctChange(row[column.swingKey])}
                        </div>
                      ) : null}
                      {column.earningsDateKey ? (
                        <div className="text-[9px] text-slate-400 dark:text-slate-500">
                          Earnings {formatDateLabel(row[column.earningsDateKey])}
                        </div>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
