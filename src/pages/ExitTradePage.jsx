import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { addExit, fetchTrades } from '../api/trades';
import ExitReasonMultiSelect from '../components/ExitReasonMultiSelect';
import TradeStrategySelector from '../components/TradeStrategySelector';
import { hasAnySelectedOption, normalizeOptionList } from '../utils/tradeOptions';

const todayInputDate = () => new Date().toISOString().slice(0, 10);

const money = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const toggleOption = (current, option) => {
  const items = normalizeOptionList(current);
  return items.includes(option) ? items.filter((item) => item !== option) : [...items, option];
};

const ExitTradePage = () => {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [strategyFilter, setStrategyFilter] = useState([]);
  const [selectedTradeId, setSelectedTradeId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    exitDate: todayInputDate(),
    exitPrice: '',
    exitQty: '',
    exitReasons: [],
    notes: ''
  });

  const loadTrades = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchTrades();
      setTrades(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load trades');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrades();
  }, []);

  const openTrades = useMemo(
    () =>
      trades.filter((trade) => {
        const status = String(trade?.metrics?.status || '').toUpperCase();
        const openQty = Number(trade?.metrics?.openQty || 0);
        return status === 'OPEN' && openQty > 0;
      }),
    [trades]
  );

  const filteredTrades = useMemo(() => {
    const query = String(search || '').trim().toUpperCase();
    return openTrades.filter((trade) => {
      const symbol = String(trade?.symbol || '').toUpperCase();
      const strategy = String(trade?.strategy || '').toUpperCase();
      const matchesQuery = !query || symbol.includes(query) || strategy.includes(query);
      return matchesQuery && hasAnySelectedOption(trade?.strategy, strategyFilter);
    });
  }, [openTrades, search, strategyFilter]);

  const selectedTrade =
    filteredTrades.find((trade) => trade._id === selectedTradeId) ||
    openTrades.find((trade) => trade._id === selectedTradeId) ||
    null;

  useEffect(() => {
    if (!selectedTradeId && filteredTrades.length) {
      const firstTrade = filteredTrades[0];
      setSelectedTradeId(firstTrade._id);
      setForm((current) => ({ ...current, exitQty: String(firstTrade?.metrics?.openQty || '') }));
      return;
    }

    if (selectedTradeId && !openTrades.some((trade) => trade._id === selectedTradeId)) {
      const firstTrade = filteredTrades[0] || openTrades[0];
      setSelectedTradeId(firstTrade?._id || '');
      setForm((current) => ({ ...current, exitQty: firstTrade ? String(firstTrade?.metrics?.openQty || '') : '' }));
    }
  }, [filteredTrades, openTrades, selectedTradeId]);

  const handleSelectTrade = (trade) => {
    setSelectedTradeId(trade._id);
    setSuccess('');
    setForm((current) => ({
      ...current,
      exitQty: String(trade?.metrics?.openQty || ''),
      exitPrice: ''
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!selectedTrade) return;

    const payload = {
      exitDate: form.exitDate,
      exitPrice: Number(form.exitPrice),
      exitQty: Number(form.exitQty),
      exitReasons: form.exitReasons,
      notes: form.notes
    };

    if (!payload.exitDate || payload.exitPrice <= 0 || payload.exitQty <= 0) {
      alert('Exit date, price, and quantity are required.');
      return;
    }

    if (payload.exitQty > Number(selectedTrade?.metrics?.openQty || 0) + 1e-9) {
      alert('Exit quantity cannot exceed open quantity.');
      return;
    }

    setSubmitting(true);
    setSuccess('');
    try {
      await addExit(selectedTrade._id, payload);
      setSuccess(`Exit recorded for ${selectedTrade.symbol}`);
      setForm({
        exitDate: todayInputDate(),
        exitPrice: '',
        exitQty: '',
        exitReasons: [],
        notes: ''
      });
      await loadTrades();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add exit');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p>Loading open trades...</p>;
  if (error) return <p className="text-red-600 dark:text-red-400">{error}</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Exit Trade</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Search open trades, pick one, and record the exit price, quantity, and remarks.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <section className="surface-card space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Open Trades</h2>
            <span className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
              {filteredTrades.length} shown
            </span>
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="field-input"
              placeholder="Type symbol or strategy"
            />
          </label>

          <TradeStrategySelector
            value={strategyFilter}
            onToggle={(option) => setStrategyFilter((current) => toggleOption(current, option))}
            label="Filter by Criteria"
          />

          <div className="max-h-[32rem] space-y-2 overflow-auto">
            {filteredTrades.map((trade) => {
              const isSelected = selectedTradeId === trade._id;
              return (
                <button
                  key={trade._id}
                  type="button"
                  onClick={() => handleSelectTrade(trade)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                    isSelected
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{trade.symbol}</span>
                    <span className={`text-xs ${isSelected ? 'text-slate-200 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'}`}>
                      Open Qty {trade.metrics.openQty}
                    </span>
                  </div>
                  <div className={`mt-1 text-xs ${isSelected ? 'text-slate-200 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'}`}>
                    Entry {new Date(trade.entryDate).toLocaleDateString()} | Avg {money(trade.metrics.avgEntryPrice)}
                  </div>
                </button>
              );
            })}
            {!filteredTrades.length ? (
              <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No open trades matched your search.
              </p>
            ) : null}
          </div>
        </section>

        <section className="surface-card p-5">
          {selectedTrade ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{selectedTrade.symbol}</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    Open Qty {selectedTrade.metrics.openQty} | Avg Entry {money(selectedTrade.metrics.avgEntryPrice)} | Side {selectedTrade.side}
                  </p>
                </div>
                <Link href={`/trades/${selectedTrade._id}`} className="btn-muted px-3 py-2 text-sm">
                  Open Detail
                </Link>
              </div>

              {success ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{success}</p> : null}

              <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-sm font-medium">Exit Date</span>
                  <input
                    type="date"
                    value={form.exitDate}
                    onChange={(event) => setForm((current) => ({ ...current, exitDate: event.target.value }))}
                    className="field-input"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-sm font-medium">Exit Price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.exitPrice}
                    onChange={(event) => setForm((current) => ({ ...current, exitPrice: event.target.value }))}
                    className="field-input"
                    placeholder="0.00"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-sm font-medium">Exit Quantity</span>
                  <input
                    type="number"
                    min="0"
                    step="0.000001"
                    max={selectedTrade.metrics.openQty}
                    value={form.exitQty}
                    onChange={(event) => setForm((current) => ({ ...current, exitQty: event.target.value }))}
                    className="field-input"
                    placeholder={`Max ${selectedTrade.metrics.openQty}`}
                  />
                </label>

                <ExitReasonMultiSelect
                  value={form.exitReasons}
                  onToggle={(option) => setForm((current) => ({ ...current, exitReasons: toggleOption(current.exitReasons, option) }))}
                  className="md:col-span-2"
                />

                <label className="space-y-1 md:col-span-2">
                  <span className="text-sm font-medium">Remarks</span>
                  <textarea
                    value={form.notes}
                    onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                    rows={4}
                    className="field-input"
                    placeholder="Reason for exit, execution notes, or remarks"
                  />
                </label>

                <div className="md:col-span-2">
                  <button type="submit" className="btn-primary px-4 py-2 text-sm" disabled={submitting}>
                    {submitting ? 'Saving Exit...' : 'Record Exit'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Select an open trade to record an exit.
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ExitTradePage;
