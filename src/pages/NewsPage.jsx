'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  fetchNewsWatchlistDetails,
  fetchNewsWatchlists,
  importNewsWatchlist,
  syncAllNewsWatchlists,
  syncNewsWatchlist
} from '@/api/news';

const formatDateTime = (value) => {
  if (!value) return 'Not yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not yet';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
};

const statusClassName = (status) => {
  if (status === 'success') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'error') return 'text-red-600 dark:text-red-400';
  if (status === 'syncing') return 'text-amber-600 dark:text-amber-400';
  return 'text-slate-600 dark:text-slate-400';
};

const articleCount = (watchlist) => Number(watchlist?.articleCount || 0);

export default function NewsPage() {
  const [watchlists, setWatchlists] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedWatchlist, setSelectedWatchlist] = useState(null);
  const [watchlistsLoading, setWatchlistsLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncingOne, setSyncingOne] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadWatchlists = async ({ preserveSelection = true } = {}) => {
    setWatchlistsLoading(true);
    try {
      const data = await fetchNewsWatchlists();
      const nextWatchlists = data?.watchlists || [];
      setWatchlists(nextWatchlists);

      if (!nextWatchlists.length) {
        setSelectedId('');
        setSelectedWatchlist(null);
        return;
      }

      setSelectedId((current) => {
        if (preserveSelection && current && nextWatchlists.some((item) => item.id === current)) {
          return current;
        }
        return nextWatchlists[0].id;
      });
    } catch (nextError) {
      setError(nextError.response?.data?.message || 'Failed to load watchlists');
    } finally {
      setWatchlistsLoading(false);
    }
  };

  useEffect(() => {
    loadWatchlists();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;

    const loadDetails = async () => {
      setDetailsLoading(true);
      try {
        const data = await fetchNewsWatchlistDetails(selectedId);
        if (active) {
          setSelectedWatchlist(data);
        }
      } catch (nextError) {
        if (active) {
          setError(nextError.response?.data?.message || 'Failed to load watchlist details');
        }
      } finally {
        if (active) {
          setDetailsLoading(false);
        }
      }
    };

    loadDetails();
    return () => {
      active = false;
    };
  }, [selectedId]);

  const selectedListMeta = useMemo(
    () => watchlists.find((item) => item.id === selectedId) || null,
    [watchlists, selectedId]
  );

  const handleImport = async (event) => {
    event.preventDefault();
    setImporting(true);
    setError('');
    setMessage('');
    try {
      const imported = await importNewsWatchlist(urlInput);
      setUrlInput('');
      await loadWatchlists({ preserveSelection: false });
      setSelectedId(imported.id);
      setMessage(`Imported ${imported.title}. Run sync when you want the last 7 days of news.`);
    } catch (nextError) {
      setError(nextError.response?.data?.message || 'Failed to import watchlist');
    } finally {
      setImporting(false);
    }
  };

  const handleSyncSelected = async () => {
    if (!selectedId) return;
    setSyncingOne(true);
    setError('');
    setMessage('');
    try {
      const result = await syncNewsWatchlist(selectedId);
      await loadWatchlists();
      const details = await fetchNewsWatchlistDetails(selectedId);
      setSelectedWatchlist(details);
      setMessage(
        `Sync finished for ${result.watchlistTitle}. Scanned ${result.tickersScanned} tickers, inserted ${result.matchesInserted} matches.`
      );
    } catch (nextError) {
      setError(nextError.response?.data?.message || 'Failed to sync watchlist');
    } finally {
      setSyncingOne(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    setError('');
    setMessage('');
    try {
      const result = await syncAllNewsWatchlists();
      await loadWatchlists();
      if (selectedId) {
        const details = await fetchNewsWatchlistDetails(selectedId);
        setSelectedWatchlist(details);
      }
      setMessage(
        `Sync finished. Watchlists: ${result.watchlistsScanned}, tickers: ${result.tickersScanned}, new matches: ${result.matchesInserted}.`
      );
    } catch (nextError) {
      setError(nextError.response?.data?.message || 'Failed to sync all watchlists');
    } finally {
      setSyncingAll(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">News</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Import a public TradingView watchlist, then sync Google News from the last 7 days for those companies.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSyncAll}
          disabled={syncingAll || !watchlists.length}
          className="btn-primary disabled:cursor-wait"
        >
          {syncingAll ? 'Syncing All...' : 'Sync All'}
        </button>
      </div>

      <form onSubmit={handleImport} className="surface-card p-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            type="url"
            className="field-input"
            placeholder="https://www.tradingview.com/watchlists/66860403/"
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            required
          />
          <button
            type="submit"
            disabled={importing}
            className="btn-primary shrink-0 disabled:cursor-wait"
          >
            {importing ? 'Importing...' : 'Add Watchlist'}
          </button>
        </div>
      </form>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}

      <div className="grid gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="surface-card h-fit p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Watchlists
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">{watchlists.length}</span>
          </div>

          {watchlistsLoading ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">Loading watchlists...</p>
          ) : !watchlists.length ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              No watchlists yet. Import a public TradingView list to start syncing news.
            </p>
          ) : (
            <div className="space-y-2">
              {watchlists.map((watchlist) => {
                const isSelected = watchlist.id === selectedId;
                return (
                  <button
                    key={watchlist.id}
                    type="button"
                    onClick={() => setSelectedId(watchlist.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      isSelected
                        ? 'border-emerald-500/60 bg-emerald-50 text-slate-900 dark:border-emerald-400/60 dark:bg-emerald-950/30 dark:text-slate-100'
                        : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:hover:bg-slate-900/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{watchlist.title}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {watchlist.tickerCount} tickers, {articleCount(watchlist)} matched items
                        </p>
                      </div>
                      <span className={`text-[11px] font-medium uppercase ${statusClassName(watchlist.syncStatus)}`}>
                        {watchlist.syncStatus}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="space-y-4">
          {!selectedListMeta ? (
            <div className="surface-card p-6">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Select a watchlist to view grouped company news.
              </p>
            </div>
          ) : (
            <>
              <div className="surface-card p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold">{selectedWatchlist?.title || selectedListMeta.title}</h2>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {selectedWatchlist?.tickerCount || selectedListMeta.tickerCount} tickers tracked
                    </p>
                    <a
                      href={selectedWatchlist?.sourceUrl || selectedListMeta.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex text-sm font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                    >
                      Open shared TradingView watchlist
                    </a>
                    <div className="grid gap-2 text-xs text-slate-600 dark:text-slate-400 md:grid-cols-2">
                      <p>Last imported: {formatDateTime(selectedWatchlist?.lastImportedAt)}</p>
                      <p>Last synced: {formatDateTime(selectedWatchlist?.lastSyncedAt)}</p>
                    </div>
                    {selectedWatchlist?.syncError ? (
                      <p className="text-xs text-red-600 dark:text-red-400">{selectedWatchlist.syncError}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={handleSyncSelected}
                    disabled={syncingOne || detailsLoading}
                    className="btn-primary shrink-0 disabled:cursor-wait"
                  >
                    {syncingOne ? 'Syncing...' : 'Sync Now'}
                  </button>
                </div>
              </div>

              {detailsLoading ? (
                <div className="surface-card p-6">
                  <p className="text-sm text-slate-600 dark:text-slate-400">Loading watchlist news...</p>
                </div>
              ) : !selectedWatchlist?.tickerGroups?.length ? (
                <div className="surface-card p-6">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    This watchlist has no parsed tickers yet.
                  </p>
                </div>
              ) : (
                selectedWatchlist.tickerGroups.map((group) => (
                  <article key={group.canonicalTicker} className="surface-card p-5">
                    <div className="mb-4 flex flex-col gap-1 border-b border-slate-200 pb-4 dark:border-slate-800">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold">{group.symbol}</h3>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {group.exchange || 'Ticker'}
                        </span>
                        {group.sectionTitle ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                            {group.sectionTitle}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">{group.companyName || group.symbol}</p>
                    </div>

                    {!group.articles.length ? (
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        No Google News items matched this ticker in the last 7 days.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {group.articles.map((article) => (
                          <a
                            key={`${group.canonicalTicker}-${article.id}`}
                            href={article.googleNewsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-xl border border-slate-200 bg-white/80 p-4 transition hover:border-emerald-400/50 hover:bg-emerald-50/40 dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-emerald-400/40 dark:hover:bg-emerald-950/20"
                          >
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-medium">{article.sourceName || article.sourceDomain || 'Google News'}</span>
                              <span>&middot;</span>
                              <span>{formatDateTime(article.publishedAt)}</span>
                              <span>&middot;</span>
                              <span className="uppercase">{article.matchedBy}</span>
                            </div>
                            <h4 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                              {article.title}
                            </h4>
                            {article.descriptionText ? (
                              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                                {article.descriptionText}
                              </p>
                            ) : null}
                          </a>
                        ))}
                      </div>
                    )}
                  </article>
                ))
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
