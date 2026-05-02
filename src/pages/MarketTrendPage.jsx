'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { useSettings } from '../contexts/SettingsContext';
import { fetchMarketTrendDashboard, syncMarketTrendDashboard } from '../api/marketTrend';

const pageCache = {
  data: null
};

const numberFormatter = new Intl.NumberFormat('en-IN');
const INDEX_RANGE_PRESETS = [
  { key: '1m', label: '1M', months: 1 },
  { key: '2m', label: '2M', months: 2 },
  { key: '3m', label: '3M', months: 3 },
  { key: '4m', label: '4M', months: 4 },
  { key: '6m', label: '6M', months: 6 },
  { key: 'all', label: 'All', months: null }
];

const getMonthKey = (value) => (value ? String(value).slice(0, 7) : '');

const toUtcDate = (value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const subtractMonths = (value, months) => {
  if (!value || months === null || months === undefined) return value;
  const date = toUtcDate(value);
  if (!date) return value;
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
};

const formatMonth = (value) => {
  if (!value) return '-';
  const date = new Date(`${value}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
};

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
};

const signalClassName = (value) => {
  const number = Number(value || 0);
  if (number > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (number < 0) return 'text-red-600 dark:text-red-400';
  return 'text-slate-900 dark:text-slate-100';
};

const putNetCellClassName = (value) => {
  const number = Number(value || 0);
  if (number > 0) {
    return 'font-medium text-red-600 dark:text-red-400';
  }
  return 'text-emerald-600 dark:text-emerald-400';
};

const callNetCellClassName = (value) => {
  const number = Number(value || 0);
  if (number < 0) {
    return 'font-medium text-red-600 dark:text-red-400';
  }
  return 'text-emerald-600 dark:text-emerald-400';
};

const TrendTooltip = ({ active, payload, label, valueKey, valueLabel, valueClassName = signalClassName }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  const value = point?.[valueKey];

  return (
    <div className="rounded border border-slate-300 bg-white px-3 py-2 text-xs shadow dark:border-slate-700 dark:bg-slate-900">
      <p className="font-medium">{formatDate(label)}</p>
      {valueKey && value !== undefined ? (
        <p className={valueClassName(value)}>
          {valueLabel}: {numberFormatter.format(value)}
        </p>
      ) : null}
    </div>
  );
};

const MarketTrendPage = () => {
  const { theme } = useSettings();
  const [data, setData] = useState(pageCache.data);
  const [loading, setLoading] = useState(!pageCache.data);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [selectedSnapshotMonth, setSelectedSnapshotMonth] = useState('');
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState('');
  const [selectedIndexRange, setSelectedIndexRange] = useState('6m');
  const [indexStartDate, setIndexStartDate] = useState('');
  const [indexEndDate, setIndexEndDate] = useState('');

  useEffect(() => {
    const load = async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      setError('');
      try {
        const response = await fetchMarketTrendDashboard();
        setData(response);
        pageCache.data = response;
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load market trend dashboard');
      } finally {
        if (!silent) setLoading(false);
      }
    };

    if (pageCache.data) {
      load({ silent: true });
      return;
    }

    load();
  }, []);

  const meta = data?.meta;
  const latestParticipants = data?.latestParticipants || [];
  const participantSnapshots = data?.participantSnapshots || [];
  const indexPositioningChart = data?.charts?.fiiIndexPositioningNets || [];

  const syncIncremental = async () => {
    setSyncing(true);
    setSyncMessage('');
    setError('');
    try {
      const result = await syncMarketTrendDashboard('incremental');
      const dashboard = await fetchMarketTrendDashboard();
      setData(dashboard);
      pageCache.data = dashboard;
      setSyncMessage(
        `Sync finished. Imported ${result.importedDates} date(s), skipped ${result.skippedMissing} missing archive date(s).`
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to sync market trend data');
    } finally {
      setSyncing(false);
    }
  };

  const snapshotMonthOptions = useMemo(() => {
    const months = new Set(participantSnapshots.map((snapshot) => getMonthKey(snapshot.date)).filter(Boolean));
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [participantSnapshots]);
  const allSnapshotDates = useMemo(
    () => participantSnapshots.map((snapshot) => snapshot.date).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [participantSnapshots]
  );
  const snapshotsByDate = useMemo(
    () => new Map(participantSnapshots.map((snapshot) => [snapshot.date, snapshot.participants])),
    [participantSnapshots]
  );
  const snapshotDatesByMonth = useMemo(() => {
    const grouped = new Map();
    participantSnapshots.forEach((snapshot) => {
      const monthKey = getMonthKey(snapshot.date);
      if (!grouped.has(monthKey)) grouped.set(monthKey, []);
      grouped.get(monthKey).push(snapshot.date);
    });
    grouped.forEach((dates, key) => {
      grouped.set(key, [...dates].sort((a, b) => a.localeCompare(b)));
    });
    return grouped;
  }, [participantSnapshots]);
  const selectedMonthDates = snapshotDatesByMonth.get(selectedSnapshotMonth) || [];
  const selectedSnapshotParticipants = useMemo(() => {
    const rows = snapshotsByDate.get(selectedSnapshotDate);
    return [...(rows || latestParticipants)]
      .filter((row) => row.clientType !== 'TOTAL')
      .sort((a, b) => a.clientType.localeCompare(b.clientType));
  }, [snapshotsByDate, selectedSnapshotDate, latestParticipants]);
  const selectedSnapshotIndex = useMemo(
    () => allSnapshotDates.findIndex((date) => date === selectedSnapshotDate),
    [allSnapshotDates, selectedSnapshotDate]
  );
  const latestIndexDate = indexPositioningChart[indexPositioningChart.length - 1]?.date || '';
  const earliestIndexDate = indexPositioningChart[0]?.date || '';
  const filteredIndexPositioningChart = useMemo(() => {
    if (!indexPositioningChart.length) return [];
    const effectiveStart = indexStartDate || earliestIndexDate;
    const effectiveEnd = indexEndDate || latestIndexDate;

    return indexPositioningChart
      .filter((row) => row.date >= effectiveStart && row.date <= effectiveEnd)
      .map((row) => ({
        ...row,
        futuresPositive: row.value >= 0 ? row.value : null,
        futuresNegative: row.value < 0 ? row.value : null,
        callGreen: row.callNet >= 0 ? row.callNet : null,
        callRed: row.callNet < 0 ? row.callNet : null,
        putRed: row.putNet > 0 ? row.putNet : null,
        putGreen: row.putNet <= 0 ? row.putNet : null
      }));
  }, [earliestIndexDate, indexEndDate, indexPositioningChart, indexStartDate, latestIndexDate]);

  useEffect(() => {
    const defaultDate = meta?.latestTradeDate || '';
    if (!defaultDate) return;
    setSelectedSnapshotDate((current) => current || defaultDate);
    setSelectedSnapshotMonth((current) => current || getMonthKey(defaultDate));
  }, [meta?.latestTradeDate]);

  useEffect(() => {
    if (!selectedSnapshotMonth) return;
    if (selectedMonthDates.includes(selectedSnapshotDate)) return;
    const fallbackDate = selectedMonthDates[selectedMonthDates.length - 1] || '';
    if (fallbackDate) {
      setSelectedSnapshotDate(fallbackDate);
    }
  }, [selectedMonthDates, selectedSnapshotDate, selectedSnapshotMonth]);

  useEffect(() => {
    if (!indexPositioningChart.length) return;
    if (selectedIndexRange === 'all') {
      setIndexStartDate(earliestIndexDate);
      setIndexEndDate(latestIndexDate);
      return;
    }

    const preset = INDEX_RANGE_PRESETS.find((item) => item.key === selectedIndexRange);
    const presetStart = preset ? subtractMonths(latestIndexDate, preset.months) : earliestIndexDate;
    const boundedStart = presetStart < earliestIndexDate ? earliestIndexDate : presetStart;
    setIndexStartDate(boundedStart);
    setIndexEndDate(latestIndexDate);
  }, [earliestIndexDate, indexPositioningChart, latestIndexDate, selectedIndexRange]);

  const handleSnapshotMonthChange = (event) => {
    const nextMonth = event.target.value;
    const nextMonthDates = snapshotDatesByMonth.get(nextMonth) || [];
    setSelectedSnapshotMonth(nextMonth);
    setSelectedSnapshotDate(nextMonthDates[nextMonthDates.length - 1] || '');
  };

  const handleIndexPresetChange = (presetKey) => {
    setSelectedIndexRange(presetKey);
  };

  const handleIndexStartDateChange = (event) => {
    const nextStartDate = event.target.value;
    setSelectedIndexRange('manual');
    setIndexStartDate(nextStartDate);
    if (indexEndDate && nextStartDate && nextStartDate > indexEndDate) {
      setIndexEndDate(nextStartDate);
    }
  };

  const handleIndexEndDateChange = (event) => {
    const nextEndDate = event.target.value;
    setSelectedIndexRange('manual');
    setIndexEndDate(nextEndDate);
    if (indexStartDate && nextEndDate && nextEndDate < indexStartDate) {
      setIndexStartDate(nextEndDate);
    }
  };

  const moveSnapshotByOffset = (offset) => {
    if (!allSnapshotDates.length) return;
    const currentIndex = selectedSnapshotIndex >= 0 ? selectedSnapshotIndex : allSnapshotDates.length - 1;
    const nextIndex = currentIndex + offset;
    if (nextIndex < 0 || nextIndex >= allSnapshotDates.length) return;

    const nextDate = allSnapshotDates[nextIndex];
    setSelectedSnapshotMonth(getMonthKey(nextDate));
    setSelectedSnapshotDate(nextDate);
  };

  const handleHistoricalDateChange = (event) => {
    const nextDate = event.target.value;
    if (!nextDate) return;
    const monthKey = getMonthKey(nextDate);
    const eligibleDates = allSnapshotDates.filter((date) => date <= nextDate);
    const resolvedDate = eligibleDates.length ? eligibleDates[eligibleDates.length - 1] : allSnapshotDates[0];

    setSelectedSnapshotMonth(monthKey);
    setSelectedSnapshotDate(resolvedDate);
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      const tagName = event.target?.tagName;
      if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA' || event.target?.isContentEditable) {
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        moveSnapshotByOffset(-1);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        moveSnapshotByOffset(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moveSnapshotByOffset]);

  if (loading) return <p>Loading market trend dashboard...</p>;
  if (error && !data) return <p className="text-red-600">{error}</p>;

  const isDark = theme === 'dark';
  const chartGrid = isDark ? '#334155' : '#cbd5e1';
  const chartAxis = isDark ? '#475569' : '#94a3b8';
  const chartTick = isDark ? '#cbd5e1' : '#334155';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Market Trend</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            NSE participant open-interest trend view for the last 12 months, focused on FII positioning.
          </p>
        </div>
        <button
          type="button"
          onClick={syncIncremental}
          disabled={syncing}
          className="btn-muted px-3 py-2 text-sm disabled:cursor-wait disabled:opacity-60"
        >
          {syncing ? 'Syncing...' : 'Sync Latest Data'}
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {syncMessage ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{syncMessage}</p> : null}

      {!meta?.latestTradeDate ? (
        <div className="surface-card rounded-lg p-5">
          <h2 className="text-lg font-semibold">No market trend data yet</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Run the backfill script once, then use the sync button here to update recent trading days.
          </p>
        </div>
      ) : (
        <>
          <section className="surface-card rounded-lg p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 className="text-lg font-semibold">FII Index Futures Net</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Shared time controls and hover cursor apply to Index Fut Net, Index Call Net, and Index Put Net.
                </p>
              </div>
              <div className="flex flex-col gap-3 xl:items-end">
                <div className="flex flex-wrap gap-2">
                  {INDEX_RANGE_PRESETS.map((preset) => {
                    const isActive = selectedIndexRange === preset.key;
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => handleIndexPresetChange(preset.key)}
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${
                          isActive
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-500 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-emerald-400 dark:hover:text-emerald-300'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">From</span>
                    <input
                      type="date"
                      min={earliestIndexDate || undefined}
                      max={indexEndDate || latestIndexDate || undefined}
                      value={indexStartDate}
                      onChange={handleIndexStartDateChange}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">To</span>
                    <input
                      type="date"
                      min={indexStartDate || earliestIndexDate || undefined}
                      max={latestIndexDate || undefined}
                      value={indexEndDate}
                      onChange={handleIndexEndDateChange}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="mt-6 space-y-6">
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Index Fut Net</p>
                <div className="h-[22rem]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      syncId="fii-net-series"
                      data={filteredIndexPositioningChart}
                      margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                      <XAxis dataKey="date" hide />
                      <YAxis stroke={chartAxis} tick={{ fill: chartTick, fontSize: 12 }} />
                      <Tooltip
                        content={
                          <TrendTooltip
                            valueKey="value"
                            valueLabel="Index Fut Net"
                            valueClassName={signalClassName}
                          />
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="futuresPositive"
                        stroke="#16a34a"
                        strokeWidth={3}
                        dot={{ r: 3, strokeWidth: 1, fill: '#16a34a' }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="futuresNegative"
                        stroke="#dc2626"
                        strokeWidth={3}
                        dot={{ r: 3, strokeWidth: 1, fill: '#dc2626' }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Index Call Net</p>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      syncId="fii-net-series"
                      data={filteredIndexPositioningChart}
                      margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                      <XAxis dataKey="date" hide />
                      <YAxis stroke={chartAxis} tick={{ fill: chartTick, fontSize: 12 }} />
                      <Tooltip
                        content={
                          <TrendTooltip
                            valueKey="callNet"
                            valueLabel="Index Call Net"
                            valueClassName={callNetCellClassName}
                          />
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="callGreen"
                        stroke="#16a34a"
                        strokeWidth={2.5}
                        dot={{ r: 2.5, strokeWidth: 1, fill: '#16a34a' }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="callRed"
                        stroke="#dc2626"
                        strokeWidth={2.5}
                        dot={{ r: 2.5, strokeWidth: 1, fill: '#dc2626' }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Index Put Net</p>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      syncId="fii-net-series"
                      data={filteredIndexPositioningChart}
                      margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                      <XAxis
                        dataKey="date"
                        stroke={chartAxis}
                        tick={{ fill: chartTick, fontSize: 12 }}
                        minTickGap={24}
                        tickFormatter={formatDate}
                      />
                      <YAxis stroke={chartAxis} tick={{ fill: chartTick, fontSize: 12 }} />
                      <Tooltip
                        content={
                          <TrendTooltip
                            valueKey="putNet"
                            valueLabel="Index Put Net"
                            valueClassName={putNetCellClassName}
                          />
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="putGreen"
                        stroke="#16a34a"
                        strokeWidth={2.5}
                        dot={{ r: 2.5, strokeWidth: 1, fill: '#16a34a' }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="putRed"
                        stroke="#dc2626"
                        strokeWidth={2.5}
                        dot={{ r: 2.5, strokeWidth: 1, fill: '#dc2626' }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </section>

          <section className="surface-card rounded-lg p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Latest participant snapshot</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {formatDate(selectedSnapshotDate || meta?.latestTradeDate)} | {meta?.availableTradingDays || 0}{' '}
                  available trading day(s)
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Use arrow keys to move one trading day at a time.
                </p>
              </div>
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="flex gap-2 md:pb-0.5">
                  <button
                    type="button"
                    onClick={() => moveSnapshotByOffset(-1)}
                    disabled={selectedSnapshotIndex <= 0}
                    aria-label="Previous trading day"
                    title="Previous trading day"
                    className="btn-muted rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSnapshotByOffset(1)}
                    disabled={selectedSnapshotIndex < 0 || selectedSnapshotIndex >= allSnapshotDates.length - 1}
                    aria-label="Next trading day"
                    title="Next trading day"
                    className="btn-muted rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ↓
                  </button>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-slate-600 dark:text-slate-300">Month</span>
                  <select
                    value={selectedSnapshotMonth}
                    onChange={handleSnapshotMonthChange}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  >
                    {snapshotMonthOptions.map((month) => (
                      <option key={month} value={month}>
                        {formatMonth(month)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-slate-600 dark:text-slate-300">Calendar</span>
                  <input
                    type="date"
                    value={selectedSnapshotDate}
                    min={allSnapshotDates[0] || undefined}
                    max={allSnapshotDates[allSnapshotDates.length - 1] || undefined}
                    onChange={handleHistoricalDateChange}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="table-head">
                  <tr>
                    <th className="px-3 py-2">Client Type</th>
                    <th className="px-3 py-2">Index Fut Long</th>
                    <th className="px-3 py-2">Index Fut Short</th>
                    <th className="px-3 py-2">Index Fut Net</th>
                    <th className="px-3 py-2">Index Call Long</th>
                    <th className="px-3 py-2">Index Call Short</th>
                    <th className="px-3 py-2">Index Call Net</th>
                    <th className="px-3 py-2">Index Put Long</th>
                    <th className="px-3 py-2">Index Put Short</th>
                    <th className="px-3 py-2">Index Put Net</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSnapshotParticipants.map((row) => (
                    <tr key={row.clientType} className="table-row-hover">
                      <td className="px-3 py-2 font-medium">{row.clientType}</td>
                      <td className="px-3 py-2">{numberFormatter.format(row.futureIndexLong)}</td>
                      <td className="px-3 py-2">{numberFormatter.format(row.futureIndexShort)}</td>
                      <td className={`px-3 py-2 ${signalClassName(row.indexFuturesNet)}`}>
                        {numberFormatter.format(row.indexFuturesNet)}
                      </td>
                      <td className="px-3 py-2">{numberFormatter.format(row.optionIndexCallLong)}</td>
                      <td className="px-3 py-2">{numberFormatter.format(row.optionIndexCallShort)}</td>
                      <td className={`px-3 py-2 ${callNetCellClassName(row.callNet)}`}>
                        {numberFormatter.format(row.callNet)}
                      </td>
                      <td className="px-3 py-2">{numberFormatter.format(row.optionIndexPutLong)}</td>
                      <td className="px-3 py-2">{numberFormatter.format(row.optionIndexPutShort)}</td>
                      <td className={`px-3 py-2 ${putNetCellClassName(row.putNet)}`}>
                        {numberFormatter.format(row.putNet)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default MarketTrendPage;
