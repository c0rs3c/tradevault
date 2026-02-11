import { useEffect, useMemo, useState } from 'react';
import {
  deleteTradeImport,
  fetchTradeImport,
  fetchTradeImports,
  importDhanTrades,
  importZerodhaTrades
} from '../api/trades';

const formatDateTime = (value) => {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleString();
};

const parseCsvText = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };

  const pushRow = () => {
    if (row.length === 1 && row[0] === '') {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === ',') {
      pushCell();
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      pushCell();
      pushRow();
      continue;
    }

    cell += ch;
  }

  pushCell();
  if (row.length) pushRow();

  return rows;
};

const parseDelimitedRows = (text) => {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  if (raw.includes('\t')) {
    return raw
      .split(/\r?\n/)
      .map((line) => line.split('\t'))
      .filter((cells) => cells.some((cell) => String(cell || '').trim()));
  }
  return parseCsvText(raw).filter((cells) => cells.some((cell) => String(cell || '').trim()));
};

const normalizeHeader = (header) =>
  String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const findHeaderIndex = (headers, candidates) => {
  const normalized = headers.map(normalizeHeader);
  const candidateSet = new Set(candidates.map(normalizeHeader));
  return normalized.findIndex((h) => candidateSet.has(h));
};

const toDateMillis = (value) => {
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? 0 : dt.getTime();
};

const parsePreviewRows = (text, source) => {
  const rows = parseDelimitedRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0];

  if (source === 'ZERODHA') {
    const symbolIdx = findHeaderIndex(headers, ['symbol', 'tradingsymbol', 'trading symbol']);
    const sideIdx = findHeaderIndex(headers, ['trade type', 'type', 'buy/sell', 'transaction type', 'side']);
    const qtyIdx = findHeaderIndex(headers, ['quantity', 'qty', 'filled quantity', 'executed quantity']);
    const priceIdx = findHeaderIndex(headers, ['price', 'trade price', 'average price', 'avg price']);
    const execTimeIdx = findHeaderIndex(headers, ['order execution time', 'execution time', 'time', 'timestamp']);
    const dateIdx = findHeaderIndex(headers, ['trade date', 'trade_date', 'date']);

    return rows.slice(1).map((row, i) => {
      const dateText = execTimeIdx >= 0 ? row[execTimeIdx] : row[dateIdx] || '';
      return {
        id: `z-${i}`,
        symbol: String(row[symbolIdx] || '').trim().toUpperCase(),
        side: String(row[sideIdx] || '').trim().toUpperCase(),
        qty: String(row[qtyIdx] || '').trim(),
        price: String(row[priceIdx] || '').trim(),
        status: '-',
        dateText: String(dateText || '').trim(),
        dateMs: toDateMillis(dateText)
      };
    });
  }

  const symbolIdx = findHeaderIndex(headers, ['name', 'symbol', 'security']);
  const sideIdx = findHeaderIndex(headers, ['buy/sell', 'side', 'transaction type']);
  const qtyIdx = findHeaderIndex(headers, ['quantity/lot', 'quantity', 'qty']);
  const priceIdx = findHeaderIndex(headers, ['trade price', 'price']);
  const dateIdx = findHeaderIndex(headers, ['date', 'trade date']);
  const timeIdx = findHeaderIndex(headers, ['time', 'trade time']);
  const statusIdx = findHeaderIndex(headers, ['status']);

  return rows.slice(1).map((row, i) => {
    const dateText = String(row[dateIdx] || '').trim();
    const timeText = timeIdx >= 0 ? String(row[timeIdx] || '').trim() : '';
    const stamp = `${dateText}${timeText ? ` ${timeText}` : ''}`.trim();
    return {
      id: `d-${i}`,
      symbol: String(row[symbolIdx] || '').trim().toUpperCase(),
      side: String(row[sideIdx] || '').trim().toUpperCase(),
      qty: String(row[qtyIdx] || '').trim(),
      price: String(row[priceIdx] || '').trim(),
      status: String(row[statusIdx] || '').trim().toUpperCase() || '-',
      dateText: stamp,
      dateMs: toDateMillis(stamp)
    };
  });
};

