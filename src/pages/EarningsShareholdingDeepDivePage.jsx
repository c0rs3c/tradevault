'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  fetchEarningsShareholdingDeepDive,
  fetchEarningsShareholdingSummary,
  listEarningsShareholdingCompanies,
  listEarningsShareholdingPeriods
} from '@/api/deepDive';
import { fetchMarketCandles } from '@/api/trades';
import StockScreenerBlock from '@/components/StockScreenerBlock';

const normalizeSearchText = (value) => String(value || '').trim().toUpperCase();

const formatNumber = (value, digits = 2) => {
  if (!Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
};

const formatHeaderDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};

const splitQuarterLabel = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (!match) {
    return {
      month: text,
      year: ''
    };
  }
  return {
    month: match[1],
    year: match[2]
  };
};

const sortByPeriodEndAsc = (rows) =>
  [...(rows || [])].sort((left, right) => {
    const leftValue = String(left?.periodEnd || '');
    const rightValue = String(right?.periodEnd || '');
    return leftValue.localeCompare(rightValue);
  });

const QUARTER_MONTH_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

const resolveQuarterAnchorDate = ({ periodLabel = '', earningsDate = '', periodEnd = '' } = {}) => {
  if (earningsDate) return earningsDate;

  const { month, year } = splitQuarterLabel(periodLabel);
  const monthIndex = QUARTER_MONTH_INDEX[String(month || '').toLowerCase()];
  if (Number.isInteger(monthIndex) && /^\d{4}$/.test(String(year || ''))) {
    return new Date(Date.UTC(Number(year), monthIndex, 1)).toISOString();
  }

  return periodEnd || '';
};

const computeSwingPercent = (candles = []) => {
  if (!Array.isArray(candles) || candles.length < 2) return null;

  const lows = candles.map((bar) => Number(bar?.low)).filter(Number.isFinite);
  const highs = candles.map((bar) => Number(bar?.high)).filter(Number.isFinite);
  const firstOpen = Number(candles[0]?.open);
  const firstClose = Number(candles[0]?.close);
  const lastClose = Number(candles[candles.length - 1]?.close);
  const startingPrice = Number.isFinite(firstOpen) ? firstOpen : firstClose;

  if (!lows.length || !highs.length || !Number.isFinite(startingPrice) || !Number.isFinite(lastClose)) return null;

  const lowestLow = Math.min(...lows);
  const highestHigh = Math.max(...highs);
  if (!Number.isFinite(lowestLow) || !Number.isFinite(highestHigh) || lowestLow <= 0 || highestHigh <= 0) return null;

  if (lastClose >= startingPrice) {
    return ((highestHigh - lowestLow) / lowestLow) * 100;
  }
  return -((highestHigh - lowestLow) / highestHigh) * 100;
};

const toUnixSeconds = (value) => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
};

const toBrowserStorageKey = (mode) => `trade-journal:earnings-shareholding:${mode}`;

const QUARTERLY_METRICS = [
  { key: 'salesRsCr', label: 'Sales', showChange: true },
  { key: 'netProfitRsCr', label: 'Net Profit', showChange: true },
  { key: 'epsRs', label: 'EPS in Rs', showChange: false },
  { key: 'opmPercent', label: 'OPM %', suffix: '%', showChange: false }
];

const SUMMARY_CHANGE_FIELDS = [
  { metric: 'sales', changeType: 'yoy', key: 'salesYoyChange', valueKey: 'salesRsCr', headerLines: ['Sales', 'YoY'] },
  { metric: 'netProfit', changeType: 'yoy', key: 'netProfitYoyChange', valueKey: 'netProfitRsCr', headerLines: ['Net Profit', 'YoY'] },
  { metric: 'sales', changeType: 'qoq', key: 'salesQoqChange', valueKey: 'salesRsCr', headerLines: ['Sales', 'QoQ'] },
  { metric: 'netProfit', changeType: 'qoq', key: 'netProfitQoqChange', valueKey: 'netProfitRsCr', headerLines: ['Net Profit', 'QoQ'] }
];

const normalizeCategoryOrder = (value) => {
  const label = String(value || '').trim();
  if (label === 'Promoters') return 1;
  if (label === 'FIIs') return 2;
  if (label === 'DIIs') return 3;
  if (label === 'Government') return 4;
  if (label === 'Public') return 5;
  if (label === 'No. of Shareholders') return 6;
  return 100;
};

