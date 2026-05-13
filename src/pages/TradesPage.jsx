import { Fragment, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  addStopLossAdjustment,
  deleteStopLossAdjustment,
  deleteTradeScreenshotUpload,
  deleteExit,
  deletePyramid,
  deleteTrade,
  fetchTradeQuote,
  fetchTrades,
  uploadTradeScreenshotFile,
  updateExit,
  updateTrade,
  updatePyramid
} from '../api/trades';
import Modal from '../components/Modal';
import ScreenshotManager from '../components/ScreenshotManager';
import TradeStrategySelector from '../components/TradeStrategySelector';
import ExitReasonMultiSelect from '../components/ExitReasonMultiSelect';
import { useSettings } from '../contexts/SettingsContext';
import TradeChartOverlay from '../components/TradeChartOverlay';
import { hasAnySelectedOption, joinOptionList, normalizeOptionList } from '../utils/tradeOptions';

const tradesCache = {
  data: null
};

const money = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const pnlTextClass = (value) => {
  const num = Number(value || 0);
  if (num > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (num < 0) return 'text-red-600 dark:text-red-400';
  return '';
};

const SortArrow = ({ active = false, direction = 'desc' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={`h-3 w-3 ${active ? 'text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'} ${
      direction === 'asc' ? 'rotate-180' : ''
    }`}
    aria-hidden="true"
  >
    <path d="M12 5v14" strokeLinecap="round" />
    <path d="m8 15 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const entryRisk = (entryPrice, stopLoss, qty, side = 'LONG') => {
  const entry = Number(entryPrice || 0);
  const stop = Number(stopLoss || 0);
  const quantity = Number(qty || 0);
  const perUnitRisk =
    String(side || 'LONG').toUpperCase() === 'SHORT'
      ? Math.max(stop - entry, 0)
      : Math.max(entry - stop, 0);
  return perUnitRisk * quantity;
};

const EPSILON_QTY = 1e-9;

const entrySourceKey = (sourceType, sourceId) => `${String(sourceType || 'BASE').toUpperCase()}::${sourceId || 'BASE'}`;

const stopLossPercent = (entryPrice, stopLoss) => {
  const entry = Number(entryPrice || 0);
  const sl = Number(stopLoss || 0);
  if (entry <= 0 || sl <= 0) return 0;
  return (Math.abs(entry - sl) / entry) * 100;
};

const realizedPnlPercent = (trade) => {
  const realized = Number(trade?.metrics?.realizedPnL || 0);
  const avgEntryPrice = Number(trade?.metrics?.avgEntryPrice || 0);
  const totalEntryQty = Number(trade?.metrics?.totalEntryQty || 0);
  const basis = avgEntryPrice * totalEntryQty;
  if (!basis) return 0;
  return (realized / basis) * 100;
};

const unrealizedPnlValue = (trade, livePrice = null) => {
  const openQty = Number(trade?.metrics?.openQty || 0);
  const avgEntryPrice = Number(trade?.metrics?.avgEntryPrice || 0);
  if (!openQty || !avgEntryPrice) return null;

  const marketPrice =
    livePrice !== null && livePrice !== undefined ? Number(livePrice) : Number(trade?.metrics?.unrealizedPnL);

  if (livePrice !== null && livePrice !== undefined && Number.isFinite(marketPrice)) {
    return trade?.side === 'SHORT'
      ? openQty * (avgEntryPrice - marketPrice)
      : openQty * (marketPrice - avgEntryPrice);
  }

  const metricValue = Number(trade?.metrics?.unrealizedPnL);
  return Number.isFinite(metricValue) ? metricValue : null;
};

const unrealizedPnlPercent = (trade, livePrice = null) => {
  const unrealized = unrealizedPnlValue(trade, livePrice);
  const avgEntryPrice = Number(trade?.metrics?.avgEntryPrice || 0);
  const openQty = Number(trade?.metrics?.openQty || 0);
  const basis = avgEntryPrice * openQty;
  if (unrealized === null || !basis) return null;
  return (unrealized / basis) * 100;
};

const capitalAllocated = (trade) => {
  const avgEntryPrice = Number(trade?.metrics?.avgEntryPrice || 0);
  const totalEntryQty = Number(trade?.metrics?.totalEntryQty || 0);
  return avgEntryPrice * totalEntryQty;
};

const buildTradeEntries = (trade) =>
  [
    {
      sourceType: 'BASE',
      sourceId: 'BASE',
      label: 'Base Entry',
      entryDate: trade?.entryDate,
      entryPrice: Number(trade?.entryPrice || 0),
      qty: Number(trade?.entryQty || 0),
      stopLoss: Number(trade?.stopLoss || 0)
    },
    ...((trade?.pyramids || []).map((p) => ({
      sourceType: 'PYRAMID',
      sourceId: String(p?._id || ''),
      label: 'Pyramid',
      entryDate: p?.entryDate || p?.date,
      entryPrice: Number(p?.price || 0),
      qty: Number(p?.qty || 0),
      stopLoss: Number(p?.stopLoss || 0)
    })))
  ].sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate));

const buildOpenLots = (trade) => {
  const lots = buildTradeEntries(trade).map((entry) => ({
    qtyRemaining: Number(entry.qty || 0),
    entryPrice: Number(entry.entryPrice || 0),
    stopLoss: Number(entry.stopLoss || 0),
    sourceType: entry.sourceType,
    sourceId: entry.sourceId
  }));
  const exits = [...(trade?.exits || [])].sort((a, b) => new Date(a.exitDate) - new Date(b.exitDate));

  exits.forEach((exit) => {
    let remainingExitQty = Number(exit?.exitQty || 0);
    for (const lot of lots) {
      if (remainingExitQty <= EPSILON_QTY) break;
      if (lot.qtyRemaining <= EPSILON_QTY) continue;
      const matchedQty = Math.min(remainingExitQty, lot.qtyRemaining);
      lot.qtyRemaining -= matchedQty;
      remainingExitQty -= matchedQty;
    }
  });

  return lots
    .filter((lot) => lot.qtyRemaining > EPSILON_QTY)
    .map((lot) => ({
      qty: lot.qtyRemaining,
      entryPrice: lot.entryPrice,
      stopLoss: lot.stopLoss,
      sourceType: lot.sourceType,
      sourceId: lot.sourceId
    }));
};

const applyStopLossAdjustmentsToLots = (openLots, adjustments = []) => {
  let segments = openLots.map((lot) => ({
    qty: Number(lot.qty || 0),
    entryPrice: Number(lot.entryPrice || 0),
    stopLoss: Number(lot.stopLoss || 0),
    sourceType: lot.sourceType || 'BASE',
    sourceId: lot.sourceId || 'BASE',
    isAdjusted: false,
    adjustedAt: null
  }));

  const sortedAdjustments = [...adjustments].sort((a, b) => new Date(a?.date || 0) - new Date(b?.date || 0));
  for (const adjustment of sortedAdjustments) {
    let remainingQty = Number(adjustment?.qty || 0);
    const adjustedStopLoss = Number(adjustment?.stopLoss || 0);
    const targetType = String(adjustment?.targetType || '').toUpperCase();
    const targetEntryId = String(adjustment?.targetEntryId || '');
    if (remainingQty <= EPSILON_QTY || adjustedStopLoss <= 0) continue;

    const matchesTarget = (segment) => {
      if (targetType === 'PYRAMID' && targetEntryId) {
        return segment.sourceType === 'PYRAMID' && segment.sourceId === targetEntryId;
      }
      if (targetType === 'BASE') {
        return segment.sourceType === 'BASE';
      }
      return true;
    };

    const adjustedSegments = segments
      .filter((segment) => segment.isAdjusted && segment.qty > EPSILON_QTY && matchesTarget(segment))
      .sort((a, b) => new Date(b.adjustedAt || 0) - new Date(a.adjustedAt || 0));
    const baseSegments = segments.filter(
      (segment) => !segment.isAdjusted && segment.qty > EPSILON_QTY && matchesTarget(segment)
    );

    for (const pool of [adjustedSegments, baseSegments]) {
      for (const segment of pool) {
        if (remainingQty <= EPSILON_QTY) break;
        if (segment.qty <= EPSILON_QTY) continue;
        const matchedQty = Math.min(remainingQty, segment.qty);
        segment.qty -= matchedQty;
        remainingQty -= matchedQty;
        segments.push({
          qty: matchedQty,
          entryPrice: segment.entryPrice,
          stopLoss: adjustedStopLoss,
          sourceType: segment.sourceType,
          sourceId: segment.sourceId,
          isAdjusted: true,
          adjustedAt: adjustment?.date || new Date()
        });
      }
      if (remainingQty <= EPSILON_QTY) break;
    }

    segments = segments.filter((segment) => segment.qty > EPSILON_QTY);
  }

  return segments;
};

const buildEntryRiskSnapshot = (trade) => {
  const segments = applyStopLossAdjustmentsToLots(buildOpenLots(trade), trade?.stopLossAdjustments || []);
  return segments.reduce((acc, segment) => {
    const key = entrySourceKey(segment.sourceType, segment.sourceId);
    if (!acc[key]) {
      acc[key] = { openQty: 0, capitalAtRisk: 0, stopLosses: new Set() };
    }
    acc[key].openQty += Number(segment.qty || 0);
    acc[key].capitalAtRisk += entryRisk(segment.entryPrice, segment.stopLoss, segment.qty, trade?.side);
    if (Number(segment.stopLoss || 0) > 0) {
      acc[key].stopLosses.add(Number(segment.stopLoss));
    }
    return acc;
  }, {});
};

