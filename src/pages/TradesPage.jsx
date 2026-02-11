import { Fragment, useMemo, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  addStopLossAdjustment,
  deleteExit,
  deletePyramid,
  deleteTrade,
  fetchTradeQuote,
  fetchTrades,
  updateExit,
  updateTrade,
  updatePyramid
} from '../api/trades';
import { useSettings } from '../contexts/SettingsContext';

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

const entryRisk = (entryPrice, stopLoss, qty) =>
  Math.abs(Number(entryPrice || 0) - Number(stopLoss || 0)) * Number(qty || 0);

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

const capitalAllocated = (trade) => {
  const avgEntryPrice = Number(trade?.metrics?.avgEntryPrice || 0);
  const totalEntryQty = Number(trade?.metrics?.totalEntryQty || 0);
  return avgEntryPrice * totalEntryQty;
};

const tradeEntries = (trade) => [
  {
    entryPrice: Number(trade?.entryPrice || 0),
    qty: Number(trade?.entryQty || 0),
    stopLoss: Number(trade?.stopLoss || 0)
  },
  ...((trade?.pyramids || []).map((p) => ({
    entryPrice: Number(p?.price || 0),
    qty: Number(p?.qty || 0),
    stopLoss: Number(p?.stopLoss || 0)
  })))
];

