'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchMarketBreadthDeepDive } from '@/api/deepDive';

const PAGE_SIZE = 100;

const formatInteger = (value) => {
  if (!Number.isFinite(Number(value))) return '—';
  return Math.trunc(Number(value)).toLocaleString('en-IN');
};

const formatNumber = (value, digits = 2) => {
  if (!Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
};

const formatPercent = (value) => formatNumber(value, 2);

const formatTradeDate = (value) => {
  const date = new Date(`${String(value || '').slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value || '—';
  const day = date.getUTCDate();
  const suffix = day >= 11 && day <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
  const month = date.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' });
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${day}${suffix} ${month}'${year}`;
};

const StatsCard = ({ label, value, helper = '' }) => (
  <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{label}</p>
    <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    {helper ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{helper}</p> : null}
  </div>
);

const getColumnScale = (rows, key) => {
  const values = rows.map((row) => Number(row?.[key])).filter(Number.isFinite);
  if (!values.length) return { min: 0, mid: 0, max: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    min,
    mid: (min + max) / 2,
    max
  };
};

const mix = (start, end, ratio) => start + (end - start) * ratio;

const gradientForRatio = (ratio) => {
  const clamped = Math.max(0, Math.min(1, ratio));
  const red = { r: 248, g: 113, b: 113 };
  const yellow = { r: 253, g: 224, b: 71 };
  const green = { r: 74, g: 222, b: 128 };

  if (clamped <= 0.5) {
    const local = clamped / 0.5;
    return {
      r: Math.round(mix(red.r, yellow.r, local)),
      g: Math.round(mix(red.g, yellow.g, local)),
      b: Math.round(mix(red.b, yellow.b, local))
    };
  }

  const local = (clamped - 0.5) / 0.5;
  return {
    r: Math.round(mix(yellow.r, green.r, local)),
    g: Math.round(mix(yellow.g, green.g, local)),
    b: Math.round(mix(yellow.b, green.b, local))
  };
};

const getHeatmapStyle = (value, scale, alpha = 0.72) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const { min, max } = scale;
  const ratio = max > min ? (numeric - min) / (max - min) : 0.5;
  const color = gradientForRatio(ratio);
  const softColor = gradientForRatio(Math.min(1, ratio + 0.12));
  return {
    backgroundImage: `linear-gradient(135deg, rgba(${softColor.r}, ${softColor.g}, ${softColor.b}, ${alpha}) 0%, rgba(${color.r}, ${color.g}, ${color.b}, ${Math.max(
      0.58,
      alpha - 0.08
    )}) 100%)`
  };
};

const dateCellStyle = {
  backgroundImage: 'linear-gradient(135deg, rgba(226, 232, 240, 0.95) 0%, rgba(241, 245, 249, 0.95) 100%)'
};

const TABLE_HEADERS = [
  'Date',
  'Universe',
  'Up >4% of NSE',
  'Down <4% of NSE',
  '4% A/D ratio',
  '% above 10dma',
  '% above 20dma',
  '% above 50dma',
  '% above 200dma'
];

const TABLE_COLUMN_WIDTHS = ['20%', '12%', '14%', '14%', '10%', '10%', '10%', '10%', '10%'];

const mergeRowsByTradeDate = (currentRows, nextRows) => {
  const merged = new Map();
  [...currentRows, ...nextRows].forEach((row) => {
    if (!row?.tradeDate) return;
    merged.set(row.tradeDate, row);
  });
  return [...merged.values()].sort((left, right) => String(right.tradeDate).localeCompare(String(left.tradeDate)));
};

export default function MarketBreadthDeepDivePage() {
  const [selectedDateInput, setSelectedDateInput] = useState('');
  const [querySelectedDate, setQuerySelectedDate] = useState('');
  const [payload, setPayload] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const scrollAreaRef = useRef(null);
  const loadMoreRef = useRef(null);
  const loadMoreInFlightRef = useRef(false);
  const lastRequestedCursorRef = useRef('');

  useEffect(() => {
    let cancelled = false;

    const loadInitial = async () => {
      try {
        setLoading(true);
        setError('');
        loadMoreInFlightRef.current = false;
        lastRequestedCursorRef.current = '';
        const result = await fetchMarketBreadthDeepDive({ selectedDate: querySelectedDate, limit: PAGE_SIZE });
        if (cancelled) return;
        setPayload(result);
        setRows(Array.isArray(result?.rows) ? result.rows : []);
        if (!selectedDateInput && result?.latestAvailableDate) {
          setSelectedDateInput(result.latestAvailableDate);
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError?.response?.data?.message || loadError.message || 'Failed to load market breadth');
        setPayload(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadInitial();
    return () => {
      cancelled = true;
    };
  }, [querySelectedDate]);

  const summary = payload?.summary || {};
  const latestAvailableDate = payload?.latestAvailableDate || '';
  const effectiveDate = payload?.effectiveDate || '';
  const earliestAvailableDate = payload?.earliestAvailableDate || '';
  const hasMore = Boolean(payload?.hasMore);

  const handleShowMore = async () => {
    const nextCursor = String(payload?.nextBeforeDate || '');
    if (!nextCursor || loadingMore || loadMoreInFlightRef.current) return;
    if (lastRequestedCursorRef.current === nextCursor) return;

    loadMoreInFlightRef.current = true;
    lastRequestedCursorRef.current = nextCursor;
    try {
      setLoadingMore(true);
      const result = await fetchMarketBreadthDeepDive({
        selectedDate: effectiveDate || querySelectedDate,
        beforeDate: nextCursor,
        limit: PAGE_SIZE
      });
      const nextRows = Array.isArray(result?.rows) ? result.rows : [];
      setRows((current) => mergeRowsByTradeDate(current, nextRows));
      setPayload((current) => ({
        ...(current || {}),
        ...result,
        summary: current?.summary || result?.summary || {},
        rows: undefined
      }));
    } catch (loadError) {
      lastRequestedCursorRef.current = '';
      setError(loadError?.response?.data?.message || loadError.message || 'Failed to load more market breadth history');
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const root = scrollAreaRef.current;
    if (!root) return undefined;

    const handleScroll = () => {
      if (loading || loadingMore || !hasMore) return;
      const remaining = root.scrollHeight - root.scrollTop - root.clientHeight;
      if (remaining <= 320) {
        void handleShowMore();
      }
    };

    root.addEventListener('scroll', handleScroll, { passive: true });
    return () => root.removeEventListener('scroll', handleScroll);
  }, [hasMore, loading, loadingMore, payload?.nextBeforeDate, effectiveDate, querySelectedDate]);

  useEffect(() => {
    if (loading || loadingMore || !hasMore) return undefined;

    const node = loadMoreRef.current;
    const root = scrollAreaRef.current;
    if (!node || !root) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        void handleShowMore();
      },
      {
        root,
        rootMargin: '300px 0px',
        threshold: 0
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, payload?.nextBeforeDate]);

  const scales = useMemo(
    () => ({
      universeCount: getColumnScale(rows, 'universeCount'),
      up4Pct: getColumnScale(rows, 'up4Pct'),
      down4Pct: getColumnScale(rows, 'down4Pct'),
      adRatio: getColumnScale(rows, 'adRatio'),
      aboveSma10Pct: getColumnScale(rows, 'aboveSma10Pct'),
      aboveSma20Pct: getColumnScale(rows, 'aboveSma20Pct'),
      aboveSma50Pct: getColumnScale(rows, 'aboveSma50Pct'),
      aboveSma200Pct: getColumnScale(rows, 'aboveSma200Pct')
    }),
    [rows]
  );

  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Market Breadth Deep Dive
            </h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Trading-session breadth matrix for the whole NSE universe. Each row is a stored trading date, with 4%
              mover participation, 4% advance/decline ratio, and close-above-SMA breadth percentages.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
            <div>Latest stored date: {latestAvailableDate || '—'}</div>
            <div className="mt-1">Ending at: {effectiveDate || '—'}</div>
            <div className="mt-1">Rows shown: {rows.length || '—'} trading sessions</div>
          </div>
        </div>
      </section>

      <section className="surface-card space-y-5 p-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">End date</span>
              <input
                type="date"
                value={selectedDateInput}
                max={latestAvailableDate || undefined}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setSelectedDateInput(nextValue);
                  setQuerySelectedDate(nextValue);
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>

          <StatsCard
            label="Universe"
            value={loading ? '…' : formatInteger(summary.universeCount)}
            helper={effectiveDate ? formatTradeDate(effectiveDate) : 'Latest row'}
          />
          <StatsCard
            label="Up >4%"
            value={loading ? '…' : formatPercent(summary.up4Pct)}
            helper={loading ? '' : `${formatInteger(summary.up4PctCount)} stocks`}
          />
          <StatsCard
            label="Down <4%"
            value={loading ? '…' : formatPercent(summary.down4Pct)}
            helper={loading ? '' : `${formatInteger(summary.down4PctCount)} stocks`}
          />
          <StatsCard
            label="4% A/D Ratio"
            value={loading ? '…' : formatNumber(summary.adRatio)}
            helper="Up % / Down % x 100"
          />
          <StatsCard
            label="% Above 50 DMA"
            value={loading ? '…' : formatPercent(summary.aboveSma50Pct)}
            helper={loading ? '' : `${formatInteger(summary.aboveSma50Count)} stocks`}
          />
        </div>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        {effectiveDate && querySelectedDate && effectiveDate !== querySelectedDate ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Exact data was not available for {querySelectedDate}. Showing the latest stored trading date on or before it:{' '}
            {effectiveDate}.
          </p>
        ) : null}
      </section>

      <section className="surface-card overflow-hidden">
        <div
          ref={scrollAreaRef}
          className="max-h-[75vh] overflow-auto overscroll-contain border-t border-slate-200 dark:border-slate-800"
        >
            <table className="min-w-[1100px] table-fixed border-separate border-spacing-0 text-sm">
              <colgroup>
                {TABLE_COLUMN_WIDTHS.map((width, index) => (
                  <col key={TABLE_HEADERS[index]} style={{ width }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-30">
                <tr>
                  {TABLE_HEADERS.map((header) => (
                    <th
                      key={header}
                      className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                      Loading market breadth history…
                    </td>
                  </tr>
                ) : rows.length ? (
                  rows.map((row, index) => (
                    <tr
                      key={row.tradeDate}
                      className={index % 2 === 0 ? 'bg-white dark:bg-slate-950' : 'bg-slate-50/40 dark:bg-slate-900/50'}
                    >
                      <td
                        className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900 dark:border-slate-900 dark:text-slate-100"
                        style={dateCellStyle}
                      >
                      {formatTradeDate(row.tradeDate)}
                    </td>
                      <td
                        className="border-b border-slate-100 px-4 py-3 text-right font-medium text-slate-900 dark:border-slate-900 dark:text-slate-100"
                        style={dateCellStyle}
                      >
                        {formatInteger(row.universeCount)}
                      </td>
                      <td
                        className="border-b border-slate-100 px-4 py-3 text-right font-medium text-slate-900 dark:border-slate-900 dark:text-slate-100"
                      >
                        {formatPercent(row.up4Pct)}
                      </td>
                      <td
                        className="border-b border-slate-100 px-4 py-3 text-right font-medium text-slate-900 dark:border-slate-900 dark:text-slate-100"
                      >
                        {formatPercent(row.down4Pct)}
                      </td>
                      <td
                        className="border-b border-slate-100 px-4 py-3 text-right font-medium text-slate-900 dark:border-slate-900 dark:text-slate-100"
                        style={getHeatmapStyle(row.adRatio, scales.adRatio)}
                      >
                        {formatNumber(row.adRatio)}
                      </td>
                      <td
                        className="border-b border-slate-100 px-4 py-3 text-right font-medium text-slate-900 dark:border-slate-900 dark:text-slate-100"
                        style={getHeatmapStyle(row.aboveSma10Pct, scales.aboveSma10Pct)}
                      >
                        {formatPercent(row.aboveSma10Pct)}
                      </td>
                      <td
                        className="border-b border-slate-100 px-4 py-3 text-right font-medium text-slate-900 dark:border-slate-900 dark:text-slate-100"
                        style={getHeatmapStyle(row.aboveSma20Pct, scales.aboveSma20Pct)}
                      >
                        {formatPercent(row.aboveSma20Pct)}
                      </td>
                      <td
                        className="border-b border-slate-100 px-4 py-3 text-right font-medium text-slate-900 dark:border-slate-900 dark:text-slate-100"
                        style={getHeatmapStyle(row.aboveSma50Pct, scales.aboveSma50Pct)}
                      >
                        {formatPercent(row.aboveSma50Pct)}
                      </td>
                      <td
                        className="border-b border-slate-100 px-4 py-3 text-right font-medium text-slate-900 dark:border-slate-900 dark:text-slate-100"
                        style={getHeatmapStyle(row.aboveSma200Pct, scales.aboveSma200Pct)}
                      >
                        {formatPercent(row.aboveSma200Pct)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                      No stored breadth data is available for the selected date.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {!loading && rows.length ? (
              <div className="border-t border-slate-200 px-6 py-4 dark:border-slate-800">
                <div className="flex flex-col gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <p>
                    {hasMore
                      ? `Scroll down to load older stored sessions until ${earliestAvailableDate || 'the earliest available date'}.`
                      : `Reached the earliest stored session${earliestAvailableDate ? ` at ${earliestAvailableDate}` : ''}.`}
                  </p>
                  {loadingMore ? <p>Loading more rows…</p> : null}
                  {hasMore ? <div ref={loadMoreRef} className="h-4 w-full" aria-hidden="true" /> : null}
                </div>
              </div>
            ) : null}
        </div>
      </section>
    </div>
  );
}
