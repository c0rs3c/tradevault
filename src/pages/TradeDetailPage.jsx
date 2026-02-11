import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import Modal from '../components/Modal';
import {
  addExit,
  addPyramid,
  deleteExit,
  deletePyramid,
  fetchTrade,
  fetchTradeQuote,
  updateExit,
  updatePyramid,
  updateTrade
} from '../api/trades';

const inputClass = 'field-input';
const toInputDate = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');
const money = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const TradeDetailPage = () => {
  const params = useParams();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [trade, setTrade] = useState(null);
  const [liveQuote, setLiveQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPyramidModal, setShowPyramidModal] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showEditEntryModal, setShowEditEntryModal] = useState(false);
  const [showEditPyramidModal, setShowEditPyramidModal] = useState(false);
  const [showEditExitModal, setShowEditExitModal] = useState(false);
  const [editingPyramidId, setEditingPyramidId] = useState('');
  const [editingExitId, setEditingExitId] = useState('');

  const [pyramidForm, setPyramidForm] = useState({ date: '', price: '', qty: '', stopLoss: '' });
  const [exitForm, setExitForm] = useState({ exitDate: '', exitPrice: '', exitQty: '', notes: '' });
  const [entryForm, setEntryForm] = useState({
    entryDate: '',
    entryPrice: '',
    entryQty: '',
    stopLoss: '',
    strategy: '',
    notes: ''
  });
  const [editPyramidForm, setEditPyramidForm] = useState({ date: '', price: '', qty: '', stopLoss: '' });
  const [editExitForm, setEditExitForm] = useState({
    exitDate: '',
    exitPrice: '',
    exitQty: '',
    notes: ''
  });

  const loadTrade = useCallback(async () => {
    try {
      const data = await fetchTrade(id);
      setTrade(data);
      setEntryForm({
        entryDate: toInputDate(data.entryDate),
        entryPrice: String(data.entryPrice ?? ''),
        entryQty: String(data.entryQty ?? ''),
        stopLoss: String(data.stopLoss ?? ''),
        strategy: data.strategy || '',
        notes: data.notes || ''
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load trade');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadTrade();
  }, [loadTrade]);

  const loadLiveQuote = async () => {
    setQuoteLoading(true);
    try {
      const quote = await fetchTradeQuote(id);
      setLiveQuote(quote);
      setQuoteError('');
    } catch (err) {
      setQuoteError(err.response?.data?.message || 'Failed to fetch live price');
    } finally {
      setQuoteLoading(false);
    }
  };

  useEffect(() => {
    setLiveQuote(null);
    setQuoteError('');
  }, [id]);

  useEffect(() => {
    const openModal = searchParams.get('openModal');
    if (openModal === 'pyramid') setShowPyramidModal(true);
    if (openModal === 'exit') setShowExitModal(true);
  }, [searchParams]);

  const closePyramidModal = () => {
    setShowPyramidModal(false);
    if (searchParams.get('openModal') === 'pyramid') {
      if (searchParams.get('source') === 'trades') {
        router.push('/trades');
        return;
      }
      const next = new URLSearchParams(searchParams.toString());
      next.delete('openModal');
      router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname);
    }
  };

  const closeExitModal = () => {
    setShowExitModal(false);
    if (searchParams.get('openModal') === 'exit') {
      if (searchParams.get('source') === 'trades') {
        router.push('/trades');
        return;
      }
      const next = new URLSearchParams(searchParams.toString());
      next.delete('openModal');
      router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname);
    }
  };

  const handleAddPyramid = async (e) => {
    e.preventDefault();
    if (Number(pyramidForm.price) <= 0 || Number(pyramidForm.qty) <= 0 || Number(pyramidForm.stopLoss) <= 0) {
      return alert('Price, qty, and stop loss must be greater than 0');
    }

    try {
      const updated = await addPyramid(id, {
        date: pyramidForm.date,
        price: Number(pyramidForm.price),
        qty: Number(pyramidForm.qty),
        stopLoss: Number(pyramidForm.stopLoss)
      });
      setTrade(updated);
      setShowPyramidModal(false);
      setPyramidForm({ date: '', price: '', qty: '', stopLoss: '' });
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add pyramid');
    }
  };

  const handleAddExit = async (e) => {
    e.preventDefault();
    if (Number(exitForm.exitPrice) <= 0 || Number(exitForm.exitQty) <= 0) {
      return alert('Exit price and qty must be greater than 0');
    }

    try {
      const updated = await addExit(id, {
        exitDate: exitForm.exitDate,
        exitPrice: Number(exitForm.exitPrice),
        exitQty: Number(exitForm.exitQty),
        notes: exitForm.notes
      });
      setTrade(updated);
      setShowExitModal(false);
      setExitForm({ exitDate: '', exitPrice: '', exitQty: '', notes: '' });
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add exit');
    }
  };

  const handleDeletePyramid = async (pid) => {
    try {
      const updated = await deletePyramid(id, pid);
      setTrade(updated);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete pyramid');
    }
  };

  const handleDeleteExit = async (eid) => {
    try {
      const updated = await deleteExit(id, eid);
      setTrade(updated);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete exit');
    }
  };

  const openEditEntryModal = () => {
    setEntryForm({
      entryDate: toInputDate(trade.entryDate),
      entryPrice: String(trade.entryPrice ?? ''),
      entryQty: String(trade.entryQty ?? ''),
      stopLoss: String(trade.stopLoss ?? ''),
      strategy: trade.strategy || '',
      notes: trade.notes || ''
    });
    setShowEditEntryModal(true);
  };

  const handleUpdateEntry = async (event) => {
    event.preventDefault();
    if (
      Number(entryForm.entryPrice) <= 0 ||
      Number(entryForm.entryQty) <= 0 ||
      Number(entryForm.stopLoss) <= 0
    ) {
      return alert('Entry price, qty, and stop loss must be greater than 0');
    }

    try {
      const updated = await updateTrade(id, {
        entryDate: entryForm.entryDate,
        entryPrice: Number(entryForm.entryPrice),
        entryQty: Number(entryForm.entryQty),
        stopLoss: Number(entryForm.stopLoss),
        strategy: entryForm.strategy,
        notes: entryForm.notes
      });
      setTrade(updated);
      setShowEditEntryModal(false);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update initial entry');
    }
  };

  const openEditPyramidModal = (pyramid) => {
    setEditingPyramidId(pyramid._id);
    setEditPyramidForm({
      date: toInputDate(pyramid.date),
      price: String(pyramid.price ?? ''),
      qty: String(pyramid.qty ?? ''),
      stopLoss: String(pyramid.stopLoss ?? '')
    });
    setShowEditPyramidModal(true);
  };

  const handleUpdatePyramid = async (event) => {
    event.preventDefault();
    if (!editingPyramidId) return;
    if (
      Number(editPyramidForm.price) <= 0 ||
      Number(editPyramidForm.qty) <= 0 ||
      Number(editPyramidForm.stopLoss) <= 0
    ) {
      return alert('Price, qty, and stop loss must be greater than 0');
    }
    try {
      const updated = await updatePyramid(id, editingPyramidId, {
        date: editPyramidForm.date,
        price: Number(editPyramidForm.price),
        qty: Number(editPyramidForm.qty),
        stopLoss: Number(editPyramidForm.stopLoss)
      });
      setTrade(updated);
      setShowEditPyramidModal(false);
      setEditingPyramidId('');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update pyramid');
    }
  };

  const openEditExitModal = (exit) => {
    setEditingExitId(exit._id);
    setEditExitForm({
      exitDate: toInputDate(exit.exitDate),
      exitPrice: String(exit.exitPrice ?? ''),
      exitQty: String(exit.exitQty ?? ''),
      notes: exit.notes || ''
    });
    setShowEditExitModal(true);
  };

  const handleUpdateExit = async (event) => {
    event.preventDefault();
    if (!editingExitId) return;
    if (Number(editExitForm.exitPrice) <= 0 || Number(editExitForm.exitQty) <= 0) {
      return alert('Exit price and qty must be greater than 0');
    }
    try {
      const updated = await updateExit(id, editingExitId, {
        exitDate: editExitForm.exitDate,
        exitPrice: Number(editExitForm.exitPrice),
        exitQty: Number(editExitForm.exitQty),
        notes: editExitForm.notes
      });
      setTrade(updated);
      setShowEditExitModal(false);
      setEditingExitId('');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update exit');
    }
  };

  if (loading) return <p>Loading trade...</p>;
  if (error) return <p className="text-red-600">{error}</p>;
  if (!trade) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href="/trades" className="btn-muted">
            Back to Trades
          </Link>
          <h1 className="text-2xl font-semibold">{trade.symbol} Trade</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPyramidModal(true)}
            className="btn-primary"
          >
            Add Pyramid
          </button>
          <button
            onClick={() => setShowExitModal(true)}
            className="btn-muted"
          >
            Add Exit
          </button>
        </div>
      </div>

      <section className="surface-card grid gap-3 p-4 md:grid-cols-3">
        <div>
          <p className="text-xs text-slate-600 dark:text-slate-400">Capital At Risk</p>
          <p className="text-lg font-semibold">{money(trade.metrics.capitalAtRisk)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-600 dark:text-slate-400">Open Qty</p>
          <p className="text-lg font-semibold">{trade.metrics.openQty}</p>
        </div>
        <div>
          <p className="text-xs text-slate-600 dark:text-slate-400">Avg Entry Price</p>
          <p className="text-lg font-semibold">{trade.metrics.avgEntryPrice}</p>
        </div>
        <div>
          <p className="text-xs text-slate-600 dark:text-slate-400">Realized P&L</p>
          <p className="text-lg font-semibold">{money(trade.metrics.realizedPnL)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-600 dark:text-slate-400">Realized R</p>
          <p className="text-lg font-semibold">{trade.metrics.realizedR}</p>
        </div>
        <div>
          <p className="text-xs text-slate-600 dark:text-slate-400">Status</p>
          <p className="text-lg font-semibold">{trade.metrics.status}</p>
        </div>
        <div>
          <p className="text-xs text-slate-600 dark:text-slate-400">Live Price</p>
          <p className="text-lg font-semibold">
            {quoteLoading ? (
              <span className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent dark:border-slate-500" />
                Fetching...
              </span>
            ) : liveQuote ? (
              money(liveQuote.price)
            ) : (
              'N/A'
            )}
          </p>
          <button
            type="button"
            className="btn-muted mt-2 px-2 py-1 text-xs"
            onClick={loadLiveQuote}
            disabled={quoteLoading}
          >
            {quoteLoading ? 'Refreshing...' : 'Refresh Live Price'}
          </button>
          {liveQuote?.asOf && (
            <p className="text-xs text-slate-500 dark:text-slate-500">
              Updated {new Date(liveQuote.asOf).toLocaleTimeString()}
            </p>
          )}
          {quoteError && <p className="text-xs text-red-600 dark:text-red-400">{quoteError}</p>}
        </div>
      </section>

      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Initial Entry</h2>
          <button type="button" className="btn-muted px-2 py-1 text-xs" onClick={openEditEntryModal}>
            Edit Entry
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Entry Date</p>
            <p className="text-sm font-medium">{new Date(trade.entryDate).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Entry Price</p>
            <p className="text-sm font-medium">{trade.entryPrice}</p>
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Entry Qty</p>
            <p className="text-sm font-medium">{trade.entryQty}</p>
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Stop Loss</p>
            <p className="text-sm font-medium">{trade.stopLoss}</p>
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Strategy</p>
            <p className="text-sm font-medium">{trade.strategy || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Notes</p>
            <p className="text-sm font-medium">{trade.notes || '-'}</p>
          </div>
        </div>
      </section>

      <section className="surface-card p-4">
        <h2 className="text-lg font-semibold">Pyramids</h2>
        <div className="mt-3 space-y-2">
          {(trade.pyramids || []).map((p) => (
            <div key={p._id} className="table-row-hover flex items-center justify-between rounded-md p-3">
              <p className="text-sm">
                {new Date(p.date).toLocaleDateString()} | Price: {p.price} | Qty: {p.qty} | Stop: {p.stopLoss}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEditPyramidModal(p)}
                  className="btn-muted px-2 py-1 text-xs"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDeletePyramid(p._id)}
                  className="btn-danger px-2 py-1 text-xs"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {!trade.pyramids?.length && <p className="text-sm text-slate-600 dark:text-slate-400">No pyramid entries.</p>}
        </div>
      </section>

      <section className="surface-card p-4">
        <h2 className="text-lg font-semibold">Exits</h2>
        <div className="mt-3 space-y-2">
          {(trade.exits || []).map((exit) => (
            <div
              key={exit._id}
              className="table-row-hover flex items-center justify-between rounded-md p-3"
            >
              <p className="text-sm">
                {new Date(exit.exitDate).toLocaleDateString()} | Price: {exit.exitPrice} | Qty: {exit.exitQty}{' '}
                {exit.notes ? `| ${exit.notes}` : ''}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEditExitModal(exit)}
                  className="btn-muted px-2 py-1 text-xs"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteExit(exit._id)}
                  className="btn-danger px-2 py-1 text-xs"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {!trade.exits?.length && <p className="text-sm text-slate-600 dark:text-slate-400">No exits yet.</p>}
        </div>
      </section>

      <section className="surface-card p-4">
        <h2 className="text-lg font-semibold">Trade Charges</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Charges</p>
            <p className="text-lg font-semibold text-red-700 dark:text-red-300">
              {money(trade.metrics?.charges ?? trade.charges ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Gross Realized P&L</p>
            <p className="text-lg font-semibold">
              {money(trade.metrics?.grossRealizedPnL ?? trade.metrics?.realizedPnL ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Net Realized P&L</p>
            <p className="text-lg font-semibold">
              {money(trade.metrics?.realizedPnL ?? 0)}
            </p>
          </div>
        </div>
      </section>

      <Modal title="Add Pyramid Entry" open={showPyramidModal} onClose={closePyramidModal}>
        <form onSubmit={handleAddPyramid} className="space-y-3">
          <input
            type="date"
            className={inputClass}
            value={pyramidForm.date}
            onChange={(e) => setPyramidForm((prev) => ({ ...prev, date: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder="Price"
            className={inputClass}
            value={pyramidForm.price}
            onChange={(e) => setPyramidForm((prev) => ({ ...prev, price: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder="Qty"
            className={inputClass}
            value={pyramidForm.qty}
            onChange={(e) => setPyramidForm((prev) => ({ ...prev, qty: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder={`Stop Loss (current ${trade.stopLoss})`}
            className={inputClass}
            value={pyramidForm.stopLoss}
            onChange={(e) => setPyramidForm((prev) => ({ ...prev, stopLoss: e.target.value }))}
            required
          />
          <button type="submit" className="btn-primary">
            Save Pyramid
          </button>
        </form>
      </Modal>

      <Modal title="Add Exit" open={showExitModal} onClose={closeExitModal}>
        <form onSubmit={handleAddExit} className="space-y-3">
          <input
            type="date"
            className={inputClass}
            value={exitForm.exitDate}
            onChange={(e) => setExitForm((prev) => ({ ...prev, exitDate: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder="Exit Price"
            className={inputClass}
            value={exitForm.exitPrice}
            onChange={(e) => setExitForm((prev) => ({ ...prev, exitPrice: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder={`Exit Qty (max ${trade.metrics.openQty})`}
            className={inputClass}
            value={exitForm.exitQty}
            onChange={(e) => setExitForm((prev) => ({ ...prev, exitQty: e.target.value }))}
            required
          />
          <textarea
            placeholder="Notes (optional)"
            className={inputClass}
            value={exitForm.notes}
            onChange={(e) => setExitForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
          <button type="submit" className="btn-primary">
            Save Exit
          </button>
        </form>
      </Modal>

      <Modal title="Edit Initial Entry" open={showEditEntryModal} onClose={() => setShowEditEntryModal(false)}>
        <form onSubmit={handleUpdateEntry} className="space-y-3">
          <input
            type="date"
            className={inputClass}
            value={entryForm.entryDate}
            onChange={(e) => setEntryForm((prev) => ({ ...prev, entryDate: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder="Entry Price"
            className={inputClass}
            value={entryForm.entryPrice}
            onChange={(e) => setEntryForm((prev) => ({ ...prev, entryPrice: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder="Entry Qty"
            className={inputClass}
            value={entryForm.entryQty}
            onChange={(e) => setEntryForm((prev) => ({ ...prev, entryQty: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder="Stop Loss"
            className={inputClass}
            value={entryForm.stopLoss}
            onChange={(e) => setEntryForm((prev) => ({ ...prev, stopLoss: e.target.value }))}
            required
          />
          <input
            type="text"
            placeholder="Strategy (optional)"
            className={inputClass}
            value={entryForm.strategy}
            onChange={(e) => setEntryForm((prev) => ({ ...prev, strategy: e.target.value }))}
          />
          <textarea
            placeholder="Notes (optional)"
            className={inputClass}
            value={entryForm.notes}
            onChange={(e) => setEntryForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
          <button type="submit" className="btn-primary">
            Save Entry
          </button>
        </form>
      </Modal>

      <Modal
        title="Edit Pyramid Entry"
        open={showEditPyramidModal}
        onClose={() => {
          setShowEditPyramidModal(false);
          setEditingPyramidId('');
        }}
      >
        <form onSubmit={handleUpdatePyramid} className="space-y-3">
          <input
            type="date"
            className={inputClass}
            value={editPyramidForm.date}
            onChange={(e) => setEditPyramidForm((prev) => ({ ...prev, date: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder="Price"
            className={inputClass}
            value={editPyramidForm.price}
            onChange={(e) => setEditPyramidForm((prev) => ({ ...prev, price: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder="Qty"
            className={inputClass}
            value={editPyramidForm.qty}
            onChange={(e) => setEditPyramidForm((prev) => ({ ...prev, qty: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder="Stop Loss"
            className={inputClass}
            value={editPyramidForm.stopLoss}
            onChange={(e) => setEditPyramidForm((prev) => ({ ...prev, stopLoss: e.target.value }))}
            required
          />
          <button type="submit" className="btn-primary">
            Save Pyramid
          </button>
        </form>
      </Modal>

      <Modal
        title="Edit Exit"
        open={showEditExitModal}
        onClose={() => {
          setShowEditExitModal(false);
          setEditingExitId('');
        }}
      >
        <form onSubmit={handleUpdateExit} className="space-y-3">
          <input
            type="date"
            className={inputClass}
            value={editExitForm.exitDate}
            onChange={(e) => setEditExitForm((prev) => ({ ...prev, exitDate: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder="Exit Price"
            className={inputClass}
            value={editExitForm.exitPrice}
            onChange={(e) => setEditExitForm((prev) => ({ ...prev, exitPrice: e.target.value }))}
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder="Exit Qty"
            className={inputClass}
            value={editExitForm.exitQty}
            onChange={(e) => setEditExitForm((prev) => ({ ...prev, exitQty: e.target.value }))}
            required
          />
          <textarea
            placeholder="Notes (optional)"
            className={inputClass}
            value={editExitForm.notes}
            onChange={(e) => setEditExitForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
          <button type="submit" className="btn-primary">
            Save Exit
          </button>
        </form>
      </Modal>
    </div>
  );
};

export default TradeDetailPage;
