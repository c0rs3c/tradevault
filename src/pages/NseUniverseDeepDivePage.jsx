'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import {
  fetchNseUniverseSnapshot,
  fetchNseUniverseSyncStatus,
  searchNseUniverseSymbols,
  triggerNseUniverseSync
} from '@/api/deepDive';
import SymbolOverviewTooltip from '@/components/SymbolOverviewTooltip';

const DEFAULT_PAGE_SIZE = 100;

const formatNumber = (value, digits = 2) => {
  if (!Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
};

const formatInteger = (value) => {
  if (!Number.isFinite(Number(value))) return '—';
  return Math.trunc(Number(value)).toLocaleString('en-IN');
};

const formatCurrencyCrore = (value) => {
  if (!Number.isFinite(Number(value))) return '—';
  return `₹${formatNumber(value)} Cr`;
};

const formatMarketCap = (value) => {
  if (!Number.isFinite(Number(value))) return '—';
  return `₹${formatNumber(Number(value) / 10000000)} Cr`;
};

const clampPct = (value) => {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.min(100, Number(value)));
};

const StatsCard = ({ label, value, helper = '' }) => (
  <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{label}</p>
    <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    {helper ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{helper}</p> : null}
  </div>
);

const SyncSummaryCard = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{label}</p>
    <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">{value}</p>
  </div>
);