const getFilteredRows = (rows, filters) => {
  let next = [...rows];
  if (filters.search.trim()) {
    const query = filters.search.trim().toUpperCase();
    next = next.filter((row) => row.symbol.includes(query));
  }
  if (filters.side !== 'ALL') {
    next = next.filter((row) => row.side === filters.side);
  }
  if (filters.status !== 'ALL') {
    next = next.filter((row) => row.status === filters.status);
  }
  next.sort((a, b) => {
    if (filters.sortBy === 'dateAsc') return a.dateMs - b.dateMs;
    if (filters.sortBy === 'dateDesc') return b.dateMs - a.dateMs;
    return a.symbol.localeCompare(b.symbol);
  });
  return next;
};

const initialFilters = { search: '', side: 'ALL', status: 'ALL', sortBy: 'dateAsc' };

const ImportTradesPage = () => {
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [dhanFileName, setDhanFileName] = useState('');
  const [dhanCsvText, setDhanCsvText] = useState('');
  const [zerodhaFilters, setZerodhaFilters] = useState(initialFilters);
  const [dhanFilters, setDhanFilters] = useState(initialFilters);
  const [submittingZerodha, setSubmittingZerodha] = useState(false);
  const [submittingDhan, setSubmittingDhan] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [imports, setImports] = useState([]);
  const [loadingImports, setLoadingImports] = useState(true);
  const [deletingImportId, setDeletingImportId] = useState('');
  const [viewingImportId, setViewingImportId] = useState('');
  const [viewingImport, setViewingImport] = useState(null);
  const [loadingViewingImport, setLoadingViewingImport] = useState(false);
  const [historyFilters, setHistoryFilters] = useState(initialFilters);

  const loadImports = async () => {
    try {
      const data = await fetchTradeImports();
      setImports(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load imports');
    } finally {
      setLoadingImports(false);
    }
  };

  useEffect(() => {
    loadImports();
  }, []);

  const zerodhaRows = useMemo(() => parsePreviewRows(csvText, 'ZERODHA'), [csvText]);
  const dhanRows = useMemo(() => parsePreviewRows(dhanCsvText, 'DHAN'), [dhanCsvText]);
  const filteredZerodhaRows = useMemo(
    () => getFilteredRows(zerodhaRows, zerodhaFilters),
    [zerodhaRows, zerodhaFilters]
  );
  const filteredDhanRows = useMemo(() => getFilteredRows(dhanRows, dhanFilters), [dhanRows, dhanFilters]);

  const zerodhaStatuses = useMemo(
    () => [...new Set(zerodhaRows.map((row) => row.status).filter((s) => s && s !== '-'))],
    [zerodhaRows]
  );
  const dhanStatuses = useMemo(
    () => [...new Set(dhanRows.map((row) => row.status).filter((s) => s && s !== '-'))],
    [dhanRows]
  );

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    setError('');
    if (!file) {
      setFileName('');
      setCsvText('');
      return;
    }

    setFileName(file.name);
    try {
      const text = await file.text();
      setCsvText(text);
      setZerodhaFilters(initialFilters);
    } catch {
      setError('Failed to read file');
      setCsvText('');
    }
  };

  const handleImport = async (event) => {
    event.preventDefault();
    if (!csvText.trim()) {
      setError('Please select a Zerodha tradebook CSV file');
      return;
    }

    setSubmittingZerodha(true);
    setError('');
    setSuccess('');
    try {
      const result = await importZerodhaTrades(csvText, fileName);
      setSuccess(`Imported ${result.importedCount} trade(s) from ${fileName || 'CSV file'}`);
      setCsvText('');
      setFileName('');
      setZerodhaFilters(initialFilters);
      await loadImports();
    } catch (err) {
      setError(err.response?.data?.message || 'Import failed');
    } finally {
      setSubmittingZerodha(false);
    }
  };

  const handleDhanFileChange = async (event) => {
    const file = event.target.files?.[0];
    setError('');
    if (!file) {
      setDhanFileName('');
      setDhanCsvText('');
      return;
    }

    setDhanFileName(file.name);
    try {
      const text = await file.text();
      setDhanCsvText(text);
      setDhanFilters(initialFilters);
    } catch {
      setError('Failed to read Dhan file');
      setDhanCsvText('');
    }
  };

  const handleDhanImport = async (event) => {
    event.preventDefault();
    if (!dhanCsvText.trim()) {
      setError('Please select a Dhan tradebook file');
      return;
    }

    setSubmittingDhan(true);
    setError('');
    setSuccess('');
    try {
      const result = await importDhanTrades(dhanCsvText, dhanFileName || 'Dhan Tradebook');
      setSuccess(`Imported ${result.importedCount} trade(s) from ${dhanFileName || 'Dhan tradebook'}`);
      setDhanCsvText('');
      setDhanFileName('');
      setDhanFilters(initialFilters);
      await loadImports();
    } catch (err) {
      setError(err.response?.data?.message || 'Dhan import failed');
    } finally {
      setSubmittingDhan(false);
    }
  };

  const handleDeleteImport = async (importId) => {
    const confirmed = window.confirm('Delete this import and all trades created by it?');
    if (!confirmed) return;

    setError('');
    setSuccess('');
    setDeletingImportId(importId);
    try {
      const result = await deleteTradeImport(importId);
      setSuccess(`Deleted import and removed ${result.deletedTrades} trade(s).`);
      setImports((prev) => prev.filter((item) => item._id !== importId));
      if (viewingImportId === importId) {
        setViewingImportId('');
        setViewingImport(null);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete import');
    } finally {
      setDeletingImportId('');
    }
  };

  const handleViewImport = async (importId) => {
    if (viewingImportId === importId) {
      setViewingImportId('');
      setViewingImport(null);
      return;
    }
    setLoadingViewingImport(true);
    setError('');
    try {
      const data = await fetchTradeImport(importId);
      const rows = (data.previewRows || []).map((row, i) => ({
        id: `h-${importId}-${i}`,
        symbol: row.symbol || '',
        side: row.side || '',
        dateText: row.dateText || '',
        qty: row.qty || '',
        price: row.price || '',
        status: row.status || '-',
        dateMs: toDateMillis(row.dateText)
      }));
      setViewingImportId(importId);
      setViewingImport({ ...data, rows });
      setHistoryFilters(initialFilters);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load import preview');
    } finally {
      setLoadingViewingImport(false);
    }
  };

  const historyStatuses = useMemo(
    () => [...new Set((viewingImport?.rows || []).map((row) => row.status).filter((s) => s && s !== '-'))],
    [viewingImport]
  );
  const filteredHistoryRows = useMemo(
    () => getFilteredRows(viewingImport?.rows || [], historyFilters),
    [viewingImport, historyFilters]
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Import Trades</h1>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {success && <p className="text-sm text-emerald-700 dark:text-emerald-300">{success}</p>}

      <div className="grid gap-4 xl:grid-cols-2">
        <form onSubmit={handleImport} className="surface-card space-y-4 p-5">
          <h2 className="text-lg font-semibold">Zerodha Import</h2>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Upload Zerodha tradebook CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="field-input file:mr-4 file:rounded-md file:border-0 file:bg-slate-200 dark:file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 dark:file:text-slate-100 hover:file:bg-slate-300 dark:hover:file:bg-slate-700"
              onChange={handleFileChange}
            />
            {fileName && <p className="text-xs text-slate-600 dark:text-slate-400">Selected: {fileName}</p>}
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Required columns: symbol, trade_type (buy/sell), quantity, price, and either order_execution_time or trade_date.
            </p>
          </label>

          {!!zerodhaRows.length && (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-4">
                <input
                  className="field-input py-1.5 text-sm"
                  placeholder="Filter symbol"
                  value={zerodhaFilters.search}
                  onChange={(e) => setZerodhaFilters((prev) => ({ ...prev, search: e.target.value }))}
                />
                <select
                  className="field-input py-1.5 text-sm"
                  value={zerodhaFilters.side}
                  onChange={(e) => setZerodhaFilters((prev) => ({ ...prev, side: e.target.value }))}
                >
                  <option value="ALL">All Sides</option>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
                <select
                  className="field-input py-1.5 text-sm"
                  value={zerodhaFilters.status}
                  onChange={(e) => setZerodhaFilters((prev) => ({ ...prev, status: e.target.value }))}
                >
                  <option value="ALL">All Status</option>
                  {zerodhaStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <select
                  className="field-input py-1.5 text-sm"
                  value={zerodhaFilters.sortBy}
                  onChange={(e) => setZerodhaFilters((prev) => ({ ...prev, sortBy: e.target.value }))}
                >
                  <option value="dateAsc">Date (Oldest)</option>
                  <option value="dateDesc">Date (Newest)</option>
                  <option value="symbolAsc">Symbol (A-Z)</option>
                </select>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Preview: {filteredZerodhaRows.length} / {zerodhaRows.length} rows
              </p>
              <div className="max-h-72 overflow-auto rounded border border-slate-200 dark:border-slate-800">
                <table className="min-w-full text-left text-xs">
                  <thead className="table-head">
                    <tr>
                      <th className="px-2 py-1.5">Symbol</th>
                      <th className="px-2 py-1.5">Side</th>
                      <th className="px-2 py-1.5">Date/Time</th>
                      <th className="px-2 py-1.5">Qty</th>
                      <th className="px-2 py-1.5">Price</th>
                      <th className="px-2 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredZerodhaRows.slice(0, 500).map((row) => (
                      <tr key={row.id} className="table-row-hover">
                        <td className="px-2 py-1.5">{row.symbol || '-'}</td>
                        <td className="px-2 py-1.5">{row.side || '-'}</td>
                        <td className="px-2 py-1.5">{row.dateText || '-'}</td>
                        <td className="px-2 py-1.5">{row.qty || '-'}</td>
                        <td className="px-2 py-1.5">{row.price || '-'}</td>
                        <td className="px-2 py-1.5">{row.status || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <button type="submit" disabled={submittingZerodha} className="btn-primary px-4 py-2">
            {submittingZerodha ? 'Importing...' : 'Import Zerodha Trades'}
          </button>
        </form>

        <form onSubmit={handleDhanImport} className="surface-card space-y-4 p-5">
          <h2 className="text-lg font-semibold">Dhan Import</h2>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Upload Dhan tradebook file</span>
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              className="field-input file:mr-4 file:rounded-md file:border-0 file:bg-slate-200 dark:file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 dark:file:text-slate-100 hover:file:bg-slate-300 dark:hover:file:bg-slate-700"
              onChange={handleDhanFileChange}
            />
            {dhanFileName && <p className="text-xs text-slate-600 dark:text-slate-400">Selected: {dhanFileName}</p>}
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Required columns: Date, Name, Buy/Sell, Quantity/Lot, Trade Price. Supports tab-separated Dhan export. Only rows with Status = Traded are imported.
            </p>
          </label>

          {!!dhanRows.length && (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-4">
                <input
                  className="field-input py-1.5 text-sm"
                  placeholder="Filter symbol"
                  value={dhanFilters.search}
                  onChange={(e) => setDhanFilters((prev) => ({ ...prev, search: e.target.value }))}
                />
                <select
                  className="field-input py-1.5 text-sm"
                  value={dhanFilters.side}
                  onChange={(e) => setDhanFilters((prev) => ({ ...prev, side: e.target.value }))}
                >
                  <option value="ALL">All Sides</option>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
                <select
                  className="field-input py-1.5 text-sm"
                  value={dhanFilters.status}
                  onChange={(e) => setDhanFilters((prev) => ({ ...prev, status: e.target.value }))}
                >
                  <option value="ALL">All Status</option>
                  {dhanStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <select
                  className="field-input py-1.5 text-sm"
                  value={dhanFilters.sortBy}
                  onChange={(e) => setDhanFilters((prev) => ({ ...prev, sortBy: e.target.value }))}
                >
                  <option value="dateAsc">Date (Oldest)</option>
                  <option value="dateDesc">Date (Newest)</option>
                  <option value="symbolAsc">Symbol (A-Z)</option>
                </select>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Preview: {filteredDhanRows.length} / {dhanRows.length} rows
              </p>
              <div className="max-h-72 overflow-auto rounded border border-slate-200 dark:border-slate-800">
                <table className="min-w-full text-left text-xs">
                  <thead className="table-head">
                    <tr>
                      <th className="px-2 py-1.5">Symbol</th>
                      <th className="px-2 py-1.5">Side</th>
                      <th className="px-2 py-1.5">Date/Time</th>
                      <th className="px-2 py-1.5">Qty</th>
                      <th className="px-2 py-1.5">Price</th>
                      <th className="px-2 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDhanRows.slice(0, 500).map((row) => (
                      <tr key={row.id} className="table-row-hover">
                        <td className="px-2 py-1.5">{row.symbol || '-'}</td>
                        <td className="px-2 py-1.5">{row.side || '-'}</td>
                        <td className="px-2 py-1.5">{row.dateText || '-'}</td>
                        <td className="px-2 py-1.5">{row.qty || '-'}</td>
                        <td className="px-2 py-1.5">{row.price || '-'}</td>
                        <td className="px-2 py-1.5">{row.status || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <button type="submit" disabled={submittingDhan} className="btn-primary px-4 py-2">
            {submittingDhan ? 'Importing...' : 'Import Dhan Trades'}
          </button>
        </form>
      </div>

      <section className="surface-card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Import History</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {imports.length} import{imports.length === 1 ? '' : 's'}
          </span>
        </div>

        {loadingImports ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">Loading imports...</p>
        ) : imports.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Source File</th>
                  <th className="px-3 py-2">Imported</th>
                  <th className="px-3 py-2">Current Trades</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((item) => (
                  <tr key={item._id} className="table-row-hover">
                    <td className="px-3 py-2">{formatDateTime(item.createdAt)}</td>
                    <td className="px-3 py-2">{item.source}</td>
                    <td className="px-3 py-2">{item.fileName || '-'}</td>
                    <td className="px-3 py-2">{item.importedCount}</td>
                    <td className="px-3 py-2">{item.tradesCount}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="btn-muted px-2.5 py-1.5 text-xs"
                          onClick={() => handleViewImport(item._id)}
                          disabled={loadingViewingImport}
                        >
                          {viewingImportId === item._id ? 'Hide' : 'View'}
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950/30"
                          onClick={() => handleDeleteImport(item._id)}
                          disabled={deletingImportId === item._id}
                        >
                          {deletingImportId === item._id ? 'Deleting...' : 'Delete Import'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">No imports yet.</p>
        )}
      </section>

      {loadingViewingImport && (
        <section className="surface-card p-5">
          <p className="text-sm text-slate-600 dark:text-slate-300">Loading import preview...</p>
        </section>
      )}

      {!loadingViewingImport && viewingImport && (
        <section className="surface-card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              File Viewer: {viewingImport.fileName || `${viewingImport.source} Tradebook`}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {filteredHistoryRows.length} / {viewingImport.rows.length} rows
            </span>
          </div>
          {!viewingImport.rows.length ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Preview unavailable for this import. It may have been imported before viewer support.
            </p>
          ) : (
            <>
              <div className="grid gap-2 md:grid-cols-4">
                <input
                  className="field-input py-1.5 text-sm"
                  placeholder="Filter symbol"
                  value={historyFilters.search}
                  onChange={(e) => setHistoryFilters((prev) => ({ ...prev, search: e.target.value }))}
                />
                <select
                  className="field-input py-1.5 text-sm"
                  value={historyFilters.side}
                  onChange={(e) => setHistoryFilters((prev) => ({ ...prev, side: e.target.value }))}
                >
                  <option value="ALL">All Sides</option>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
                <select
                  className="field-input py-1.5 text-sm"
                  value={historyFilters.status}
                  onChange={(e) => setHistoryFilters((prev) => ({ ...prev, status: e.target.value }))}
                >
                  <option value="ALL">All Status</option>
                  {historyStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <select
                  className="field-input py-1.5 text-sm"
                  value={historyFilters.sortBy}
                  onChange={(e) => setHistoryFilters((prev) => ({ ...prev, sortBy: e.target.value }))}
                >
                  <option value="dateAsc">Date (Oldest)</option>
                  <option value="dateDesc">Date (Newest)</option>
                  <option value="symbolAsc">Symbol (A-Z)</option>
                </select>
              </div>
              <div className="max-h-[60vh] overflow-auto rounded border border-slate-200 dark:border-slate-800">
                <table className="min-w-full text-left text-xs">
                  <thead className="table-head">
                    <tr>
                      <th className="px-2 py-1.5">Symbol</th>
                      <th className="px-2 py-1.5">Side</th>
                      <th className="px-2 py-1.5">Date/Time</th>
                      <th className="px-2 py-1.5">Qty</th>
                      <th className="px-2 py-1.5">Price</th>
                      <th className="px-2 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistoryRows.map((row) => (
                      <tr key={row.id} className="table-row-hover">
                        <td className="px-2 py-1.5">{row.symbol || '-'}</td>
                        <td className="px-2 py-1.5">{row.side || '-'}</td>
                        <td className="px-2 py-1.5">{row.dateText || '-'}</td>
                        <td className="px-2 py-1.5">{row.qty || '-'}</td>
                        <td className="px-2 py-1.5">{row.price || '-'}</td>
                        <td className="px-2 py-1.5">{row.status || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
};

export default ImportTradesPage;
