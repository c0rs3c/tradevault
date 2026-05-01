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
  const parsed = new Date(`${monthKey}-01T00:00:00`);
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
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [hasInitializedMonth, setHasInitializedMonth] = useState(false);
  const [chartTrade, setChartTrade] = useState(null);
  const [chartLoadingTradeId, setChartLoadingTradeId] = useState('');
  const [refreshingCmp, setRefreshingCmp] = useState(false);

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
    monthlyPnL: []
  };
  const openTrades = data?.openTrades || [];
  const totalCapital = data?.totalCapital || 0;
  const summary = analytics.summary || {};
  const winningTrades = analytics.winningTrades || [];
  const losingTrades = analytics.losingTrades || [];
  const equityCurve = analytics.equityCurve || [];
  const monthlyPnL = analytics.monthlyPnL || [];
  const latestMonthly = monthlyPnL.length ? monthlyPnL[monthlyPnL.length - 1] : null;
  const monthlyLabel = latestMonthly?.month ? ` (${monthLabel(latestMonthly.month)})` : '';
  const tradeMonthOptions = useMemo(() => {
    const months = new Set();
    [...winningTrades, ...losingTrades].forEach((trade) => {
      const monthKey = toMonthKey(trade.openedOn);
      if (monthKey) months.add(monthKey);
    });
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [winningTrades, losingTrades]);
  useEffect(() => {
    if (hasInitializedMonth) return;
    if (!tradeMonthOptions.length) return;
    setSelectedMonth(tradeMonthOptions[0]);
    setHasInitializedMonth(true);
  }, [tradeMonthOptions, hasInitializedMonth]);
  useEffect(() => {
    setExcludedOpenPositionIds(settings?.dashboardExcludedOpenPositions || []);
  }, [settings?.dashboardExcludedOpenPositions]);
  const filteredWinningTrades = useMemo(
    () =>
      selectedMonth === 'ALL'
        ? winningTrades
        : winningTrades.filter((trade) => toMonthKey(trade.openedOn) === selectedMonth),
    [winningTrades, selectedMonth]
  );
  const filteredLosingTrades = useMemo(
    () =>
      selectedMonth === 'ALL'
        ? losingTrades
        : losingTrades.filter((trade) => toMonthKey(trade.openedOn) === selectedMonth),
    [losingTrades, selectedMonth]
  );
  const visibleWinningTrades = showAllWinningTrades
    ? filteredWinningTrades
    : filteredWinningTrades.slice(0, 5);
  const visibleLosingTrades = showAllLosingTrades
    ? filteredLosingTrades
    : filteredLosingTrades.slice(0, 5);
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
        return {
          ...group,
          avgEntryPrice,
          positionSizeValue,
          positionSizePercent: totalCapital ? (positionSizeValue / totalCapital) * 100 : 0,
          riskPercent: totalCapital ? (group.capitalAtRisk / totalCapital) * 100 : 0,
          unrealizedPnL: group.unrealizedAllKnown ? group.unrealizedPnL : null
        };
      })
      .sort((a, b) => new Date(a.earliestEntryDate) - new Date(b.earliestEntryDate));
  }, [openTrades, totalCapital]);
  const includedGroupedOpenTrades = useMemo(
    () => groupedOpenTrades.filter((group) => !excludedOpenPositionIds.includes(group.id)),
    [groupedOpenTrades, excludedOpenPositionIds]
  );
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
                <th className="px-3 py-2">Position Size (Rs / %)</th>
                <th className="px-3 py-2">Cpital at Risk (Rs / %)</th>
                <th className="px-3 py-2">Realized P&L</th>
                <th className="px-3 py-2">Unrealized P&L</th>
                <th className="px-3 py-2">Dash</th>
              </tr>
            </thead>
            <tbody>
              {groupedOpenTrades.map((group) => {
                const canExpand = group.side === 'LONG' && group.trades.length > 1;
                const isHidden = Boolean(hiddenGroups[group.id]);
                const isExcluded = excludedOpenPositionIds.includes(group.id);
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
                      <td className="px-3 py-2 font-medium">{isHidden ? '••••' : group.symbol}</td>
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
                        <td className="px-3 py-2 text-xs" colSpan={10}>
                          <div className="space-y-2">
                            {isHidden ? (
                              <p className="text-slate-600 dark:text-slate-300">Data hidden for this position.</p>
                            ) : (
                              group.trades
                                .slice()
                                .sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate))
                                .map((trade) => (
                                  <p key={trade._id} className="text-slate-700 dark:text-slate-300">
                                    {formatDisplayDate(trade.entryDate)} | Entry: {trade.entryPrice} | Qty: {trade.entryQty} | Open Qty: {trade.metrics.openQty}
                                  </p>
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
                  <td className="px-3 py-4 text-slate-600 dark:text-slate-400" colSpan={10}>
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

      <section className="surface-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Closed Trades</h2>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Opened Month</span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="ALL">All Months</option>
              {tradeMonthOptions.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </select>
          </label>
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
                        <button
                          type="button"
                          onClick={() => openChartForTrade(trade)}
                          disabled={chartLoadingTradeId === String(trade.id)}
                          className="underline decoration-dotted underline-offset-2 hover:text-sky-600 disabled:cursor-wait disabled:opacity-60 dark:hover:text-sky-300"
                          title="Open chart"
                        >
                          {trade.symbol}
                        </button>
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
                        <button
                          type="button"
                          onClick={() => openChartForTrade(trade)}
                          disabled={chartLoadingTradeId === String(trade.id)}
                          className="underline decoration-dotted underline-offset-2 hover:text-sky-600 disabled:cursor-wait disabled:opacity-60 dark:hover:text-sky-300"
                          title="Open chart"
                        >
                          {trade.symbol}
                        </button>
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