export default function NseUniverseDeepDivePage() {
  const [searchInput, setSearchInput] = useState('');
  const deferredSearchInput = useDeferredValue(searchInput);
  const [selectedDate, setSelectedDate] = useState('');
  const [minMarketCapCr, setMinMarketCapCr] = useState('');
  const [maxMarketCapCr, setMaxMarketCapCr] = useState('');
  const [minRupeeVolumeCr, setMinRupeeVolumeCr] = useState('');
  const [maxRupeeVolumeCr, setMaxRupeeVolumeCr] = useState('');
  const [syncDate, setSyncDate] = useState('');
  const [page, setPage] = useState(1);
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [nseUniverseCardOpen, setNseUniverseCardOpen] = useState(false);
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      try {
        setLoadingStatus(true);
        const result = await fetchNseUniverseSyncStatus();
        if (cancelled) return;
        setStatus(result);
        setSyncing(result?.sync?.status === 'running');
        if (!selectedDate && result?.inventory?.latestTradeDate) {
          setSelectedDate(result.inventory.latestTradeDate);
        }
        if (!syncDate) {
          setSyncDate(new Date().toISOString().slice(0, 10));
        }
      } catch (loadError) {
        if (!cancelled) setSyncError(loadError?.response?.data?.message || loadError.message || 'Failed to load sync status');
      } finally {
        if (!cancelled) setLoadingStatus(false);
      }
    };

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, [selectedDate, syncDate]);

  useEffect(() => {
    let cancelled = false;
    const loadSnapshot = async () => {
      try {
        setLoadingSnapshot(true);
        setError('');
        const result = await fetchNseUniverseSnapshot({
          q: deferredSearchInput,
          selectedDate,
          minMarketCapCr,
          maxMarketCapCr,
          minRupeeVolumeCr,
          maxRupeeVolumeCr,
          page,
          pageSize: DEFAULT_PAGE_SIZE
        });
        if (cancelled) return;
        setSnapshot(result);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError?.response?.data?.message || loadError.message || 'Failed to load NSE Universe data');
          setSnapshot(null);
        }
      } finally {
        if (!cancelled) setLoadingSnapshot(false);
      }
    };

    loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [deferredSearchInput, selectedDate, minMarketCapCr, maxMarketCapCr, minRupeeVolumeCr, maxRupeeVolumeCr, page]);

  useEffect(() => {
    let cancelled = false;
    if (!deferredSearchInput.trim()) {
      setSuggestions([]);
      return () => {
        cancelled = true;
      };
    }

    const timer = setTimeout(async () => {
      try {
        const result = await searchNseUniverseSymbols(deferredSearchInput, 12);
        if (!cancelled) setSuggestions(result?.suggestions || []);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deferredSearchInput]);

  useEffect(() => {
    if (!syncing) return undefined;
    const interval = setInterval(async () => {
      try {
        const result = await fetchNseUniverseSyncStatus();
        setStatus(result);
        const isRunning = result?.sync?.status === 'running';
        setSyncing(isRunning);
        if (!isRunning) {
          const latestDate = result?.inventory?.latestTradeDate;
          if (latestDate) setSelectedDate((current) => current || latestDate);
          const refreshed = await fetchNseUniverseSnapshot({
            q: deferredSearchInput,
            selectedDate,
            minMarketCapCr,
            maxMarketCapCr,
            minRupeeVolumeCr,
            maxRupeeVolumeCr,
            page,
            pageSize: DEFAULT_PAGE_SIZE
          });
          setSnapshot(refreshed);
        }
      } catch {
        // Polling failures should not disrupt the page.
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [deferredSearchInput, page, selectedDate, minMarketCapCr, maxMarketCapCr, minRupeeVolumeCr, maxRupeeVolumeCr, syncing]);

  const rows = snapshot?.rows || [];
  const total = Number(snapshot?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  const latestAvailableDate = snapshot?.latestAvailableDate || status?.inventory?.latestTradeDate || '';
  const effectiveDate = snapshot?.effectiveDate || '';
  const syncCurrent = Number(status?.sync?.current || 0);
  const syncTotal = Number(status?.sync?.total || 0);
  const syncProgressPct = syncTotal > 0 ? clampPct((syncCurrent / syncTotal) * 100) : 0;
  const recentLines = Array.isArray(status?.sync?.recentLines) ? status.sync.recentLines : [];
  const syncSummary = status?.sync?.summary || null;
  const syncedStocksLastRun = syncSummary?.syncedSymbols ?? syncSummary?.processedSymbols ?? null;
  const barsInsertedLastRun = syncSummary?.insertedRows ?? null;

  const handleSync = async () => {
    try {
      setSyncError('');
      setSyncing(true);
      const result = await triggerNseUniverseSync({ syncDate: syncDate || undefined });
      setStatus((current) => ({
        ...(current || {}),
        sync: result?.status || current?.sync || null
      }));
    } catch (requestError) {
      setSyncing(false);
      setSyncError(requestError?.response?.data?.message || requestError.message || 'Failed to start NSE Universe sync');
    }
  };

  return (
    <div className="space-y-6">
      <section className="surface-card">
        <button
          type="button"
          onClick={() => setNseUniverseCardOpen((current) => !current)}
          className="flex w-full items-start justify-between gap-4 px-6 py-6 text-left"
          aria-expanded={nseUniverseCardOpen}
          aria-controls="nse-universe-card-panel"
        >
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">NSE Universe</h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Stored daily OHLCV history from yfinance for symbols listed in <code>nse-universe.csv</code>, with
              10/20/50/200 SMAs, 30-day volume SMA, rupee volume in crore, and market-cap snapshots in PostgreSQL.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              <div>Latest stored date: {latestAvailableDate || '—'}</div>
              <div className="mt-1">Viewing date: {effectiveDate || '—'}</div>
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`mt-3 h-5 w-5 shrink-0 text-slate-500 transition-transform dark:text-slate-400 ${nseUniverseCardOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </button>

        {nseUniverseCardOpen ? (
          <div id="nse-universe-card-panel" className="space-y-5 border-t border-slate-200 px-6 py-6 dark:border-slate-800">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatsCard
                label="Universe Size"
                value={formatInteger(status?.inventory?.totalSymbols)}
                helper="Symbols seeded from CSV"
              />
              <StatsCard
                label="Synced Symbols"
                value={formatInteger(status?.inventory?.syncedSymbols)}
                helper="Have at least one stored date"
              />
              <StatsCard
                label="Rows Loaded"
                value={loadingSnapshot ? '…' : formatInteger(snapshot?.total)}
                helper="Rows for the selected trading date"
              />
              <StatsCard
                label="Last Sync"
                value={syncing ? 'Running' : formatInteger(syncedStocksLastRun)}
                helper={
                  syncing
                    ? status?.sync?.message || 'Sync in progress'
                    : barsInsertedLastRun !== null
                      ? `${formatInteger(barsInsertedLastRun)} bars inserted`
                      : 'No completed sync yet'
                }
              />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setSyncPanelOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                aria-expanded={syncPanelOpen}
                aria-controls="nse-universe-sync-panel"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Sync Latest</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Run or inspect the NSE Universe sync from this card.
                  </p>
                </div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`h-4 w-4 shrink-0 text-slate-500 transition-transform dark:text-slate-400 ${syncPanelOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {syncPanelOpen ? (
                <div id="nse-universe-sync-panel" className="border-t border-slate-200 px-4 py-4 dark:border-slate-800">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="min-w-[180px] flex-1 space-y-2">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Sync through date</span>
                      <input
                        type="date"
                        value={syncDate}
                        onChange={(event) => setSyncDate(event.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleSync}
                      disabled={syncing}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                    >
                      {syncing ? 'Syncing…' : 'Sync Latest'}
                    </button>
                  </div>
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                    The sync starts after each symbol&apos;s last stored date and backfills from 2020-01-01 on first load.
                  </p>
                  {syncError ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{syncError}</p> : null}
                  {loadingStatus ? null : status?.sync?.message ? (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{status.sync.message}</p>
                      {status.sync.total ? (
                        <>
                          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                            <div
                              className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out"
                              style={{ width: `${syncProgressPct}%` }}
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            <span>
                              {formatInteger(syncCurrent)} / {formatInteger(syncTotal)}
                              {status.sync.currentSymbol ? ` • ${status.sync.currentSymbol}` : ''}
                            </span>
                            <span>{formatNumber(syncProgressPct)}%</span>
                          </div>
                        </>
                      ) : null}
                      {syncSummary ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <SyncSummaryCard
                            label="Stocks Synced"
                            value={formatInteger(syncSummary.syncedSymbols ?? syncSummary.processedSymbols)}
                          />
                          <SyncSummaryCard
                            label="Bars Inserted"
                            value={formatInteger(syncSummary.insertedRows)}
                          />
                          <SyncSummaryCard
                            label="Stocks Skipped"
                            value={formatInteger(syncSummary.skippedSymbols)}
                          />
                          <SyncSummaryCard
                            label="Stocks Failed"
                            value={formatInteger(syncSummary.failedSymbols)}
                          />
                        </div>
                      ) : null}
                      {recentLines.length ? (
                        <div className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                          {recentLines.slice(-4).map((line, index) => (
                            <p key={`${line}-${index}`} className="truncate">
                              {line}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="surface-card space-y-5 p-6">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Stock search</span>
              <input
                type="text"
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  setPage(1);
                }}
                list="nse-universe-symbol-suggestions"
                placeholder="Type symbol or company name"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <datalist id="nse-universe-symbol-suggestions">
                {suggestions.map((item) => (
                  <option key={item.symbol} value={item.symbol}>
                    {item.companyName ? `${item.symbol} - ${item.companyName}` : item.symbol}
                  </option>
                ))}
              </datalist>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">View date</span>
              <input
                type="date"
                value={selectedDate}
                max={latestAvailableDate || undefined}
                onChange={(event) => {
                  setSelectedDate(event.target.value);
                  setPage(1);
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Market Cap Range (Cr)</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={minMarketCapCr}
                  onChange={(event) => {
                    setMinMarketCapCr(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Min"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={maxMarketCapCr}
                  onChange={(event) => {
                    setMaxMarketCapCr(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Max"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Rupee Volume Range (Cr)</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={minRupeeVolumeCr}
                  onChange={(event) => {
                    setMinRupeeVolumeCr(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Min"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={maxRupeeVolumeCr}
                  onChange={(event) => {
                    setMaxRupeeVolumeCr(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Max"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </label>
          </div>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          {effectiveDate && selectedDate && effectiveDate !== selectedDate ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Exact data was not available for {selectedDate}. Showing the latest stored trading date on or before it:
              {' '}
              {effectiveDate}.
            </p>
          ) : null}
        </div>
      </section>

      <section className="surface-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Daily snapshot</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              OHLCV, 10/20/50/200 SMA, 30-day volume SMA and rupee volume in crore for the selected date.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50 dark:border-slate-700"
            >
              Prev
            </button>
            <span>
              Page {page} / {formatInteger(totalPages)}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50 dark:border-slate-700"
            >
              Next
            </button>
          </div>
        </div>

        <div className="overflow-x-auto overflow-y-visible">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {[
                  'Stock',
                  'Date',
                  'Open',
                  'High',
                  'Low',
                  'Close',
                  'Volume',
                  'SMA 10',
                  'SMA 20',
                  'SMA 50',
                  'SMA 200',
                  'Vol SMA 30',
                  'Rupee Volume',
                  'Market Cap'
                ].map((header) => (
                  <th
                    key={header}
                    className="sticky top-0 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingSnapshot ? (
                <tr>
                  <td colSpan={14} className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    Loading NSE Universe snapshot…
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((row, index) => (
                  <tr
                    key={`${row.symbol}-${row.tradeDate}`}
                    className={index % 2 === 0 ? 'bg-white dark:bg-slate-950' : 'bg-slate-50/70 dark:bg-slate-900/60'}
                  >
                    <td className="border-b border-slate-100 px-4 py-3 dark:border-slate-900">
                      <div className="inline-flex items-center gap-2">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{row.symbol}</div>
                        <SymbolOverviewTooltip
                          symbol={row.symbol}
                          companyName={row.companyName || ''}
                          aboutText={row.aboutText || ''}
                        />
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{row.companyName || '—'}</div>
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-600 dark:border-slate-900 dark:text-slate-300">
                      {row.tradeDate}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3 dark:border-slate-900">{formatNumber(row.open)}</td>
                    <td className="border-b border-slate-100 px-4 py-3 dark:border-slate-900">{formatNumber(row.high)}</td>
                    <td className="border-b border-slate-100 px-4 py-3 dark:border-slate-900">{formatNumber(row.low)}</td>
                    <td className="border-b border-slate-100 px-4 py-3 font-medium text-slate-900 dark:border-slate-900 dark:text-slate-100">
                      {formatNumber(row.close)}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3 dark:border-slate-900">{formatInteger(row.volume)}</td>
                    <td className="border-b border-slate-100 px-4 py-3 dark:border-slate-900">{formatNumber(row.sma10)}</td>
                    <td className="border-b border-slate-100 px-4 py-3 dark:border-slate-900">{formatNumber(row.sma20)}</td>
                    <td className="border-b border-slate-100 px-4 py-3 dark:border-slate-900">{formatNumber(row.sma50)}</td>
                    <td className="border-b border-slate-100 px-4 py-3 dark:border-slate-900">{formatNumber(row.sma200)}</td>
                    <td className="border-b border-slate-100 px-4 py-3 dark:border-slate-900">{formatInteger(row.volumeSma30)}</td>
                    <td className="border-b border-slate-100 px-4 py-3 dark:border-slate-900">
                      {formatCurrencyCrore(row.rupeeVolumeCrore)}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3 dark:border-slate-900">{formatMarketCap(row.marketCap)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={14} className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    No rows found for the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