const getStopLossDisplay = (snapshot, fallbackStopLoss) => {
  const stopLosses = snapshot ? [...snapshot.stopLosses] : [];
  if (!stopLosses.length) return Number(fallbackStopLoss || 0).toFixed(2);
  if (stopLosses.length === 1) return stopLosses[0].toFixed(2);
  return 'Mixed';
};

const getEntryTargetMeta = (trade, targetType = 'BASE', targetEntryId = 'BASE') => {
  const snapshotByEntry = buildEntryRiskSnapshot(trade);
  const key = entrySourceKey(targetType, targetEntryId);
  const snapshot = snapshotByEntry[key];
  if (targetType === 'PYRAMID') {
    const pyramid = (trade?.pyramids || []).find((item) => String(item?._id || '') === String(targetEntryId || ''));
    return {
      key,
      label: pyramid
        ? `Pyramid ${new Date(pyramid.date).toLocaleDateString()} @ ${pyramid.price}`
        : 'Pyramid',
      openQty: Number(snapshot?.openQty || 0),
      capitalAtRisk: Number(snapshot?.capitalAtRisk || 0),
      stopLossDisplay: getStopLossDisplay(snapshot, pyramid?.stopLoss)
    };
  }

  return {
    key,
    label: 'Base Entry',
    openQty: Number(snapshot?.openQty || 0),
    capitalAtRisk: Number(snapshot?.capitalAtRisk || 0),
    stopLossDisplay: getStopLossDisplay(snapshot, trade?.stopLoss)
  };
};

const getStopLossHistoryForTarget = (trade, targetType = 'BASE', targetEntryId = 'BASE') =>
  [...(trade?.stopLossAdjustments || [])]
    .filter((adjustment) => {
      const adjustmentType = String(adjustment?.targetType || 'BASE').toUpperCase();
      const adjustmentTargetId = String(adjustment?.targetEntryId || 'BASE');
      return adjustmentType === String(targetType || 'BASE').toUpperCase()
        && adjustmentTargetId === String(targetEntryId || 'BASE');
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

const tradeEntries = (trade) =>
  buildTradeEntries(trade).map((entry) => ({
    entryPrice: Number(entry.entryPrice || 0),
    qty: Number(entry.qty || 0),
    stopLoss: Number(entry.stopLoss || 0)
  }));

const tradeStopLossPercent = (trade) => {
  const entries = tradeEntries(trade).filter((e) => e.entryPrice > 0 && e.qty > 0 && e.stopLoss > 0);
  if (!entries.length) return 0;
  const totalNotional = entries.reduce((acc, e) => acc + e.entryPrice * e.qty, 0);
  const totalRisk = entries.reduce((acc, e) => acc + entryRisk(e.entryPrice, e.stopLoss, e.qty, trade?.side), 0);
  if (!totalNotional) return 0;
  return (totalRisk / totalNotional) * 100;
};

const tradeRMultipleBySl = (trade) => {
  const slPercent = tradeStopLossPercent(trade);
  if (!slPercent) return 0;
  const gainPercent = realizedPnlPercent(trade);
  const raw = gainPercent / slPercent;
  if (raw <= -1) return -1;
  return raw;
};

const diffInCalendarDaysInclusive = (start, end) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  const startUtc = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const endUtc = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  const diffDays = Math.floor((endUtc - startUtc) / (24 * 60 * 60 * 1000));
  return Math.max(0, diffDays) + 1;
};

const tradeHoldingDays = (trade) => {
  const exits = trade?.exits || [];
  if (!trade?.entryDate) return 0;
  if (!exits.length) return diffInCalendarDaysInclusive(trade.entryDate, new Date());
  const lastExitDate = exits.reduce((latest, exit) => {
    const latestTime = latest ? new Date(latest).getTime() : -Infinity;
    const currentTime = new Date(exit.exitDate).getTime();
    return currentTime > latestTime ? exit.exitDate : latest;
  }, null);
  return diffInCalendarDaysInclusive(trade.entryDate, lastExitDate || trade.entryDate);
};

const compareNullableNumbers = (a, b, direction = 'desc') => {
  const aValid = Number.isFinite(a);
  const bValid = Number.isFinite(b);
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  return direction === 'asc' ? a - b : b - a;
};

const todayInputDate = () => new Date().toISOString().slice(0, 10);
const normalizeScreenshots = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item) => ({
      url: String(item?.url || '').trim(),
      key: String(item?.key || '').trim()
    }))
    .filter((item) => item.url);

const validateScreenshotFiles = (files) => {
  const nextFiles = Array.from(files || []);
  if (!nextFiles.length) return '';
  if (nextFiles.some((file) => !file.type.startsWith('image/'))) return 'Please upload only image files';
  if (nextFiles.some((file) => file.size > 5 * 1024 * 1024)) return 'Each screenshot must be 5MB or smaller';
  return '';
};

const toggleOption = (current, option) => {
  const items = normalizeOptionList(current);
  return items.includes(option) ? items.filter((item) => item !== option) : [...items, option];
};

const monthGroupLabel = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Unknown Month';
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric'
  }).format(date);
};

const monthFilterValue = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 7);
};

