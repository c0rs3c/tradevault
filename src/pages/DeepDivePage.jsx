'use client';

import { useEffect, useState } from 'react';
import { fetchDeepDiveRs, fetchDeepDiveStatus } from '@/api/deepDive';

const BENCHMARKS = [
  { key: 'NIFTY', label: 'Nifty 50' },
  { key: 'MIDSML400', label: 'MidSmallcap 400' },
  { key: 'CNXSMALLCAP', label: 'CNX Smallcap' }
];

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

const signalClassName = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'text-slate-500 dark:text-slate-400';
  if (num > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (num < 0) return 'text-red-600 dark:text-red-400';
  return 'text-slate-700 dark:text-slate-200';
};

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
    className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-slate-50"
  >
    <span>{label}</span>
    <span className="text-xs">{active ? (direction === 'asc' ? '↑' : '↓') : '↕'}</span>
  </button>
);

export default function DeepDivePage() {
  const [status, setStatus] = useState(null);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [relativeBenchmarkKey, setRelativeBenchmarkKey] = useState('MIDSML400');
  const [sortBy, setSortBy] = useState('stockChangePct');
  const [sortDirection, setSortDirection] = useState('desc');
  const [page, setPage] = useState(1);
  const pageSize = 100;

  const runDeepDive = async ({
    nextStartDate = startDate,
    nextEndDate = endDate,
    nextRelativeBenchmarkKey = relativeBenchmarkKey,
    nextSortBy = sortBy,
    nextSortDirection = sortDirection,
    nextPage = page,
    showPageLoader = false
  } = {}) => {
    if (showPageLoader) setLoading(true);
    else setRunning(true);
    setError('');
    try {
      const response = await fetchDeepDiveRs({
        startDate: nextStartDate,
        endDate: nextEndDate,
        relativeBenchmarkKey: nextRelativeBenchmarkKey,
        sortBy: nextSortBy,
        sortDirection: nextSortDirection,
        page: nextPage,
        pageSize
      });
      setResults(response);
    } catch (nextError) {
      setError(nextError.response?.data?.message || 'Failed to run RS Deep Dive');
    } finally {
      setLoading(false);
      setRunning(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [statusResult] = await Promise.all([fetchDeepDiveStatus()]);
        setStatus(statusResult);
        await runDeepDive({ showPageLoader: true });
        setInitialized(true);
      } catch (nextError) {
        setError(nextError.response?.data?.message || 'Failed to load Deep Dive');
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!initialized) return;
    setPage(1);
    runDeepDive({ nextPage: 1 });
  }, [initialized, startDate, endDate, relativeBenchmarkKey]);

  const handleSort = (nextSortBy) => {
    const nextDirection =
      sortBy === nextSortBy ? (sortDirection === 'asc' ? 'desc' : 'asc') : 'desc';
    setSortBy(nextSortBy);
    setSortDirection(nextDirection);
    setPage(1);
    runDeepDive({
      nextSortBy,
      nextSortDirection: nextDirection,
      nextPage: 1
    });
  };

  const handlePageChange = (nextPage) => {
    setPage(nextPage);
    runDeepDive({ nextPage });
  };

  if (loading) return <p>Loading Deep Dive...</p>;

  const selectedBenchmark = BENCHMARKS.find((item) => item.key === relativeBenchmarkKey) || BENCHMARKS[1];

  return (
    <div className="space-y-6">
      <section className="surface-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Deep Dive
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              All imported stocks are shown by default for the selected date range.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Start Date</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">End Date</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Compare Against</span>
              <select
                value={relativeBenchmarkKey}
                onChange={(event) => setRelativeBenchmarkKey(event.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              >
                {BENCHMARKS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
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
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Selected Benchmark</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">{selectedBenchmark.label}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Rows</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
              {results?.totalRows || 0} total
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">{running ? 'Updating...' : 'Ready'}</div>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
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
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Results</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Sorted by clicking any column header. Default sort is stock percentage change descending. Showing 100 stocks per page.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-slate-600 dark:text-slate-300">
            Page {results?.page || 1} of {results?.totalPages || 1} | Showing {results?.rows?.length || 0} of {results?.totalRows || 0}
          </p>
          <div className="flex items-center gap-2">
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

        <div className="overflow-x-auto">
          <table className="min-w-[1400px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                <th className="px-3 py-2">
                  <SortHeader
                    label="Symbol"
                    active={sortBy === 'symbol'}
                    direction={sortDirection}
                    onClick={() => handleSort('symbol')}
                  />
                </th>
                <th className="px-3 py-2">
                  <SortHeader
                    label="Company"
                    active={sortBy === 'companyName'}
                    direction={sortDirection}
                    onClick={() => handleSort('companyName')}
                  />
                </th>
                <th className="px-3 py-2">
                  <SortHeader
                    label="Sector"
                    active={sortBy === 'sector'}
                    direction={sortDirection}
                    onClick={() => handleSort('sector')}
                  />
                </th>
                <th className="px-3 py-2">
                  <SortHeader
                    label="Industry"
                    active={sortBy === 'industry'}
                    direction={sortDirection}
                    onClick={() => handleSort('industry')}
                  />
                </th>
                <th className="px-3 py-2">Start</th>
                <th className="px-3 py-2">End</th>
                <th className="px-3 py-2">
                  <SortHeader
                    label="Stock %"
                    active={sortBy === 'stockChangePct'}
                    direction={sortDirection}
                    onClick={() => handleSort('stockChangePct')}
                  />
                </th>
                {BENCHMARKS.map((item) => (
                  <th key={`${item.key}-change`} className="px-3 py-2">
                    <SortHeader
                      label={`${item.label} %`}
                      active={sortBy === `benchmarkChangePct:${item.key}`}
                      direction={sortDirection}
                      onClick={() => handleSort(`benchmarkChangePct:${item.key}`)}
                    />
                  </th>
                ))}
                <th className="px-3 py-2">
                  <SortHeader
                    label={`${selectedBenchmark.label} X`}
                    active={sortBy === `xMultiple:${relativeBenchmarkKey}`}
                    direction={sortDirection}
                    onClick={() => handleSort(`xMultiple:${relativeBenchmarkKey}`)}
                  />
                </th>
                <th className="px-3 py-2">
                  <SortHeader
                    label="Bars"
                    active={sortBy === 'barsCount'}
                    direction={sortDirection}
                    onClick={() => handleSort('barsCount')}
                  />
                </th>
                <th className="px-3 py-2">
                  <SortHeader
                    label="Approx Years"
                    active={sortBy === 'approxYears'}
                    direction={sortDirection}
                    onClick={() => handleSort('approxYears')}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {(results?.rows || []).map((row) => (
                <tr key={row.symbol} className="table-row-hover">
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
                  {BENCHMARKS.map((item) => (
                    <td key={`${row.symbol}-${item.key}-change`} className={`px-3 py-2 ${signalClassName(row.benchmarks?.[item.key]?.benchmarkChangePct)}`}>
                      {formatNumber(row.benchmarks?.[item.key]?.benchmarkChangePct)}%
                    </td>
                  ))}
                  <td className={`px-3 py-2 font-medium ${signalClassName(row.benchmarks?.[relativeBenchmarkKey]?.xMultiple)}`}>
                    {formatNumber(row.benchmarks?.[relativeBenchmarkKey]?.xMultiple, 3)}
                  </td>
                  <td className="px-3 py-2">{row.barsCount || '-'}</td>
                  <td className="px-3 py-2">{formatNumber(row.approxYears, 1)}</td>
                </tr>
              ))}
              {!results?.rows?.length ? (
                <tr>
                  <td colSpan={11 + BENCHMARKS.length} className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    No imported-stock rows are available for the selected date range.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
