'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchDeepDiveRs, fetchDeepDiveStatus } from '@/api/deepDive';

const BENCHMARKS = [
  { key: 'NIFTY', label: 'Nifty 50' }
];
const RS_DEEP_DIVE_CACHE_PREFIX = 'rs-deep-dive-cache:';
const RS_DEEP_DIVE_LATEST_PARAMS_KEY = 'rs-deep-dive-latest-params';
const QUERY_PAGE_SIZE = 5000;

const defaultEndDate = () => new Date().toISOString().slice(0, 10);
const defaultStartDate = () => {
  const end = new Date();
  end.setDate(end.getDate() - 90);
  return end.toISOString().slice(0, 10);
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

const formatNumber = (value, digits = 2) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toFixed(digits);
};

const formatUnsignedNumber = (value, digits = 2) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return Math.abs(num).toFixed(digits);
};

const buildPageNumbers = (currentPage, totalPages) => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, 'ellipsis-end', totalPages];
  }
  if (currentPage >= totalPages - 3) {
    return [1, 'ellipsis-start', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, 'ellipsis-start', currentPage - 1, currentPage, currentPage + 1, 'ellipsis-end', totalPages];
};

const formatElapsedSeconds = (value) => {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
};

const formatHighLow = (high, low) => {
  const highLabel = formatNumber(high, 2);
  const lowLabel = formatNumber(low, 2);
  if (highLabel === '-' && lowLabel === '-') return '-';
  return `${highLabel} / ${lowLabel}`;
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

const getCacheEntry = (nextStartDate, nextEndDate, nextRelativeBenchmarkKey) => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(
      `${RS_DEEP_DIVE_CACHE_PREFIX}${nextStartDate}:${nextEndDate}:${nextRelativeBenchmarkKey}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.payload) return null;
    return {
      savedAt: parsed.savedAt || null,
      payload: parsed.payload
    };
  } catch {
    return null;
  }
};

const signalClassName = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'text-slate-500 dark:text-slate-400';
  if (num > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (num < 0) return 'text-red-600 dark:text-red-400';
  return 'text-slate-700 dark:text-slate-200';
};

const Spinner = ({ className = 'h-4 w-4' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    className={`${className} animate-spin`}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" className="stroke-current opacity-20" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" className="stroke-current" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const InfoTooltip = ({ row }) => (
  <span className="group relative inline-flex">
    <button
      type="button"
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      aria-label={`About ${row.symbol}`}
      onClick={(event) => event.preventDefault()}
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
    </span>
  </span>
);

const SortHeader = ({ label, active, direction, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1.5 font-medium text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-slate-50"
  >
    <span>{label}</span>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      className={`h-3 w-3 transition-transform ${active ? 'opacity-100' : 'opacity-35'} ${
        active && direction === 'asc' ? 'rotate-180' : ''
      }`}
      aria-hidden="true"
    >
      <path d="M6 2v8" />
      <path d="M3.5 4.5 6 2l2.5 2.5" />
    </svg>
  </button>
);

export default function RsDeepDivePage() {
  const [status, setStatus] = useState(null);
  const [rawResults, setRawResults] = useState(null);
  const [appliedParams, setAppliedParams] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [hasLoadedResults, setHasLoadedResults] = useState(false);
  const [cacheSummary, setCacheSummary] = useState(null);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [relativeBenchmarkKey, setRelativeBenchmarkKey] = useState('NIFTY');
  const [minChangePct, setMinChangePct] = useState('');
  const [maxChangePct, setMaxChangePct] = useState('');
  const [minXIndex, setMinXIndex] = useState('');
  const [maxXIndex, setMaxXIndex] = useState('');
  const [sortBy, setSortBy] = useState('changePct');
  const [sortDirection, setSortDirection] = useState('desc');
  const [page, setPage] = useState(1);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedSymbols, setSelectedSymbols] = useState([]);
  const [copyStatus, setCopyStatus] = useState('');
  const [copyStatusTarget, setCopyStatusTarget] = useState('');
  const pageSize = 100;
  const runStartedAtRef = useRef(null);
  const selectAllRef = useRef(null);
  const copyStatusTimeoutRef = useRef(null);
  const latestInputsRef = useRef({
    startDate: defaultStartDate(),
    endDate: defaultEndDate(),
    relativeBenchmarkKey: 'NIFTY'
  });

  const buildQueryKey = (nextStartDate, nextEndDate, nextRelativeBenchmarkKey) =>
    `${RS_DEEP_DIVE_CACHE_PREFIX}${nextStartDate}:${nextEndDate}:${nextRelativeBenchmarkKey}`;

  const refreshCacheSummary = () => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(RS_DEEP_DIVE_LATEST_PARAMS_KEY);
      if (!raw) {
        setCacheSummary(null);
        return;
      }
      const parsed = JSON.parse(raw);
      const nextStartDate = String(parsed?.startDate || '').trim();
      const nextEndDate = String(parsed?.endDate || '').trim();
      const nextRelativeBenchmarkKey = String(parsed?.relativeBenchmarkKey || '').trim();
      if (!nextStartDate || !nextEndDate || !BENCHMARKS.some((item) => item.key === nextRelativeBenchmarkKey)) {
        setCacheSummary(null);
        return;
      }
      const cacheEntry = getCacheEntry(nextStartDate, nextEndDate, nextRelativeBenchmarkKey);
      if (!cacheEntry) {
        setCacheSummary(null);
        return;
      }
      setCacheSummary({
        startDate: nextStartDate,
        endDate: nextEndDate,
        relativeBenchmarkKey: nextRelativeBenchmarkKey,
        benchmarkLabel: BENCHMARKS.find((item) => item.key === nextRelativeBenchmarkKey)?.label || nextRelativeBenchmarkKey,
        savedAt: cacheEntry.savedAt
      });
    } catch {
      setCacheSummary(null);
    }
  };

  const saveCachedResults = (nextStartDate, nextEndDate, nextRelativeBenchmarkKey, response) => {
    if (typeof window === 'undefined') return;
    const queryKey = buildQueryKey(nextStartDate, nextEndDate, nextRelativeBenchmarkKey);
    window.localStorage.setItem(
      queryKey,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        payload: response
      })
    );
    window.localStorage.setItem(
      RS_DEEP_DIVE_LATEST_PARAMS_KEY,
      JSON.stringify({
        startDate: nextStartDate,
        endDate: nextEndDate,
        relativeBenchmarkKey: nextRelativeBenchmarkKey
      })
    );
    refreshCacheSummary();
  };

  const getCachedResults = (nextStartDate, nextEndDate, nextRelativeBenchmarkKey) => {
    return getCacheEntry(nextStartDate, nextEndDate, nextRelativeBenchmarkKey)?.payload || null;
  };

  const applyLoadedResults = ({
    nextStartDate,
    nextEndDate,
    nextRelativeBenchmarkKey,
    response
  }) => {
    setRawResults(response);
    setAppliedParams({
      startDate: nextStartDate,
      endDate: nextEndDate,
      relativeBenchmarkKey: nextRelativeBenchmarkKey
    });
    setHasLoadedResults(true);
  };

  const runDeepDive = async ({
    nextStartDate = startDate,
    nextEndDate = endDate,
    nextRelativeBenchmarkKey = relativeBenchmarkKey,
    forceRefresh = false
  } = {}) => {
    if (!nextStartDate || !nextEndDate || nextStartDate > nextEndDate) {
      setError('Valid startDate and endDate are required');
      return;
    }

    const cachedResults = forceRefresh
      ? null
      : getCachedResults(nextStartDate, nextEndDate, nextRelativeBenchmarkKey);
    if (cachedResults) {
      applyLoadedResults({
        nextStartDate,
        nextEndDate,
        nextRelativeBenchmarkKey,
        response: cachedResults
      });
      setError('');
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(
          RS_DEEP_DIVE_LATEST_PARAMS_KEY,
          JSON.stringify({
            startDate: nextStartDate,
            endDate: nextEndDate,
            relativeBenchmarkKey: nextRelativeBenchmarkKey
          })
        );
        refreshCacheSummary();
      }
      return;
    }

    setRunning(true);
    setError('');
    try {
      const response = await fetchDeepDiveRs({
        startDate: nextStartDate,
        endDate: nextEndDate,
        relativeBenchmarkKey: nextRelativeBenchmarkKey,
        sortBy: 'changePct',
        sortDirection: 'desc',
        page: 1,
        pageSize: QUERY_PAGE_SIZE
      });
      applyLoadedResults({
        nextStartDate,
        nextEndDate,
        nextRelativeBenchmarkKey,
        response
      });
      saveCachedResults(nextStartDate, nextEndDate, nextRelativeBenchmarkKey, response);
    } catch (nextError) {
      setError(nextError.response?.data?.message || 'Failed to run RS Deep Dive');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    const loadStatus = async () => {
      setLoadingStatus(true);
      setError('');
      try {
        const statusResult = await fetchDeepDiveStatus();
        setStatus(statusResult);
        if (typeof window !== 'undefined') {
          const raw = window.localStorage.getItem(RS_DEEP_DIVE_LATEST_PARAMS_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            const nextStartDate = String(parsed?.startDate || '').trim();
            const nextEndDate = String(parsed?.endDate || '').trim();
            const nextRelativeBenchmarkKey = String(parsed?.relativeBenchmarkKey || '').trim();
            if (nextStartDate) setStartDate(nextStartDate);
            if (nextEndDate) setEndDate(nextEndDate);
            if (BENCHMARKS.some((item) => item.key === nextRelativeBenchmarkKey)) {
              setRelativeBenchmarkKey(nextRelativeBenchmarkKey);
            }
            const cachedResults = getCachedResults(
              nextStartDate || defaultStartDate(),
              nextEndDate || defaultEndDate(),
              BENCHMARKS.some((item) => item.key === nextRelativeBenchmarkKey)
                ? nextRelativeBenchmarkKey
                : 'NIFTY'
            );
            if (cachedResults) {
              applyLoadedResults({
                nextStartDate: nextStartDate || defaultStartDate(),
                nextEndDate: nextEndDate || defaultEndDate(),
                nextRelativeBenchmarkKey: BENCHMARKS.some((item) => item.key === nextRelativeBenchmarkKey)
                  ? nextRelativeBenchmarkKey
                  : 'NIFTY',
                response: cachedResults
              });
            }
          }
          refreshCacheSummary();
        }
      } catch (nextError) {
        setError(nextError.response?.data?.message || 'Failed to load Deep Dive status');
      } finally {
        setLoadingStatus(false);
      }
    };
    loadStatus();
  }, []);

  useEffect(() => {
    latestInputsRef.current = {
      startDate,
      endDate,
      relativeBenchmarkKey
    };
  }, [startDate, endDate, relativeBenchmarkKey]);

  const handleStartDateChange = (event) => {
    const nextStartDate = event.target.value;
    latestInputsRef.current = {
      ...latestInputsRef.current,
      startDate: nextStartDate
    };
    setStartDate(nextStartDate);
  };

  const handleEndDateChange = (event) => {
    const nextEndDate = event.target.value;
    latestInputsRef.current = {
      ...latestInputsRef.current,
      endDate: nextEndDate
    };
    setEndDate(nextEndDate);
  };

  useEffect(() => {
    if (!running) {
      setElapsedSeconds(0);
      runStartedAtRef.current = null;
      return undefined;
    }

    if (!runStartedAtRef.current) {
      runStartedAtRef.current = Date.now();
      setElapsedSeconds(0);
    }

    const intervalId = window.setInterval(() => {
      const startedAt = runStartedAtRef.current || Date.now();
      setElapsedSeconds((Date.now() - startedAt) / 1000);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [running]);

  const handleSort = (nextSortBy) => {
    if (!hasLoadedResults) return;
    const nextDirection =
      sortBy === nextSortBy ? (sortDirection === 'asc' ? 'desc' : 'asc') : 'desc';
    setSortBy(nextSortBy);
    setSortDirection(nextDirection);
    setPage(1);
  };

  const handlePageChange = (nextPage) => {
    setPage(nextPage);
  };

  const clearLocalRsData = () => {
    if (typeof window !== 'undefined') {
      const keysToRemove = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(RS_DEEP_DIVE_CACHE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => window.localStorage.removeItem(key));
      window.localStorage.removeItem(RS_DEEP_DIVE_LATEST_PARAMS_KEY);
    }
    setRawResults(null);
    setAppliedParams(null);
    setHasLoadedResults(false);
    setPage(1);
    setError('');
    setCacheSummary(null);
    setSelectedSymbols([]);
    setCopyStatus('');
    setCopyStatusTarget('');
  };

  const handleLoadSymbols = () => {
    clearLocalRsData();
    runDeepDive({
      nextStartDate: latestInputsRef.current.startDate,
      nextEndDate: latestInputsRef.current.endDate,
      nextRelativeBenchmarkKey: latestInputsRef.current.relativeBenchmarkKey,
      forceRefresh: true
    });
  };

  const handleClearSavedData = () => {
    clearLocalRsData();
  };

  const handleThresholdChange = (setter) => (event) => {
    setter(event.target.value);
    setPage(1);
    setCopyStatus('');
    setCopyStatusTarget('');
  };

  const copySymbolsToClipboard = async (symbols, target) => {
    if (copyStatusTimeoutRef.current) {
      window.clearTimeout(copyStatusTimeoutRef.current);
      copyStatusTimeoutRef.current = null;
    }
    setCopyStatusTarget(target || '');
    if (!symbols.length || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setCopyStatus(symbols.length ? 'Clipboard unavailable' : 'No symbols to copy');
      return;
    }
    try {
      const payload = symbols.map((symbol) => `NSE:${symbol}`).join(',');
      await navigator.clipboard.writeText(payload);
      setCopyStatus(`Copied ${symbols.length} symbol${symbols.length === 1 ? '' : 's'}`);
      copyStatusTimeoutRef.current = window.setTimeout(() => {
        setCopyStatus('');
        setCopyStatusTarget('');
        copyStatusTimeoutRef.current = null;
      }, 2500);
    } catch {
      setCopyStatus('Failed to copy symbols');
    }
  };

  const selectedBenchmark = BENCHMARKS.find((item) => item.key === relativeBenchmarkKey) || BENCHMARKS[0];
  const appliedBenchmark =
    BENCHMARKS.find((item) => item.key === appliedParams?.relativeBenchmarkKey) || selectedBenchmark;
  const appliedBenchmarkSummary = rawResults?.benchmarkSummaries?.find(
    (item) => item.key === appliedParams?.relativeBenchmarkKey
  ) || null;
  const loadedPeriodLabel = hasLoadedResults
    ? `${formatDate(appliedBenchmarkSummary?.startDate || appliedParams?.startDate)} to ${formatDate(
        appliedBenchmarkSummary?.endDate || appliedParams?.endDate
      )}`
    : 'Not loaded';
  const hasPendingInputChanges =
    hasLoadedResults &&
    appliedParams &&
    (
      appliedParams.startDate !== startDate ||
      appliedParams.endDate !== endDate ||
      appliedParams.relativeBenchmarkKey !== relativeBenchmarkKey
    );
  const results = useMemo(() => {
    if (!rawResults) return null;
    const parsedMinChangePct = minChangePct === '' ? null : Number(minChangePct);
    const parsedMaxChangePct = maxChangePct === '' ? null : Number(maxChangePct);
    const parsedMinXIndex = minXIndex === '' ? null : Number(minXIndex);
    const parsedMaxXIndex = maxXIndex === '' ? null : Number(maxXIndex);
    const rows = Array.isArray(rawResults.rows) ? [...rawResults.rows] : [];
    const filteredRows = rows.filter((row) => {
      const changePct = Number(row.changePct);
      const xIndexMagnitude = Math.abs(Number(row.xIndex));
      if (Number.isFinite(parsedMinChangePct) && (!Number.isFinite(changePct) || changePct < parsedMinChangePct)) return false;
      if (Number.isFinite(parsedMaxChangePct) && (!Number.isFinite(changePct) || changePct > parsedMaxChangePct)) return false;
      if (Number.isFinite(parsedMinXIndex) && (!Number.isFinite(xIndexMagnitude) || xIndexMagnitude < parsedMinXIndex)) return false;
      if (Number.isFinite(parsedMaxXIndex) && (!Number.isFinite(xIndexMagnitude) || xIndexMagnitude > parsedMaxXIndex)) return false;
      return true;
    });
    filteredRows.sort((left, right) => {
      const leftValue =
        sortBy === 'symbol'
          ? String(left.symbol || '')
          : sortBy === 'companyName'
            ? String(left.companyName || '')
            : sortBy === 'sector'
            ? String(left.sector || '')
            : sortBy === 'industry'
              ? String(left.industry || '')
                : Number(sortBy === 'xIndex' ? Math.abs(left.xIndex) : left.changePct);
      const rightValue =
        sortBy === 'symbol'
          ? String(right.symbol || '')
          : sortBy === 'companyName'
            ? String(right.companyName || '')
            : sortBy === 'sector'
            ? String(right.sector || '')
            : sortBy === 'industry'
              ? String(right.industry || '')
                : Number(sortBy === 'xIndex' ? Math.abs(right.xIndex) : right.changePct);

      if (typeof leftValue === 'string' || typeof rightValue === 'string') {
        const value = String(leftValue || '').localeCompare(String(rightValue || ''));
        return sortDirection === 'asc' ? value : value * -1;
      }

      const leftNum = Number.isFinite(leftValue) ? leftValue : Number.NEGATIVE_INFINITY;
      const rightNum = Number.isFinite(rightValue) ? rightValue : Number.NEGATIVE_INFINITY;
      const value = leftNum === rightNum ? 0 : leftNum < rightNum ? -1 : 1;
      return sortDirection === 'asc' ? value : value * -1;
    });

    const totalRows = filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const currentPage = Math.min(page, totalPages);
    const pageStart = (currentPage - 1) * pageSize;
    return {
      ...rawResults,
      filteredRows,
      rows: filteredRows.slice(pageStart, pageStart + pageSize),
      totalRows,
      totalPages,
      page: currentPage,
      pageSize
    };
  }, [rawResults, sortBy, sortDirection, page, minChangePct, maxChangePct, minXIndex, maxXIndex]);

  useEffect(() => {
    const visibleSymbols = new Set((results?.filteredRows || []).map((row) => row.symbol));
    setSelectedSymbols((current) => current.filter((symbol) => visibleSymbols.has(symbol)));
  }, [results?.filteredRows]);

  const filteredSymbols = useMemo(
    () => (results?.filteredRows || []).map((row) => row.symbol),
    [results]
  );
  const selectedSymbolsSet = useMemo(() => new Set(selectedSymbols), [selectedSymbols]);
  const selectedFilteredSymbols = useMemo(
    () => filteredSymbols.filter((symbol) => selectedSymbolsSet.has(symbol)),
    [filteredSymbols, selectedSymbolsSet]
  );
  const allFilteredSelected = filteredSymbols.length > 0 && selectedFilteredSymbols.length === filteredSymbols.length;
  const someFilteredSelected = selectedFilteredSymbols.length > 0 && !allFilteredSelected;
  const pageNumbers = useMemo(
    () => buildPageNumbers(results?.page || 1, results?.totalPages || 1),
    [results]
  );

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someFilteredSelected;
  }, [someFilteredSelected]);

  useEffect(() => () => {
    if (copyStatusTimeoutRef.current) {
      window.clearTimeout(copyStatusTimeoutRef.current);
    }
  }, []);

  const toggleSelectAllFiltered = () => {
    setSelectedSymbols(allFilteredSelected ? [] : filteredSymbols);
    setCopyStatus('');
  };

  const toggleRowSelection = (symbol) => {
    setSelectedSymbols((current) => (
      current.includes(symbol)
        ? current.filter((item) => item !== symbol)
        : [...current, symbol]
    ));
    setCopyStatus('');
  };

  const handleScrollToTop = () => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6">
      <section className="surface-card p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              RS Deep Dive
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Choose the period and comparison index, then load symbols for the selected universe.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Start Date</span>
              <input
                type="date"
                value={startDate}
                onChange={handleStartDateChange}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">End Date</span>
              <input
                type="date"
                value={endDate}
                onChange={handleEndDateChange}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <div className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Compare Against</span>
              <div className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                {BENCHMARKS[0].label}
              </div>
            </div>
            <button
              type="button"
              onClick={handleLoadSymbols}
              disabled={running || loadingStatus}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              {running ? <Spinner /> : null}
              <span>{running ? 'Loading...' : 'Load Symbols'}</span>
            </button>
            <button
              type="button"
              onClick={handleClearSavedData}
              disabled={running || loadingStatus || !cacheSummary}
              className="inline-flex flex-col items-start justify-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <span>{cacheSummary ? 'Clear Saved Data' : 'No Saved Data'}</span>
              <span className="mt-1 text-xs font-normal text-slate-500 dark:text-slate-400">
                {cacheSummary
                  ? `${formatDate(cacheSummary.startDate)} to ${formatDate(cacheSummary.endDate)}`
                  : 'No cached RS Deep Dive query'}
              </span>
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                {cacheSummary
                  ? `${cacheSummary.benchmarkLabel} • Saved ${formatDateTime(cacheSummary.savedAt)}`
                  : 'Use Load Symbols to save the current filters'}
              </span>
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Data Available Till</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
              {status?.latestAvailableDate ? formatDate(status.latestAvailableDate) : 'Not synced'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Loaded Period</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
              {loadedPeriodLabel}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Loaded Index</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
              {hasLoadedResults ? appliedBenchmark.label : 'Not loaded'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Rows</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
              {results?.totalRows || 0} total
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
              {loadingStatus ? 'Loading status...' : running ? 'Updating...' : hasLoadedResults ? 'Loaded' : 'Awaiting input'}
            </div>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        {hasPendingInputChanges ? (
          <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
            Filters changed. Press `Load Symbols` to calculate a new RS Deep Dive result.
          </p>
        ) : null}
        {running ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Elapsed time: {formatElapsedSeconds(elapsedSeconds)}
          </p>
        ) : null}
      </section>

      {results?.benchmarkSummaries?.length ? (
        <section className="grid gap-4 md:grid-cols-3">
          {results.benchmarkSummaries.map((item) => (
            <div key={item.key} className="surface-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.displayName}</div>
                {running ? <Spinner className="h-4 w-4 text-slate-400" /> : null}
              </div>
              <div className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
                {formatNumber(item.periodGapPct)}%
              </div>
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                High to low gap during {formatDate(item.startDate || appliedParams?.startDate)} to{' '}
                {formatDate(item.endDate || appliedParams?.endDate)}
              </div>
              <div className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-slate-300">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-800 dark:bg-slate-900/70">
                  <div className="uppercase tracking-wide text-slate-500 dark:text-slate-400">Start H/L</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                    {formatHighLow(item.startHigh, item.startLow)}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-800 dark:bg-slate-900/70">
                  <div className="uppercase tracking-wide text-slate-500 dark:text-slate-400">End H/L</div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                    {formatHighLow(item.endHigh, item.endLow)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {!hasLoadedResults ? (
        <section className="surface-card p-6 text-sm text-slate-600 dark:text-slate-300">
          Run the query to load symbols for the selected dates and filters.
        </section>
      ) : (
        <section className="surface-card space-y-4 p-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Results</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Sorted by clicking any column header. Change % uses the displayed boundary H/L values: start low to end high when the symbol finished up, and start high to end low when it finished down, preserving the negative sign for down moves.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Change % Above</span>
              <input
                type="number"
                value={minChangePct}
                onChange={handleThresholdChange(setMinChangePct)}
                placeholder="e.g. 10 or -5"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Change % Below</span>
              <input
                type="number"
                value={maxChangePct}
                onChange={handleThresholdChange(setMaxChangePct)}
                placeholder="e.g. 40 or 0"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">xIndex Above</span>
              <input
                type="number"
                value={minXIndex}
                onChange={handleThresholdChange(setMinXIndex)}
                placeholder="Uses shown value"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">xIndex Below</span>
              <input
                type="number"
                value={maxXIndex}
                onChange={handleThresholdChange(setMaxXIndex)}
                placeholder="Uses shown value"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-slate-600 dark:text-slate-300">
              Page {results?.page || 1} of {results?.totalPages || 1} | Showing {results?.rows?.length || 0} of {results?.totalRows || 0}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => copySymbolsToClipboard(filteredSymbols, 'filtered')}
                disabled={!filteredSymbols.length}
                className="btn-muted px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {copyStatusTarget === 'filtered' && copyStatus ? copyStatus : 'Copy Filtered Symbols'}
              </button>
              <button
                type="button"
                onClick={() => copySymbolsToClipboard(selectedFilteredSymbols, 'selected')}
                disabled={!selectedFilteredSymbols.length}
                className="btn-muted px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {copyStatusTarget === 'selected' && copyStatus ? copyStatus : 'Copy Selected Symbols'}
              </button>
              <button
                type="button"
                onClick={() => handlePageChange(Math.max(1, (results?.page || 1) - 1))}
                disabled={!results?.page || results.page <= 1 || running}
                className="btn-muted px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => handlePageChange(Math.min(results?.totalPages || 1, (results?.page || 1) + 1))}
                disabled={!results?.page || results.page >= (results?.totalPages || 1) || running}
                className="btn-muted px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {pageNumbers.map((item) => {
              if (typeof item !== 'number') {
                return (
                  <span key={item} className="px-2 py-1 text-slate-400 dark:text-slate-500">
                    ...
                  </span>
                );
              }
              const isActive = item === (results?.page || 1);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => handlePageChange(item)}
                  disabled={isActive || running}
                  className={`rounded-md px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </div>
          {copyStatus && !copyStatusTarget ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">{copyStatus}</p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="min-w-[1200px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                  <th className="px-3 py-2">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAllFiltered}
                      disabled={!filteredSymbols.length}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      aria-label="Select all filtered symbols"
                    />
                  </th>
                  <th className="px-3 py-2">
                    <SortHeader label="Symbol" active={sortBy === 'symbol'} direction={sortDirection} onClick={() => handleSort('symbol')} />
                  </th>
                  <th className="px-3 py-2">
                    <SortHeader label="Company" active={sortBy === 'companyName'} direction={sortDirection} onClick={() => handleSort('companyName')} />
                  </th>
                  <th className="px-3 py-2">
                    <SortHeader label="Sector" active={sortBy === 'sector'} direction={sortDirection} onClick={() => handleSort('sector')} />
                  </th>
                  <th className="px-3 py-2">
                    <SortHeader label="Industry" active={sortBy === 'industry'} direction={sortDirection} onClick={() => handleSort('industry')} />
                  </th>
                  <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">Start H/L</th>
                  <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">End H/L</th>
                  <th className="px-3 py-2">
                    <SortHeader label="Change %" active={sortBy === 'changePct'} direction={sortDirection} onClick={() => handleSort('changePct')} />
                  </th>
                  <th className="px-3 py-2">
                    <SortHeader label="xIndex" active={sortBy === 'xIndex'} direction={sortDirection} onClick={() => handleSort('xIndex')} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {(results?.rows || []).map((row) => (
                  <tr key={row.symbol} className="table-row-hover">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedSymbolsSet.has(row.symbol)}
                        onChange={() => toggleRowSelection(row.symbol)}
                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        aria-label={`Select ${row.symbol}`}
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
                    <td className="px-3 py-2 tabular-nums">
                      {formatHighLow(row.stockStartHigh, row.stockStartLow)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatHighLow(row.stockEndHigh, row.stockEndLow)}
                    </td>
                    <td className={`px-3 py-2 font-medium ${signalClassName(row.changePct)}`}>
                      {formatNumber(row.changePct)}%
                    </td>
                    <td className={`px-3 py-2 font-medium ${signalClassName(row.stockChangePct)}`}>
                      {formatUnsignedNumber(row.xIndex, 3)}
                    </td>
                  </tr>
                ))}
                {!results?.rows?.length ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                      No imported-stock rows are available for the selected date range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <button
        type="button"
        onClick={handleScrollToTop}
        className="fixed bottom-5 right-5 z-20 rounded-full border border-slate-300 bg-white/85 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-slate-100"
        aria-label="Scroll to top"
      >
        Top
      </button>
    </div>
  );
}
