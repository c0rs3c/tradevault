'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  deleteNewsWatchlist,
  fetchNewsWatchlistDetails,
  fetchNewsWatchlists,
  importNewsWatchlistText,
  importNewsWatchlist,
  searchNewsBySymbol,
  syncAllNewsWatchlists,
  syncNewsWatchlist
} from '@/api/news';
import { fetchSymbols } from '@/api/symbols';

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
const getSyncProgress = (watchlist) => watchlist?.syncProgress || { current: 0, total: 0, currentTicker: '', currentCompanyName: '' };
const getSyncProgressLabel = (watchlist) => {
  const progress = getSyncProgress(watchlist);
  const current = Number(progress.current || 0);
  const total = Number(progress.total || 0);
  if (!total) return '';
  const target = progress.currentCompanyName || progress.currentTicker || 'ticker';
  return `${current}/${total} • ${target}`;
};
const getSyncProgressPercent = (watchlist) => {
  const progress = getSyncProgress(watchlist);
  const current = Number(progress.current || 0);
  const total = Number(progress.total || 0);
  if (!total) return 0;
  return Math.max(0, Math.min(100, (current / total) * 100));
};

export default function NewsPage() {
  const [symbolOptions, setSymbolOptions] = useState([]);
  const [activeNewsTab, setActiveNewsTab] = useState('watchlist');
  const [watchlists, setWatchlists] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedWatchlist, setSelectedWatchlist] = useState(null);
  const [newsSearchInput, setNewsSearchInput] = useState('');
  const [searchingNews, setSearchingNews] = useState(false);
  const [searchedNews, setSearchedNews] = useState(null);
  const [selectedCompanyFilters, setSelectedCompanyFilters] = useState([]);
  const [companyFilterSearch, setCompanyFilterSearch] = useState('');
  const [expandedArticleGroups, setExpandedArticleGroups] = useState({});
  const [watchlistsLoading, setWatchlistsLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncingOne, setSyncingOne] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [syncProgressLabel, setSyncProgressLabel] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadWatchlists = async ({ preserveSelection = true, showLoading = true } = {}) => {
    if (showLoading) {
      setWatchlistsLoading(true);
    }
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
      if (showLoading) {
        setWatchlistsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadWatchlists();
  }, []);

  useEffect(() => {
    let active = true;

    const loadSymbols = async () => {
      try {
        const data = await fetchSymbols();
        if (active) {
          setSymbolOptions(Array.isArray(data?.symbols) ? data.symbols : []);
        }
      } catch {
        // Search suggestions are non-critical.
      }
    };

    loadSymbols();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!syncingOne && !syncingAll) return undefined;

    let active = true;
    let polling = false;

    const poll = async () => {
      if (!active || polling) return;
      polling = true;
      try {
        await loadWatchlists({ showLoading: false });
        if (selectedId) {
          const data = await fetchNewsWatchlistDetails(selectedId);
          if (active) {
            setSelectedWatchlist(data);
          }
        }
      } catch {
        // Keep in-flight sync polling resilient.
      } finally {
        polling = false;
      }
    };

    poll();
    const intervalId = window.setInterval(poll, 1200);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [syncingOne, syncingAll, selectedId]);

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

  useEffect(() => {
    setCompanyFilterSearch('');
    setExpandedArticleGroups({});
  }, [selectedId]);

  const selectedListMeta = useMemo(
    () => watchlists.find((item) => item.id === selectedId) || null,
    [watchlists, selectedId]
  );
  const selectedProgressSource = selectedWatchlist || selectedListMeta;
  const selectedSyncProgressLabel = getSyncProgressLabel(selectedProgressSource);
  const selectedSyncProgressPercent = getSyncProgressPercent(selectedProgressSource);
  const companyFilterOptions = useMemo(
    () =>
      (selectedWatchlist?.tickerGroups || []).map((group) => ({
        value: group.canonicalTicker,
        label: group.companyName || group.symbol
      })),
    [selectedWatchlist]
  );
  useEffect(() => {
    const optionValues = companyFilterOptions.map((option) => option.value);
    setSelectedCompanyFilters((current) => {
      if (!optionValues.length) return [];
      if (!current.length) return optionValues;
      const validCurrent = current.filter((value) => optionValues.includes(value));
      if (
        validCurrent.length === current.length &&
        validCurrent.every((value, index) => value === current[index])
      ) {
        return current;
      }
      return validCurrent.length ? validCurrent : optionValues;
    });
  }, [selectedId, companyFilterOptions]);

  const visibleCompanyFilterOptions = useMemo(() => {
    const normalizedSearch = companyFilterSearch.trim().toLowerCase();
    if (!normalizedSearch) return companyFilterOptions;
    return companyFilterOptions.filter((option) => option.label.toLowerCase().includes(normalizedSearch));
  }, [companyFilterOptions, companyFilterSearch]);
  const filteredTickerGroups = useMemo(() => {
    const tickerGroups = selectedWatchlist?.tickerGroups || [];
    const selectedValues = new Set(selectedCompanyFilters);
    return tickerGroups.filter((group) => selectedValues.has(group.canonicalTicker));
  }, [selectedWatchlist, selectedCompanyFilters]);
  const shouldShowNewsSymbolSuggestions = newsSearchInput.trim().length > 0;

  const handleDeleteWatchlist = async (watchlist) => {
    const confirmed = window.confirm(`Delete watchlist "${watchlist.title}"?`);
    if (!confirmed) return;

    setDeletingId(watchlist.id);
    setError('');
    setMessage('');
    try {
      const result = await deleteNewsWatchlist(watchlist.id);
      const wasSelected = selectedId === watchlist.id;
      await loadWatchlists({ preserveSelection: !wasSelected });
      if (wasSelected) {
        setSelectedWatchlist(null);
      }
      setMessage(`Deleted ${result.title}.`);
    } catch (nextError) {
      setError(nextError.response?.data?.message || 'Failed to delete watchlist');
    } finally {
      setDeletingId('');
    }
  };

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

  const handleTextFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setMessage('');
    setFileName(file.name);
    try {
      const text = await file.text();
      const imported = await importNewsWatchlistText({
        title: file.name,
        text
      });
      await loadWatchlists({ preserveSelection: false });
      setSelectedId(imported.id);
      setMessage(`Imported ${imported.title} from ${file.name}. Run sync when you want the last 7 days of news.`);
    } catch (nextError) {
      setError(nextError.response?.data?.message || 'Failed to import text watchlist');
    } finally {
      setImporting(false);
      event.target.value = '';
    }
  };

  const handleSyncSelected = async () => {
    if (!selectedId) return;
    setSyncingOne(true);
    setSyncProgressLabel(`Syncing ${selectedListMeta?.title || 'selected watchlist'}...`);
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
      setSyncProgressLabel('');
    }
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    setSyncProgressLabel('Syncing all watchlists...');
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
      setSyncProgressLabel('');
    }
  };

  const handleCompanyFilterToggle = (value) => {
    setSelectedCompanyFilters((current) => {
      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return companyFilterOptions.map((option) => option.value).filter((optionValue) => next.has(optionValue));
    });
  };

  const handleSelectAllCompanies = () => {
    setSelectedCompanyFilters(companyFilterOptions.map((option) => option.value));
  };

  const handleClearCompanySelection = () => {
    setSelectedCompanyFilters([]);
  };

  const handleSearchNews = async (event) => {
    event.preventDefault();
    const normalizedSymbol = String(newsSearchInput || '').trim().toUpperCase();
    if (!normalizedSymbol) return;

    setSearchingNews(true);
    setError('');
    setMessage('');
    try {
      const result = await searchNewsBySymbol(normalizedSymbol);
      setSearchedNews(result);
    } catch (nextError) {
      setError(nextError.response?.data?.message || 'Failed to search company news');
    } finally {
      setSearchingNews(false);
    }
  };

  const handleShowMoreArticles = (canonicalTicker, totalArticles) => {
    setExpandedArticleGroups((current) => {
      const currentVisible = Number(current[canonicalTicker] || 3);
      return {
        ...current,
        [canonicalTicker]: Math.min(totalArticles, currentVisible + 5)
      };
    });
  };

  const handleShowLessArticles = (canonicalTicker) => {
    setExpandedArticleGroups((current) => ({
      ...current,
      [canonicalTicker]: 3
    }));
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

      <div className="surface-card p-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveNewsTab('watchlist')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeNewsTab === 'watchlist'
                ? 'bg-emerald-600 text-white dark:bg-emerald-500'
                : 'btn-muted'
            }`}
          >
            Watchlist News
          </button>
          <button
            type="button"
            onClick={() => setActiveNewsTab('search')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeNewsTab === 'search'
                ? 'bg-emerald-600 text-white dark:bg-emerald-500'
                : 'btn-muted'
            }`}
          >
            Company Search
          </button>
        </div>
      </div>

      {activeNewsTab === 'watchlist' ? (
        <form onSubmit={handleImport} className="surface-card p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
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
            <label className="btn-muted flex cursor-pointer items-center justify-center gap-2 px-4 text-center">
              <input
                type="file"
                accept=".txt,text/plain"
                className="hidden"
                onChange={handleTextFileChange}
                disabled={importing}
              />
              <span>{importing && fileName ? `Uploading ${fileName}...` : 'Upload .txt'}</span>
            </label>
          </div>
          <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
            Text file format: one symbol per line like <code>NSE:MTARTECH</code>. Section headers starting with <code>###</code> are also supported.
          </p>
        </form>
      ) : (
        <form onSubmit={handleSearchNews} className="surface-card p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Search Company News
              </span>
              <input
                type="text"
                list={shouldShowNewsSymbolSuggestions ? 'news-symbol-options' : undefined}
                value={newsSearchInput}
                onChange={(event) => setNewsSearchInput(event.target.value.toUpperCase())}
                placeholder="Enter ticker like CUPID or MTARTECH"
                className="field-input"
              />
              <datalist id="news-symbol-options">
                {shouldShowNewsSymbolSuggestions
                  ? symbolOptions.map((symbol) => <option key={symbol} value={symbol} />)
                  : null}
              </datalist>
            </label>
            <button
              type="submit"
              disabled={searchingNews}
              className="btn-primary shrink-0 disabled:cursor-wait"
            >
              {searchingNews ? 'Searching...' : 'Search News'}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
            Uses the same ticker list as New Trade and fetches fresh Google News without saving it to any watchlist.
          </p>
        </form>
      )}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}
      {activeNewsTab === 'search' && searchedNews ? (
        <div className="surface-card p-5">
          <div className="mb-4 flex flex-col gap-1 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{searchedNews.symbol}</h2>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Search
              </span>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">{searchedNews.companyName || searchedNews.symbol}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{searchedNews.articleCount} matched items</p>
          </div>
          {!searchedNews.articles?.length ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              No Google News items matched this ticker in the last 7 days.
            </p>
          ) : (
            <div className="space-y-3">
              {searchedNews.articles.map((article) => (
                <a
                  key={`${searchedNews.symbol}-${article.id}`}
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
                  <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                    {article.title}
                  </h3>
                  {article.descriptionText ? (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                      {article.descriptionText}
                    </p>
                  ) : null}
                </a>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {activeNewsTab === 'watchlist' && (syncingOne || syncingAll) ? (
        <div className="surface-card p-4">
          <div className="flex items-center gap-3">
            <span
              className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600 dark:border-slate-700 dark:border-t-emerald-400"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{syncProgressLabel}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className={`h-full rounded-full bg-emerald-600 dark:bg-emerald-400 ${selectedSyncProgressPercent ? 'transition-[width] duration-300 ease-out' : 'w-1/3 animate-[news-sync-indeterminate_1.2s_ease-in-out_infinite]'}`}
                  style={selectedSyncProgressPercent ? { width: `${selectedSyncProgressPercent}%` } : undefined}
                />
              </div>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                {selectedSyncProgressLabel || 'Fetching Google News items and updating stored matches.'}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {activeNewsTab === 'watchlist' ? (
        <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
          <aside className="surface-card h-fit p-4 xl:sticky xl:top-24">
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
              <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
                {watchlists.map((watchlist) => {
                  const isSelected = watchlist.id === selectedId;
                  const isDeleting = deletingId === watchlist.id;
                  return (
                    <div
                      key={watchlist.id}
                      className={`rounded-xl border px-3 py-3 transition ${
                        isSelected
                          ? 'border-emerald-500/60 bg-emerald-50 text-slate-900 dark:border-emerald-400/60 dark:bg-emerald-950/30 dark:text-slate-100'
                          : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:hover:bg-slate-900/80'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedId(watchlist.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-sm font-medium">{watchlist.title}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Imported: {formatDateTime(watchlist.lastImportedAt)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {watchlist.tickerCount} tickers, {articleCount(watchlist)} matched items
                          </p>
                          {watchlist.syncStatus === 'syncing' && getSyncProgressLabel(watchlist) ? (
                            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                              {getSyncProgressLabel(watchlist)}
                            </p>
                          ) : null}
                        </button>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <span className={`text-[11px] font-medium uppercase ${statusClassName(watchlist.syncStatus)}`}>
                            {watchlist.syncStatus}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteWatchlist(watchlist)}
                            disabled={isDeleting}
                            className="text-xs font-medium text-red-600 transition hover:text-red-700 disabled:cursor-wait disabled:opacity-60 dark:text-red-400 dark:hover:text-red-300"
                          >
                            {isDeleting ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
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
                    {selectedProgressSource?.syncStatus === 'syncing' && selectedSyncProgressLabel ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        In progress: {selectedSyncProgressLabel}
                      </p>
                    ) : null}
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
              ) : !filteredTickerGroups.length ? (
                <div className="surface-card p-6">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    No companies match the current display filter.
                  </p>
                </div>
              ) : (
                filteredTickerGroups.map((group) => {
                  const visibleArticleCount = Number(expandedArticleGroups[group.canonicalTicker] || 3);
                  const visibleArticles = group.articles.slice(0, visibleArticleCount);
                  const hasHiddenArticles = group.articles.length > 3;
                  const canShowMore = visibleArticleCount < group.articles.length;

                  return (
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
                          {visibleArticles.map((article) => (
                            <a
                              key={`${group.canonicalTicker}-${article.id}`}
                              href={article.googleNewsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded-xl border border-slate-200 bg-white/80 p-4 text-left transition hover:border-emerald-400/50 hover:bg-emerald-50/40 dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-emerald-400/40 dark:hover:bg-emerald-950/20"
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
                          {hasHiddenArticles ? (
                            <div className="flex items-center gap-4">
                              {canShowMore ? (
                                <button
                                  type="button"
                                  onClick={() => handleShowMoreArticles(group.canonicalTicker, group.articles.length)}
                                  className="text-sm font-medium text-emerald-700 transition hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                                >
                                  Show 5 more ({group.articles.length} total)
                                </button>
                              ) : null}
                              {visibleArticleCount > 3 ? (
                                <button
                                  type="button"
                                  onClick={() => handleShowLessArticles(group.canonicalTicker)}
                                  className="text-sm font-medium text-slate-600 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                                >
                                  Show less
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </>
          )}
          </section>
          <aside className="surface-card h-fit p-4 xl:sticky xl:top-24">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Companies
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {filteredTickerGroups.length}/{companyFilterOptions.length}
              </span>
            </div>
            {!selectedWatchlist?.tickerGroups?.length ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Select a watchlist to filter companies.
              </p>
            ) : (
              <div className="space-y-3">
                <label className="flex min-w-0 flex-col gap-2">
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Search
                  </span>
                  <input
                    type="search"
                    value={companyFilterSearch}
                    onChange={(event) => setCompanyFilterSearch(event.target.value)}
                    placeholder="Search companies..."
                    className="field-input"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllCompanies}
                    className="btn-muted flex-1 px-3 py-2 text-xs"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={handleClearCompanySelection}
                    className="btn-muted flex-1 px-3 py-2 text-xs"
                  >
                    Clear All
                  </button>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>{visibleCompanyFilterOptions.length} visible</span>
                    <span>{selectedCompanyFilters.length} selected</span>
                  </div>
                  {!visibleCompanyFilterOptions.length ? (
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      No companies match the current search.
                    </p>
                  ) : (
                    <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                      {visibleCompanyFilterOptions.map((option) => {
                        const checked = selectedCompanyFilters.includes(option.value);
                        return (
                          <label
                            key={option.value}
                            className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900/70"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleCompanyFilterToggle(option.value)}
                              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-700"
                            />
                            <span className="min-w-0 truncate">{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
