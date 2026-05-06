import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { saveSettings } from '../api/settings';
import { fetchDashboard, fetchTrade } from '../api/trades';
import SummaryCard from '../components/SummaryCard';
import TradeChartOverlay from '../components/TradeChartOverlay';
import { useSettings } from '../contexts/SettingsContext';

const dashboardCache = {
  data: null
};

const money = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const pnlTextClass = (value) => {
  const num = Number(value || 0);
  if (num > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (num < 0) return 'text-red-600 dark:text-red-400';
  return 'text-slate-900 dark:text-slate-100';
};

const monthLabel = (monthKey) => {
  if (!monthKey) return '';
  const parsed = new Date(`${monthKey}-01T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return monthKey;
  return new Intl.DateTimeFormat('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(parsed);
};

const toMonthKey = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 7);
};

const formatDisplayDate = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(parsed);
};

const symbolText = (symbols) => {
  const unique = [...new Set((symbols || []).filter(Boolean))];
  if (!unique.length) return '-';
  return unique.join(', ');
};

const monthShortLabel = (year, monthIndex) =>
  new Intl.DateTimeFormat('en-IN', {
    month: 'short',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, monthIndex, 1)));

const toYear = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getUTCFullYear();
};

const toMonthIndex = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getUTCMonth();
};

const diffInCalendarDaysInclusive = (start, end = new Date()) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  const startUtc = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const endUtc = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  const diffDays = Math.floor((endUtc - startUtc) / (24 * 60 * 60 * 1000));
  return Math.max(0, diffDays) + 1;
};

const getDaysInMonth = (year, monthIndex) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

const tradeDotSizeClass = (count) => {
  return 'h-2 w-2';
};

const getTradePyramidCount = (trade) => (Array.isArray(trade?.pyramids) ? trade.pyramids.length : 0);

const getTradeHasPartialExits = (trade) => {
  const exits = Array.isArray(trade?.exits) ? trade.exits : [];
  if (!exits.length) return false;

  const totalEntryQty = Number(trade?.metrics?.totalEntryQty || trade?.entryQty || 0);
  const exitedQty =
    trade?.metrics?.exitedQty !== undefined
      ? Number(trade.metrics.exitedQty || 0)
      : exits.reduce((acc, exit) => acc + Number(exit?.exitQty || 0), 0);

  return (exitedQty > 0 && exitedQty < totalEntryQty) || exits.length > 1;
};

const TradeStructureIndicators = ({
  pyramidCount = 0,
  hasPartialExits = false
}) => {
  if (!pyramidCount && !hasPartialExits) return null;

  return (
    <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
      {pyramidCount > 0 ? (
        <span
          className="group relative inline-flex"
        >
          <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
          title="Pyramids done"
          aria-label="Pyramids done"
        >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-3 w-3"
              aria-hidden="true"
            >
              <path d="M12 4 4.5 18h15L12 4Z" />
            </svg>
          </span>
          <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
            Pyramids done
          </span>
        </span>
      ) : null}
      {hasPartialExits ? (
        <span
          className="group relative inline-flex"
        >
          <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
          title="Partial exits done"
          aria-label="Partial exits done"
        >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-3 w-3"
              aria-hidden="true"
            >
              <path d="M6 12h9" strokeLinecap="round" />
              <path d="m12 7 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
            Partial exits done
          </span>
        </span>
      ) : null}
    </div>
  );
};

const OpenTradeActionButtons = ({ tradeId, compact = false }) => {
  if (!tradeId) return null;

  const baseButtonClass = compact
    ? 'group relative inline-flex h-6 w-6 items-center justify-center rounded border transition-colors duration-200'
    : 'group relative inline-flex h-7 w-7 items-center justify-center rounded border transition-colors duration-200';
  const iconClass = compact ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const tooltipClass =
    'pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900';

  return (
    <div className="flex items-center gap-1 whitespace-nowrap">
      <Link
        href={`/trades/${tradeId}?openModal=pyramid&source=dashboard`}
        className={`${baseButtonClass} border-emerald-500/70 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50`}
        aria-label="Pyramid"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className={iconClass}
          aria-hidden="true"
        >
          <path d="m12 4 8 14H4L12 4Z" />
          <path d="M8.8 12.2h6.4M7.2 15h9.6" strokeLinecap="round" />
        </svg>
        <span className={tooltipClass}>Pyramid</span>
      </Link>
      <Link
        href={`/trades/${tradeId}?openModal=exit&source=dashboard`}
        className={`${baseButtonClass} border-rose-500/70 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/60 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-900/50`}
        aria-label="Exit"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          className={iconClass}
          aria-hidden="true"
        >
          <path d="M10 5h7v14h-7" />
          <path d="M14 12H4" strokeLinecap="round" />
          <path d="m7.5 8.5-3.5 3.5 3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={tooltipClass}>Exit</span>
      </Link>
    </div>
  );
};

const SortArrow = ({ active = false, direction = 'desc' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={`h-3 w-3 ${active ? 'text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'} ${
      direction === 'asc' ? 'rotate-180' : ''
    }`}
    aria-hidden="true"
  >
    <path d="M12 5v14" strokeLinecap="round" />
    <path d="m8 15 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CalendarTradeTooltip = ({ trade, className = '' }) => (
  <span className={`pointer-events-none absolute z-[80] hidden w-44 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-[11px] text-slate-700 shadow-lg group-hover:block group-focus-visible:block dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 ${className}`}>
    <span className="block font-semibold text-slate-900 dark:text-slate-100">{trade.symbol || 'Trade'}</span>
    <span className="mt-1 block">Entry: {formatDisplayDate(trade.entryDate)}</span>
    <span className="block">Close: {formatDisplayDate(trade.closedOn)}</span>
    <span className={`block ${pnlTextClass(trade.realizedPnL)}`}>P&amp;L: {money(trade.realizedPnL)}</span>
    <span className="block">R: {Number(trade.realizedR || 0).toFixed(2)}</span>
  </span>
);

const TradeClustersCalendar = ({
  months,
  selectedYear,
  availableYears,
  onPreviousYear,
  onNextYear,
  onTradeClick,
  chartLoadingTradeId,
  expanded,
  onToggleExpanded
}) => {
  const monthsByKey = new Map((months || []).map((month) => [month.monthKey, month]));
  const yearRows = Array.from({ length: 12 }, (_, monthIndex) => {
    const monthKey = `${selectedYear}-${String(monthIndex + 1).padStart(2, '0')}`;
    const source = monthsByKey.get(monthKey);
    const daysByNumber = new Map((source?.days || []).map((day) => [day.dayOfMonth, day]));
    const daysInMonth = getDaysInMonth(selectedYear, monthIndex);

    return {
      monthIndex,
      monthKey,
      label: monthShortLabel(selectedYear, monthIndex),
      cells: Array.from({ length: 31 }, (_, dayIndex) => {
        const dayOfMonth = dayIndex + 1;
        if (dayOfMonth > daysInMonth) return null;
        return daysByNumber.get(dayOfMonth) || { dayOfMonth, trades: [] };
      })
    };
  });
  const hasTrades = yearRows.some((row) => row.cells.some((cell) => cell?.trades?.length));
  const canGoPrevious = availableYears.indexOf(selectedYear) < availableYears.length - 1;
  const canGoNext = availableYears.indexOf(selectedYear) > 0;
  const tooltipPlacementClass = ({ rowIndex, dayIndex }) => {
    const placeAbove = rowIndex >= 9;
    const alignRight = dayIndex >= 28;
    const alignLeft = dayIndex <= 2;

    const verticalClass = placeAbove ? 'bottom-full mb-2' : 'top-full mt-2';
    if (alignRight) return `${verticalClass} right-0`;
    if (alignLeft) return `${verticalClass} left-0`;
    return `${verticalClass} left-1/2 -translate-x-1/2`;
  };

  if (!availableYears.length) {
    return (
      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Trade Clusters Calendar</h2>
          <button type="button" onClick={onToggleExpanded} className="btn-muted px-3 py-1.5 text-sm">
            {expanded ? 'Hide Calendar' : 'Show Calendar'}
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">No closed trades available yet.</p>
      </section>
    );
  }

  return (
    <section className="surface-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Trade Clusters Calendar</h2>
        <div className="flex items-center gap-4">
          <button type="button" onClick={onToggleExpanded} className="btn-muted px-3 py-1.5 text-sm">
            {expanded ? 'Hide Calendar' : 'Show Calendar'}
          </button>
        </div>
      </div>

      {expanded ? (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              One row per month and one column per day, with stacked dots per trading day.
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                onClick={onNextYear}
                disabled={!canGoNext}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                aria-label="Show newer year"
                title="Show newer year"
              >
                ↑
              </button>
              <span className="min-w-16 text-center text-sm font-semibold">{selectedYear}</span>
              <button
                type="button"
                onClick={onPreviousYear}
                disabled={!canGoPrevious}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                aria-label="Show older year"
                title="Show older year"
              >
                ↓
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[1320px] rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-slate-100/70 shadow-sm dark:border-slate-800 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900/70">
              <div className="grid grid-cols-[84px_repeat(31,minmax(36px,1fr))] border-b border-slate-200/80 bg-slate-100/80 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-400">
                <div className="sticky left-0 z-10 border-r border-slate-200/80 bg-slate-100/95 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/95">
                  Month
                </div>
                {Array.from({ length: 31 }, (_, dayIndex) => (
                  <div
                    key={dayIndex + 1}
                    className="border-r border-slate-200/60 px-1 py-3 text-center last:border-r-0 dark:border-slate-800/80"
                  >
                    {dayIndex + 1}
                  </div>
                ))}
              </div>

              {yearRows.map((row, rowIndex) => (
                <div
                  key={row.monthKey}
                  className="grid grid-cols-[84px_repeat(31,minmax(36px,1fr))] border-b border-slate-200/70 last:border-b-0 dark:border-slate-800"
                >
                  <div className="sticky left-0 z-10 flex items-center border-r border-slate-200/80 bg-white/95 px-3 py-3 text-sm font-semibold dark:border-slate-800 dark:bg-slate-950/95">
                    {row.label}
                  </div>
                  {row.cells.map((day, index) => (
                    <div
                      key={`${row.monthKey}-${index + 1}`}
                      className={`min-h-16 border-r border-slate-200/60 px-1 py-1 last:border-r-0 dark:border-slate-800/80 ${
                        day
                          ? 'bg-white/75 dark:bg-slate-950/60'
                          : 'bg-slate-100/50 dark:bg-slate-900/50'
                      }`}
                    >
                      {day ? (
                    <div className="flex flex-wrap items-start justify-center gap-1 overflow-visible pt-1">
                      {day.trades.map((trade) => {
                            const isLoading = chartLoadingTradeId === String(trade.id);
                            return (
                              <button
                                key={trade.id}
                                type="button"
                                onClick={() => onTradeClick(trade)}
                                disabled={isLoading}
                                className={`group relative z-0 inline-flex rounded-full transition-transform duration-150 hover:z-[70] hover:scale-110 focus-visible:z-[70] focus-visible:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-wait disabled:opacity-60 ${
                                  trade.isProfitable
                                    ? 'bg-emerald-500 ring-emerald-200 dark:bg-emerald-400 dark:ring-emerald-900'
                                    : 'bg-red-500 ring-red-200 dark:bg-red-400 dark:ring-red-900'
                                } ${tradeDotSizeClass(trade.tradesOnSameDay)}`}
                                title={trade.symbol || 'Trade'}
                                aria-label={`${trade.symbol || 'Trade'} on ${formatDisplayDate(trade.entryDate)}`}
                              >
                            <span className="absolute inset-0 rounded-full ring-2 ring-current/10" aria-hidden="true" />
                            <CalendarTradeTooltip
                              trade={trade}
                              className={tooltipPlacementClass({ rowIndex, dayIndex: index + 1 })}
                            />
                          </button>
                        );
                      })}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {!hasTrades ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">No closed trades found for {selectedYear}.</p>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          Click `Show Calendar` to expand the full year trade-cluster matrix for {selectedYear}.
        </p>
      )}
    </section>
  );
};

const EquityTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  return (
    <div className="rounded border border-slate-300 bg-white px-3 py-2 text-xs shadow dark:border-slate-700 dark:bg-slate-900">
      <p className="font-medium">{formatDisplayDate(label)}</p>
      <p className={pnlTextClass(point.eventPnl)}>Event P&L: {money(point.eventPnl)}</p>
      <p className="text-slate-700 dark:text-slate-300">Equity: {money(point.equity)}</p>
      <p className="text-slate-700 dark:text-slate-300">Symbols: {symbolText(point.symbols)}</p>
    </div>
  );
};

const MonthlyPnlTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  return (
    <div className="rounded border border-slate-300 bg-white px-3 py-2 text-xs shadow dark:border-slate-700 dark:bg-slate-900">
      <p className="font-medium">{monthLabel(label)}</p>
      <p className={pnlTextClass(point.pnl)}>P&L: {money(point.pnl)}</p>
      <p className="text-slate-700 dark:text-slate-300">
        Trades in bar: {Number(point.tradesInBar || 0)}
      </p>
      <p className="text-slate-700 dark:text-slate-300">Symbols: {symbolText(point.symbols)}</p>
    </div>
  );
};

const DashboardPage = () => {
  const { theme, settings, setSettings } = useSettings();
  const [data, setData] = useState(dashboardCache.data);
  const [loading, setLoading] = useState(!dashboardCache.data);
  const [error, setError] = useState('');
  const [excludedOpenPositionIds, setExcludedOpenPositionIds] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [hiddenGroups, setHiddenGroups] = useState({});
  const [showAllWinningTrades, setShowAllWinningTrades] = useState(false);
  const [showAllLosingTrades, setShowAllLosingTrades] = useState(false);
  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [showTradeClusterCalendar, setShowTradeClusterCalendar] = useState(false);
  const [chartTrade, setChartTrade] = useState(null);
  const [chartLoadingTradeId, setChartLoadingTradeId] = useState('');
  const [refreshingCmp, setRefreshingCmp] = useState(false);
  const [openTradesSort, setOpenTradesSort] = useState({ key: 'earliestEntryDate', direction: 'asc' });

  useEffect(() => {
    const load = async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const response = await fetchDashboard();
        setData(response);
        dashboardCache.data = response;
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load dashboard');
      } finally {
        if (!silent) setLoading(false);
      }
    };

    if (dashboardCache.data) {
      setData(dashboardCache.data);
      setLoading(false);
      load({ silent: true });
      return;
    }
    load();
  }, []);

  const analytics = data?.analytics || {
    summary: {},
    winningTrades: [],
    losingTrades: [],
    equityCurve: [],
    monthlyPnL: [],
    calendarTradeClusters: []
  };
  const openTrades = data?.openTrades || [];
  const totalCapital = data?.totalCapital || 0;
  const summary = analytics.summary || {};
  const winningTrades = analytics.winningTrades || [];
  const losingTrades = analytics.losingTrades || [];
  const equityCurve = analytics.equityCurve || [];
  const monthlyPnL = analytics.monthlyPnL || [];
  const calendarTradeClusters = analytics.calendarTradeClusters || [];
  const latestMonthly = monthlyPnL.length ? monthlyPnL[monthlyPnL.length - 1] : null;
  const monthlyLabel = latestMonthly?.month ? ` (${monthLabel(latestMonthly.month)})` : '';
  const availableYears = useMemo(() => {
    const years = new Set();
    [...winningTrades, ...losingTrades].forEach((trade) => {
      const year = toYear(trade.openedOn);
      if (year !== null) years.add(year);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [winningTrades, losingTrades]);
  useEffect(() => {
    if (!availableYears.length) return;
    setSelectedYear((current) => (current !== null && availableYears.includes(current) ? current : availableYears[0]));
  }, [availableYears]);
  const availableMonths = useMemo(() => {
    if (selectedYear === null) return [];

    const monthSet = new Set();
    [...winningTrades, ...losingTrades].forEach((trade) => {
      if (toYear(trade.openedOn) !== selectedYear) return;
      const monthIndex = toMonthIndex(trade.openedOn);
      if (monthIndex !== null) monthSet.add(monthIndex);
    });

    return Array.from(monthSet)
      .sort((a, b) => a - b)
      .map((monthIndex) => ({
        value: String(monthIndex),
        label: monthShortLabel(selectedYear, monthIndex)
      }));
  }, [winningTrades, losingTrades, selectedYear]);
  useEffect(() => {
    setSelectedMonth((current) =>
      availableMonths.some((month) => month.value === current) ? current : availableMonths.at(-1)?.value || 'all'
    );
  }, [availableMonths]);
  useEffect(() => {
    setExcludedOpenPositionIds(settings?.dashboardExcludedOpenPositions || []);
  }, [settings?.dashboardExcludedOpenPositions]);
  const filteredWinningTrades = useMemo(
    () =>
      selectedYear === null
        ? winningTrades
        : winningTrades.filter((trade) => {
            if (toYear(trade.openedOn) !== selectedYear) return false;
            if (selectedMonth === null || selectedMonth === 'all') return true;
            return toMonthIndex(trade.openedOn) === Number(selectedMonth);
          }),
    [winningTrades, selectedYear, selectedMonth]
  );
  const filteredLosingTrades = useMemo(
    () =>
      selectedYear === null
        ? losingTrades
        : losingTrades.filter((trade) => {
            if (toYear(trade.openedOn) !== selectedYear) return false;
            if (selectedMonth === null || selectedMonth === 'all') return true;
            return toMonthIndex(trade.openedOn) === Number(selectedMonth);
          }),
    [losingTrades, selectedYear, selectedMonth]
  );
  const visibleWinningTrades = showAllWinningTrades
    ? filteredWinningTrades
    : filteredWinningTrades.slice(0, 5);
  const visibleLosingTrades = showAllLosingTrades
    ? filteredLosingTrades
    : filteredLosingTrades.slice(0, 5);
  const visibleCalendarMonths = useMemo(
    () =>
      selectedYear === null
        ? calendarTradeClusters
        : calendarTradeClusters.filter((month) => Number(month.monthKey.slice(0, 4)) === selectedYear),
    [calendarTradeClusters, selectedYear]
  );
  const closedTradeSequence = useMemo(
    () => [...filteredWinningTrades, ...filteredLosingTrades].map((trade) => String(trade.id)),
    [filteredWinningTrades, filteredLosingTrades]
  );
  const chartTradeIndex = useMemo(() => {
    if (!chartTrade?._id) return -1;
    return closedTradeSequence.findIndex((id) => id === String(chartTrade._id));
  }, [closedTradeSequence, chartTrade]);

  const groupedOpenTrades = useMemo(() => {
    const groups = new Map();
    openTrades.forEach((trade) => {
      const key = `${trade.symbol}__${trade.side}`;
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          symbol: trade.symbol,
          side: trade.side,
          trades: [],
          earliestEntryDate: trade.entryDate,
          totalEntryQty: 0,
          openQty: 0,
          avgEntryValue: 0,
          capitalAtRisk: 0,
          realizedPnL: 0,
          unrealizedPnL: 0,
          unrealizedAllKnown: true,
          realizedR: 0,
          cmp: null
        });
      }
      const group = groups.get(key);
      group.trades.push(trade);
      if (new Date(trade.entryDate) < new Date(group.earliestEntryDate)) {
        group.earliestEntryDate = trade.entryDate;
      }
      const totalEntryQty = Number(trade.metrics.totalEntryQty || 0);
      const openQty = Number(trade.metrics.openQty || 0);
      group.totalEntryQty += totalEntryQty;
      group.openQty += openQty;
      group.avgEntryValue += Number(trade.metrics.avgEntryPrice || 0) * openQty;
      group.capitalAtRisk += Number(trade.metrics.capitalAtRisk || 0);
      group.realizedPnL += Number(trade.metrics.realizedPnL || 0);
      const livePrice = Number(trade.lastPrice);
      if (group.cmp === null && Number.isFinite(livePrice) && livePrice > 0) {
        group.cmp = livePrice;
      }
      if (trade.metrics.unrealizedPnL === null || trade.metrics.unrealizedPnL === undefined) {
        group.unrealizedAllKnown = false;
      } else {
        group.unrealizedPnL += Number(trade.metrics.unrealizedPnL || 0);
      }
      group.realizedR += Number(trade.metrics.realizedR || 0);
    });

    return Array.from(groups.values())
      .map((group) => {
        const avgEntryPrice = group.openQty ? group.avgEntryValue / group.openQty : 0;
        const positionSizeValue = group.avgEntryValue;
        const pyramidCount = group.trades.reduce((acc, trade) => acc + getTradePyramidCount(trade), 0);
        const hasPartialExits = group.trades.some((trade) => getTradeHasPartialExits(trade));
        return {
          ...group,
          avgEntryPrice,
          positionSizeValue,
          positionSizePercent: totalCapital ? (positionSizeValue / totalCapital) * 100 : 0,
          riskPercent: totalCapital ? (group.capitalAtRisk / totalCapital) * 100 : 0,
          unrealizedPnL: group.unrealizedAllKnown ? group.unrealizedPnL : null,
          holdingDays: diffInCalendarDaysInclusive(group.earliestEntryDate),
          pyramidCount,
          hasPartialExits
        };
      })
      .sort((a, b) => new Date(a.earliestEntryDate) - new Date(b.earliestEntryDate));
  }, [openTrades, totalCapital]);
  const includedGroupedOpenTrades = useMemo(
    () => groupedOpenTrades.filter((group) => !excludedOpenPositionIds.includes(group.id)),
    [groupedOpenTrades, excludedOpenPositionIds]
  );
  const sortedGroupedOpenTrades = useMemo(() => {
    const list = [...groupedOpenTrades];
    const factor = openTradesSort.direction === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (openTradesSort.key === 'positionSizeValue') {
        return (Number(a.positionSizeValue || 0) - Number(b.positionSizeValue || 0)) * factor;
      }
      if (openTradesSort.key === 'capitalAtRisk') {
        return (Number(a.capitalAtRisk || 0) - Number(b.capitalAtRisk || 0)) * factor;
      }
      return (new Date(a.earliestEntryDate) - new Date(b.earliestEntryDate)) * factor;
    });
    return list;
  }, [groupedOpenTrades, openTradesSort]);
  const totalCapitalAtRiskIncluded = includedGroupedOpenTrades.reduce(
    (acc, group) => acc + Number(group.capitalAtRisk || 0),
    0
  );
  const totalCapitalAtRiskPercent = totalCapital ? (totalCapitalAtRiskIncluded / totalCapital) * 100 : 0;
  const totalPositionSize = includedGroupedOpenTrades.reduce(
    (acc, group) => acc + Number(group.positionSizeValue || 0),
    0
  );
  const totalPositionSizePercent = totalCapital ? (totalPositionSize / totalCapital) * 100 : 0;
  const totalUnrealizedPnL = includedGroupedOpenTrades.reduce(
    (acc, group) => acc + Number(group.unrealizedPnL || 0),
    0
  );
  const hasKnownUnrealizedPnL = includedGroupedOpenTrades.some((group) => group.unrealizedPnL !== null);
  const dashboardCards = settings?.dashboardCards || {};

  if (loading) return <p>Loading dashboard...</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  const toggleGroup = (id) => {
    setExpandedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const toggleHiddenGroup = (id) => {
    setHiddenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const refreshCmp = async () => {
    setRefreshingCmp(true);
    try {
      const response = await fetchDashboard({ forceRefreshCmp: true });
      setData(response);
      dashboardCache.data = response;
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to refresh CMP');
    } finally {
      setRefreshingCmp(false);
    }
  };
  const toggleOpenTradesSort = (key) => {
    setOpenTradesSort((current) => (
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'desc' }
    ));
  };
  const toggleDashboardPosition = async (groupId) => {
    const nextExcluded = excludedOpenPositionIds.includes(groupId)
      ? excludedOpenPositionIds.filter((id) => id !== groupId)
      : [...excludedOpenPositionIds, groupId];
    setExcludedOpenPositionIds(nextExcluded);
    setSettings((prev) => (
      prev
        ? {
            ...prev,
            dashboardExcludedOpenPositions: nextExcluded
          }
        : prev
    ));
    try {
      const updatedSettings = await saveSettings({ dashboardExcludedOpenPositions: nextExcluded });
      setExcludedOpenPositionIds(updatedSettings?.dashboardExcludedOpenPositions || []);
      setSettings(updatedSettings);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update dashboard position setting');
    }
  };
  const openChartForTrade = async (tradeSummary) => {
    const tradeId = String(tradeSummary?.id || '');
    if (!tradeId) return;
    setChartLoadingTradeId(tradeId);
    try {
      const fullTrade = await fetchTrade(tradeId);
      setChartTrade(fullTrade);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to load trade chart');
    } finally {
      setChartLoadingTradeId('');
    }
  };
  const showPrevChartTrade = async () => {
    if (chartTradeIndex <= 0) return;
    const nextId = closedTradeSequence[chartTradeIndex - 1];
    if (!nextId) return;
    setChartLoadingTradeId(nextId);
    try {
      const fullTrade = await fetchTrade(nextId);
      setChartTrade(fullTrade);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to load trade chart');
    } finally {
      setChartLoadingTradeId('');
    }
  };
  const showNextChartTrade = async () => {
    if (chartTradeIndex < 0 || chartTradeIndex >= closedTradeSequence.length - 1) return;
    const nextId = closedTradeSequence[chartTradeIndex + 1];
    if (!nextId) return;
    setChartLoadingTradeId(nextId);
    try {
      const fullTrade = await fetchTrade(nextId);
      setChartTrade(fullTrade);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to load trade chart');
    } finally {
      setChartLoadingTradeId('');
    }
  };

  const isDark = theme === 'dark';
  const chartGrid = isDark ? '#334155' : '#cbd5e1';
  const chartAxis = isDark ? '#475569' : '#94a3b8';
  const chartTick = isDark ? '#cbd5e1' : '#334155';
  const selectedYearIndex = availableYears.indexOf(selectedYear);
  const selectedMonthIndex = availableMonths.findIndex((month) => month.value === selectedMonth);
  const selectedMonthLabel =
    selectedMonth === 'all'
      ? 'All Months'
      : availableMonths.find((month) => month.value === selectedMonth)?.label || 'No months';
  const canShowPreviousMonth = selectedMonth !== 'all' && selectedMonthIndex > 0;
  const canShowNextMonth = selectedMonth !== 'all' && selectedMonthIndex >= 0 && selectedMonthIndex < availableMonths.length - 1;
  const showPreviousYear = () => {
    if (selectedYearIndex < 0 || selectedYearIndex >= availableYears.length - 1) return;
    setSelectedYear(availableYears[selectedYearIndex + 1]);
  };
  const showNextYear = () => {
    if (selectedYearIndex <= 0) return;
    setSelectedYear(availableYears[selectedYearIndex - 1]);
  };
  const showPreviousMonth = () => {
    if (!canShowPreviousMonth) return;
    setSelectedMonth(availableMonths[selectedMonthIndex - 1]?.value || 'all');
  };
  const showNextMonth = () => {
    if (!canShowNextMonth) return;
    setSelectedMonth(availableMonths[selectedMonthIndex + 1]?.value || 'all');
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Data at a glance</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {dashboardCards.totalRealizedPnl !== false && (
            <SummaryCard
              label="Total Realized P&L"
              value={money(summary.totalRealizedPnL)}
              valueClassName={pnlTextClass(summary.totalRealizedPnL)}
            />
          )}
          {dashboardCards.monthlyPnl !== false && (
            <SummaryCard
              label={`Monthly P&L${monthlyLabel}`}
              value={money(summary.monthlyRealizedPnL)}
              valueClassName={pnlTextClass(summary.monthlyRealizedPnL)}
            />
          )}
          {dashboardCards.totalCapitalAtRisk !== false && (
            <SummaryCard
              label="Total Capital at Risk"
              value={`${money(totalCapitalAtRiskIncluded)} (${totalCapitalAtRiskPercent.toFixed(2)}%)`}
              className="border border-amber-300/80 bg-amber-50/70 shadow-sm dark:border-amber-500/50 dark:bg-amber-950/20"
              valueClassName="text-amber-700 dark:text-amber-300"
            />
          )}
          {dashboardCards.totalPositionSize !== false && (
            <SummaryCard
              label="Total Position Size"
              value={`${money(totalPositionSize)} (${totalPositionSizePercent.toFixed(2)}%)`}
            />
          )}
          {dashboardCards.totalUnrealizedPnl !== false && (
            <SummaryCard
              label="Total Unrealized P&L"
              value={hasKnownUnrealizedPnL ? money(totalUnrealizedPnL) : 'N/A'}
              valueClassName={hasKnownUnrealizedPnL ? pnlTextClass(totalUnrealizedPnL) : undefined}
            />
          )}
          {dashboardCards.avgR === true && <SummaryCard label="Avg R" value={summary.avgR} />}
          {dashboardCards.avgHoldingDays !== false && (
            <SummaryCard label="Avg Holding Days" value={`${summary.avgHoldingDays || 0} days`} />
          )}
          {dashboardCards.winRate !== false && <SummaryCard label="Win Rate" value={`${summary.winRate}%`} />}
          {dashboardCards.avgWinnerLoser !== false && (
            <SummaryCard
              label="Avg Winner / Loser"
              value={`${money(summary.avgWinner)} / ${money(summary.avgLoser)}`}
            />
          )}
          {dashboardCards.profitFactor === true && <SummaryCard label="Profit Factor" value={summary.profitFactor} />}
          {dashboardCards.maxDrawdown === true && (
            <SummaryCard label="Max Drawdown" value={money(summary.maxDrawdown)} />
          )}
          {dashboardCards.tradesOpenCount !== false && (
            <SummaryCard
              label="Trades / Open"
              value={`${summary.tradesCount} / ${includedGroupedOpenTrades.length}`}
            />
          )}
        </div>
      </section>

      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Open Trades</h2>
          <button
            type="button"
            onClick={refreshCmp}
            disabled={refreshingCmp}
            className="btn-muted px-3 py-1.5 text-sm disabled:cursor-wait disabled:opacity-60"
          >
            {refreshingCmp ? 'Refreshing CMP...' : 'Refresh CMP'}
          </button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-3 py-2" />
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Avg Entry</th>
                <th className="px-3 py-2">CMP</th>
                <th className="px-3 py-2">Open Qty</th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggleOpenTradesSort('positionSizeValue')}
                    className="inline-flex items-center gap-1 hover:text-sky-600 dark:hover:text-sky-300"
                  >
                    Position Size (Rs / %)
                    <SortArrow
                      active={openTradesSort.key === 'positionSizeValue'}
                      direction={openTradesSort.direction}
                    />
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggleOpenTradesSort('capitalAtRisk')}
                    className="inline-flex items-center gap-1 hover:text-sky-600 dark:hover:text-sky-300"
                  >
                    Cpital at Risk (Rs / %)
                    <SortArrow
                      active={openTradesSort.key === 'capitalAtRisk'}
                      direction={openTradesSort.direction}
                    />
                  </button>
                </th>
                <th className="px-3 py-2">Holding Days</th>
                <th className="px-3 py-2">Realized P&L</th>
                <th className="px-3 py-2">Unrealized P&L</th>
                <th className="px-3 py-2">Actions</th>
                <th className="px-3 py-2">Dash</th>
              </tr>
            </thead>
            <tbody>
              {sortedGroupedOpenTrades.map((group) => {
                const canExpand = group.side === 'LONG' && group.trades.length > 1;
                const isHidden = Boolean(hiddenGroups[group.id]);
                const isExcluded = excludedOpenPositionIds.includes(group.id);
                const primaryTrade = group.trades[0] || null;
                const isSingleTrade = group.trades.length === 1;
                return (
                  <Fragment key={group.id}>
                    <tr className={isExcluded ? 'table-row-hover opacity-70' : 'table-row-hover'}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!canExpand}
                            onClick={() => canExpand && toggleGroup(group.id)}
                            className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-colors duration-200 ${
                              canExpand
                                ? 'border-violet-400/80 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-500/60 dark:bg-violet-950/30 dark:text-violet-200 dark:hover:bg-violet-900/50'
                                : 'cursor-not-allowed border-slate-300 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-600'
                            }`}
                            aria-label={canExpand ? 'Show buy breakup' : 'Single entry'}
                            title={canExpand ? 'Show buy breakup' : 'Single entry'}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              className={`h-3.5 w-3.5 transition-transform duration-200 ${
                                expandedGroups[group.id] ? 'rotate-180' : ''
                              }`}
                              aria-hidden="true"
                            >
                              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleHiddenGroup(group.id)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 transition-colors duration-200 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                            aria-label={isHidden ? 'Show data' : 'Hide data'}
                            title={isHidden ? 'Show data' : 'Hide data'}
                          >
                            {isHidden ? (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.9"
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              >
                                <path d="M3 3 21 21" strokeLinecap="round" />
                                <path d="M10.7 10.7a2 2 0 0 0 2.8 2.8" />
                                <path d="M9.9 5.1A10.9 10.9 0 0 1 12 5c5.4 0 9.2 4.2 10 7-0.4 1.3-1.4 2.8-2.8 4.1" />
                                <path d="M6.7 6.7C4.7 8 3.4 9.9 3 12c0.8 2.8 4.6 7 10 7 1 0 1.9-.1 2.8-.3" />
                              </svg>
                            ) : (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.9"
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              >
                                <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {isHidden ? (
                          '••••'
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openChartForTrade({ id: primaryTrade?._id })}
                              disabled={!primaryTrade?._id || chartLoadingTradeId === String(primaryTrade?._id)}
                              className="underline decoration-dotted underline-offset-2 hover:text-sky-600 disabled:cursor-wait disabled:opacity-60 dark:hover:text-sky-300"
                              title="Open chart"
                            >
                              {group.symbol}
                            </button>
                            <TradeStructureIndicators
                              pyramidCount={group.pyramidCount}
                              hasPartialExits={group.hasPartialExits}
                            />
                            {primaryTrade?._id ? (
                              <Link
                                href={`/trades/${primaryTrade._id}`}
                                className="group relative inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 transition-colors duration-200 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                aria-label={`Details for ${group.symbol}`}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.9"
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                >
                                  <path d="M9 9h6v6" strokeLinecap="round" />
                                  <path d="m15 9-6 6" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M5 12v7h7" strokeLinecap="round" />
                                  <path d="M12 5h7v7" strokeLinecap="round" />
                                </svg>
                                <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                                  Details
                                </span>
                              </Link>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">{isHidden ? '••••' : group.avgEntryPrice.toFixed(2)}</td>
                      <td className="px-3 py-2">
                        {isHidden ? '••••' : group.cmp === null ? 'N/A' : group.cmp.toFixed(2)}
                      </td>
                      <td className="px-3 py-2">{isHidden ? '••••' : group.openQty}</td>
                      <td className="px-3 py-2">
                        {isHidden
                          ? '••••'
                          : `${money(group.positionSizeValue)} (${group.positionSizePercent.toFixed(2)}%)`}
                      </td>
                      <td className="px-3 py-2">
                        {isHidden ? '••••' : `${money(group.capitalAtRisk)} (${group.riskPercent.toFixed(2)}%)`}
                      </td>
                      <td className="px-3 py-2">{isHidden ? '••••' : group.holdingDays}</td>
                      <td className={`px-3 py-2 ${isHidden ? '' : pnlTextClass(group.realizedPnL)}`}>
                        {isHidden ? '••••' : money(group.realizedPnL)}
                      </td>
                      <td className="px-3 py-2">
                        {isHidden ? (
                          '••••'
                        ) : group.unrealizedPnL === null ? (
                          'N/A'
                        ) : (
                          <span className={pnlTextClass(group.unrealizedPnL)}>
                            {money(group.unrealizedPnL)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isHidden ? (
                          '••••'
                        ) : isSingleTrade ? (
                          <OpenTradeActionButtons tradeId={primaryTrade?._id} />
                        ) : (
                          <span className="text-xs text-slate-500 dark:text-slate-400">Expand for trade actions</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggleDashboardPosition(group.id)}
                          className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-colors duration-200 ${
                            isExcluded
                              ? 'border-slate-300 bg-white text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
                              : 'border-emerald-400/80 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50'
                          }`}
                          aria-label={isExcluded ? 'Include in dashboard calculations' : 'Exclude from dashboard calculations'}
                          title={isExcluded ? 'Include in dashboard calculations' : 'Exclude from dashboard calculations'}
                        >
                          {isExcluded ? (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.9"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            >
                              <path d="M3 3 21 21" strokeLinecap="round" />
                              <path d="M10.7 10.7a2 2 0 0 0 2.8 2.8" />
                              <path d="M9.9 5.1A10.9 10.9 0 0 1 12 5c5.4 0 9.2 4.2 10 7-0.4 1.3-1.4 2.8-2.8 4.1" />
                              <path d="M6.7 6.7C4.7 8 3.4 9.9 3 12c0.8 2.8 4.6 7 10 7 1 0 1.9-.1 2.8-.3" />
                            </svg>
                          ) : (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.9"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            >
                              <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </td>
                    </tr>
                    {canExpand && expandedGroups[group.id] && (
                      <tr className="border-b-2 border-slate-300 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/70">
                        <td className="px-3 py-2 text-xs" colSpan={12}>
                          <div className="space-y-2">
                            {isHidden ? (
                              <p className="text-slate-600 dark:text-slate-300">Data hidden for this position.</p>
                            ) : (
                              group.trades
                                .slice()
                                .sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate))
                                .map((trade) => (
                                  <div
                                    key={trade._id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white/80 px-3 py-2 text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
                                  >
                                    <p>
                                      {formatDisplayDate(trade.entryDate)} | Entry: {trade.entryPrice} | Qty: {trade.entryQty} | Open Qty: {trade.metrics.openQty}
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <OpenTradeActionButtons tradeId={trade._id} compact />
                                      <Link
                                        href={`/trades/${trade._id}`}
                                        className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 transition-colors duration-200 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                      >
                                        Details
                                      </Link>
                                    </div>
                                  </div>
                                ))
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!groupedOpenTrades.length && (
                <tr>
                  <td className="px-3 py-4 text-slate-600 dark:text-slate-400" colSpan={11}>
                    No open trades.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="surface-card p-4">
          <h2 className="text-lg font-semibold">Equity Curve</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equityCurve}>
                <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fill: chartTick }} axisLine={{ stroke: chartAxis }} tickLine={{ stroke: chartAxis }} />
                <YAxis tick={{ fill: chartTick }} axisLine={{ stroke: chartAxis }} tickLine={{ stroke: chartAxis }} />
                <Tooltip
                  content={<EquityTooltip />}
                />
                <Line type="monotone" dataKey="equity" stroke="#34d399" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="surface-card p-4">
          <h2 className="text-lg font-semibold">Monthly P&L</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyPnL}>
                <CartesianGrid stroke={chartGrid} strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fill: chartTick }} axisLine={{ stroke: chartAxis }} tickLine={{ stroke: chartAxis }} />
                <YAxis tick={{ fill: chartTick }} axisLine={{ stroke: chartAxis }} tickLine={{ stroke: chartAxis }} />
                <Tooltip
                  content={<MonthlyPnlTooltip />}
                />
                <Bar dataKey="pnl" fill="#34d399" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <TradeClustersCalendar
        months={visibleCalendarMonths}
        selectedYear={selectedYear || availableYears[0] || new Date().getUTCFullYear()}
        availableYears={availableYears}
        onPreviousYear={showPreviousYear}
        onNextYear={showNextYear}
        onTradeClick={openChartForTrade}
        chartLoadingTradeId={chartLoadingTradeId}
        expanded={showTradeClusterCalendar}
        onToggleExpanded={() => setShowTradeClusterCalendar((prev) => !prev)}
      />

      <section className="surface-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Closed Trades</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <span>Year</span>
              <select
                value={selectedYear || ''}
                onChange={(event) => setSelectedYear(Number(event.target.value))}
                disabled={!availableYears.length}
                className="min-w-[6rem] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {availableYears.length ? (
                  availableYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))
                ) : (
                  <option value="">No years</option>
                )}
              </select>
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
              <span className="text-sm text-slate-600 dark:text-slate-300">Month</span>
              <button
                type="button"
                onClick={showPreviousMonth}
                disabled={!canShowPreviousMonth}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                aria-label="Show previous month"
                title="Show previous month"
              >
                ↑
              </button>
              <span className="min-w-20 text-center text-sm font-semibold text-slate-900 dark:text-slate-100">
                {selectedMonthLabel}
              </span>
              <button
                type="button"
                onClick={showNextMonth}
                disabled={!canShowNextMonth}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                aria-label="Show next month"
                title="Show next month"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => setSelectedMonth('all')}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  selectedMonth === 'all'
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                All Months
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section>
            <h3 className="text-base font-semibold text-emerald-700 dark:text-emerald-300">
              Winning Trades ({filteredWinningTrades.length})
            </h3>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="table-head">
                  <tr>
                    <th className="px-3 py-2">Symbol</th>
                    <th className="px-3 py-2">First Entry</th>
                    <th className="px-3 py-2">Final Close</th>
                    <th className="px-3 py-2">Realized P&L</th>
                    <th className="px-3 py-2">Realized R</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleWinningTrades.map((trade) => (
                    <tr key={trade.id} className="table-row-hover">
                      <td className="px-3 py-2 font-medium">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openChartForTrade(trade)}
                            disabled={chartLoadingTradeId === String(trade.id)}
                            className="underline decoration-dotted underline-offset-2 hover:text-sky-600 disabled:cursor-wait disabled:opacity-60 dark:hover:text-sky-300"
                            title="Open chart"
                          >
                            {trade.symbol}
                          </button>
                          <TradeStructureIndicators
                            pyramidCount={trade.pyramidCount}
                            hasPartialExits={trade.hasPartialExits}
                          />
                          <Link
                            href={`/trades/${trade.id}`}
                            className="group relative inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 transition-colors duration-200 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                            aria-label={`Details for ${trade.symbol}`}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.9"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            >
                              <path d="M9 9h6v6" strokeLinecap="round" />
                              <path d="m15 9-6 6" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M5 12v7h7" strokeLinecap="round" />
                              <path d="M12 5h7v7" strokeLinecap="round" />
                            </svg>
                            <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                              Details
                            </span>
                          </Link>
                        </div>
                      </td>
                      <td className="px-3 py-2">{formatDisplayDate(trade.openedOn)}</td>
                      <td className="px-3 py-2">{formatDisplayDate(trade.closedOn)}</td>
                      <td className={`px-3 py-2 ${pnlTextClass(trade.realizedPnL)}`}>
                        {money(trade.realizedPnL)}
                      </td>
                      <td className="px-3 py-2">{Number(trade.realizedR || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                  {!filteredWinningTrades.length && (
                    <tr>
                      <td className="px-3 py-4 text-slate-600 dark:text-slate-400" colSpan={5}>
                        No winning trades for this month.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredWinningTrades.length > 5 && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  className="btn-muted px-3 py-1.5 text-sm"
                  onClick={() => setShowAllWinningTrades((prev) => !prev)}
                >
                  {showAllWinningTrades ? 'Show Less' : 'Show Full Data'}
                </button>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-base font-semibold text-red-700 dark:text-red-300">
              Losing Trades ({filteredLosingTrades.length})
            </h3>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="table-head">
                  <tr>
                    <th className="px-3 py-2">Symbol</th>
                    <th className="px-3 py-2">First Entry</th>
                    <th className="px-3 py-2">Final Close</th>
                    <th className="px-3 py-2">Realized P&L</th>
                    <th className="px-3 py-2">Realized R</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLosingTrades.map((trade) => (
                    <tr key={trade.id} className="table-row-hover">
                      <td className="px-3 py-2 font-medium">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openChartForTrade(trade)}
                            disabled={chartLoadingTradeId === String(trade.id)}
                            className="underline decoration-dotted underline-offset-2 hover:text-sky-600 disabled:cursor-wait disabled:opacity-60 dark:hover:text-sky-300"
                            title="Open chart"
                          >
                            {trade.symbol}
                          </button>
                          <TradeStructureIndicators
                            pyramidCount={trade.pyramidCount}
                            hasPartialExits={trade.hasPartialExits}
                          />
                          <Link
                            href={`/trades/${trade.id}`}
                            className="group relative inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 transition-colors duration-200 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                            aria-label={`Details for ${trade.symbol}`}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.9"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            >
                              <path d="M9 9h6v6" strokeLinecap="round" />
                              <path d="m15 9-6 6" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M5 12v7h7" strokeLinecap="round" />
                              <path d="M12 5h7v7" strokeLinecap="round" />
                            </svg>
                            <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                              Details
                            </span>
                          </Link>
                        </div>
                      </td>
                      <td className="px-3 py-2">{formatDisplayDate(trade.openedOn)}</td>
                      <td className="px-3 py-2">{formatDisplayDate(trade.closedOn)}</td>
                      <td className={`px-3 py-2 ${pnlTextClass(trade.realizedPnL)}`}>
                        {money(trade.realizedPnL)}
                      </td>
                      <td className="px-3 py-2">{Number(trade.realizedR || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                  {!filteredLosingTrades.length && (
                    <tr>
                      <td className="px-3 py-4 text-slate-600 dark:text-slate-400" colSpan={5}>
                        No losing trades for this month.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredLosingTrades.length > 5 && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  className="btn-muted px-3 py-1.5 text-sm"
                  onClick={() => setShowAllLosingTrades((prev) => !prev)}
                >
                  {showAllLosingTrades ? 'Show Less' : 'Show Full Data'}
                </button>
              </div>
            )}
          </section>
        </div>
      </section>
      <TradeChartOverlay
        open={Boolean(chartTrade)}
        trade={chartTrade}
        onClose={() => setChartTrade(null)}
        onPrevTrade={showPrevChartTrade}
        onNextTrade={showNextChartTrade}
      />
    </div>
  );
};

export default DashboardPage;