const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const computePctChange = (currentValue, previousValue) => {
  const current = toFiniteNumber(currentValue);
  const previous = toFiniteNumber(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
};

const pctToneClass = (value) => {
  if (!Number.isFinite(value)) return 'text-slate-400 dark:text-slate-500';
  if (value > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (value < 0) return 'text-red-600 dark:text-red-400';
  return 'text-slate-500 dark:text-slate-400';
};

const metricValueToneClass = (label, value) => {
  const metricLabel = String(label || '').trim().toLowerCase();
  if (!['sales', 'net profit'].includes(metricLabel)) {
    return 'text-slate-900 dark:text-slate-100';
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 'text-slate-400 dark:text-slate-500';
  if (numericValue < 0) return 'text-red-600 dark:text-red-400';
  return 'text-slate-900 dark:text-slate-100';
};

const formatPctChange = (value) => {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${formatNumber(value)}%`;
};

const summaryRequestEqual = (left, right) => {
  if (!left || !right) return false;
  const leftColumnFilters = left.columnFilters || {};
  const rightColumnFilters = right.columnFilters || {};
  const leftFilterKeys = Object.keys(leftColumnFilters).sort();
  const rightFilterKeys = Object.keys(rightColumnFilters).sort();
  return (
    left.symbol === right.symbol
    && left.minMarketCapCr === right.minMarketCapCr
    && left.maxMarketCapCr === right.maxMarketCapCr
    && left.minRupeeVolumeCr === right.minRupeeVolumeCr
    && left.maxRupeeVolumeCr === right.maxRupeeVolumeCr
    && left.minPrice === right.minPrice
    && left.maxPrice === right.maxPrice
    && leftFilterKeys.length === rightFilterKeys.length
    && leftFilterKeys.every((key, index) =>
      key === rightFilterKeys[index]
      && String(leftColumnFilters[key]?.min || '') === String(rightColumnFilters[key]?.min || '')
      && String(leftColumnFilters[key]?.max || '') === String(rightColumnFilters[key]?.max || '')
    )
    && Array.isArray(left.quarters)
    && Array.isArray(right.quarters)
    && left.quarters.length === right.quarters.length
    && left.quarters.every((value, index) => value === right.quarters[index])
  );
};

const MiniBarChart = ({ values = [] }) => {
  const [hoveredBarKey, setHoveredBarKey] = useState(null);
  const numericValues = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!numericValues.length) {
    return <div className="text-[10px] text-slate-400 dark:text-slate-500">No data</div>;
  }

  const width = 112;
  const height = 44;
  const topPadding = 4;
  const bottomPadding = 4;
  const chartHeight = height - topPadding - bottomPadding;
  const minValue = Math.min(...numericValues, 0);
  const maxValue = Math.max(...numericValues, 0);
  const range = maxValue - minValue || 1;
  const step = width / numericValues.length;
  const barWidth = Math.max(6, step - 4);
  const zeroY = topPadding + ((maxValue - 0) / range) * chartHeight;
  const bars = numericValues.map((value, index) => {
    const barHeight = (Math.abs(value) / range) * chartHeight;
    const x = index * step + (step - barWidth) / 2;
    const y = value >= 0 ? zeroY - barHeight : zeroY;
    return {
      key: `${index}-${value}`,
      value,
      x,
      y,
      height: Math.max(barHeight, 1.5)
    };
  });

  return (
    <div className="relative h-11 w-28">
      <div
        className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-slate-300 dark:border-slate-700"
        style={{ top: `${(zeroY / height) * 100}%` }}
      />
      {bars.map((bar) => (
        <div
          key={bar.key}
          className="absolute"
          onMouseEnter={() => setHoveredBarKey(bar.key)}
          onMouseLeave={() => setHoveredBarKey((current) => (current === bar.key ? null : current))}
          style={{
            left: `${(bar.x / width) * 100}%`,
            top: `${(bar.y / height) * 100}%`,
            width: `${(barWidth / width) * 100}%`,
            height: `${(bar.height / height) * 100}%`
          }}
        >
          <div
            className={`h-full w-full rounded-sm ${bar.value < 0 ? 'bg-red-500 dark:bg-red-400' : 'bg-slate-700 dark:bg-slate-200'}`}
          />
          {hoveredBarKey === bar.key ? (
            <div className="pointer-events-none absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-medium text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
              {formatNumber(bar.value)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
};

const ScreenerTable = ({ title, subtitle = '', columns, rows, showMiniChart = false }) => (
  <section className="surface-card space-y-4 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
      </div>
      <p className="text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{columns.length} periods</p>
    </div>

    <div className="overflow-auto">
      <table className="min-w-[1200px] w-full table-fixed border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-[1] w-40 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              Metric
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                className="w-28 border-b border-slate-200 bg-slate-50 px-4 py-3 text-center dark:border-slate-800 dark:bg-slate-950"
              >
                <div className="flex min-h-[56px] flex-col items-center justify-start gap-0.5 text-center">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    {column.month}
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    {column.year || '\u00A0'}
                  </span>
                  <span className="whitespace-nowrap text-[10px] font-medium normal-case tracking-normal text-slate-500 dark:text-slate-400">
                    {column.sublabel || '\u00A0'}
                  </span>
                </div>
              </th>
            ))}
            {showMiniChart ? (
              <th className="w-32 border-b border-slate-200 bg-slate-50 px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                Trend
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th className="sticky left-0 z-[1] border-b border-slate-200 bg-white px-4 py-3 text-left font-medium text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
                {row.label}
              </th>
              {row.values.map((value, index) => (
                <td
                  key={`${row.label}-${columns[index]?.key || index}`}
                  className="border-b border-slate-200 px-4 py-3 text-center text-slate-600 dark:border-slate-800 dark:text-slate-300"
                >
                  {typeof value === 'object' && value !== null ? (
                    <div className="flex w-full flex-col items-center gap-1 tabular-nums">
                      <div className={`w-full text-center text-base font-bold ${metricValueToneClass(row.label, value.raw)}`}>{value.primary}</div>
                      {value.showChange ? (
                        <div className="flex w-full flex-col items-center text-[10px] leading-4 text-slate-500 dark:text-slate-400">
                          <div className={`w-full text-center font-semibold ${pctToneClass(value.yoy)}`}>
                            YoY {formatPctChange(value.yoy)}
                          </div>
                          <div className={`w-full text-center font-semibold ${pctToneClass(value.qoq)}`}>
                            QoQ {formatPctChange(value.qoq)}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    value
                  )}
                </td>
              ))}
              {showMiniChart ? (
                <td className="border-b border-slate-200 px-4 py-3 text-center dark:border-slate-800">
                  <div className="flex justify-center">
                    <MiniBarChart values={row.values.map((value) => (typeof value === 'object' && value !== null ? value.raw : value))} />
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

export default function EarningsShareholdingDeepDivePage({ mode = 'tools' }) {
  const isScreenerMode = mode === 'screener';
  const router = useRouter();
  const browserStorageKey = toBrowserStorageKey(mode);
  const [companyOptions, setCompanyOptions] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1);
  const [searchInput, setSearchInput] = useState('');
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState('');
  const [companyLoadError, setCompanyLoadError] = useState('');
  const [summaryLoadError, setSummaryLoadError] = useState('');
  const [result, setResult] = useState(null);
  const [stockSummaryRows, setStockSummaryRows] = useState([]);
  const [quarterOptions, setQuarterOptions] = useState([]);
  const [selectedScreenerQuarterEnds, setSelectedScreenerQuarterEnds] = useState([]);
  const [selectedSummarySymbol, setSelectedSummarySymbol] = useState('');
  const [minMarketCapCr, setMinMarketCapCr] = useState(isScreenerMode ? '1000' : '');
  const [maxMarketCapCr, setMaxMarketCapCr] = useState(isScreenerMode ? '70000' : '');
  const [minRupeeVolumeCr, setMinRupeeVolumeCr] = useState(isScreenerMode ? '5' : '');
  const [maxRupeeVolumeCr, setMaxRupeeVolumeCr] = useState('');
  const [minPrice, setMinPrice] = useState(isScreenerMode ? '30' : '');
  const [maxPrice, setMaxPrice] = useState(isScreenerMode ? '10000' : '');
  const [summarySortConfig, setSummarySortConfig] = useState({
    key: 'symbol',
    direction: 'desc'
  });
  const [visibleSummaryColumnKeys, setVisibleSummaryColumnKeys] = useState([]);
  const [columnValueFilters, setColumnValueFilters] = useState({});
  const [suggestionsHidden, setSuggestionsHidden] = useState(false);
  const [quarterSelectionError, setQuarterSelectionError] = useState('');
  const [appliedSummaryRequest, setAppliedSummaryRequest] = useState(null);
  const [browserStateLoaded, setBrowserStateLoaded] = useState(false);
  const [browserPersistenceReady, setBrowserPersistenceReady] = useState(false);
  const [pendingRestoredScreenerState, setPendingRestoredScreenerState] = useState(null);
  const [restoredSearchSymbol, setRestoredSearchSymbol] = useState('');
  const [summarySwingBySymbol, setSummarySwingBySymbol] = useState({});
  const showSearchSection = !isScreenerMode;
  const shouldShowSummaryTable = isScreenerMode;
  const orderedScreenerQuarterEnds = useMemo(
    () => [...selectedScreenerQuarterEnds].sort((left, right) => String(left).localeCompare(String(right))),
    [selectedScreenerQuarterEnds]
  );
  const currentSummaryRequest = useMemo(
    () => ({
      symbol: selectedSummarySymbol,
      quarters: orderedScreenerQuarterEnds,
      minMarketCapCr,
      maxMarketCapCr,
      minRupeeVolumeCr,
      maxRupeeVolumeCr,
      minPrice,
      maxPrice,
      columnFilters: Object.fromEntries(
        visibleSummaryColumnKeys
          .map((key) => [key, columnValueFilters[key] || { min: '', max: '' }])
          .filter(([, value]) => String(value?.min || '').trim() || String(value?.max || '').trim())
      )
    }),
    [
      selectedSummarySymbol,
      orderedScreenerQuarterEnds,
      minMarketCapCr,
      maxMarketCapCr,
      minRupeeVolumeCr,
      maxRupeeVolumeCr,
      minPrice,
      maxPrice,
      visibleSummaryColumnKeys,
      columnValueFilters
    ]
  );
  const hasAppliedScreener = !isScreenerMode || summaryRequestEqual(currentSummaryRequest, appliedSummaryRequest);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const rawState = window.localStorage.getItem(browserStorageKey);
      if (!rawState) {
        setBrowserStateLoaded(true);
        return;
      }

      const savedState = JSON.parse(rawState);
      if (isScreenerMode) {
        setPendingRestoredScreenerState(savedState);
      } else {
        const nextSearchInput = String(savedState?.searchInput || '');
        const nextSelectedSymbol = String(savedState?.selectedSymbol || '');
        setSearchInput(nextSearchInput);
        setRestoredSearchSymbol(nextSelectedSymbol || nextSearchInput);
        setBrowserPersistenceReady(true);
      }
    } catch {
      // Ignore malformed browser state and continue with defaults.
    } finally {
      setBrowserStateLoaded(true);
    }
  }, [browserStorageKey, isScreenerMode]);

  useEffect(() => {
    if (!isScreenerMode || !browserStateLoaded || !quarterOptions.length) return;

    if (pendingRestoredScreenerState) {
      const savedQuarterEnds = Array.isArray(pendingRestoredScreenerState?.selectedScreenerQuarterEnds)
        ? pendingRestoredScreenerState.selectedScreenerQuarterEnds
        : [];
      const availableQuarterEnds = new Set(quarterOptions.map((item) => item.periodEnd).filter(Boolean));
      const restoredQuarterEnds = savedQuarterEnds.filter((periodEnd) => availableQuarterEnds.has(periodEnd));

      setSelectedScreenerQuarterEnds(
        restoredQuarterEnds.length
          ? restoredQuarterEnds
          : sortByPeriodEndAsc(quarterOptions).slice(-3).map((item) => item.periodEnd)
      );
      setSelectedSummarySymbol(String(pendingRestoredScreenerState?.selectedSummarySymbol || ''));
      setMinMarketCapCr(String(pendingRestoredScreenerState?.minMarketCapCr ?? '1000'));
      setMaxMarketCapCr(String(pendingRestoredScreenerState?.maxMarketCapCr ?? '70000'));
      setMinRupeeVolumeCr(String(pendingRestoredScreenerState?.minRupeeVolumeCr ?? '5'));
      setMaxRupeeVolumeCr(String(pendingRestoredScreenerState?.maxRupeeVolumeCr ?? ''));
      setMinPrice(String(pendingRestoredScreenerState?.minPrice ?? '30'));
      setMaxPrice(String(pendingRestoredScreenerState?.maxPrice ?? '10000'));
      setVisibleSummaryColumnKeys(Array.isArray(pendingRestoredScreenerState?.visibleSummaryColumnKeys) ? pendingRestoredScreenerState.visibleSummaryColumnKeys : []);
      const restoredAppliedSummaryRequest =
        pendingRestoredScreenerState?.appliedSummaryRequest && typeof pendingRestoredScreenerState.appliedSummaryRequest === 'object'
          ? pendingRestoredScreenerState.appliedSummaryRequest
          : null;
      setColumnValueFilters(
        pendingRestoredScreenerState?.columnValueFilters && typeof pendingRestoredScreenerState.columnValueFilters === 'object'
          ? pendingRestoredScreenerState.columnValueFilters
          : restoredAppliedSummaryRequest?.columnFilters && typeof restoredAppliedSummaryRequest.columnFilters === 'object'
            ? restoredAppliedSummaryRequest.columnFilters
          : {}
      );
      setSummarySortConfig(
        pendingRestoredScreenerState?.summarySortConfig && typeof pendingRestoredScreenerState.summarySortConfig === 'object'
          ? pendingRestoredScreenerState.summarySortConfig
          : { key: 'symbol', direction: 'desc' }
      );
      setAppliedSummaryRequest(
        restoredAppliedSummaryRequest || null
      );
      setPendingRestoredScreenerState(null);
    } else if (!selectedScreenerQuarterEnds.length) {
      setSelectedScreenerQuarterEnds(sortByPeriodEndAsc(quarterOptions).slice(-3).map((item) => item.periodEnd));
    }

    setBrowserPersistenceReady(true);
  }, [browserStateLoaded, isScreenerMode, pendingRestoredScreenerState, quarterOptions, selectedScreenerQuarterEnds.length]);

  useEffect(() => {
    let active = true;
    const loadCompanies = async () => {
      const [companiesResult, periodsResult] = await Promise.allSettled([
        listEarningsShareholdingCompanies(),
        listEarningsShareholdingPeriods()
      ]);

      if (!active) return;

      if (companiesResult.status === 'fulfilled') {
        setCompanyOptions(Array.isArray(companiesResult.value?.suggestions) ? companiesResult.value.suggestions : []);
        setCompanyLoadError('');
      } else {
        setCompanyOptions([]);
        setCompanyLoadError(
          companiesResult.reason?.response?.data?.message || 'Failed to load company suggestions'
        );
      }

      if (periodsResult.status === 'fulfilled') {
        const nextPeriods = Array.isArray(periodsResult.value?.periods) ? periodsResult.value.periods : [];
        setQuarterOptions(nextPeriods);
        setSelectedScreenerQuarterEnds((current) => (current.length ? current : nextPeriods.slice(0, 3).map((item) => item.periodEnd)));
      } else {
        setQuarterOptions([]);
        setQuarterSelectionError(
          periodsResult.reason?.response?.data?.message || 'Failed to load quarter list'
        );
      }

      if (active) {
        setLoadingCompanies(false);
      }
    };

    loadCompanies();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isScreenerMode) {
      setStockSummaryRows([]);
      setLoadingSummary(false);
      setSummaryLoadError('');
      return undefined;
    }

    if (!selectedScreenerQuarterEnds.length) {
      setStockSummaryRows([]);
      setLoadingSummary(false);
      return undefined;
    }

    const requestPayload = appliedSummaryRequest;
    if (!requestPayload) {
      setStockSummaryRows([]);
      setLoadingSummary(false);
      setSummaryLoadError('');
      return undefined;
    }

    let active = true;
    const loadSummary = async () => {
      setLoadingSummary(true);
      const summaryResult = await Promise.allSettled([
        fetchEarningsShareholdingSummary(requestPayload)
      ]);

      if (!active) return;

      if (summaryResult[0].status === 'fulfilled') {
        setStockSummaryRows(Array.isArray(summaryResult[0].value?.stocks) ? summaryResult[0].value.stocks : []);
        setSummaryLoadError('');
      } else {
        setStockSummaryRows([]);
        setSummaryLoadError(
          summaryResult[0].reason?.response?.data?.message || 'Failed to load earnings/shareholding stock list'
        );
      }

      if (active) {
        setLoadingSummary(false);
      }
    };

    loadSummary();
    return () => {
      active = false;
    };
  }, [appliedSummaryRequest, isScreenerMode, selectedScreenerQuarterEnds]);

  useEffect(() => {
    const query = normalizeSearchText(searchInput);
    if (!query || suggestionsHidden) {
      setSuggestions([]);
      setHighlightedSuggestionIndex(-1);
      return;
    }

    const nextSuggestions = companyOptions
      .map((item) => {
        const symbol = normalizeSearchText(item.symbol);
        const companyName = normalizeSearchText(item.companyName);
        let score = -1;

        if (symbol === query) score = 1000;
        else if (companyName === query) score = 950;
        else if (symbol.startsWith(query)) score = 800;
        else if (companyName.startsWith(query)) score = 780;
        else if (symbol.includes(query)) score = 600;
        else if (companyName.includes(query)) score = 580;

        return { ...item, score };
      })
      .filter((item) => item.score >= 0)
      .sort((a, b) => (b.score - a.score) || a.symbol.localeCompare(b.symbol))
      .slice(0, 10);

    setSuggestions(nextSuggestions);
    setHighlightedSuggestionIndex(nextSuggestions.length ? 0 : -1);
  }, [companyOptions, searchInput, suggestionsHidden]);

  const toggleSummarySort = (key) => {
    setSummarySortConfig((current) => ({
      key,
      direction: current.key === key ? (current.direction === 'asc' ? 'desc' : 'asc') : 'desc'
    }));
  };

  const toggleVisibleSummaryColumn = (key) => {
    setVisibleSummaryColumnKeys((current) => {
      if (current.includes(key)) {
        if (current.length === 1) return current;
        return current.filter((item) => item !== key);
      }
      return [...current, key];
    });
  };

  const toggleVisibleSummaryColumnGroup = (group, shouldCheck) => {
    const groupKeys = summaryColumns
      .filter((column) => {
        const headerText = String(column?.headerLines?.join(' ') || '').toLowerCase();
        return group === 'yoy' ? headerText.includes('yoy') : headerText.includes('qoq');
      })
      .map((column) => column.key);

    setVisibleSummaryColumnKeys((current) => {
      if (shouldCheck) {
        return [...new Set([...current, ...groupKeys])];
      }

      const next = current.filter((key) => !groupKeys.includes(key));
      return next.length ? next : current;
    });
  };

  const runSearch = async (rawValue, matchedEntry = null) => {
    const query = String(rawValue || '').trim();
    if (!query) {
      setError('Enter a company name or symbol');
      setResult(null);
      setSelectedSummarySymbol('');
      return;
    }

    const resolvedEntry = matchedEntry || suggestions[0] || null;
    const symbol = resolvedEntry?.symbol || normalizeSearchText(query);

    setLoadingData(true);
    setError('');
    setSearchInput(symbol);
    setSuggestionsHidden(true);
    setSuggestions([]);
    setHighlightedSuggestionIndex(-1);

    try {
      const data = await fetchEarningsShareholdingDeepDive(symbol);
      setResult(data);
      if (isScreenerMode) {
        setSelectedSummarySymbol(data?.symbol || symbol);
      }
    } catch (nextError) {
      setResult(null);
      if (isScreenerMode) {
        setSelectedSummarySymbol('');
      }
      setError(nextError.response?.data?.message || 'Failed to load earnings/shareholding data');
    } finally {
      setLoadingData(false);
    }
  };

  const selectSuggestion = (event, item) => {
    event.preventDefault();
    event.stopPropagation();
    setSuggestionsHidden(true);
    runSearch(item.symbol, item);
  };

  useEffect(() => {
    if (isScreenerMode || !browserStateLoaded || loadingCompanies || !restoredSearchSymbol) return;
    runSearch(restoredSearchSymbol);
    setRestoredSearchSymbol('');
  }, [browserStateLoaded, isScreenerMode, loadingCompanies, restoredSearchSymbol]);

  const selectedScreenerQuarterEndSet = useMemo(() => new Set(selectedScreenerQuarterEnds), [selectedScreenerQuarterEnds]);
  const quarterOptionMap = useMemo(
    () =>
      quarterOptions.reduce((acc, item) => {
        if (item?.periodEnd) acc[item.periodEnd] = item;
        return acc;
      }, {}),
    [quarterOptions]
  );
  const quarterlyRowsWithChanges = useMemo(
    () =>
      sortByPeriodEndAsc(result?.quarterlyResults || [])
        .map((row, index, rows) => ({
          ...row,
          metricChanges: {
            salesRsCr: {
              qoq: index > 0 ? computePctChange(row.salesRsCr, rows[index - 1].salesRsCr) : null,
              yoy: index > 3 ? computePctChange(row.salesRsCr, rows[index - 4].salesRsCr) : null
            },
            netProfitRsCr: {
              qoq: index > 0 ? computePctChange(row.netProfitRsCr, rows[index - 1].netProfitRsCr) : null,
              yoy: index > 3 ? computePctChange(row.netProfitRsCr, rows[index - 4].netProfitRsCr) : null
            }
          }
        })),
    [result]
  );
  const displayedQuarterlyRows = useMemo(
    () =>
      isScreenerMode
        ? quarterlyRowsWithChanges.filter((row) =>
            selectedScreenerQuarterEndSet.size ? selectedScreenerQuarterEndSet.has(row.periodEnd) : true
          )
        : quarterlyRowsWithChanges,
    [isScreenerMode, quarterlyRowsWithChanges, selectedScreenerQuarterEndSet]
  );
  const quarterlyColumns = useMemo(
    () =>
      displayedQuarterlyRows.map((row) => ({
        key: row.periodEnd,
        ...splitQuarterLabel(row.periodLabel),
        sublabel: row.earningsDate ? formatHeaderDate(row.earningsDate) : ''
      })),
    [displayedQuarterlyRows]
  );
  const quarterlyDisplayRows = useMemo(
    () =>
      QUARTERLY_METRICS.map((metric) => ({
        label: metric.label,
        values: displayedQuarterlyRows.map((row) => {
          const value = row[metric.key];
          if (!Number.isFinite(Number(value))) {
            return {
              primary: '—',
              raw: value,
              qoq: null,
              yoy: null,
              showChange: metric.showChange
            };
          }
          const qoq = metric.showChange ? row.metricChanges?.[metric.key]?.qoq : null;
          const yoy = metric.showChange ? row.metricChanges?.[metric.key]?.yoy : null;
          return {
            primary: `${formatNumber(value)}${metric.suffix || ''}`,
            raw: value,
            qoq,
            yoy,
            showChange: metric.showChange
          };
        })
      })),
    [displayedQuarterlyRows]
  );
  const shareholdingPeriods = useMemo(() => {
    const seen = new Set();
    return sortByPeriodEndAsc(result?.shareholdingPattern || [])
      .filter((row) => {
        const key = `${row.viewType}-${row.periodEnd}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return isScreenerMode
          ? (selectedScreenerQuarterEndSet.size ? selectedScreenerQuarterEndSet.has(row.periodEnd) : true)
          : true;
      })
      .map((row) => ({
        key: `${row.viewType}-${row.periodEnd}`,
        label: row.periodLabel,
        viewType: row.viewType,
        periodEnd: row.periodEnd
      }));
  }, [isScreenerMode, result, selectedScreenerQuarterEndSet]);
  const shareholdingDisplayRows = useMemo(() => {
    const categoryMap = new Map();
    (result?.shareholdingPattern || []).forEach((row) => {
      const category = row.holdersCategory;
      if (!categoryMap.has(category)) categoryMap.set(category, row);
    });
    return [...categoryMap.keys()]
      .sort((left, right) => {
        const orderDiff = normalizeCategoryOrder(left) - normalizeCategoryOrder(right);
        return orderDiff || left.localeCompare(right);
      })
      .map((category) => ({
        label: category,
        values: shareholdingPeriods.map((period) => {
          const match = (result?.shareholdingPattern || []).find(
            (row) =>
              row.holdersCategory === category &&
              row.viewType === period.viewType &&
              row.periodEnd === period.periodEnd
          );
          if (!match) return '—';
          if (category === 'No. of Shareholders') {
            return {
              primary: formatNumber(match.shareholderCount, 0),
              raw: match.shareholderCount,
              qoq: null,
              yoy: null,
              showChange: false
            };
          }
          return {
            primary: Number.isFinite(Number(match.holdingPercent)) ? `${formatNumber(match.holdingPercent)}%` : '—',
            raw: match.holdingPercent,
            qoq: null,
            yoy: null,
            showChange: false
          };
        })
      }));
  }, [result, shareholdingPeriods]);
  const summaryColumns = useMemo(
    () => {
      const buildColumnsForFields = (fields) =>
        orderedScreenerQuarterEnds.flatMap((periodEnd) => {
          const period = quarterOptionMap[periodEnd];
          const periodLabel = period?.periodLabel || formatHeaderDate(periodEnd);
          return fields.map((field) => ({
            key: `${field.key}__${periodEnd}`,
            headerLines: [...field.headerLines, periodLabel],
            selectorLabel: `${field.headerLines.join(' ')} ${periodLabel}`,
            periodEnd,
            earningsDateKey: `earningsDate__${periodEnd}`,
            valueKey: `${field.valueKey}__${periodEnd}`,
            swingKey: `swing__${periodEnd}`
          }));
        });

      return [
        ...buildColumnsForFields(SUMMARY_CHANGE_FIELDS.filter((field) => field.changeType === 'yoy')),
        ...buildColumnsForFields(SUMMARY_CHANGE_FIELDS.filter((field) => field.changeType === 'qoq'))
      ];
    },
    [orderedScreenerQuarterEnds, quarterOptionMap]
  );

  useEffect(() => {
    if (!isScreenerMode || !orderedScreenerQuarterEnds.length || !stockSummaryRows.length) {
      setSummarySwingBySymbol({});
      return undefined;
    }

    const activeController = new AbortController();
    let active = true;

    const loadSummarySwings = async () => {
      const entries = await Promise.all(
        stockSummaryRows.map(async (row) => {
          const anchors = orderedScreenerQuarterEnds
            .map((periodEnd) => {
              const metric = row.metricsByPeriod?.[periodEnd];
              if (!metric) return null;
              return {
                periodEnd,
                anchorDate: resolveQuarterAnchorDate({
                  periodLabel: metric.periodLabel,
                  earningsDate: metric.earningsDate,
                  periodEnd
                })
              };
            })
            .filter(Boolean);

          if (anchors.length < 2) {
            return [row.symbol, {}];
          }

          const from = anchors[0]?.anchorDate;
          const to = anchors[anchors.length - 1]?.anchorDate;
          if (!from || !to) {
            return [row.symbol, {}];
          }

          try {
            const response = await fetchMarketCandles({
              symbol: row.symbol,
              from,
              to,
              interval: '1D',
              signal: activeController.signal
            });

            const candles = Array.isArray(response?.candles) ? response.candles : [];
            const nextSwingMap = {};
            for (let index = 0; index < anchors.length - 1; index += 1) {
              const currentAnchor = anchors[index];
              const nextAnchor = anchors[index + 1];
              const fromSeconds = toUnixSeconds(currentAnchor.anchorDate);
              const toSeconds = toUnixSeconds(nextAnchor.anchorDate);

              if (!Number.isFinite(fromSeconds) || !Number.isFinite(toSeconds) || fromSeconds >= toSeconds) {
                nextSwingMap[currentAnchor.periodEnd] = null;
                continue;
              }

              const windowCandles = candles.filter((bar) => {
                const time = Number(bar?.time);
                return Number.isFinite(time) && time >= fromSeconds && time <= toSeconds;
              });
              nextSwingMap[currentAnchor.periodEnd] = computeSwingPercent(windowCandles);
            }

            return [row.symbol, nextSwingMap];
          } catch {
            return [row.symbol, {}];
          }
        })
      );

      if (active) {
        setSummarySwingBySymbol(Object.fromEntries(entries));
      }
    };

    loadSummarySwings();
    return () => {
      active = false;
      activeController.abort();
    };
  }, [isScreenerMode, orderedScreenerQuarterEnds, stockSummaryRows]);

  const summaryRows = useMemo(
    () =>
      stockSummaryRows.map((row) => {
        const nextRow = { ...row };
        nextRow.salesTrend = orderedScreenerQuarterEnds.map(
          (periodEnd) => row.metricsByPeriod?.[periodEnd]?.salesRsCr ?? null
        );
        nextRow.netProfitTrend = orderedScreenerQuarterEnds.map(
          (periodEnd) => row.metricsByPeriod?.[periodEnd]?.netProfitRsCr ?? null
        );
        nextRow.chartPreviewPeriods = orderedScreenerQuarterEnds.map((periodEnd) => {
          const metric = row.metricsByPeriod?.[periodEnd];
          return {
            periodEnd,
            periodLabel: metric?.periodLabel || quarterOptionMap[periodEnd]?.periodLabel || formatHeaderDate(periodEnd),
            earningsDate: metric?.earningsDate || '',
            anchorDate: resolveQuarterAnchorDate({
              periodLabel: metric?.periodLabel || quarterOptionMap[periodEnd]?.periodLabel || '',
              earningsDate: metric?.earningsDate,
              periodEnd
            })
          };
        });
        summaryColumns.forEach((column) => {
          const metricKey = column.key.split('__')[0];
          nextRow[column.key] = row.metricsByPeriod?.[column.periodEnd]?.[metricKey] ?? null;
          nextRow[column.earningsDateKey] = row.metricsByPeriod?.[column.periodEnd]?.earningsDate || '';
          nextRow[column.valueKey] = row.metricsByPeriod?.[column.periodEnd]?.[column.valueKey.split('__')[0]] ?? null;
          nextRow[column.swingKey] = summarySwingBySymbol[row.symbol]?.[column.periodEnd] ?? null;
        });
        return nextRow;
      }),
    [orderedScreenerQuarterEnds, stockSummaryRows, summaryColumns, summarySwingBySymbol, quarterOptionMap]
  );

  useEffect(() => {
    if (!isScreenerMode || !browserPersistenceReady) return;

    const availableKeys = summaryColumns.map((column) => column.key);
    setVisibleSummaryColumnKeys((current) => {
      const kept = current.filter((key) => availableKeys.includes(key));
      return kept.length ? kept : availableKeys;
    });
    setColumnValueFilters((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => availableKeys.includes(key))
      )
    );
    setSummarySortConfig((current) => {
      if (availableKeys.includes(current.key) || current.key === 'symbol' || current.key === 'companyName') {
        return current;
      }
      const preferredKey =
        summaryColumns.find((column) => column.key.startsWith('netProfitYoyChange__'))?.key
        || availableKeys[0]
        || 'symbol';
      return { key: preferredKey, direction: 'desc' };
    });
  }, [browserPersistenceReady, isScreenerMode, summaryColumns]);

  useEffect(() => {
    if (!browserStateLoaded || !browserPersistenceReady || typeof window === 'undefined') return;

    const nextState = isScreenerMode
      ? {
          selectedScreenerQuarterEnds,
          selectedSummarySymbol,
          minMarketCapCr,
          maxMarketCapCr,
          minRupeeVolumeCr,
          maxRupeeVolumeCr,
          minPrice,
          maxPrice,
          visibleSummaryColumnKeys,
          columnValueFilters,
          summarySortConfig,
          appliedSummaryRequest
        }
      : {
          searchInput,
          selectedSymbol: result?.symbol || ''
        };

    window.localStorage.setItem(browserStorageKey, JSON.stringify(nextState));
  }, [
    appliedSummaryRequest,
    browserPersistenceReady,
    browserStateLoaded,
    browserStorageKey,
    columnValueFilters,
    isScreenerMode,
    maxMarketCapCr,
    maxPrice,
    maxRupeeVolumeCr,
    minMarketCapCr,
    minPrice,
    minRupeeVolumeCr,
    result,
    searchInput,
    selectedScreenerQuarterEnds,
    selectedSummarySymbol,
    summarySortConfig,
    visibleSummaryColumnKeys
  ]);

  const toggleSelectedQuarter = (periodEnd) => {
    setQuarterSelectionError('');
    setSelectedScreenerQuarterEnds((current) => {
      if (current.includes(periodEnd)) {
        return current.filter((item) => item !== periodEnd);
      }
      if (current.length >= 4) {
        setQuarterSelectionError('You can choose at most 4 quarters.');
        return current;
      }
      return [...current, periodEnd];
    });
  };

  const handleColumnFilterChange = (columnKey, bound, value) => {
    setColumnValueFilters((current) => ({
      ...current,
      [columnKey]: {
        min: bound === 'min' ? value : (current[columnKey]?.min || ''),
        max: bound === 'max' ? value : (current[columnKey]?.max || '')
      }
    }));
  };

  const handleApplyFilters = () => {
    setAppliedSummaryRequest({
      ...currentSummaryRequest,
      quarters: [...currentSummaryRequest.quarters]
    });
  };

  const clearSavedBrowserState = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(browserStorageKey);
    }

    if (isScreenerMode) {
      setSelectedSummarySymbol('');
      setMinMarketCapCr('1000');
      setMaxMarketCapCr('70000');
      setMinRupeeVolumeCr('5');
      setMaxRupeeVolumeCr('');
      setMinPrice('30');
      setMaxPrice('10000');
      setVisibleSummaryColumnKeys([]);
      setColumnValueFilters({});
      setSummarySortConfig({ key: 'symbol', direction: 'desc' });
      setAppliedSummaryRequest(null);
      setQuarterSelectionError('');
      setSelectedScreenerQuarterEnds(sortByPeriodEndAsc(quarterOptions).slice(-3).map((item) => item.periodEnd));
      setStockSummaryRows([]);
      setSummaryLoadError('');
      return;
    }

    setSearchInput('');
    setRestoredSearchSymbol('');
    setResult(null);
    setError('');
    setSuggestions([]);
    setHighlightedSuggestionIndex(-1);
    setSuggestionsHidden(false);
  };

  return (
    <div className="space-y-6">
      <section className="surface-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Saved in this browser</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Selections on this page are stored locally in this browser and update automatically when you change them.
          </p>
        </div>
        <button
          type="button"
          onClick={clearSavedBrowserState}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:text-slate-100"
        >
          Clear Saved Selections
        </button>
      </section>

      {showSearchSection ? (
        <section className="surface-card space-y-4 p-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Earnings Data
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Search any NSE stock by symbol or company name to open its detailed earnings and shareholding view.
            </p>
          </div>

          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              runSearch(searchInput, highlightedSuggestionIndex >= 0 ? suggestions[highlightedSuggestionIndex] : null);
            }}
          >
            <label className="space-y-1">
              <span className="text-sm font-medium">Company Search</span>
              <div className="relative">
                <input
                  className="field-input"
                  value={searchInput}
                  onChange={(event) => {
                    setSuggestionsHidden(false);
                    const nextValue = event.target.value;
                    setSearchInput(nextValue);
                    if (!String(nextValue || '').trim()) {
                      setSelectedSummarySymbol('');
                      setResult(null);
                      setError('');
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!suggestions.length) return;
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setHighlightedSuggestionIndex((current) => (current + 1) % suggestions.length);
                      return;
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setHighlightedSuggestionIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
                      return;
                    }
                    if (event.key === 'Enter' && highlightedSuggestionIndex >= 0) {
                      event.preventDefault();
                      runSearch(searchInput, suggestions[highlightedSuggestionIndex]);
                      return;
                    }
                    if (event.key === 'Escape') {
                      setSuggestionsHidden(true);
                      setSuggestions([]);
                      setHighlightedSuggestionIndex(-1);
                    }
                  }}
                  placeholder="Type symbol or company name"
                  autoComplete="off"
                />

                {suggestions.length ? (
                  <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
                    <ul className="max-h-80 overflow-y-auto py-1">
                      {suggestions.map((item, index) => {
                        const active = index === highlightedSuggestionIndex;
                        return (
                          <li key={item.symbol}>
                            <button
                              type="button"
                              className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition ${
                                active
                                  ? 'bg-sky-100 text-slate-900 ring-1 ring-sky-200 dark:bg-sky-950/70 dark:text-slate-100 dark:ring-sky-800'
                                  : 'text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800'
                              }`}
                              onMouseEnter={() => setHighlightedSuggestionIndex(index)}
                              onMouseDown={(event) => selectSuggestion(event, item)}
                              onClick={(event) => selectSuggestion(event, item)}
                            >
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold">{item.symbol}</span>
                                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                                  {item.companyName || 'Unknown company'}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            </label>
          </form>

          {loadingCompanies ? <p className="text-xs text-slate-500 dark:text-slate-400">Loading company list...</p> : null}
          {loadingData ? <p className="text-xs text-slate-500 dark:text-slate-400">Loading company data...</p> : null}
          {companyLoadError ? <p className="text-sm text-red-600 dark:text-red-400">{companyLoadError}</p> : null}

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </section>
      ) : null}

      {isScreenerMode ? (
        <section className="surface-card space-y-4 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Quarter Picker</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Choose up to 4 earnings quarters between Jan 2021 and Dec 2027. YoY and QoQ columns will be built only from the selected quarters.
              </p>
            </div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {selectedScreenerQuarterEnds.length}/4 selected
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {sortByPeriodEndAsc(quarterOptions).map((period) => {
              const active = selectedScreenerQuarterEnds.includes(period.periodEnd);
              return (
                <button
                  key={period.periodEnd}
                  type="button"
                  onClick={() => toggleSelectedQuarter(period.periodEnd)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? 'border-sky-500 bg-sky-100 text-sky-900 dark:border-sky-400 dark:bg-sky-950/60 dark:text-sky-100'
                      : 'border-slate-300 text-slate-700 hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:text-slate-100'
                  }`}
                >
                  {period.periodLabel}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setQuarterSelectionError('');
                setSelectedScreenerQuarterEnds(sortByPeriodEndAsc(quarterOptions).slice(-3).map((item) => item.periodEnd));
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:text-slate-100"
            >
              Reset to latest 3
            </button>
          </div>

          {quarterSelectionError ? <p className="text-sm text-red-600 dark:text-red-400">{quarterSelectionError}</p> : null}
        </section>
      ) : null}

      {shouldShowSummaryTable ? (
        <StockScreenerBlock
          title={selectedSummarySymbol ? `${selectedSummarySymbol} Snapshot` : 'All Stocks'}
          subtitle={
            'Choose quarters and filters, then click Apply Filters to load stocks matching the selected criteria.'
          }
          rows={isScreenerMode && !hasAppliedScreener ? [] : summaryRows}
          loading={loadingSummary}
          error={summaryLoadError}
          emptyStateMessage={
            isScreenerMode
              ? 'No stocks are shown yet. Choose your criteria and click Apply Filters.'
              : ''
          }
          filters={{
            minMarketCapCr,
            maxMarketCapCr,
            minRupeeVolumeCr,
            maxRupeeVolumeCr,
            minPrice,
            maxPrice
          }}
          onFilterChange={(key, value) => {
            if (key === 'minMarketCapCr') setMinMarketCapCr(value);
            if (key === 'maxMarketCapCr') setMaxMarketCapCr(value);
            if (key === 'minRupeeVolumeCr') setMinRupeeVolumeCr(value);
            if (key === 'maxRupeeVolumeCr') setMaxRupeeVolumeCr(value);
            if (key === 'minPrice') setMinPrice(value);
            if (key === 'maxPrice') setMaxPrice(value);
          }}
          sortConfig={summarySortConfig}
          onSort={toggleSummarySort}
          columnOptions={summaryColumns}
          visibleColumnKeys={visibleSummaryColumnKeys}
          onToggleColumn={toggleVisibleSummaryColumn}
          onSelectRow={(row) => runSearch(row.symbol, row)}
          showFilters={isScreenerMode}
          showColumnSelector={isScreenerMode}
          columnSelectorLabel={orderedScreenerQuarterEnds.length ? `Columns for ${orderedScreenerQuarterEnds.map((periodEnd) => quarterOptionMap[periodEnd]?.periodLabel || formatHeaderDate(periodEnd)).join(', ')}` : 'Columns'}
          showHeader={isScreenerMode}
          trendColumns={isScreenerMode ? [
            { key: 'salesTrend', label: 'Sales Trend' },
            { key: 'netProfitTrend', label: 'Profit Trend' }
          ] : []}
          headerActions={
            isScreenerMode ? (
              <button
                type="button"
                onClick={handleApplyFilters}
                className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Apply Filters
              </button>
            ) : null
          }
          columnValueFilters={columnValueFilters}
          onColumnFilterChange={isScreenerMode ? handleColumnFilterChange : undefined}
          onToggleColumnGroup={isScreenerMode ? toggleVisibleSummaryColumnGroup : undefined}
        />
      ) : null}

      {result ? (
        <>
          <section className="surface-card space-y-4 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {result.profile?.companyName || result.symbol}
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Symbol: {result.symbol}
                  {result.profile?.companySlug ? ` · Slug: ${result.profile.companySlug}` : ''}
                </p>
              </div>
              {result.profile?.sourceUrl ? (
                <a
                  href={result.profile.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-sky-700 hover:text-sky-600 dark:text-sky-300"
                >
                  Open source
                </a>
              ) : null}
            </div>
            {result.profile?.aboutText ? (
              <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">{result.profile.aboutText}</p>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">No company profile text stored for this stock.</p>
            )}
          </section>

          <ScreenerTable
            title="Quarterly Results"
            subtitle="Screener-style view with periods as columns."
            columns={quarterlyColumns}
            rows={quarterlyDisplayRows}
            showMiniChart
          />

          <ScreenerTable
            title="Shareholding Pattern"
            subtitle="Quarterly holder mix across stored periods."
            columns={shareholdingPeriods}
            rows={shareholdingDisplayRows}
          />
        </>
      ) : null}
    </div>
  );
}
