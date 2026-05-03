'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createDeepDiveList,
  deleteDeepDiveList,
  fetchDeepDiveLists,
  fetchDeepDiveRs,
  fetchDeepDiveSectorAnalysis,
  fetchDeepDiveStatus
} from '@/api/deepDive';

const BENCHMARKS = [
  { key: 'NIFTY', label: 'Nifty 50' },
  { key: 'MIDSML400', label: 'MidSmallcap 400' },
  { key: 'CNXSMALLCAP', label: 'CNX Smallcap' }
];

const STATUS_LABELS = {
  ready: 'Ready',
  price_ready_profile_missing: 'Price Ready, Profile Missing',
  no_price_history: 'No Price History',
  missing_start_history: 'Missing Start History',
  missing_end_history: 'Missing End History',
  missing_start_and_end_history: 'Missing Start and End History',
  insufficient_boundary_data: 'Boundary Data Issue'
};

const numberFormatter = new Intl.NumberFormat('en-IN');
const moneyFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2
});

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

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
};

const formatNumber = (value, digits = 2) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toFixed(digits);
};

const formatMoney = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return moneyFormatter.format(num);
};

const formatStatusLabel = (status) => STATUS_LABELS[status] || status || '-';

const signalClassName = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'text-slate-500 dark:text-slate-400';
  if (num > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (num < 0) return 'text-red-600 dark:text-red-400';
  return 'text-slate-700 dark:text-slate-200';
};

const defaultEndDate = () => new Date().toISOString().slice(0, 10);
const defaultStartDate = () => {
  const end = new Date();
  end.setDate(end.getDate() - 90);
  return end.toISOString().slice(0, 10);
};

const defaultFilters = () => ({
  minStockChangePct: '',
  maxStockChangePct: '',
  minLiquidity20d: '50000000',
  sector: '',
  industry: '',
  topN: '',
  sortBy: 'stockChangePct',
  sortDirection: 'desc',
  minXMultiples: {
    NIFTY: '',
    MIDSML400: '',
    CNXSMALLCAP: ''
  },
  minRsRatios: {
    NIFTY: '',
    MIDSML400: '',
    CNXSMALLCAP: ''
  }
});

const InfoTooltip = ({ row }) => {
  const details = [
    row.sector ? `Sector: ${row.sector}` : '',
    row.industry ? `Industry: ${row.industry}` : '',
    row.summary || ''
  ].filter(Boolean);

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        aria-label={`About ${row.symbol}`}
        onClick={(event) => event.stopPropagation()}
      >
        i
      </button>
      <span className="pointer-events-none absolute left-0 top-7 z-20 hidden w-80 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs text-slate-700 shadow-xl group-hover:block group-focus-within:block dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
        <span className="block font-semibold text-slate-900 dark:text-slate-100">
          {row.companyName || row.symbol}
        </span>
        <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
          {[row.sector, row.industry].filter(Boolean).join(' • ') || 'Metadata pending'}
        </span>
        {row.summary ? <span className="mt-2 block leading-5">{row.summary}</span> : null}
        {!row.summary && details.length <= 2 ? (
          <span className="mt-2 block text-slate-500 dark:text-slate-400">
            Company profile has not been ingested yet.
          </span>
        ) : null}
      </span>
    </span>
  );
};

