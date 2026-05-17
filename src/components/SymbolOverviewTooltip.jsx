'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchSymbolOverview } from '../api/symbolProfile';

const overviewCache = new Map();
const pendingCache = new Map();

const loadOverview = async (symbol, signal) => {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) {
    return {
      symbol: '',
      companyName: '',
      aboutText: '',
      sector: '',
      broadIndustry: '',
      industry: '',
      found: false
    };
  }
  if (overviewCache.has(normalized)) return overviewCache.get(normalized);
  if (pendingCache.has(normalized)) return pendingCache.get(normalized);

  const promise = fetchSymbolOverview(normalized, signal)
    .then((data) => {
      overviewCache.set(normalized, data);
      pendingCache.delete(normalized);
      return data;
    })
    .catch((error) => {
      pendingCache.delete(normalized);
      throw error;
    });

  pendingCache.set(normalized, promise);
  return promise;
};

const buildMetaText = (overview) =>
  [overview?.sector, overview?.industry || overview?.broadIndustry].filter(Boolean).join(' • ');

export default function SymbolOverviewTooltip({
  symbol,
  companyName = '',
  aboutText = '',
  sector = '',
  broadIndustry = '',
  industry = '',
  className = '',
  iconClassName = '',
  panelClassName = ''
}) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const hasInitialOverview = Boolean(companyName || aboutText || sector || broadIndustry || industry);
  const [overview, setOverview] = useState(
    hasInitialOverview
      ? {
          symbol: normalizedSymbol,
          companyName,
          aboutText,
          sector,
          broadIndustry,
          industry,
          found: true
        }
      : null
  );
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    setOverview(
      hasInitialOverview
        ? {
            symbol: normalizedSymbol,
            companyName,
            aboutText,
            sector,
            broadIndustry,
            industry,
            found: true
          }
        : null
    );
    setFailed(false);
    setLoading(false);
  }, [normalizedSymbol, hasInitialOverview, companyName, aboutText, sector, broadIndustry, industry]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ensureLoaded = async () => {
    if (!normalizedSymbol || loading || overview) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setFailed(false);
    try {
      const data = await loadOverview(normalizedSymbol, controller.signal);
      setOverview(data);
    } catch (error) {
      if (error?.name !== 'CanceledError' && error?.name !== 'AbortError') {
        setFailed(true);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!normalizedSymbol) return null;

  const metaText = buildMetaText(overview);
  const resolvedName = overview?.companyName || normalizedSymbol;

  return (
    <span
      className={`group relative inline-flex ${className}`.trim()}
      onMouseEnter={ensureLoaded}
      onFocus={ensureLoaded}
    >
      <button
        type="button"
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-semibold text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 ${iconClassName}`.trim()}
        aria-label={`Show company overview for ${normalizedSymbol}`}
        onClick={(event) => event.preventDefault()}
      >
        i
      </button>
      <span
        className={`pointer-events-none absolute left-0 top-7 z-20 hidden w-96 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs text-slate-700 shadow-xl group-hover:block group-focus-within:block dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 ${panelClassName}`.trim()}
      >
        <span className="block font-semibold text-slate-900 dark:text-slate-100">{resolvedName}</span>
        {metaText ? (
          <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{metaText}</span>
        ) : null}
        {loading ? <span className="mt-2 block leading-5 text-slate-500 dark:text-slate-400">Loading overview...</span> : null}
        {!loading && overview?.aboutText ? <span className="mt-2 block leading-5">{overview.aboutText}</span> : null}
        {!loading && overview && !overview.found ? (
          <span className="mt-2 block leading-5 text-slate-500 dark:text-slate-400">No company overview found in PostgreSQL yet.</span>
        ) : null}
        {!loading && failed ? (
          <span className="mt-2 block leading-5 text-rose-600 dark:text-rose-400">Failed to load company overview.</span>
        ) : null}
      </span>
    </span>
  );
}