const tradeStopLossPercent = (trade) => {
  const entries = tradeEntries(trade).filter((e) => e.entryPrice > 0 && e.qty > 0 && e.stopLoss > 0);
  if (!entries.length) return 0;
  const totalNotional = entries.reduce((acc, e) => acc + e.entryPrice * e.qty, 0);
  const totalRisk = entries.reduce((acc, e) => acc + Math.abs(e.entryPrice - e.stopLoss) * e.qty, 0);
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

const todayInputDate = () => new Date().toISOString().slice(0, 10);

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
  const [sortBy, setSortBy] = useState('entryDateAsc');
  const [liveLoading, setLiveLoading] = useState(false);
  const [editingBase, setEditingBase] = useState(null);
  const [editingPyramid, setEditingPyramid] = useState(null);
  const [editingExit, setEditingExit] = useState(null);
  const [editingStopLossAdjustment, setEditingStopLossAdjustment] = useState(null);

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

  const loadLivePrices = useCallback(async ({ includeClosed = false } = {}) => {
    const quoteCandidates = trades
      .filter((trade) => includeClosed || trade.metrics?.status === 'OPEN')
      .slice(0, 12);
    if (!quoteCandidates.length) return;

    setLiveLoading(true);
    setQuoteStatusByTradeId((prev) => {
      const next = { ...prev };
      quoteCandidates.forEach((trade) => {
        next[trade._id] = { loading: true, error: false };
      });
      return next;
    });

    const runWithConcurrency = async (items, worker, limit = 4) => {
      const results = new Array(items.length);
      let cursor = 0;
      const consume = async () => {
        while (cursor < items.length) {
          const current = cursor;
          cursor += 1;
          results[current] = await worker(items[current]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
      return results;
    };

    const results = await runWithConcurrency(
      quoteCandidates,
      (trade) =>
        fetchTradeQuote(trade._id)
          .then((quote) => ({ tradeId: trade._id, ok: true, quote }))
          .catch(() => ({ tradeId: trade._id, ok: false })),
      4
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
    loadLivePrices({ includeClosed: false });
    const intervalId = window.setInterval(() => {
      loadLivePrices({ includeClosed: false });
    }, 30 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [trades, loadLivePrices]);

  const filtered = useMemo(() => {
    let list = trades.filter((trade) => trade.symbol.toLowerCase().includes(search.toLowerCase()));

    if (statusFilter !== 'ALL') {
      list = list.filter((trade) => trade.metrics.status === statusFilter);
    }

    list.sort((a, b) => {
      if (sortBy === 'entryDateAsc') return new Date(a.entryDate) - new Date(b.entryDate);
      if (sortBy === 'entryDateDesc') return new Date(b.entryDate) - new Date(a.entryDate);
      if (sortBy === 'realizedPnLDesc') {
        return Number(b.metrics.realizedPnL || 0) - Number(a.metrics.realizedPnL || 0);
      }
      if (sortBy === 'realizedPnLAsc') {
        return Number(a.metrics.realizedPnL || 0) - Number(b.metrics.realizedPnL || 0);
      }
      if (sortBy === 'realizedRDesc') {
        return tradeRMultipleBySl(b) - tradeRMultipleBySl(a);
      }
      if (sortBy === 'realizedRAsc') {
        return tradeRMultipleBySl(a) - tradeRMultipleBySl(b);
      }
      if (sortBy === 'symbolAsc') return a.symbol.localeCompare(b.symbol);
      return 0;
    });

    return list;
  }, [trades, search, statusFilter, sortBy]);

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

  const upsertTrade = (updatedTrade) => {
    setTrades((prev) => {
      const next = prev.map((trade) => (trade._id === updatedTrade._id ? updatedTrade : trade));
      tradesCache.data = next;
      return next;
    });
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
    setEditingBase({
      tradeId: trade._id,
      values: {
        symbol: trade.symbol || '',
        entryDate: new Date(trade.entryDate).toISOString().slice(0, 10),
        entryPrice: String(trade.entryPrice ?? ''),
        entryQty: String(trade.entryQty ?? ''),
        stopLoss: String(trade.stopLoss ?? ''),
        strategy: trade.strategy || '',
        notes: trade.notes || ''
      }
    });
  };

  const saveEditBase = async (tradeId) => {
    if (!editingBase || editingBase.tradeId !== tradeId) return;
    const payload = {
      symbol: String(editingBase.values.symbol || '').trim().toUpperCase(),
      entryDate: editingBase.values.entryDate,
      entryPrice: Number(editingBase.values.entryPrice),
      entryQty: Number(editingBase.values.entryQty),
      stopLoss: Number(editingBase.values.stopLoss),
      strategy: editingBase.values.strategy,
      notes: editingBase.values.notes
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

    try {
      const updatedTrade = await updateTrade(tradeId, payload);
      upsertTrade(updatedTrade);
      setEditingBase(null);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update base trade');
    }
  };

  const toggleExpanded = (id) => {
    setExpandedTradeIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const startStopLossAdjustment = (trade) => {
    setEditingBase(null);
    setEditingPyramid(null);
    setEditingExit(null);
    setExpandedTradeIds((prev) => ({ ...prev, [trade._id]: true }));
    setEditingStopLossAdjustment({
      tradeId: trade._id,
      values: {
        date: todayInputDate(),
        qty: String(trade?.metrics?.openQty || ''),
        stopLoss: ''
      }
    });
  };

  const saveStopLossAdjustment = async (trade) => {
    if (!editingStopLossAdjustment || editingStopLossAdjustment.tradeId !== trade._id) return;
    const payload = {
      date: editingStopLossAdjustment.values.date,
      qty: Number(editingStopLossAdjustment.values.qty),
      stopLoss: Number(editingStopLossAdjustment.values.stopLoss)
    };
    if (!payload.date || payload.qty <= 0 || payload.stopLoss <= 0) {
      alert('Date, quantity, and stop loss are required and must be valid.');
      return;
    }
    const openQty = Number(trade?.metrics?.openQty || 0);
    if (payload.qty > openQty + 1e-9) {
      alert('Adjustment quantity cannot exceed open quantity.');
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

  if (loading) return <p>Loading trades...</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="surface-card space-y-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Filter Trades
          </p>
          <p className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            {filtered.length} result{filtered.length === 1 ? '' : 's'}
          </p>
        </div>

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
              Sort By
            </span>
            <select
              className="field-input py-1.5 text-sm"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="entryDateAsc">Date (Oldest)</option>
              <option value="entryDateDesc">Date (Newest)</option>
              <option value="realizedPnLDesc">Realized P&L (High to Low)</option>
              <option value="realizedPnLAsc">Realized P&L (Low to High)</option>
              <option value="realizedRDesc">R Multiple (High to Low)</option>
              <option value="realizedRAsc">R Multiple (Low to High)</option>
              <option value="symbolAsc">Symbol (A-Z)</option>
            </select>
          </label>

        </div>

        <div className="flex justify-end pt-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-muted px-2.5 py-1 text-xs"
              onClick={() => loadLivePrices({ includeClosed: true })}
              disabled={liveLoading}
            >
              {liveLoading ? 'Loading Live...' : 'Load Live Prices'}
            </button>
            <button
              type="button"
              className="btn-muted px-2.5 py-1 text-xs"
              onClick={() => {
                setSearch('');
                setStatusFilter('ALL');
                setSortBy('entryDateAsc');
              }}
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      <div className="surface-card max-h-[70vh] overflow-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="table-head [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-100 dark:[&_th]:bg-slate-900">
            <tr>
              <th className="px-3 py-2">Trade #</th>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Entry Date</th>
              <th className="px-3 py-2">Avg Entry</th>
              <th className="px-3 py-2">Open Qty</th>
              <th className="px-3 py-2">Capital Allocated (Rs / %)</th>
              <th className="px-3 py-2">Current Price</th>
              <th className="px-3 py-2">Risk (Rs / %)</th>
              <th className="px-3 py-2">Realized P&L</th>
              <th className="px-3 py-2">R Multiple</th>
              <th className="px-3 py-2">Holding Days</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((trade, index) => {
              const allocatedValue = capitalAllocated(trade);
              const allocatedPercent = totalCapital ? (allocatedValue / totalCapital) * 100 : 0;
              const computedRMultiple = tradeRMultipleBySl(trade);
              const holdingDays = tradeHoldingDays(trade);
              return (
              <Fragment key={trade._id}>
                <tr className="table-row-hover">
                  <td className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">{index + 1}</td>
                  <td className="px-3 py-2 font-medium">{trade.symbol}</td>
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
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {money(trade.metrics.capitalAtRisk)} ({Number(trade.metrics.riskPercent || 0).toFixed(2)}%)
                  </td>
                  <td className={`px-3 py-2 ${pnlTextClass(trade.metrics.realizedPnL)}`}>
                    {money(trade.metrics.realizedPnL)} ({realizedPnlPercent(trade).toFixed(2)}%)
                  </td>
                  <td className={`px-3 py-2 ${pnlTextClass(computedRMultiple)}`}>
                    {computedRMultiple.toFixed(2)}
                  </td>
                  <td className="px-3 py-2">{holdingDays}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 whitespace-nowrap">
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
                        <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
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
                        <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                          Exit
                        </span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => startStopLossAdjustment(trade)}
                        className="group relative rounded border border-cyan-400/80 bg-cyan-50 p-1.5 text-cyan-700 transition-colors duration-200 hover:bg-cyan-100 dark:border-cyan-500/60 dark:bg-cyan-950/30 dark:text-cyan-200 dark:hover:bg-cyan-900/50"
                        aria-label="Adjust stop loss"
                        title="Adjust stop loss"
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
                          <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5Z" strokeLinejoin="round" />
                          <path d="M9 12h6" strokeLinecap="round" />
                        </svg>
                        <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                          Adjust SL
                        </span>
                      </button>
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
                        <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
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
                        <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
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
                        <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-100 dark:text-slate-900">
                          Delete
                        </span>
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedTradeIds[trade._id] && (
                <tr className="border-b-2 border-slate-300 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/70">
                  <td colSpan={12} className="px-3 py-2 text-xs">
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
                                onClick={() => setEditingBase(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn-muted px-2 py-1 text-xs"
                              onClick={() => startEditBase(trade)}
                            >
                              Edit
                            </button>
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
                            <input
                              type="text"
                              className="field-input py-1 text-xs md:col-span-2"
                              value={editingBase.values.strategy}
                              onChange={(e) =>
                                setEditingBase((prev) => ({
                                  ...prev,
                                  values: { ...prev.values, strategy: e.target.value }
                                }))
                              }
                              placeholder="Strategy"
                            />
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
                          </div>
                        ) : (
                          <div className="space-y-1 text-slate-600 dark:text-slate-300">
                            <p>Symbol: {trade.symbol}</p>
                            <p>Date: {new Date(trade.entryDate).toLocaleDateString()}</p>
                            <p>Price: {trade.entryPrice}</p>
                            <p>Qty: {trade.entryQty}</p>
                            <p>
                              Stop Loss: {trade.stopLoss} ({stopLossPercent(trade.entryPrice, trade.stopLoss).toFixed(2)}%)
                            </p>
                            {trade.strategy && <p>Strategy: {trade.strategy}</p>}
                            {trade.notes && <p>Notes: {trade.notes}</p>}
                          </div>
                        )}
                      </div>

                      <div className="rounded border border-cyan-400/60 bg-cyan-50 px-3 py-2 dark:border-cyan-600/40 dark:bg-cyan-950/20">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p className="font-semibold text-cyan-700 dark:text-cyan-300">Stop Loss Changes</p>
                          {editingStopLossAdjustment?.tradeId === trade._id ? (
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
                          ) : (
                            <button
                              type="button"
                              className="btn-muted px-2 py-1 text-xs"
                              onClick={() => startStopLossAdjustment(trade)}
                            >
                              Add SL Change
                            </button>
                          )}
                        </div>
                        {editingStopLossAdjustment?.tradeId === trade._id && (
                          <div className="mb-2 grid gap-2 md:grid-cols-3">
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
                        )}
                        {!!trade.stopLossAdjustments?.length ? (
                          <div className="space-y-1 text-cyan-800 dark:text-cyan-200">
                            {[...trade.stopLossAdjustments]
                              .sort((a, b) => new Date(b.date) - new Date(a.date))
                              .map((adj) => (
                                <div
                                  key={adj._id}
                                  className="rounded border border-cyan-300/70 bg-cyan-100/60 px-2 py-1 dark:border-cyan-700/50 dark:bg-cyan-950/30"
                                >
                                  Date: {new Date(adj.date).toLocaleDateString()} | Qty: {adj.qty} | SL: {adj.stopLoss}
                                </div>
                              ))}
                          </div>
                        ) : (
                          <p className="text-cyan-800 dark:text-cyan-200">None</p>
                        )}
                      </div>

                      <div className="rounded border border-amber-400/60 bg-amber-50 px-3 py-2 dark:border-amber-600/40 dark:bg-amber-950/20">
                        <p className="mb-1 font-semibold text-amber-700 dark:text-amber-300">Pyramids</p>
                        {!!trade.pyramids?.length ? (
                          <div className="space-y-1 text-amber-800 dark:text-amber-200">
                            {trade.pyramids.map((p) => (
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
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p>
                                      Date: {new Date(p.date).toLocaleDateString()} | Price: {p.price} | Qty: {p.qty} | Stop: {p.stopLoss} ({stopLossPercent(p.price, p.stopLoss).toFixed(2)}%)
                                      {trade.metrics.status === 'OPEN'
                                        ? ` | Capital at Risk: ${money(entryRisk(p.price, p.stopLoss, p.qty))}`
                                        : ''}
                                    </p>
                                    <div className="flex items-center gap-2">
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
                                )}
                              </div>
                            ))}
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
                                    </div>
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
                    </div>
                  </td>
                </tr>
                )}
              </Fragment>
            );
            })}
            {!filtered.length && (
              <tr>
                <td className="px-3 py-6 text-center text-slate-600 dark:text-slate-400" colSpan={12}>
                  No trades found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TradesPage;