const TradesLoadingState = () => (
  <div className="space-y-4 animate-pulse">
    <div className="surface-card space-y-3 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="h-4 w-28 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-6 w-24 rounded-full bg-slate-200 dark:bg-slate-800" />
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <div className="h-10 rounded-md bg-slate-200 dark:bg-slate-800" />
        <div className="h-10 rounded-md bg-slate-200 dark:bg-slate-800" />
        <div className="h-10 rounded-md bg-slate-200 dark:bg-slate-800" />
      </div>
      <div className="flex justify-end gap-2">
        <div className="h-8 w-24 rounded-md bg-slate-200 dark:bg-slate-800" />
        <div className="h-8 w-32 rounded-md bg-slate-200 dark:bg-slate-800" />
        <div className="h-8 w-28 rounded-md bg-slate-200 dark:bg-slate-800" />
      </div>
    </div>

    <div className="surface-card overflow-hidden">
      <div className="grid grid-cols-[72px_160px_120px_110px_90px_170px_130px_150px_160px_170px_110px_110px_120px] gap-0 border-b border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">
        {Array.from({ length: 13 }).map((_, index) => (
          <div key={`head-${index}`} className="px-3 py-3">
            <div className="h-4 rounded bg-slate-200 dark:bg-slate-800" />
          </div>
        ))}
      </div>
      <div className="space-y-0">
        {Array.from({ length: 6 }).map((_, rowIndex) => (
          <div
            key={`row-${rowIndex}`}
            className="grid grid-cols-[72px_160px_120px_110px_90px_170px_130px_150px_160px_170px_110px_110px_120px] gap-0 border-b border-slate-200 dark:border-slate-800"
          >
            {Array.from({ length: 13 }).map((__, colIndex) => (
              <div key={`cell-${rowIndex}-${colIndex}`} className="px-3 py-3">
                <div className="h-4 rounded bg-slate-200 dark:bg-slate-800" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>

    <div className="flex items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent dark:border-slate-500" />
      Loading trades...
    </div>
  </div>
);

const getPastTradeComments = (trade) => ({
  market: String(trade?.pastTradeMarketComment || '').trim(),
  general: String(trade?.pastTradeGeneralComment || trade?.pastTradeComment || '').trim()
});

const hasPastTradeComments = (trade) => {
  const comments = getPastTradeComments(trade);
  return Boolean(comments.market || comments.general);
};

const buildTradesCopyPayload = (trades) => {
  const groups = [];
  const groupsByKey = trades.reduce((acc, trade) => {
    const symbol = String(trade?.symbol || '').trim().toUpperCase();
    if (!symbol) return acc;

    const date = new Date(trade?.entryDate || 0);
    const year = Number.isNaN(date.getTime()) ? 0 : date.getUTCFullYear();
    const month = Number.isNaN(date.getTime()) ? 0 : date.getUTCMonth();
    const groupKey = `${year}-${String(month).padStart(2, '0')}`;

    if (!acc[groupKey]) {
      acc[groupKey] = {
        label: monthGroupLabel(trade?.entryDate),
        symbols: [],
        seen: new Set()
      };
      groups.push(acc[groupKey]);
    }

    if (!acc[groupKey].seen.has(symbol)) {
      acc[groupKey].seen.add(symbol);
      acc[groupKey].symbols.push(`NSE:${symbol}`);
    }

    return acc;
  }, {});

  return groups
    .map((group) => `###${group.label}(${group.symbols.length}),${group.symbols.join(',')}`)
    .join(',');
};

const TradesPage = () => {
  const { settings } = useSettings();
  const totalCapital = Number(settings?.totalCapital || 0);
  const [trades, setTrades] = useState(tradesCache.data || []);
  const [quotesByTradeId, setQuotesByTradeId] = useState({});
  const [quoteStatusByTradeId, setQuoteStatusByTradeId] = useState({});
  const [expandedTradeIds, setExpandedTradeIds] = useState({});
  const [loading, setLoading] = useState(!tradesCache.data);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [monthFilter, setMonthFilter] = useState('');
  const [strategyFilter, setStrategyFilter] = useState([]);
  const [showFilters, setShowFilters] = useState(true);
  const [showPastTradeComments, setShowPastTradeComments] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'entryDate', direction: 'desc' });
  const [liveLoading, setLiveLoading] = useState(false);
  const [editingBase, setEditingBase] = useState(null);
  const [editingPyramid, setEditingPyramid] = useState(null);
  const [editingExit, setEditingExit] = useState(null);
  const [editingStopLossAdjustment, setEditingStopLossAdjustment] = useState(null);
  const [chartTrade, setChartTrade] = useState(null);
  const [editingBaseScreenshotFiles, setEditingBaseScreenshotFiles] = useState([]);
  const [editingBaseUploadError, setEditingBaseUploadError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [commentTrade, setCommentTrade] = useState(null);
  const [commentMarketDraft, setCommentMarketDraft] = useState('');
  const [commentGeneralDraft, setCommentGeneralDraft] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
  const [expandedCommentTradeId, setExpandedCommentTradeId] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const copyStatusTimeoutRef = useRef(null);
  const tradesTableScrollRef = useRef(null);

  const loadTrades = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchTrades();
      setTrades(data);
      tradesCache.data = data;
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load trades');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (tradesCache.data) {
      setTrades(tradesCache.data);
      setLoading(false);
      loadTrades({ silent: true });
      return;
    }
    loadTrades();
  }, []);

  useEffect(() => () => {
    if (copyStatusTimeoutRef.current) {
      window.clearTimeout(copyStatusTimeoutRef.current);
      copyStatusTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    const node = tradesTableScrollRef.current;
    if (!node) return undefined;

    const handleScroll = () => {
      setShowScrollTop(node.scrollTop > 240);
    };

    handleScroll();
    node.addEventListener('scroll', handleScroll, { passive: true });
    return () => node.removeEventListener('scroll', handleScroll);
  }, [loading, trades.length]);

  useEffect(() => {
    const comments = getPastTradeComments(commentTrade);
    setCommentMarketDraft(comments.market);
    setCommentGeneralDraft(comments.general);
  }, [commentTrade]);

  const fetchQuoteForTrade = useCallback(async (tradeId) => {
    setQuoteStatusByTradeId((prev) => ({
      ...prev,
      [tradeId]: { loading: true, error: false }
    }));

    try {
      const quote = await fetchTradeQuote(tradeId);
      setQuotesByTradeId((prev) => ({ ...prev, [tradeId]: quote }));
      setQuoteStatusByTradeId((prev) => ({
        ...prev,
        [tradeId]: { loading: false, error: false }
      }));
    } catch {
      setQuoteStatusByTradeId((prev) => ({
        ...prev,
        [tradeId]: { loading: false, error: true }
      }));
    }
  }, []);

  const loadLivePrices = useCallback(async () => {
    const quoteCandidates = trades.filter((trade) => trade.metrics?.status === 'OPEN');
    if (!quoteCandidates.length) return;

    setLiveLoading(true);
    setQuoteStatusByTradeId((prev) => {
      const next = { ...prev };
      quoteCandidates.forEach((trade) => {
        next[trade._id] = { loading: true, error: false };
      });
      return next;
    });

    const results = await Promise.all(
      quoteCandidates.map((trade) =>
        fetchTradeQuote(trade._id)
          .then((quote) => ({ tradeId: trade._id, ok: true, quote }))
          .catch(() => ({ tradeId: trade._id, ok: false }))
      )
    );

    const nextQuotes = {};
    const nextStatus = {};
    results.forEach((result) => {
      if (result.ok && result.quote) {
        nextQuotes[result.tradeId] = result.quote;
        nextStatus[result.tradeId] = { loading: false, error: false };
      } else {
        nextStatus[result.tradeId] = { loading: false, error: true };
      }
    });
    setQuotesByTradeId((prev) => ({ ...prev, ...nextQuotes }));
    setQuoteStatusByTradeId((prev) => ({ ...prev, ...nextStatus }));
    setLiveLoading(false);
  }, [trades]);

  useEffect(() => {
    if (!trades.length) return;
    loadLivePrices();
    const intervalId = window.setInterval(() => {
      loadLivePrices();
    }, 30 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [trades, loadLivePrices]);

  const filtered = useMemo(() => {
    let list = trades.filter((trade) => trade.symbol.toLowerCase().includes(search.toLowerCase()));

    if (statusFilter !== 'ALL') {
      list = list.filter((trade) => trade.metrics.status === statusFilter);
    }

    if (monthFilter) {
      list = list.filter((trade) => monthFilterValue(trade.entryDate) === monthFilter);
    }

    if (strategyFilter.length) {
      list = list.filter((trade) => hasAnySelectedOption(trade.strategy, strategyFilter));
    }

    list.sort((a, b) => {
      if (sortConfig.key === 'symbol') {
        return sortConfig.direction === 'asc'
          ? a.symbol.localeCompare(b.symbol)
          : b.symbol.localeCompare(a.symbol);
      }
      if (sortConfig.key === 'entryDate') {
        return sortConfig.direction === 'asc'
          ? new Date(a.entryDate) - new Date(b.entryDate)
          : new Date(b.entryDate) - new Date(a.entryDate);
      }
      if (sortConfig.key === 'capitalAllocated') {
        return compareNullableNumbers(capitalAllocated(a), capitalAllocated(b), sortConfig.direction);
      }
      if (sortConfig.key === 'realizedPnL') {
        return compareNullableNumbers(
          Number(a.metrics.realizedPnL || 0),
          Number(b.metrics.realizedPnL || 0),
          sortConfig.direction
        );
      }
      if (sortConfig.key === 'unrealizedPnL') {
        const aLivePrice = quotesByTradeId[a._id]?.price;
        const bLivePrice = quotesByTradeId[b._id]?.price;
        return compareNullableNumbers(
          unrealizedPnlValue(a, aLivePrice),
          unrealizedPnlValue(b, bLivePrice),
          sortConfig.direction
        );
      }
      if (sortConfig.key === 'rMultiple') {
        return compareNullableNumbers(tradeRMultipleBySl(a), tradeRMultipleBySl(b), sortConfig.direction);
      }
      if (sortConfig.key === 'holdingDays') {
        return compareNullableNumbers(tradeHoldingDays(a), tradeHoldingDays(b), sortConfig.direction);
      }
      return 0;
    });

    return list;
  }, [trades, search, statusFilter, monthFilter, strategyFilter, sortConfig, quotesByTradeId]);
  const chartTradeIndex = useMemo(() => {
    if (!chartTrade?._id) return -1;
    return filtered.findIndex((trade) => trade._id === chartTrade._id);
  }, [filtered, chartTrade]);
  const filteredTradesCopyPayload = useMemo(() => buildTradesCopyPayload(filtered), [filtered]);

  const toggleSort = (key) => {
    setSortConfig((current) => (
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'symbol' ? 'asc' : 'desc' }
    ));
  };

  const handleDelete = async (id) => {
    const confirmation = window.prompt('Type "del" to delete this trade.');
    if (confirmation?.trim().toLowerCase() !== 'del') return;

    try {
      await deleteTrade(id);
      setTrades((prev) => {
        const next = prev.filter((trade) => trade._id !== id);
        tradesCache.data = next;
        return next;
      });
    } catch (err) {
      alert(err.response?.data?.message || 'Delete failed');
    }
  };
  const openChartForTrade = useCallback((trade) => {
    setChartTrade(trade);
  }, []);
  const showPrevChartTrade = useCallback(() => {
    if (chartTradeIndex <= 0) return;
    setChartTrade(filtered[chartTradeIndex - 1]);
  }, [chartTradeIndex, filtered]);
  const showNextChartTrade = useCallback(() => {
    if (chartTradeIndex < 0 || chartTradeIndex >= filtered.length - 1) return;
    setChartTrade(filtered[chartTradeIndex + 1]);
  }, [chartTradeIndex, filtered]);

  const upsertTrade = (updatedTrade) => {
    setTrades((prev) => {
      const next = prev.map((trade) => (trade._id === updatedTrade._id ? updatedTrade : trade));
      tradesCache.data = next;
      return next;
    });
    setCommentTrade((prev) => (prev && prev._id === updatedTrade._id ? updatedTrade : prev));
  };

  const savePastTradeComment = async (tradeId, nextComments, { closeOnSave = false } = {}) => {
    setCommentSaving(true);
    try {
      const updatedTrade = await updateTrade(tradeId, {
        pastTradeMarketComment: nextComments.market,
        pastTradeGeneralComment: nextComments.general
      });
      upsertTrade(updatedTrade);
      setShowPastTradeComments(true);
      setExpandedCommentTradeId('');
      if (closeOnSave) setCommentTrade(null);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to save past trade comment');
    } finally {
      setCommentSaving(false);
    }
  };

  const handleDeletePyramid = async (tradeId, pyramidId) => {
    if (!window.confirm('Delete this pyramid entry?')) return;
    try {
      const updatedTrade = await deletePyramid(tradeId, pyramidId);
      upsertTrade(updatedTrade);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete pyramid');
    }
  };

  const handleDeleteExit = async (tradeId, exitId) => {
    if (!window.confirm('Delete this exit entry?')) return;
    try {
      const updatedTrade = await deleteExit(tradeId, exitId);
      upsertTrade(updatedTrade);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete exit');
    }
  };

  const startEditPyramid = (trade, pyramid) => {
    setEditingBase(null);
    setEditingExit(null);
    setEditingStopLossAdjustment(null);
    setEditingPyramid({
      tradeId: trade._id,
      pyramidId: pyramid._id,
      values: {
        date: new Date(pyramid.date).toISOString().slice(0, 10),
        price: String(pyramid.price ?? ''),
        qty: String(pyramid.qty ?? ''),
        stopLoss: String(pyramid.stopLoss ?? '')
      }
    });
  };

  const saveEditPyramid = async (tradeId, pyramidId) => {
    if (!editingPyramid || editingPyramid.tradeId !== tradeId || editingPyramid.pyramidId !== pyramidId) return;
    const payload = {
      date: editingPyramid.values.date,
      price: Number(editingPyramid.values.price),
      qty: Number(editingPyramid.values.qty),
      stopLoss: Number(editingPyramid.values.stopLoss)
    };

    if (!payload.date || payload.price <= 0 || payload.qty <= 0 || payload.stopLoss <= 0) {
      alert('Date, price, qty, and stop loss are required and must be valid.');
      return;
    }

    try {
      const updatedTrade = await updatePyramid(tradeId, pyramidId, payload);
      upsertTrade(updatedTrade);
      setEditingPyramid(null);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update pyramid');
    }
  };

  const startEditExit = (trade, exit) => {
    setEditingBase(null);
    setEditingPyramid(null);
    setEditingStopLossAdjustment(null);
    setEditingExit({
      tradeId: trade._id,
      exitId: exit._id,
      values: {
        exitDate: new Date(exit.exitDate).toISOString().slice(0, 10),
        exitPrice: String(exit.exitPrice ?? ''),
        exitQty: String(exit.exitQty ?? ''),
        exitReasons: normalizeOptionList(exit.exitReasons),
        notes: exit.notes || ''
      }
    });
  };

  const saveEditExit = async (tradeId, exitId) => {
    if (!editingExit || editingExit.tradeId !== tradeId || editingExit.exitId !== exitId) return;
    const payload = {
      exitDate: editingExit.values.exitDate,
      exitPrice: Number(editingExit.values.exitPrice),
      exitQty: Number(editingExit.values.exitQty),
      exitReasons: editingExit.values.exitReasons,
      notes: editingExit.values.notes
    };

    if (!payload.exitDate || payload.exitPrice <= 0 || payload.exitQty <= 0) {
      alert('Date, exit price, and exit qty are required and must be valid.');
      return;
    }

    try {
      const updatedTrade = await updateExit(tradeId, exitId, payload);
      upsertTrade(updatedTrade);
      setEditingExit(null);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update exit');
    }
  };

  const startEditBase = (trade) => {
    setEditingPyramid(null);
    setEditingExit(null);
    setEditingStopLossAdjustment(null);
    setEditingBaseScreenshotFiles([]);
    setEditingBaseUploadError('');
    setEditingBase({
      tradeId: trade._id,
      values: {
        symbol: trade.symbol || '',
        entryDate: new Date(trade.entryDate).toISOString().slice(0, 10),
        entryPrice: String(trade.entryPrice ?? ''),
        entryQty: String(trade.entryQty ?? ''),
        stopLoss: String(trade.stopLoss ?? ''),
        strategy: normalizeOptionList(trade.strategy),
        notes: trade.notes || '',
        screenshots: normalizeScreenshots(trade.screenshots)
      }
    });
  };

  const handleEditingBaseScreenshotChange = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const validationError = validateScreenshotFiles(files);
    if (validationError) {
      setEditingBaseUploadError(validationError);
      return;
    }

    setEditingBaseUploadError('');
    setEditingBaseScreenshotFiles((prev) => [...prev, ...files]);
  };

  const saveEditBase = async (tradeId) => {
    if (!editingBase || editingBase.tradeId !== tradeId) return;
    const payload = {
      symbol: String(editingBase.values.symbol || '').trim().toUpperCase(),
      entryDate: editingBase.values.entryDate,
      entryPrice: Number(editingBase.values.entryPrice),
      entryQty: Number(editingBase.values.entryQty),
      stopLoss: Number(editingBase.values.stopLoss),
      strategy: joinOptionList(editingBase.values.strategy),
      notes: editingBase.values.notes,
      screenshots: normalizeScreenshots(editingBase.values.screenshots)
    };

    if (
      !payload.symbol ||
      !payload.entryDate ||
      payload.entryPrice <= 0 ||
      payload.entryQty <= 0 ||
      payload.stopLoss <= 0
    ) {
      alert('Symbol, date, entry price, entry qty, and stop loss are required and must be valid.');
      return;
    }

    const uploadedScreenshots = [];
    try {
      if (editingBaseScreenshotFiles.length) {
        for (const file of editingBaseScreenshotFiles) {
          const uploaded = await uploadTradeScreenshotFile(file, tradeId);
          uploadedScreenshots.push(uploaded);
        }
        payload.screenshots = [...payload.screenshots, ...uploadedScreenshots];
      }

      const updatedTrade = await updateTrade(tradeId, payload);
      upsertTrade(updatedTrade);
      setEditingBase(null);
      setEditingBaseScreenshotFiles([]);
      setEditingBaseUploadError('');
    } catch (err) {
      await Promise.all(uploadedScreenshots.map((item) => deleteTradeScreenshotUpload(item.key).catch(() => {})));
      alert(err.response?.data?.message || 'Failed to update base trade');
    }
  };

  const toggleExpanded = (id) => {
    setExpandedTradeIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const startStopLossAdjustment = (trade, targetType = 'BASE', targetEntryId = 'BASE') => {
    const target = getEntryTargetMeta(trade, targetType, targetEntryId);
    if (target.openQty <= EPSILON_QTY) {
      alert('No open quantity available for this entry.');
      return;
    }
    setEditingBase(null);
    setEditingPyramid(null);
    setEditingExit(null);
    setExpandedTradeIds((prev) => ({ ...prev, [trade._id]: true }));
    setEditingStopLossAdjustment({
      tradeId: trade._id,
      targetType,
      targetEntryId,
      targetLabel: target.label,
      values: {
        date: todayInputDate(),
        qty: String(target.openQty || ''),
        stopLoss: target.stopLossDisplay !== 'Mixed' ? target.stopLossDisplay : ''
      }
    });
  };

  const saveStopLossAdjustment = async (trade) => {
    if (!editingStopLossAdjustment || editingStopLossAdjustment.tradeId !== trade._id) return;
    const payload = {
      date: editingStopLossAdjustment.values.date,
      qty: Number(editingStopLossAdjustment.values.qty),
      stopLoss: Number(editingStopLossAdjustment.values.stopLoss),
      targetType: editingStopLossAdjustment.targetType || 'BASE',
      targetEntryId: editingStopLossAdjustment.targetEntryId || 'BASE'
    };
    if (!payload.date || payload.qty <= 0 || payload.stopLoss <= 0) {
      alert('Date, quantity, and stop loss are required and must be valid.');
      return;
    }
    const target = getEntryTargetMeta(
      trade,
      editingStopLossAdjustment.targetType || 'BASE',
      editingStopLossAdjustment.targetEntryId || 'BASE'
    );
    if (payload.qty > target.openQty + 1e-9) {
      alert('Adjustment quantity cannot exceed the open quantity of the selected entry.');
      return;
    }
    try {
      const updatedTrade = await addStopLossAdjustment(trade._id, payload);
      upsertTrade(updatedTrade);
      setEditingStopLossAdjustment(null);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add stop loss adjustment');
    }
  };

  const handleDeleteStopLossAdjustment = async (tradeId, adjustmentId) => {
    if (!window.confirm('Delete this SL change?')) return;
    try {
      const updatedTrade = await deleteStopLossAdjustment(tradeId, adjustmentId);
      upsertTrade(updatedTrade);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete stop loss adjustment');
    }
  };

  const handleCopyTrades = async () => {
    if (copyStatusTimeoutRef.current) {
      window.clearTimeout(copyStatusTimeoutRef.current);
      copyStatusTimeoutRef.current = null;
    }
    if (!filteredTradesCopyPayload) {
      setCopyStatus('No trades to copy');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setCopyStatus('Clipboard unavailable');
      return;
    }
    try {
      await navigator.clipboard.writeText(filteredTradesCopyPayload);
      setCopyStatus(`${filtered.length} copied`);
      copyStatusTimeoutRef.current = window.setTimeout(() => {
        setCopyStatus('');
        copyStatusTimeoutRef.current = null;
      }, 2500);
    } catch {
      setCopyStatus('Failed to copy trades');
    }
  };

  if (loading) return <TradesLoadingState />;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="surface-card space-y-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Filter Trades
            </p>
            <button
              type="button"
              onClick={() => setShowPastTradeComments((current) => !current)}
              className="btn-muted px-2 py-1 text-[11px]"
            >
              {showPastTradeComments ? 'Hide Past Trade Comments' : 'Show Past Trade Comments'}
            </button>
            <button
              type="button"
              onClick={() => setShowFilters((current) => !current)}
              className="btn-muted px-2 py-1 text-[11px]"
            >
              {showFilters ? 'Collapse' : 'Expand'}
            </button>
          </div>
          <p className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            {filtered.length} result{filtered.length === 1 ? '' : 's'}
          </p>
        </div>

        {showFilters ? (
        <>
        <div className="grid gap-2 md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Symbol
            </span>
            <input
              placeholder="e.g. RELIANCE"
              className="field-input py-1.5 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Status
            </span>
            <select
              className="field-input py-1.5 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Month
            </span>
            <input
              type="month"
              className="field-input py-1.5 text-sm"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
            />
          </label>
        </div>

        <TradeStrategySelector
          value={strategyFilter}
          onToggle={(option) => setStrategyFilter((current) => toggleOption(current, option))}
          label="Criteria"
          className="pt-1"
        />

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-muted px-2.5 py-1 text-xs"
              onClick={handleCopyTrades}
            >
              {copyStatus || 'Copy Trades'}
            </button>
            <button
              type="button"
              className="btn-muted px-2.5 py-1 text-xs"
              onClick={loadLivePrices}
              disabled={liveLoading}
            >
              {liveLoading ? 'Loading Live...' : 'Refresh Open Prices'}
            </button>
            <button
              type="button"
              className="btn-muted px-2.5 py-1 text-xs"
              onClick={() => {
                setSearch('');
                setStatusFilter('ALL');
                setMonthFilter('');
                setStrategyFilter([]);
                setSortConfig({ key: 'entryDate', direction: 'desc' });
              }}
            >
              Reset Filters
            </button>
          </div>
        </div>
        </>
        ) : null}
      </div>

      <div ref={tradesTableScrollRef} className="surface-card max-h-[70vh] overflow-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="table-head [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-100 dark:[&_th]:bg-slate-900">
            <tr>
              <th className="px-3 py-2">Trade #</th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleSort('symbol')}
                  className="inline-flex items-center gap-1 hover:text-sky-600 dark:hover:text-sky-300"
                >
                  Symbol
                  <SortArrow active={sortConfig.key === 'symbol'} direction={sortConfig.direction} />
                </button>
              </th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleSort('entryDate')}
                  className="inline-flex items-center gap-1 hover:text-sky-600 dark:hover:text-sky-300"
                >
                  Entry Date
                  <SortArrow active={sortConfig.key === 'entryDate'} direction={sortConfig.direction} />
                </button>
              </th>
              <th className="px-3 py-2">Avg Entry</th>
              <th className="px-3 py-2">Open Qty</th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleSort('capitalAllocated')}
                  className="inline-flex items-center gap-1 hover:text-sky-600 dark:hover:text-sky-300"
                >
                  Capital Allocated (Rs / %)
                  <SortArrow active={sortConfig.key === 'capitalAllocated'} direction={sortConfig.direction} />
                </button>
              </th>
              <th className="px-3 py-2">Current Price</th>
              <th className="px-3 py-2">Capital at Risk</th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleSort('realizedPnL')}
                  className="inline-flex items-center gap-1 hover:text-sky-600 dark:hover:text-sky-300"
                >
                  Realized P&L
                  <SortArrow active={sortConfig.key === 'realizedPnL'} direction={sortConfig.direction} />
                </button>
              </th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleSort('unrealizedPnL')}
                  className="inline-flex items-center gap-1 hover:text-sky-600 dark:hover:text-sky-300"
                >
                  Unrealized P&L
                  <SortArrow active={sortConfig.key === 'unrealizedPnL'} direction={sortConfig.direction} />
                </button>
              </th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleSort('rMultiple')}
                  className="inline-flex items-center gap-1 hover:text-sky-600 dark:hover:text-sky-300"
                >
                  R Multiple
                  <SortArrow active={sortConfig.key === 'rMultiple'} direction={sortConfig.direction} />
                </button>
              </th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleSort('holdingDays')}
                  className="inline-flex items-center gap-1 hover:text-sky-600 dark:hover:text-sky-300"
                >
                  Holding Days
                  <SortArrow active={sortConfig.key === 'holdingDays'} direction={sortConfig.direction} />
                </button>
              </th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((trade, index) => {
              const allocatedValue = capitalAllocated(trade);
              const allocatedPercent = totalCapital ? (allocatedValue / totalCapital) * 100 : 0;
              const computedRMultiple = tradeRMultipleBySl(trade);
              const holdingDays = tradeHoldingDays(trade);
              const isOpenTrade = trade.metrics?.status === 'OPEN';
              const livePrice = quotesByTradeId[trade._id]?.price;
              const unrealizedPnL = unrealizedPnlValue(trade, livePrice);
              const unrealizedPercent = unrealizedPnlPercent(trade, livePrice);
              const rowClassName = isOpenTrade
                ? 'table-row-hover bg-emerald-50/70 dark:bg-emerald-950/20'
                : 'table-row-hover';
              return (
              <Fragment key={trade._id}>
                <tr className={rowClassName}>
                  <td className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">{index + 1}</td>
                  <td className="px-3 py-2 font-medium">
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => openChartForTrade(trade)}
                        className="underline decoration-dotted underline-offset-2 hover:text-sky-600 dark:hover:text-sky-300"
                        title="Open chart"
                      >
                        {trade.symbol}
                      </button>
                      {showPastTradeComments ? (
                        <div className="max-w-xs text-xs font-normal text-slate-600 dark:text-slate-300">
                          {(() => {
                            const comments = getPastTradeComments(trade);
                            return (
                              <div className="space-y-1">
                                <div>
                                  <span className="font-medium text-slate-700 dark:text-slate-200">Market:</span>{' '}
                                  <span className="whitespace-pre-wrap break-words">{comments.market || '-'}</span>
                                </div>
                                <div>
                                  <span className="font-medium text-slate-700 dark:text-slate-200">General:</span>{' '}
                                  <span className="whitespace-pre-wrap break-words">{comments.general || '-'}</span>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">{new Date(trade.entryDate).toLocaleDateString()}</td>
                  <td className="px-3 py-2">{money(trade.metrics.avgEntryPrice)}</td>
                  <td className="px-3 py-2">{trade.metrics.openQty}</td>
                  <td className="px-3 py-2">
                    {money(allocatedValue)} ({allocatedPercent.toFixed(2)}%)
                  </td>
                  <td className="px-3 py-2">
                    {quotesByTradeId[trade._id] ? (
                      money(quotesByTradeId[trade._id].price)
                    ) : quoteStatusByTradeId[trade._id]?.loading ? (
                      <span className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent dark:border-slate-500" />
                        Fetching...
                      </span>
                    ) : quoteStatusByTradeId[trade._id]?.error ? (
                      <span className="text-xs text-rose-600 dark:text-rose-400">Failed</span>
                    ) : !isOpenTrade ? (
                      <button
                        type="button"
                        onClick={() => fetchQuoteForTrade(trade._id)}
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        Fetch
                      </button>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isOpenTrade
                      ? `${money(trade.metrics.capitalAtRisk)} (${Number(trade.metrics.riskPercent || 0).toFixed(2)}%)`
                      : '-'}
                  </td>
                  <td className={`px-3 py-2 ${pnlTextClass(trade.metrics.realizedPnL)}`}>
                    {money(trade.metrics.realizedPnL)} ({realizedPnlPercent(trade).toFixed(2)}%)
                  </td>
                  <td className={`px-3 py-2 ${pnlTextClass(unrealizedPnL)}`}>
                    {isOpenTrade && unrealizedPnL !== null
                      ? `${money(unrealizedPnL)} (${Number(unrealizedPercent || 0).toFixed(2)}%)`
                      : '-'}
                  </td>
                  <td className={`px-3 py-2 ${pnlTextClass(computedRMultiple)}`}>
                    {computedRMultiple.toFixed(2)}
                  </td>
                  <td className="px-3 py-2">{holdingDays}</td>
                  <td className="relative z-0 px-3 py-2 hover:z-20">
                    <div className="flex items-center gap-1 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setCommentTrade(trade)}
                        className={`group relative inline-flex h-7 w-7 items-center justify-center rounded border transition-colors duration-200 ${
                          hasPastTradeComments(trade)
                            ? 'border-amber-500/70 bg-amber-50 text-amber-700 dark:border-amber-500/60 dark:bg-amber-950/30 dark:text-amber-300'
                            : 'border-slate-300 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                        }`}
                        aria-label="Past trade comment"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        >
                          <path d="M7 10h10M7 14h6" strokeLinecap="round" />
                          <path d="M21 12a8.9 8.9 0 0 1-9 9 9.3 9.3 0 0 1-4-.9L3 21l.9-5A9 9 0 1 1 21 12Z" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="pointer-events-none absolute z-30 -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                          Past trade comment
                        </span>
                      </button>
                      <Link
                        href={`/trades/${trade._id}?openModal=pyramid&source=trades`}
                        className="group relative inline-flex h-7 w-7 items-center justify-center rounded border border-emerald-500/70 bg-emerald-50 text-emerald-700 transition-colors duration-200 hover:bg-emerald-100 dark:border-emerald-500/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                        aria-label="Pyramid"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        >
                          <path d="m12 4 8 14H4L12 4Z" />
                          <path d="M8.8 12.2h6.4M7.2 15h9.6" strokeLinecap="round" />
                        </svg>
                        <span className="pointer-events-none absolute z-30 -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                          Pyramid
                        </span>
                      </Link>
                      <Link
                        href={`/trades/${trade._id}?openModal=exit&source=trades`}
                        className="group relative inline-flex h-7 w-7 items-center justify-center rounded border border-rose-500/70 bg-rose-50 text-rose-700 transition-colors duration-200 hover:bg-rose-100 dark:border-rose-500/60 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-900/50"
                        aria-label="Exit"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        >
                          <path d="M10 5h7v14h-7" />
                          <path d="M14 12H4" strokeLinecap="round" />
                          <path d="m7.5 8.5-3.5 3.5 3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="pointer-events-none absolute z-30 -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                          Exit
                        </span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(trade._id)}
                        className="group relative rounded border border-violet-400/80 bg-violet-50 p-1.5 text-violet-700 transition-colors duration-200 hover:bg-violet-100 dark:border-violet-500/60 dark:bg-violet-950/30 dark:text-violet-200 dark:hover:bg-violet-900/50"
                        aria-label="View entries/exits"
                        title="View entries/exits"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          className={`h-3.5 w-3.5 transition-transform duration-200 ${
                            expandedTradeIds[trade._id] ? 'rotate-180' : ''
                          }`}
                          aria-hidden="true"
                        >
                          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="pointer-events-none absolute z-30 -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                          View entries/exits
                        </span>
                      </button>
                      <Link
                        href={`/trades/${trade._id}`}
                        className="group relative inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 transition-colors duration-200 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        aria-label="Details"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        >
                          <path d="M9 9h6v6" strokeLinecap="round" />
                          <path d="m15 9-6 6" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M5 12v7h7" strokeLinecap="round" />
                          <path d="M12 5h7v7" strokeLinecap="round" />
                        </svg>
                        <span className="pointer-events-none absolute z-30 -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                          Details
                        </span>
                      </Link>
                      <button
                        onClick={() => handleDelete(trade._id)}
                        className="group relative inline-flex h-7 w-7 items-center justify-center rounded border border-red-400/70 bg-red-50 text-red-700 transition-colors duration-200 hover:bg-red-100 dark:border-red-600/60 dark:bg-red-950/20 dark:text-red-300 dark:hover:bg-red-950/40"
                        aria-label="Delete"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18" strokeLinecap="round" />
                          <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
                          <path d="M6.8 6 7.6 20a1.5 1.5 0 0 0 1.5 1.4h5.8a1.5 1.5 0 0 0 1.5-1.4L17.2 6" />
                          <path d="M10 10.5v6M14 10.5v6" strokeLinecap="round" />
                        </svg>
                        <span className="pointer-events-none absolute z-30 -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                          Delete
                        </span>
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedTradeIds[trade._id] && (
                <tr className="border-b-2 border-slate-300 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/70">
                  <td colSpan={13} className="px-3 py-2 text-xs">
                    <div className="space-y-3">
                      <div className="rounded border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p className="font-semibold text-slate-700 dark:text-slate-200">Base Entry</p>
                          {editingBase?.tradeId === trade._id ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="btn-primary px-2 py-1 text-xs"
                                onClick={() => saveEditBase(trade._id)}
                              >
                                Update
                              </button>
                              <button
                                type="button"
                                className="btn-muted px-2 py-1 text-xs"
                                onClick={() => {
                                  setEditingBase(null);
                                  setEditingBaseScreenshotFiles([]);
                                  setEditingBaseUploadError('');
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              {trade.metrics?.status === 'OPEN' && (
                                <button
                                  type="button"
                                  className="btn-muted px-2 py-1 text-xs"
                                  onClick={() => startStopLossAdjustment(trade, 'BASE', 'BASE')}
                                >
                                  Adjust SL
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn-muted px-2 py-1 text-xs"
                                onClick={() => startEditBase(trade)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn-danger px-2 py-1 text-xs"
                                onClick={() => handleDelete(trade._id)}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                        {editingBase?.tradeId === trade._id ? (
                          <div className="grid gap-2 md:grid-cols-2">
                            <input
                              type="text"
                              className="field-input py-1 text-xs"
                              value={editingBase.values.symbol}
                              onChange={(e) =>
                                setEditingBase((prev) => ({
                                  ...prev,
                                  values: { ...prev.values, symbol: e.target.value.toUpperCase() }
                                }))
                              }
                              placeholder="Symbol"
                            />
                            <input
                              type="date"
                              className="field-input py-1 text-xs"
                              value={editingBase.values.entryDate}
                              onChange={(e) =>
                                setEditingBase((prev) => ({
                                  ...prev,
                                  values: { ...prev.values, entryDate: e.target.value }
                                }))
                              }
                            />
                            <input
                              type="number"
                              step="0.0001"
                              className="field-input py-1 text-xs"
                              value={editingBase.values.entryPrice}
                              onChange={(e) =>
                                setEditingBase((prev) => ({
                                  ...prev,
                                  values: { ...prev.values, entryPrice: e.target.value }
                                }))
                              }
                              placeholder="Entry Price"
                            />
                            <input
                              type="number"
                              step="0.0001"
                              className="field-input py-1 text-xs"
                              value={editingBase.values.entryQty}
                              onChange={(e) =>
                                setEditingBase((prev) => ({
                                  ...prev,
                                  values: { ...prev.values, entryQty: e.target.value }
                                }))
                              }
                              placeholder="Entry Qty"
                            />
                            <input
                              type="number"
                              step="0.0001"
                              className="field-input py-1 text-xs"
                              value={editingBase.values.stopLoss}
                              onChange={(e) =>
                                setEditingBase((prev) => ({
                                  ...prev,
                                  values: { ...prev.values, stopLoss: e.target.value }
                                }))
                              }
                              placeholder="Stop Loss"
                            />
                            <div className="md:col-span-2">
                              <TradeStrategySelector
                                value={editingBase.values.strategy}
                                onToggle={(option) =>
                                  setEditingBase((prev) => ({
                                    ...prev,
                                    values: { ...prev.values, strategy: toggleOption(prev.values.strategy, option) }
                                  }))
                                }
                              />
                            </div>
                            <textarea
                              className="field-input min-h-20 py-1 text-xs md:col-span-2"
                              value={editingBase.values.notes}
                              onChange={(e) =>
                                setEditingBase((prev) => ({
                                  ...prev,
                                  values: { ...prev.values, notes: e.target.value }
                                }))
                              }
                              placeholder="Notes"
                            />
                            <div className="md:col-span-2">
                              <ScreenshotManager
                                label="Trade Screenshots"
                                existingScreenshots={editingBase.values.screenshots}
                                pendingFiles={editingBaseScreenshotFiles}
                                error={editingBaseUploadError}
                                inputId={`trade-edit-screenshots-${trade._id}`}
                                onFilesSelected={handleEditingBaseScreenshotChange}
                                onRemoveExisting={(index) =>
                                  setEditingBase((prev) => ({
                                    ...prev,
                                    values: {
                                      ...prev.values,
                                      screenshots: prev.values.screenshots.filter((_, itemIndex) => itemIndex !== index)
                                    }
                                  }))
                                }
                                onRemovePending={(index) =>
                                  setEditingBaseScreenshotFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                                }
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1 text-slate-600 dark:text-slate-300">
                            <p>Symbol: {trade.symbol}</p>
                            <p>Date: {new Date(trade.entryDate).toLocaleDateString()}</p>
                            <p>Price: {trade.entryPrice}</p>
                            <p>Qty: {trade.entryQty}</p>
                            <p>
                              Stop Loss: {Number(trade.stopLoss || 0).toFixed(2)} ({stopLossPercent(trade.entryPrice, trade.stopLoss).toFixed(2)}%)
                            </p>
                            {trade.metrics?.status === 'OPEN' && (
                              <p>
                                Current SL: {getEntryTargetMeta(trade, 'BASE', 'BASE').stopLossDisplay} | Capital at Risk:{' '}
                                {money(getEntryTargetMeta(trade, 'BASE', 'BASE').capitalAtRisk)}
                              </p>
                            )}
                            {trade.strategy && <p>Strategy: {trade.strategy}</p>}
                            {trade.notes && <p>Notes: {trade.notes}</p>}
                            {(trade.screenshots || []).length ? (
                              <div className="grid gap-2 pt-1 md:grid-cols-2">
                                {trade.screenshots.map((item, index) => (
                                  <a key={item.key || item.url || index} href={item.url} target="_blank" rel="noreferrer">
                                    <img
                                      src={item.url}
                                      alt={`${trade.symbol} trade screenshot ${index + 1}`}
                                      className="max-h-52 w-full rounded-md border border-slate-300 object-contain dark:border-slate-700"
                                    />
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )}
                        <div className="mt-3 rounded border border-cyan-400/60 bg-cyan-50 px-3 py-2 dark:border-cyan-600/40 dark:bg-cyan-950/20">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="font-semibold text-cyan-700 dark:text-cyan-300">SL Change History</p>
                            {editingStopLossAdjustment?.tradeId === trade._id &&
                            editingStopLossAdjustment?.targetType === 'BASE' &&
                            editingStopLossAdjustment?.targetEntryId === 'BASE' ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="btn-primary px-2 py-1 text-xs"
                                  onClick={() => saveStopLossAdjustment(trade)}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="btn-muted px-2 py-1 text-xs"
                                  onClick={() => setEditingStopLossAdjustment(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : null}
                          </div>
                          {editingStopLossAdjustment?.tradeId === trade._id &&
                          editingStopLossAdjustment?.targetType === 'BASE' &&
                          editingStopLossAdjustment?.targetEntryId === 'BASE' ? (
                            <div className="mb-2 space-y-2">
                              <div className="grid gap-2 md:grid-cols-3">
                                <input
                                  type="date"
                                  className="field-input py-1 text-xs"
                                  value={editingStopLossAdjustment.values.date}
                                  onChange={(e) =>
                                    setEditingStopLossAdjustment((prev) => ({
                                      ...prev,
                                      values: { ...prev.values, date: e.target.value }
                                    }))
                                  }
                                />
                                <input
                                  type="number"
                                  step="0.0001"
                                  className="field-input py-1 text-xs"
                                  value={editingStopLossAdjustment.values.qty}
                                  onChange={(e) =>
                                    setEditingStopLossAdjustment((prev) => ({
                                      ...prev,
                                      values: { ...prev.values, qty: e.target.value }
                                    }))
                                  }
                                  placeholder="Qty"
                                />
                                <input
                                  type="number"
                                  step="0.0001"
                                  className="field-input py-1 text-xs"
                                  value={editingStopLossAdjustment.values.stopLoss}
                                  onChange={(e) =>
                                    setEditingStopLossAdjustment((prev) => ({
                                      ...prev,
                                      values: { ...prev.values, stopLoss: e.target.value }
                                    }))
                                  }
                                  placeholder="SL Price"
                                />
                              </div>
                            </div>
                          ) : null}
                          <p className="mb-2 text-[11px] text-cyan-800/80 dark:text-cyan-200/80">
                            Current capital-at-risk uses the latest effective SL adjustment for this base entry.
                          </p>
                          {getStopLossHistoryForTarget(trade, 'BASE', 'BASE').length ? (
                            <div className="space-y-1 text-cyan-800 dark:text-cyan-200">
                              {getStopLossHistoryForTarget(trade, 'BASE', 'BASE').map((adj) => (
                                <div
                                  key={adj._id}
                                  className="flex items-center justify-between gap-2 rounded border border-cyan-300/70 bg-cyan-100/60 px-2 py-1 dark:border-cyan-700/50 dark:bg-cyan-950/30"
                                >
                                  <p>
                                    Date: {new Date(adj.date).toLocaleDateString()} | Qty: {adj.qty} | SL: {adj.stopLoss}
                                  </p>
                                  <button
                                    type="button"
                                    className="btn-danger px-2 py-1 text-xs"
                                    onClick={() => handleDeleteStopLossAdjustment(trade._id, adj._id)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-cyan-800 dark:text-cyan-200">None</p>
                          )}
                        </div>
                      </div>

                      <div className="rounded border border-amber-400/60 bg-amber-50 px-3 py-2 dark:border-amber-600/40 dark:bg-amber-950/20">
                        <p className="mb-1 font-semibold text-amber-700 dark:text-amber-300">Pyramids</p>
                        {!!trade.pyramids?.length ? (
                          <div className="space-y-1 text-amber-800 dark:text-amber-200">
                            {trade.pyramids.map((p) => {
                              const pyramidRiskMeta = getEntryTargetMeta(trade, 'PYRAMID', String(p._id || ''));
                              return (
                                <div
                                  key={p._id}
                                  className="rounded border border-amber-300/70 bg-amber-100/60 px-2 py-1 dark:border-amber-700/50 dark:bg-amber-950/30"
                                >
                                  {editingPyramid?.tradeId === trade._id && editingPyramid?.pyramidId === p._id ? (
                                    <div className="space-y-2">
                                      <div className="grid gap-2 md:grid-cols-4">
                                        <input
                                          type="date"
                                          className="field-input py-1 text-xs"
                                          value={editingPyramid.values.date}
                                          onChange={(e) =>
                                            setEditingPyramid((prev) => ({
                                              ...prev,
                                              values: { ...prev.values, date: e.target.value }
                                            }))
                                          }
                                        />
                                        <input
                                          type="number"
                                          step="0.0001"
                                          className="field-input py-1 text-xs"
                                          value={editingPyramid.values.price}
                                          onChange={(e) =>
                                            setEditingPyramid((prev) => ({
                                              ...prev,
                                              values: { ...prev.values, price: e.target.value }
                                            }))
                                          }
                                          placeholder="Price"
                                        />
                                        <input
                                          type="number"
                                          step="0.0001"
                                          className="field-input py-1 text-xs"
                                          value={editingPyramid.values.qty}
                                          onChange={(e) =>
                                            setEditingPyramid((prev) => ({
                                              ...prev,
                                              values: { ...prev.values, qty: e.target.value }
                                            }))
                                          }
                                          placeholder="Qty"
                                        />
                                        <input
                                          type="number"
                                          step="0.0001"
                                          className="field-input py-1 text-xs"
                                          value={editingPyramid.values.stopLoss}
                                          onChange={(e) =>
                                            setEditingPyramid((prev) => ({
                                              ...prev,
                                              values: { ...prev.values, stopLoss: e.target.value }
                                            }))
                                          }
                                          placeholder="Stop Loss"
                                        />
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          className="btn-primary px-2 py-1 text-xs"
                                          onClick={() => saveEditPyramid(trade._id, p._id)}
                                        >
                                          Update
                                        </button>
                                        <button
                                          type="button"
                                          className="btn-muted px-2 py-1 text-xs"
                                          onClick={() => setEditingPyramid(null)}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="space-y-3">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p>
                                          Date: {new Date(p.date).toLocaleDateString()} | Price: {p.price} | Qty: {p.qty} | Initial Stop:{' '}
                                          {p.stopLoss} ({stopLossPercent(p.price, p.stopLoss).toFixed(2)}%)
                                          {trade.metrics.status === 'OPEN'
                                            ? ` | Current SL: ${pyramidRiskMeta.stopLossDisplay} | Open Qty: ${pyramidRiskMeta.openQty} | Capital at Risk: ${money(
                                                pyramidRiskMeta.capitalAtRisk
                                              )}`
                                            : ''}
                                        </p>
                                        <div className="flex items-center gap-2">
                                          {trade.metrics?.status === 'OPEN' && pyramidRiskMeta.openQty > EPSILON_QTY && (
                                            <button
                                              type="button"
                                              className="btn-muted px-2 py-1 text-xs"
                                              onClick={() => startStopLossAdjustment(trade, 'PYRAMID', String(p._id || ''))}
                                            >
                                              Adjust SL
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            className="btn-muted px-2 py-1 text-xs"
                                            onClick={() => startEditPyramid(trade, p)}
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            className="btn-danger px-2 py-1 text-xs"
                                            onClick={() => handleDeletePyramid(trade._id, p._id)}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                      <div className="rounded border border-cyan-400/60 bg-cyan-50 px-3 py-2 dark:border-cyan-600/40 dark:bg-cyan-950/20">
                                        <div className="mb-1 flex items-center justify-between gap-2">
                                          <p className="font-semibold text-cyan-700 dark:text-cyan-300">SL Change History</p>
                                          {editingStopLossAdjustment?.tradeId === trade._id &&
                                          editingStopLossAdjustment?.targetType === 'PYRAMID' &&
                                          editingStopLossAdjustment?.targetEntryId === String(p._id || '') ? (
                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                className="btn-primary px-2 py-1 text-xs"
                                                onClick={() => saveStopLossAdjustment(trade)}
                                              >
                                                Save
                                              </button>
                                              <button
                                                type="button"
                                                className="btn-muted px-2 py-1 text-xs"
                                                onClick={() => setEditingStopLossAdjustment(null)}
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          ) : null}
                                        </div>
                                        {editingStopLossAdjustment?.tradeId === trade._id &&
                                        editingStopLossAdjustment?.targetType === 'PYRAMID' &&
                                        editingStopLossAdjustment?.targetEntryId === String(p._id || '') ? (
                                          <div className="mb-2 space-y-2">
                                            <div className="grid gap-2 md:grid-cols-3">
                                              <input
                                                type="date"
                                                className="field-input py-1 text-xs"
                                                value={editingStopLossAdjustment.values.date}
                                                onChange={(e) =>
                                                  setEditingStopLossAdjustment((prev) => ({
                                                    ...prev,
                                                    values: { ...prev.values, date: e.target.value }
                                                  }))
                                                }
                                              />
                                              <input
                                                type="number"
                                                step="0.0001"
                                                className="field-input py-1 text-xs"
                                                value={editingStopLossAdjustment.values.qty}
                                                onChange={(e) =>
                                                  setEditingStopLossAdjustment((prev) => ({
                                                    ...prev,
                                                    values: { ...prev.values, qty: e.target.value }
                                                  }))
                                                }
                                                placeholder="Qty"
                                              />
                                              <input
                                                type="number"
                                                step="0.0001"
                                                className="field-input py-1 text-xs"
                                                value={editingStopLossAdjustment.values.stopLoss}
                                                onChange={(e) =>
                                                  setEditingStopLossAdjustment((prev) => ({
                                                    ...prev,
                                                    values: { ...prev.values, stopLoss: e.target.value }
                                                  }))
                                                }
                                                placeholder="SL Price"
                                              />
                                            </div>
                                          </div>
                                        ) : null}
                                        <p className="mb-2 text-[11px] text-cyan-800/80 dark:text-cyan-200/80">
                                          Current capital-at-risk uses the latest effective SL adjustment for this pyramid.
                                        </p>
                                        {getStopLossHistoryForTarget(trade, 'PYRAMID', String(p._id || '')).length ? (
                                          <div className="space-y-1 text-cyan-800 dark:text-cyan-200">
                                            {getStopLossHistoryForTarget(trade, 'PYRAMID', String(p._id || '')).map((adj) => (
                                              <div
                                                key={adj._id}
                                                className="flex items-center justify-between gap-2 rounded border border-cyan-300/70 bg-cyan-100/60 px-2 py-1 dark:border-cyan-700/50 dark:bg-cyan-950/30"
                                              >
                                                <p>
                                                  Date: {new Date(adj.date).toLocaleDateString()} | Qty: {adj.qty} | SL: {adj.stopLoss}
                                                </p>
                                                <button
                                                  type="button"
                                                  className="btn-danger px-2 py-1 text-xs"
                                                  onClick={() => handleDeleteStopLossAdjustment(trade._id, adj._id)}
                                                >
                                                  Delete
                                                </button>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <p className="text-cyan-800 dark:text-cyan-200">None</p>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-amber-800 dark:text-amber-200">None</p>
                        )}
                      </div>

                      <div className="rounded border border-red-400/60 bg-red-50 px-3 py-2 dark:border-red-600/40 dark:bg-red-950/20">
                        <p className="mb-1 font-semibold text-red-700 dark:text-red-300">Exits</p>
                        {!!trade.exits?.length ? (
                          <div className="space-y-1 text-red-700 dark:text-red-200">
                            {trade.exits.map((e) => (
                              <div
                                key={e._id}
                                className="rounded border border-red-300/70 bg-red-100/60 px-2 py-1 dark:border-red-700/50 dark:bg-red-950/30"
                              >
                                {editingExit?.tradeId === trade._id && editingExit?.exitId === e._id ? (
                                  <div className="space-y-2">
                                    <div className="grid gap-2 md:grid-cols-4">
                                      <input
                                        type="date"
                                        className="field-input py-1 text-xs"
                                        value={editingExit.values.exitDate}
                                        onChange={(ev) =>
                                          setEditingExit((prev) => ({
                                            ...prev,
                                            values: { ...prev.values, exitDate: ev.target.value }
                                          }))
                                        }
                                      />
                                      <input
                                        type="number"
                                        step="0.0001"
                                        className="field-input py-1 text-xs"
                                        value={editingExit.values.exitPrice}
                                        onChange={(ev) =>
                                          setEditingExit((prev) => ({
                                            ...prev,
                                            values: { ...prev.values, exitPrice: ev.target.value }
                                          }))
                                        }
                                        placeholder="Exit Price"
                                      />
                                      <input
                                        type="number"
                                        step="0.0001"
                                        className="field-input py-1 text-xs"
                                        value={editingExit.values.exitQty}
                                        onChange={(ev) =>
                                          setEditingExit((prev) => ({
                                            ...prev,
                                            values: { ...prev.values, exitQty: ev.target.value }
                                          }))
                                        }
                                        placeholder="Exit Qty"
                                      />
                                    </div>
                                    <ExitReasonMultiSelect
                                      value={editingExit.values.exitReasons}
                                      onToggle={(option) =>
                                        setEditingExit((prev) => ({
                                          ...prev,
                                          values: {
                                            ...prev.values,
                                            exitReasons: toggleOption(prev.values.exitReasons, option)
                                          }
                                        }))
                                      }
                                    />
                                    <input
                                      type="text"
                                      className="field-input py-1 text-xs"
                                      value={editingExit.values.notes}
                                      onChange={(ev) =>
                                        setEditingExit((prev) => ({
                                          ...prev,
                                          values: { ...prev.values, notes: ev.target.value }
                                        }))
                                      }
                                      placeholder="Notes"
                                    />
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        className="btn-primary px-2 py-1 text-xs"
                                        onClick={() => saveEditExit(trade._id, e._id)}
                                      >
                                        Update
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-muted px-2 py-1 text-xs"
                                        onClick={() => setEditingExit(null)}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p>
                                      Date: {new Date(e.exitDate).toLocaleDateString()} | Price: {e.exitPrice} | Qty: {e.exitQty}
                                      {normalizeOptionList(e.exitReasons).length
                                        ? ` | Reasons: ${normalizeOptionList(e.exitReasons).join(', ')}`
                                        : ''}
                                      {e.notes ? ` | Notes: ${e.notes}` : ''}
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        className="btn-muted px-2 py-1 text-xs"
                                        onClick={() => startEditExit(trade, e)}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-danger px-2 py-1 text-xs"
                                        onClick={() => handleDeleteExit(trade._id, e._id)}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-red-700 dark:text-red-200">None</p>
                        )}
                      </div>

                      <div className="mt-3 rounded border border-amber-400/60 bg-amber-50 px-3 py-2 dark:border-amber-600/40 dark:bg-amber-950/20">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="font-semibold text-amber-700 dark:text-amber-300">Past Trade Comment</p>
                          {expandedCommentTradeId === trade._id ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="btn-primary px-2 py-1 text-xs"
                                disabled={commentSaving}
                                onClick={() => savePastTradeComment(trade._id, {
                                  market: commentMarketDraft,
                                  general: commentGeneralDraft
                                })}
                              >
                                {commentSaving ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                type="button"
                                className="btn-muted px-2 py-1 text-xs"
                                disabled={commentSaving}
                                onClick={() => {
                                  setExpandedCommentTradeId('');
                                  const comments = getPastTradeComments(trade);
                                  setCommentMarketDraft(comments.market);
                                  setCommentGeneralDraft(comments.general);
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn-muted px-2 py-1 text-xs"
                              onClick={() => {
                                setExpandedCommentTradeId(trade._id);
                                const comments = getPastTradeComments(trade);
                                setCommentMarketDraft(comments.market);
                                setCommentGeneralDraft(comments.general);
                              }}
                            >
                              {hasPastTradeComments(trade) ? 'Edit' : 'Add'}
                            </button>
                          )}
                        </div>
                        {expandedCommentTradeId === trade._id ? (
                          <div className="space-y-2">
                            <textarea
                              className="field-input min-h-20 text-sm"
                              value={commentMarketDraft}
                              onChange={(e) => setCommentMarketDraft(e.target.value)}
                              placeholder="Market comment"
                            />
                            <textarea
                              className="field-input min-h-20 text-sm"
                              value={commentGeneralDraft}
                              onChange={(e) => setCommentGeneralDraft(e.target.value)}
                              placeholder="General comment"
                            />
                          </div>
                        ) : (
                          (() => {
                            const comments = getPastTradeComments(trade);
                            return (
                              <div className="space-y-1 text-sm text-amber-800 dark:text-amber-200">
                                <p className="whitespace-pre-wrap break-words">
                                  <span className="font-medium">Market:</span> {comments.market || '-'}
                                </p>
                                <p className="whitespace-pre-wrap break-words">
                                  <span className="font-medium">General:</span> {comments.general || '-'}
                                </p>
                              </div>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
                )}
              </Fragment>
            );
            })}
            {!filtered.length && (
              <tr>
                <td className="px-3 py-6 text-center text-slate-600 dark:text-slate-400" colSpan={13}>
                  No trades found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {showScrollTop ? (
        <button
          type="button"
          onClick={() => tradesTableScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-40 rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-lg transition-colors duration-200 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Top
        </button>
      ) : null}
      <Modal
        title={commentTrade ? `${commentTrade.symbol} Past Trade Comment` : 'Past Trade Comment'}
        open={Boolean(commentTrade)}
        onClose={() => setCommentTrade(null)}
      >
        <div className="space-y-3">
          <textarea
            className="field-input min-h-24 text-sm"
            value={commentMarketDraft}
            onChange={(e) => setCommentMarketDraft(e.target.value)}
            placeholder="Market comment"
          />
          <textarea
            className="field-input min-h-24 text-sm"
            value={commentGeneralDraft}
            onChange={(e) => setCommentGeneralDraft(e.target.value)}
            placeholder="General comment"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="btn-primary px-3 py-1.5 text-sm"
              disabled={!commentTrade || commentSaving}
              onClick={() => commentTrade && savePastTradeComment(
                commentTrade._id,
                { market: commentMarketDraft, general: commentGeneralDraft },
                { closeOnSave: true }
              )}
            >
              {commentSaving ? 'Saving...' : 'Save Comment'}
            </button>
          </div>
          {commentTrade?.entryDate ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Entry Date: {new Date(commentTrade.entryDate).toLocaleDateString()}
            </p>
          ) : null}
        </div>
      </Modal>
      <TradeChartOverlay
        open={Boolean(chartTrade)}
        trade={chartTrade}
        onClose={() => setChartTrade(null)}
        onPrevTrade={showPrevChartTrade}
        onNextTrade={showNextChartTrade}
      />
    </div>
  );
};

export default TradesPage;