export default function DeepDivePage() {
  const [lists, setLists] = useState([]);
  const [status, setStatus] = useState(null);
  const [selectedListId, setSelectedListId] = useState('');
  const [results, setResults] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createText, setCreateText] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedSymbols, setSelectedSymbols] = useState(() => new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [dragSelection, setDragSelection] = useState({ active: false, shouldSelect: true });
  const [groupBy, setGroupBy] = useState('sector');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [listsResult, statusResult] = await Promise.all([
          fetchDeepDiveLists(),
          fetchDeepDiveStatus()
        ]);
        setLists(listsResult?.lists || []);
        setStatus(statusResult);
        setSelectedListId((current) => current || listsResult?.lists?.[0]?.id || '');
      } catch (nextError) {
        setError(nextError.response?.data?.message || 'Failed to load Deep Dive');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    if (!selectedListId) return;
    runDeepDive({ preserveSelection: false });
  }, [selectedListId]);

  useEffect(() => {
    if (!dragSelection.active) return undefined;
    const handleMouseUp = () => {
      setDragSelection({ active: false, shouldSelect: true });
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [dragSelection.active]);

  useEffect(() => {
    const selected = [...selectedSymbols];
    if (!selected.length || !selectedListId || !results?.rows?.length) {
      setAnalysis(null);
      return;
    }

    let active = true;
    const loadAnalysis = async () => {
      setAnalyzing(true);
      try {
        const response = await fetchDeepDiveSectorAnalysis({
          stockListId: selectedListId,
          startDate,
          endDate,
          selectedSymbols: selected,
          groupBy
        });
        if (active) setAnalysis(response);
      } catch (nextError) {
        if (active) {
          setAnalysis(null);
          setError(nextError.response?.data?.message || 'Failed to load grouped analysis');
        }
      } finally {
        if (active) setAnalyzing(false);
      }
    };

    loadAnalysis();
    return () => {
      active = false;
    };
  }, [selectedSymbols, selectedListId, startDate, endDate, groupBy, results?.rows]);

  const availableSectors = results?.filters?.availableSectors || [];
  const availableIndustries = results?.filters?.availableIndustries || [];
  const selectedSymbolsArray = useMemo(() => [...selectedSymbols], [selectedSymbols]);
  const symbolStatusSummary = results?.symbolStatusSummary || {};

  const setFilterValue = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const setBenchmarkFilterValue = (bucket, key, value) => {
    setFilters((current) => ({
      ...current,
      [bucket]: {
        ...current[bucket],
        [key]: value
      }
    }));
  };

  const runDeepDive = async ({ preserveSelection = true } = {}) => {
    if (!selectedListId) return;
    setRunning(true);
    setError('');
    setMessage('');
    try {
      const response = await fetchDeepDiveRs({
        stockListId: selectedListId,
        startDate,
        endDate,
        minStockChangePct: filters.minStockChangePct,
        maxStockChangePct: filters.maxStockChangePct,
        minLiquidity20d: filters.minLiquidity20d,
        sector: filters.sector,
        industry: filters.industry,
        topN: filters.topN,
        sortBy: filters.sortBy,
        sortDirection: filters.sortDirection,
        minXMultiples: filters.minXMultiples,
        minRsRatios: filters.minRsRatios
      });
      setResults(response);
      setSelectedSymbols((current) => {
        if (!preserveSelection) return new Set();
        const next = new Set();
        const allowed = new Set((response?.rows || []).map((row) => row.symbol));
        current.forEach((symbol) => {
          if (allowed.has(symbol)) next.add(symbol);
        });
        return next;
      });
    } catch (nextError) {
      setError(nextError.response?.data?.message || 'Failed to run RS Deep Dive');
    } finally {
      setRunning(false);
    }
  };

  const handleCreateList = async (event) => {
    event.preventDefault();
    setCreating(true);
    setError('');
    setMessage('');
    try {
      const created = await createDeepDiveList({
        title: createTitle,
        description: createDescription,
        text: createText
      });
      const nextLists = await fetchDeepDiveLists();
      setLists(nextLists?.lists || []);
      setSelectedListId(created.id);
      setCreateTitle('');
      setCreateDescription('');
      setCreateText('');
      setMessage(`Created stock list "${created.title}".`);
    } catch (nextError) {
      setError(nextError.response?.data?.message || 'Failed to create stock list');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteList = async () => {
    if (!selectedListId) return;
    const target = lists.find((item) => item.id === selectedListId);
    if (!target) return;
    const confirmed = window.confirm(`Delete "${target.title}"?`);
    if (!confirmed) return;
    setDeleting(true);
    setError('');
    try {
      await deleteDeepDiveList(selectedListId);
      const nextLists = await fetchDeepDiveLists();
      setLists(nextLists?.lists || []);
      const nextId = nextLists?.lists?.[0]?.id || '';
      setSelectedListId(nextId);
      setResults(null);
      setSelectedSymbols(new Set());
      setMessage(`Deleted "${target.title}".`);
    } catch (nextError) {
      setError(nextError.response?.data?.message || 'Failed to delete stock list');
    } finally {
      setDeleting(false);
    }
  };

  const selectRange = (fromIndex, toIndex, shouldSelect) => {
    const rows = results?.rows || [];
    if (fromIndex === null || fromIndex === undefined || toIndex === null || toIndex === undefined) return;
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    setSelectedSymbols((current) => {
      const next = new Set(current);
      rows.slice(start, end + 1).forEach((row) => {
        if (shouldSelect) next.add(row.symbol);
        else next.delete(row.symbol);
      });
      return next;
    });
  };

  const toggleRowSelection = (symbol, rowIndex, options = {}) => {
    const isSelected = selectedSymbols.has(symbol);
    const shouldSelect = options.shouldSelect ?? !isSelected;
    if (options.shift && lastSelectedIndex !== null) {
      selectRange(lastSelectedIndex, rowIndex, true);
    } else {
      setSelectedSymbols((current) => {
        const next = new Set(current);
        if (shouldSelect) next.add(symbol);
        else next.delete(symbol);
        return next;
      });
    }
    setLastSelectedIndex(rowIndex);
    return shouldSelect;
  };

  const beginDragSelection = (symbol, rowIndex, event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button, a, select, textarea, input')) return;
    event.preventDefault();
    const shouldSelect = toggleRowSelection(symbol, rowIndex, { shift: event.shiftKey });
    setDragSelection({
      active: !event.shiftKey,
      shouldSelect
    });
  };

  const handleDragEnter = (symbol) => {
    if (!dragSelection.active) return;
    setSelectedSymbols((current) => {
      const next = new Set(current);
      if (dragSelection.shouldSelect) next.add(symbol);
      else next.delete(symbol);
      return next;
    });
  };

  if (loading) {
    return <p>Loading Deep Dive...</p>;
  }

  return (
    <div className="space-y-6">
      <section className="surface-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Deep Dive
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              RS Deep Dive reads only Deep Dive Mongo data. Historical prices and company profiles are expected to be synced by GitHub Actions.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Data Available Till</div>
              <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                {status?.latestAvailableDate ? formatDate(status.latestAvailableDate) : 'Not synced'}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Last Sync Run</div>
              <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                {status?.latestRun ? formatDateTime(status.latestRun.finishedAt || status.latestRun.startedAt) : 'Not yet'}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Rows Upserted</div>
              <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                {status?.latestRun ? numberFormatter.format(status.latestRun.rowsUpserted || 0) : '-'}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Benchmarks</div>
              <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                {BENCHMARKS.length}
              </div>
            </div>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        {message ? <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_2fr]">
        <form className="surface-card space-y-4 p-5" onSubmit={handleCreateList}>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Stock Lists</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Paste one symbol per line or use comma-separated symbols. These lists drive both ingestion and RS screening.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Saved List</label>
            <div className="flex gap-2">
              <select
                value={selectedListId}
                onChange={(event) => setSelectedListId(event.target.value)}
                className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="">Select stock list</option>
                {lists.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} ({item.symbolCount})
                  </option>
                ))}
              </select>
              <button type="button" onClick={handleDeleteList} disabled={!selectedListId || deleting} className="btn-danger px-3 py-2 text-sm">
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Title</span>
              <input
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                placeholder="Momentum Basket"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Description</span>
              <input
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                placeholder="Optional notes"
              />
            </label>
          </div>

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">Symbols</span>
            <textarea
              value={createText}
              onChange={(event) => setCreateText(event.target.value)}
              rows={8}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
              placeholder={'RELIANCE\nTCS\nINFY'}
            />
          </label>

          <button type="submit" className="btn-primary px-4 py-2 text-sm" disabled={creating}>
            {creating ? 'Creating...' : 'Create Stock List'}
          </button>
        </form>

        <section className="surface-card space-y-5 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">RS Deep Dive</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Choose a list, date range, and filters. Results stay inside the stored Deep Dive dataset.
              </p>
            </div>
            <button type="button" onClick={() => runDeepDive({ preserveSelection: true })} className="btn-primary px-4 py-2 text-sm" disabled={!selectedListId || running}>
              {running ? 'Running...' : 'Run Deep Dive'}
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Start Date</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">End Date</span>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Min Stock %</span>
              <input value={filters.minStockChangePct} onChange={(event) => setFilterValue('minStockChangePct', event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" placeholder="e.g. 10" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Max Stock %</span>
              <input value={filters.maxStockChangePct} onChange={(event) => setFilterValue('maxStockChangePct', event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" placeholder="Optional" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Min Liquidity</span>
              <input value={filters.minLiquidity20d} onChange={(event) => setFilterValue('minLiquidity20d', event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" placeholder="50000000" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Sector</span>
              <select value={filters.sector} onChange={(event) => setFilterValue('sector', event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <option value="">All sectors</option>
                {availableSectors.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Industry</span>
              <select value={filters.industry} onChange={(event) => setFilterValue('industry', event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <option value="">All industries</option>
                {availableIndustries.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Top N</span>
              <input value={filters.topN} onChange={(event) => setFilterValue('topN', event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" placeholder="Optional" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Sort By</span>
              <select value={filters.sortBy} onChange={(event) => setFilterValue('sortBy', event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <option value="stockChangePct">Stock % Change</option>
                <option value="liquidity20d">Liquidity 20D</option>
                <option value="symbol">Symbol</option>
                <option value="companyName">Company Name</option>
                {BENCHMARKS.map((item) => (
                  <option key={`rs-${item.key}`} value={`rsRatio:${item.key}`}>
                    RS Ratio: {item.label}
                  </option>
                ))}
                {BENCHMARKS.map((item) => (
                  <option key={`xm-${item.key}`} value={`xMultiple:${item.key}`}>
                    X Multiple: {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Sort Direction</span>
              <select value={filters.sortDirection} onChange={(event) => setFilterValue('sortDirection', event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {BENCHMARKS.map((benchmark) => (
              <div key={benchmark.key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{benchmark.label}</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs">
                    <span className="font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Min X Multiple</span>
                    <input
                      value={filters.minXMultiples[benchmark.key]}
                      onChange={(event) => setBenchmarkFilterValue('minXMultiples', benchmark.key, event.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                      placeholder="Optional"
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Min RS Ratio %</span>
                    <input
                      value={filters.minRsRatios[benchmark.key]}
                      onChange={(event) => setBenchmarkFilterValue('minRsRatios', benchmark.key, event.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                      placeholder="Optional"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>

      {results?.benchmarkSummaries?.length ? (
        <section className="grid gap-4 md:grid-cols-3">
          {results.benchmarkSummaries.map((item) => (
            <div key={item.key} className="surface-card p-4">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.displayName}</div>
              <div className={`mt-2 text-xl font-semibold ${signalClassName(item.changePct)}`}>
                {formatNumber(item.changePct)}%
              </div>
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {formatDate(item.startDate)} to {formatDate(item.endDate)}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="surface-card space-y-4 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Results</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {results?.rows?.length || 0} visible rows. Selected: {selectedSymbols.size}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedSymbols(new Set((results?.rows || []).map((row) => row.symbol)))}
              className="btn-muted px-3 py-2 text-sm"
              disabled={!results?.rows?.length}
            >
              Select Filtered Results
            </button>
            <button
              type="button"
              onClick={() => setSelectedSymbols(new Set())}
              className="btn-muted px-3 py-2 text-sm"
              disabled={!selectedSymbols.size}
            >
              Clear Selection
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1450px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                <th className="px-3 py-2">Sel</th>
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Sector</th>
                <th className="px-3 py-2">Industry</th>
                <th className="px-3 py-2">Start</th>
                <th className="px-3 py-2">End</th>
                <th className="px-3 py-2">Stock %</th>
                <th className="px-3 py-2">Liquidity 20D</th>
                {BENCHMARKS.map((item) => (
                  <th key={`${item.key}-change`} className="px-3 py-2">
                    {item.label} %
                  </th>
                ))}
                {BENCHMARKS.map((item) => (
                  <th key={`${item.key}-x`} className="px-3 py-2">
                    {item.label} X
                  </th>
                ))}
                {BENCHMARKS.map((item) => (
                  <th key={`${item.key}-rs`} className="px-3 py-2">
                    {item.label} RS Ratio %
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(results?.rows || []).map((row, index) => {
                const checked = selectedSymbols.has(row.symbol);
                return (
                  <tr
                    key={row.symbol}
                    className={`${checked ? 'bg-emerald-50/70 dark:bg-emerald-950/20' : ''} table-row-hover cursor-pointer select-none`}
                    onMouseDown={(event) => beginDragSelection(row.symbol, index, event)}
                    onMouseEnter={() => handleDragEnter(row.symbol)}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          event.stopPropagation();
                          toggleRowSelection(row.symbol, index, { shouldSelect: event.target.checked, shift: event.nativeEvent.shiftKey });
                        }}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-2">
                        <span>{row.symbol}</span>
                        <InfoTooltip row={row} />
                      </div>
                    </td>
                    <td className="px-3 py-2">{row.companyName || '-'}</td>
                    <td className="px-3 py-2">{row.sector || '-'}</td>
                    <td className="px-3 py-2">{row.industry || '-'}</td>
                    <td className="px-3 py-2">{formatNumber(row.stockStartClose, 2)}</td>
                    <td className="px-3 py-2">{formatNumber(row.stockEndClose, 2)}</td>
                    <td className={`px-3 py-2 font-medium ${signalClassName(row.stockChangePct)}`}>
                      {formatNumber(row.stockChangePct)}%
                    </td>
                    <td className="px-3 py-2">{formatMoney(row.liquidity20d)}</td>
                    {BENCHMARKS.map((item) => (
                      <td key={`${row.symbol}-${item.key}-change`} className={`px-3 py-2 ${signalClassName(row.benchmarks[item.key]?.benchmarkChangePct)}`}>
                        {formatNumber(row.benchmarks[item.key]?.benchmarkChangePct)}%
                      </td>
                    ))}
                    {BENCHMARKS.map((item) => (
                      <td key={`${row.symbol}-${item.key}-x`} className={`px-3 py-2 ${signalClassName(row.benchmarks[item.key]?.xMultiple)}`}>
                        {formatNumber(row.benchmarks[item.key]?.xMultiple, 3)}
                      </td>
                    ))}
                    {BENCHMARKS.map((item) => (
                      <td key={`${row.symbol}-${item.key}-rs`} className={`px-3 py-2 ${signalClassName(row.benchmarks[item.key]?.rsRatioPct)}`}>
                        {formatNumber(row.benchmarks[item.key]?.rsRatioPct)}%
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!results?.rows?.length ? (
                <tr>
                  <td colSpan={18} className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    No rows yet. Create a stock list, ingest the Deep Dive data, then run the query.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-card space-y-4 p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              List vs Ingestion Status
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Every pasted symbol remains in the saved list. This view shows whether each symbol has price history, boundary bars, and company profile data.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Saved Symbols</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">{numberFormatter.format(symbolStatusSummary.total || 0)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Ready</div>
            <div className="mt-1 font-medium text-emerald-700 dark:text-emerald-300">{numberFormatter.format(symbolStatusSummary.ready || 0)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Profile Missing</div>
            <div className="mt-1 font-medium text-amber-700 dark:text-amber-300">{numberFormatter.format(symbolStatusSummary.price_ready_profile_missing || 0)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Missing History</div>
            <div className="mt-1 font-medium text-red-700 dark:text-red-300">
              {numberFormatter.format(
                (symbolStatusSummary.no_price_history || 0) +
                  (symbolStatusSummary.missing_start_history || 0) +
                  (symbolStatusSummary.missing_end_history || 0) +
                  (symbolStatusSummary.missing_start_and_end_history || 0) +
                  (symbolStatusSummary.insufficient_boundary_data || 0)
              )}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1200px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Has Prices</th>
                <th className="px-3 py-2">Has Profile</th>
                <th className="px-3 py-2">Latest Bar</th>
                <th className="px-3 py-2">Start Bar</th>
                <th className="px-3 py-2">End Bar</th>
                <th className="px-3 py-2">Last Price Sync</th>
                <th className="px-3 py-2">Last Profile Sync</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Last Error</th>
              </tr>
            </thead>
            <tbody>
              {(results?.symbolStatuses || []).map((item) => (
                <tr key={`status-${item.symbol}`} className="table-row-hover">
                  <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{item.symbol}</td>
                  <td className="px-3 py-2">{item.companyName || '-'}</td>
                  <td className={`px-3 py-2 ${item.status === 'ready' ? 'text-emerald-700 dark:text-emerald-300' : item.status === 'price_ready_profile_missing' ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300'}`}>
                    {formatStatusLabel(item.status)}
                  </td>
                  <td className="px-3 py-2">{item.hasBars ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2">{item.hasProfile ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2">{formatDate(item.latestBarDate)}</td>
                  <td className="px-3 py-2">{formatDate(item.startBarDate)}</td>
                  <td className="px-3 py-2">{formatDate(item.endBarDate)}</td>
                  <td className="px-3 py-2">{formatDateTime(item.lastSyncedAt)}</td>
                  <td className="px-3 py-2">{formatDateTime(item.lastProfileSyncedAt)}</td>
                  <td className="px-3 py-2">{item.reason || '-'}</td>
                  <td className="px-3 py-2">{item.lastError || '-'}</td>
                </tr>
              ))}
              {!results?.symbolStatuses?.length ? (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    No symbol status data yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-card space-y-4 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Sector / Industry Analysis
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Analyze the currently selected subset from the RS table.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setGroupBy('sector')}
              className={`rounded-md px-3 py-2 text-sm font-medium ${groupBy === 'sector' ? 'bg-emerald-600 text-white' : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}
            >
              Group by Sector
            </button>
            <button
              type="button"
              onClick={() => setGroupBy('industry')}
              className={`rounded-md px-3 py-2 text-sm font-medium ${groupBy === 'industry' ? 'bg-emerald-600 text-white' : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}
            >
              Group by Industry
            </button>
          </div>
        </div>

        {analyzing ? <p className="text-sm text-slate-500 dark:text-slate-400">Analyzing selected stocks...</p> : null}
        {!selectedSymbolsArray.length ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Select stocks from the result table to see grouped analysis.
          </p>
        ) : null}

        {analysis?.groups?.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[1200px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                  <th className="px-3 py-2 capitalize">{analysis.groupBy}</th>
                  <th className="px-3 py-2">Count</th>
                  <th className="px-3 py-2">Avg Stock %</th>
                  <th className="px-3 py-2">Median Stock %</th>
                  {BENCHMARKS.map((item) => (
                    <th key={`${item.key}-avg-rs`} className="px-3 py-2">
                      Avg RS {item.label}
                    </th>
                  ))}
                  {BENCHMARKS.map((item) => (
                    <th key={`${item.key}-avg-x`} className="px-3 py-2">
                      Avg X {item.label}
                    </th>
                  ))}
                  <th className="px-3 py-2">Best</th>
                  <th className="px-3 py-2">Weakest</th>
                </tr>
              </thead>
              <tbody>
                {analysis.groups.map((group) => (
                  <tr key={group.group} className="table-row-hover">
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{group.group}</td>
                    <td className="px-3 py-2">{group.stockCount}</td>
                    <td className={`px-3 py-2 ${signalClassName(group.averageStockChangePct)}`}>{formatNumber(group.averageStockChangePct)}%</td>
                    <td className={`px-3 py-2 ${signalClassName(group.medianStockChangePct)}`}>{formatNumber(group.medianStockChangePct)}%</td>
                    {BENCHMARKS.map((item) => (
                      <td key={`${group.group}-${item.key}-rs`} className={`px-3 py-2 ${signalClassName(group.benchmarks[item.key]?.avgRsRatioPct)}`}>
                        {formatNumber(group.benchmarks[item.key]?.avgRsRatioPct)}%
                      </td>
                    ))}
                    {BENCHMARKS.map((item) => (
                      <td key={`${group.group}-${item.key}-x`} className={`px-3 py-2 ${signalClassName(group.benchmarks[item.key]?.avgXMultiple)}`}>
                        {formatNumber(group.benchmarks[item.key]?.avgXMultiple, 3)}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      {group.bestConstituent ? `${group.bestConstituent.symbol} (${formatNumber(group.bestConstituent.stockChangePct)}%)` : '-'}
                    </td>
                    <td className="px-3 py-2">
                      {group.weakestConstituent ? `${group.weakestConstituent.symbol} (${formatNumber(group.weakestConstituent.stockChangePct)}%)` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
