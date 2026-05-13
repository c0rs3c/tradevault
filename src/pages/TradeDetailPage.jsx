import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import Modal from '../components/Modal';
import ScreenshotManager from '../components/ScreenshotManager';
import TradeStrategySelector from '../components/TradeStrategySelector';
import ExitReasonMultiSelect from '../components/ExitReasonMultiSelect';
import {
  addExit,
  addPyramid,
  deleteTradeScreenshotUpload,
  deleteExit,
  deletePyramid,
  fetchTrade,
  fetchTradeQuote,
  uploadTradeScreenshotFile,
  updateExit,
  updatePyramid,
  updateTrade
} from '../api/trades';
import { joinOptionList, normalizeOptionList } from '../utils/tradeOptions';

const inputClass = 'field-input';
const toInputDate = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');
const money = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const normalizeScreenshots = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item) => ({
      url: String(item?.url || '').trim(),
      key: String(item?.key || '').trim()
    }))
    .filter((item) => item.url);

const toggleOption = (current, option) => {
  const items = normalizeOptionList(current);
  return items.includes(option) ? items.filter((item) => item !== option) : [...items, option];
};

const validateScreenshotFiles = (files) => {
  const nextFiles = Array.from(files || []);
  if (!nextFiles.length) return '';
  if (nextFiles.some((file) => !file.type.startsWith('image/'))) return 'Please upload only image files';
  if (nextFiles.some((file) => file.size > 5 * 1024 * 1024)) return 'Each screenshot must be 5MB or smaller';
  return '';
};

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

  const [pyramidForm, setPyramidForm] = useState({ date: '', price: '', qty: '', stopLoss: '', screenshots: [] });
  const [exitForm, setExitForm] = useState({ exitDate: '', exitPrice: '', exitQty: '', exitReasons: [], notes: '' });
  const [entryForm, setEntryForm] = useState({
    entryDate: '',
    entryPrice: '',
    entryQty: '',
    stopLoss: '',
    strategy: [],
    pastTradeMarketComment: '',
    pastTradeGeneralComment: '',
    notes: '',
    screenshots: []
  });
  const [editPyramidForm, setEditPyramidForm] = useState({ date: '', price: '', qty: '', stopLoss: '', screenshots: [] });
  const [editExitForm, setEditExitForm] = useState({
    exitDate: '',
    exitPrice: '',
    exitQty: '',
    exitReasons: [],
    notes: ''
  });
  const [entryScreenshotFiles, setEntryScreenshotFiles] = useState([]);
  const [entryUploadError, setEntryUploadError] = useState('');
  const [pyramidScreenshotFiles, setPyramidScreenshotFiles] = useState([]);
  const [pyramidUploadError, setPyramidUploadError] = useState('');
  const [editPyramidScreenshotFiles, setEditPyramidScreenshotFiles] = useState([]);
  const [editPyramidUploadError, setEditPyramidUploadError] = useState('');
  const [detailScreenshotSaving, setDetailScreenshotSaving] = useState(false);

  const loadTrade = useCallback(async () => {
    try {
      const data = await fetchTrade(id);
      setTrade(data);
      setEntryForm({
        entryDate: toInputDate(data.entryDate),
        entryPrice: String(data.entryPrice ?? ''),
        entryQty: String(data.entryQty ?? ''),
        stopLoss: String(data.stopLoss ?? ''),
        strategy: normalizeOptionList(data.strategy),
        pastTradeMarketComment: data.pastTradeMarketComment || '',
        pastTradeGeneralComment: data.pastTradeGeneralComment || data.pastTradeComment || '',
        notes: data.notes || '',
        screenshots: normalizeScreenshots(data.screenshots)
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

    const uploadedScreenshots = [];
    try {
      if (pyramidScreenshotFiles.length) {
        for (const file of pyramidScreenshotFiles) {
          const uploaded = await uploadTradeScreenshotFile(file, `${id}-pyramid`);
          uploadedScreenshots.push(uploaded);
        }
      }

      const updated = await addPyramid(id, {
        date: pyramidForm.date,
        price: Number(pyramidForm.price),
        qty: Number(pyramidForm.qty),
        stopLoss: Number(pyramidForm.stopLoss),
        screenshots: [...normalizeScreenshots(pyramidForm.screenshots), ...uploadedScreenshots]
      });
      setTrade(updated);
      setShowPyramidModal(false);
      setPyramidForm({ date: '', price: '', qty: '', stopLoss: '', screenshots: [] });
      setPyramidScreenshotFiles([]);
      setPyramidUploadError('');
    } catch (err) {
      await Promise.all(uploadedScreenshots.map((item) => deleteTradeScreenshotUpload(item.key).catch(() => {})));
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
        exitReasons: exitForm.exitReasons,
        notes: exitForm.notes
      });
      setTrade(updated);
      setShowExitModal(false);
      setExitForm({ exitDate: '', exitPrice: '', exitQty: '', exitReasons: [], notes: '' });
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
      strategy: normalizeOptionList(trade.strategy),
      notes: trade.notes || '',
      screenshots: normalizeScreenshots(trade.screenshots)
    });
    setEntryScreenshotFiles([]);
    setEntryUploadError('');
    setShowEditEntryModal(true);
  };

  const handleEntryScreenshotChange = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const validationError = validateScreenshotFiles(files);
    if (validationError) {
      setEntryUploadError(validationError);
      return;
    }

    setEntryUploadError('');
    setEntryScreenshotFiles((prev) => [...prev, ...files]);
  };

  const updateTradeScreenshotDirectly = async ({ files = [], removeIndex = null } = {}) => {
    const uploadedScreenshots = [];
    setDetailScreenshotSaving(true);
    try {
      const payload = {
        screenshots: normalizeScreenshots(trade.screenshots)
      };

      if (files.length) {
        for (const file of files) {
          const uploaded = await uploadTradeScreenshotFile(file, id);
          uploadedScreenshots.push(uploaded);
        }
        payload.screenshots = [...payload.screenshots, ...uploadedScreenshots];
      } else if (removeIndex !== null) {
        payload.screenshots = payload.screenshots.filter((_, index) => index !== removeIndex);
      } else {
        return;
      }

      const updated = await updateTrade(id, payload);
      setTrade(updated);
      setEntryForm((prev) => ({
        ...prev,
        screenshots: normalizeScreenshots(updated.screenshots)
      }));
    } catch (err) {
      await Promise.all(uploadedScreenshots.map((item) => deleteTradeScreenshotUpload(item.key).catch(() => {})));
      alert(err.response?.data?.message || 'Failed to update screenshot');
    } finally {
      setDetailScreenshotSaving(false);
    }
  };

  const handleDetailScreenshotChange = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const validationError = validateScreenshotFiles(files);
    if (validationError) {
      alert(validationError);
      return;
    }

    await updateTradeScreenshotDirectly({ files });
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

    const uploadedScreenshots = [];
    try {
      const payload = {
        entryDate: entryForm.entryDate,
        entryPrice: Number(entryForm.entryPrice),
        entryQty: Number(entryForm.entryQty),
        stopLoss: Number(entryForm.stopLoss),
        strategy: joinOptionList(entryForm.strategy),
        pastTradeMarketComment: entryForm.pastTradeMarketComment,
        pastTradeGeneralComment: entryForm.pastTradeGeneralComment,
        notes: entryForm.notes,
        screenshots: normalizeScreenshots(entryForm.screenshots)
      };

      if (entryScreenshotFiles.length) {
        for (const file of entryScreenshotFiles) {
          const uploaded = await uploadTradeScreenshotFile(file, id);
          uploadedScreenshots.push(uploaded);
        }
        payload.screenshots = [...payload.screenshots, ...uploadedScreenshots];
      }

      const updated = await updateTrade(id, {
        ...payload
      });
      setTrade(updated);
      setShowEditEntryModal(false);
      setEntryScreenshotFiles([]);
      setEntryUploadError('');
    } catch (err) {
      await Promise.all(uploadedScreenshots.map((item) => deleteTradeScreenshotUpload(item.key).catch(() => {})));
      alert(err.response?.data?.message || 'Failed to update initial entry');
    }
  };

  const openEditPyramidModal = (pyramid) => {
    setEditingPyramidId(pyramid._id);
    setEditPyramidForm({
      date: toInputDate(pyramid.date),
      price: String(pyramid.price ?? ''),
      qty: String(pyramid.qty ?? ''),
      stopLoss: String(pyramid.stopLoss ?? ''),
      screenshots: normalizeScreenshots(pyramid.screenshots)
    });
    setEditPyramidScreenshotFiles([]);
    setEditPyramidUploadError('');
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
    const uploadedScreenshots = [];
    try {
      if (editPyramidScreenshotFiles.length) {
        for (const file of editPyramidScreenshotFiles) {
          const uploaded = await uploadTradeScreenshotFile(file, `${id}-${editingPyramidId}`);
          uploadedScreenshots.push(uploaded);
        }
      }

      const updated = await updatePyramid(id, editingPyramidId, {
        date: editPyramidForm.date,
        price: Number(editPyramidForm.price),
        qty: Number(editPyramidForm.qty),
        stopLoss: Number(editPyramidForm.stopLoss),
        screenshots: [...normalizeScreenshots(editPyramidForm.screenshots), ...uploadedScreenshots]
      });
      setTrade(updated);
      setShowEditPyramidModal(false);
      setEditingPyramidId('');
      setEditPyramidScreenshotFiles([]);
      setEditPyramidUploadError('');
    } catch (err) {
      await Promise.all(uploadedScreenshots.map((item) => deleteTradeScreenshotUpload(item.key).catch(() => {})));
      alert(err.response?.data?.message || 'Failed to update pyramid');
    }
  };

  const openEditExitModal = (exit) => {
    setEditingExitId(exit._id);
    setEditExitForm({
      exitDate: toInputDate(exit.exitDate),
      exitPrice: String(exit.exitPrice ?? ''),
      exitQty: String(exit.exitQty ?? ''),
      exitReasons: normalizeOptionList(exit.exitReasons),
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
        exitReasons: editExitForm.exitReasons,
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
          <div className="md:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-600 dark:text-slate-400">Screenshots</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="btn-muted cursor-pointer px-2 py-1 text-xs">
                  {detailScreenshotSaving ? 'Uploading...' : 'Add Screenshots'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    onChange={handleDetailScreenshotChange}
                    disabled={detailScreenshotSaving}
                  />
                </label>
              </div>
            </div>
            {(trade.screenshots || []).length ? (
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                {trade.screenshots.map((item, index) => (
                  <div key={item.key || item.url || index} className="space-y-2 rounded-md border border-slate-300 p-2 dark:border-slate-700">
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <img
                        src={item.url}
                        alt={`${trade.symbol} trade screenshot ${index + 1}`}
                        className="max-h-[20rem] w-full rounded-md object-contain"
                      />
                    </a>
                    <button
                      type="button"
                      className="btn-danger px-2 py-1 text-xs"
                      onClick={() => updateTradeScreenshotDirectly({ removeIndex: index })}
                      disabled={detailScreenshotSaving}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm font-medium">No screenshots uploaded.</p>
            )}
          </div>
        </div>
      </section>

      <section className="surface-card p-4">
        <h2 className="text-lg font-semibold">Pyramids</h2>
        <div className="mt-3 space-y-2">
          {(trade.pyramids || []).map((p) => (
            <div key={p._id} className="table-row-hover space-y-3 rounded-md p-3">
              <div className="flex items-center justify-between gap-2">
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
              {(p.screenshots || []).length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {p.screenshots.map((item, index) => (
                    <a key={item.key || item.url || index} href={item.url} target="_blank" rel="noreferrer">
                      <img
                        src={item.url}
                        alt={`Pyramid screenshot ${index + 1}`}
                        className="max-h-56 w-full rounded-md border border-slate-300 object-contain dark:border-slate-700"
                      />
                    </a>
                  ))}
                </div>
              ) : null}
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
                {normalizeOptionList(exit.exitReasons).length ? `| Reasons: ${normalizeOptionList(exit.exitReasons).join(', ')} ` : ''}
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
          <ScreenshotManager
            label="Pyramid Screenshots (optional)"
            existingScreenshots={pyramidForm.screenshots}
            pendingFiles={pyramidScreenshotFiles}
            error={pyramidUploadError}
            inputId="add-pyramid-screenshots"
            onFilesSelected={(event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = '';
              const validationError = validateScreenshotFiles(files);
              if (validationError) {
                setPyramidUploadError(validationError);
                return;
              }
              setPyramidUploadError('');
              setPyramidScreenshotFiles((prev) => [...prev, ...files]);
            }}
            onRemoveExisting={(index) =>
              setPyramidForm((prev) => ({
                ...prev,
                screenshots: prev.screenshots.filter((_, itemIndex) => itemIndex !== index)
              }))
            }
            onRemovePending={(index) =>
              setPyramidScreenshotFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
            }
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
          <ExitReasonMultiSelect
            value={exitForm.exitReasons}
            onToggle={(option) => setExitForm((prev) => ({ ...prev, exitReasons: toggleOption(prev.exitReasons, option) }))}
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
          <TradeStrategySelector
            value={entryForm.strategy}
            onToggle={(option) => setEntryForm((prev) => ({ ...prev, strategy: toggleOption(prev.strategy, option) }))}
          />
          <textarea
            placeholder="Past Trade Market Comment (optional)"
            className={inputClass}
            value={entryForm.pastTradeMarketComment}
            onChange={(e) => setEntryForm((prev) => ({ ...prev, pastTradeMarketComment: e.target.value }))}
          />
          <textarea
            placeholder="Past Trade General Comment (optional)"
            className={inputClass}
            value={entryForm.pastTradeGeneralComment}
            onChange={(e) => setEntryForm((prev) => ({ ...prev, pastTradeGeneralComment: e.target.value }))}
          />
          <textarea
            placeholder="Notes (optional)"
            className={inputClass}
            value={entryForm.notes}
            onChange={(e) => setEntryForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
          <ScreenshotManager
            label="Trade Screenshots"
            existingScreenshots={entryForm.screenshots}
            pendingFiles={entryScreenshotFiles}
            error={entryUploadError}
            inputId="edit-entry-screenshots"
            onFilesSelected={handleEntryScreenshotChange}
            onRemoveExisting={(index) =>
              setEntryForm((prev) => ({
                ...prev,
                screenshots: prev.screenshots.filter((_, itemIndex) => itemIndex !== index)
              }))
            }
            onRemovePending={(index) =>
              setEntryScreenshotFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
            }
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
          <ScreenshotManager
            label="Pyramid Screenshots"
            existingScreenshots={editPyramidForm.screenshots}
            pendingFiles={editPyramidScreenshotFiles}
            error={editPyramidUploadError}
            inputId="edit-pyramid-screenshots"
            onFilesSelected={(event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = '';
              const validationError = validateScreenshotFiles(files);
              if (validationError) {
                setEditPyramidUploadError(validationError);
                return;
              }
              setEditPyramidUploadError('');
              setEditPyramidScreenshotFiles((prev) => [...prev, ...files]);
            }}
            onRemoveExisting={(index) =>
              setEditPyramidForm((prev) => ({
                ...prev,
                screenshots: prev.screenshots.filter((_, itemIndex) => itemIndex !== index)
              }))
            }
            onRemovePending={(index) =>
              setEditPyramidScreenshotFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
            }
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
          <ExitReasonMultiSelect
            value={editExitForm.exitReasons}
            onToggle={(option) =>
              setEditExitForm((prev) => ({ ...prev, exitReasons: toggleOption(prev.exitReasons, option) }))
            }
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
