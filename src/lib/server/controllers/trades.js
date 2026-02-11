import Trade from '../models/Trade';
import Settings from '../models/Settings';
import ImportBatch from '../models/ImportBatch';
import { calcTradeMetrics, buildDashboardAnalytics } from '../utils/calculations';
import { fetchSymbolQuote } from '../services/marketData';
import { parseCsv } from '../utils/csv';

const LIST_CACHE_TTL_MS = 15000;
const DEFAULT_STOP_LOSS_PCT = 0.03;
const queryCache = {
  trades: { until: 0, data: null },
  dashboard: { until: 0, data: null }
};

const invalidateTradeCaches = () => {
  queryCache.trades.until = 0;
  queryCache.trades.data = null;
  queryCache.dashboard.until = 0;
  queryCache.dashboard.data = null;
};

const normalizeHeader = (header) =>
  String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const findHeaderIndex = (headers, candidates) => {
  const normalized = headers.map(normalizeHeader);
  const normalizedCandidates = candidates.map(normalizeHeader);
  return normalized.findIndex((h) => normalizedCandidates.includes(h));
};

const toSafeNumber = (value) => {
  const num = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : NaN;
};

const toDate = (value) => {
  if (!value) return null;
  const str = String(value).trim();

  const ddmmyySlash = str.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (ddmmyySlash) {
    const [, dd, mm, yy] = ddmmyySlash;
    const year = Number(yy) >= 70 ? `19${yy}` : `20${yy}`;
    const manual = new Date(`${year}-${mm}-${dd}T00:00:00.000Z`);
    if (!Number.isNaN(manual.getTime())) return manual;
  }

  const ddmmyyyySlash = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyySlash) {
    const [, dd, mm, yyyy] = ddmmyyyySlash;
    const manual = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
    if (!Number.isNaN(manual.getTime())) return manual;
  }

  const ddmmyyyy = str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const manual = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
    if (!Number.isNaN(manual.getTime())) return manual;
  }

  const ddmmyyDash = str.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (ddmmyyDash) {
    const [, dd, mm, yy] = ddmmyyDash;
    const year = Number(yy) >= 70 ? `19${yy}` : `20${yy}`;
    const manual = new Date(`${year}-${mm}-${dd}T00:00:00.000Z`);
    if (!Number.isNaN(manual.getTime())) return manual;
  }

  const ddmmyyyyTime = str.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (ddmmyyyyTime) {
    const [, dd, mm, yyyy, hh, mi, ss] = ddmmyyyyTime;
    const manual = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}.000Z`);
    if (!Number.isNaN(manual.getTime())) return manual;
  }

  const ddmmyyTime = str.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (ddmmyyTime) {
    const [, dd, mm, yy, hh, mi, ss] = ddmmyyTime;
    const year = Number(yy) >= 70 ? `19${yy}` : `20${yy}`;
    const manual = new Date(`${year}-${mm}-${dd}T${hh}:${mi}:${ss}.000Z`);
    if (!Number.isNaN(manual.getTime())) return manual;
  }

  const ymdTime = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (ymdTime) {
    const [, yyyy, mm, dd, hh, mi, ss = '00'] = ymdTime;
    const manual = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}.000Z`);
    if (!Number.isNaN(manual.getTime())) return manual;
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  return null;
};

const withDefaultStopLoss = ({ entryPrice, side, stopLoss }) => {
  const price = Number(entryPrice || 0);
  const currentStopLoss = Number(stopLoss || 0);
  if (currentStopLoss > 0) return currentStopLoss;
  if (price <= 0) return currentStopLoss;
  const multiplier = String(side || 'LONG').toUpperCase() === 'SHORT'
    ? 1 + DEFAULT_STOP_LOSS_PCT
    : 1 - DEFAULT_STOP_LOSS_PCT;
  return Number((price * multiplier).toFixed(4));
};

const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getTotalCapital = async () => {
  const settings = await Settings.findOne();
  return settings?.totalCapital || 0;
};

const toPreviewRows = (rows, source) =>
  rows.slice(0, 5000).map((row) => ({
    symbol: String(row.symbol || '').trim().toUpperCase(),
    side: String(row.side || '').trim().toUpperCase(),
    dateText: row.executionTime instanceof Date ? row.executionTime.toISOString() : String(row.executionTime || ''),
    qty: String(row.qty ?? ''),
    price: String(row.price ?? ''),
    status: source === 'DHAN' ? String(row.status || '').trim().toUpperCase() || '-' : '-'
  }));

const withMetrics = (tradeDoc, totalCapital) => {
  const trade = tradeDoc.toObject ? tradeDoc.toObject() : tradeDoc;
  return {
    ...trade,
    metrics: calcTradeMetrics(trade, totalCapital)
  };
};

const validateExitQty = (trade, nextExitQty, existingExitId = null) => {
  const exits = trade.exits || [];
  const existingQty = exits.reduce((acc, exit) => {
    if (existingExitId && String(exit._id) === String(existingExitId)) return acc;
    return acc + Number(exit.exitQty || 0);
  }, 0);

  const totalEntryQty =
    Number(trade.entryQty || 0) +
    (trade.pyramids || []).reduce((acc, pyramid) => acc + Number(pyramid.qty || 0), 0);

  const attempted = existingQty + Number(nextExitQty || 0);

  if (attempted > totalEntryQty + 1e-9) {
    throw createError('Exit quantity exceeds current open position quantity', 400);
  }
};

const getTotalEntryQty = (trade) =>
  Number(trade.entryQty || 0) +
  (trade.pyramids || []).reduce((acc, pyramid) => acc + Number(pyramid.qty || 0), 0);

const getTotalExitQty = (trade) =>
  (trade.exits || []).reduce((acc, exit) => acc + Number(exit.exitQty || 0), 0);

const validatePositionSize = (trade) => {
  const totalEntryQty = getTotalEntryQty(trade);
  const totalExitQty = getTotalExitQty(trade);
  if (totalExitQty > totalEntryQty + 1e-9) {
    throw createError('Total exited quantity cannot exceed total position quantity', 400);
  }
};

const buildOpenStateFromExistingTrades = (trades) => {
  const openState = new Map();

  const ensureSymbolState = (symbol) => {
    if (!openState.has(symbol)) {
      openState.set(symbol, { long: [], short: [] });
    }
    return openState.get(symbol);
  };

  trades.forEach((trade) => {
    const totalEntryQty =
      Number(trade.entryQty || 0) +
      (trade.pyramids || []).reduce((acc, pyramid) => acc + Number(pyramid.qty || 0), 0);
    const totalExitQty = (trade.exits || []).reduce((acc, exit) => acc + Number(exit.exitQty || 0), 0);
    const remainingQty = totalEntryQty - totalExitQty;
    if (remainingQty <= 1e-9) return;

    const state = ensureSymbolState(trade.symbol);
    const queue = trade.side === 'SHORT' ? state.short : state.long;
    queue.push({
      existingTrade: trade,
      remainingQty
    });
  });

  return openState;
};

const parseDelimitedRows = (text) => {
  const raw = String(text || '');
  if (raw.includes('\t')) {
    return raw
      .split(/\r?\n/)
      .map((line) => line.split('\t'))
      .filter((cells) => cells.some((cell) => String(cell || '').trim()));
  }
  return parseCsv(raw).filter((r) => r.some((cell) => String(cell || '').trim()));
};

const buildTradesFromOrderEvents = (
  orderEvents,
  sourceLabel,
  sourceTag,
  { allowShort = true, initialOpenState = new Map() } = {}
) => {
  const payloads = [];
  const openTradesBySymbol = new Map();
  let skippedUnmatchedSellQty = 0;
  const touchedExistingTrades = new Set();

  for (const event of orderEvents) {
    if (!openTradesBySymbol.has(event.symbol)) {
      const seeded = initialOpenState.get(event.symbol);
      openTradesBySymbol.set(event.symbol, {
        long: seeded ? [...seeded.long] : [],
        short: seeded ? [...seeded.short] : []
      });
    }

    const state = openTradesBySymbol.get(event.symbol);
    const isBuy = event.side === 'BUY';

    // BUY always closes shorts first (if any), then opens/increases LONG.
    if (isBuy) {
      let remainingQty = event.qty;
      while (remainingQty > 0 && state.short.length > 0) {
        const openTrade = state.short[0];
        const closeQty = Math.min(remainingQty, openTrade.remainingQty);
        const exitPayload = {
          exitDate: event.executionTime,
          exitPrice: event.avgPrice,
          exitQty: closeQty,
          notes: `Imported from ${sourceLabel} (${event.importRef})`
        };
        if (openTrade.existingTrade) {
          openTrade.existingTrade.exits.push(exitPayload);
          touchedExistingTrades.add(openTrade.existingTrade);
        } else {
          openTrade.payload.exits.push(exitPayload);
        }
        openTrade.remainingQty -= closeQty;
        remainingQty -= closeQty;
        if (openTrade.remainingQty <= 1e-9) {
          state.short.shift();
        }
      }

      if (remainingQty > 0) {
        const payload = {
          symbol: event.symbol,
          side: 'LONG',
          entryDate: event.executionTime,
          entryPrice: event.avgPrice,
          entryQty: remainingQty,
          stopLoss: withDefaultStopLoss({ entryPrice: event.avgPrice, side: 'LONG' }),
          pyramids: [],
          exits: [],
          strategy: `${sourceLabel} Import`,
          notes: `Auto-imported from ${sourceLabel} trade log (${event.importRef})`,
          tags: [sourceTag]
        };
        payloads.push(payload);
        state.long.push({ payload, remainingQty });
      }
      continue;
    }

    let remainingQty = event.qty;
    while (remainingQty > 0 && state.long.length > 0) {
      const openTrade = state.long[0];
      const closeQty = Math.min(remainingQty, openTrade.remainingQty);
      const exitPayload = {
        exitDate: event.executionTime,
        exitPrice: event.avgPrice,
        exitQty: closeQty,
        notes: `Imported from ${sourceLabel} (${event.importRef})`
      };
      if (openTrade.existingTrade) {
        openTrade.existingTrade.exits.push(exitPayload);
        touchedExistingTrades.add(openTrade.existingTrade);
      } else {
        openTrade.payload.exits.push(exitPayload);
      }
      openTrade.remainingQty -= closeQty;
      remainingQty -= closeQty;
      if (openTrade.remainingQty <= 1e-9) {
        state.long.shift();
      }
    }

    if (remainingQty > 0) {
      if (!allowShort) {
        skippedUnmatchedSellQty += remainingQty;
        continue;
      }

      const payload = {
        symbol: event.symbol,
        side: 'SHORT',
        entryDate: event.executionTime,
        entryPrice: event.avgPrice,
        entryQty: remainingQty,
        stopLoss: withDefaultStopLoss({ entryPrice: event.avgPrice, side: 'SHORT' }),
        pyramids: [],
        exits: [],
        strategy: `${sourceLabel} Import`,
        notes: `Auto-imported from ${sourceLabel} trade log (${event.importRef})`,
        tags: [sourceTag]
      };
      payloads.push(payload);
      state.short.push({ payload, remainingQty });
    }
  }

  return { payloads, skippedUnmatchedSellQty, touchedExistingTrades };
};

export const getTrades = async () => {
  if (queryCache.trades.data && Date.now() < queryCache.trades.until) {
    return queryCache.trades.data;
  }

  const totalCapital = await getTotalCapital();
  const trades = await Trade.find()
    .select('-screenshot')
    .sort({ entryDate: -1, createdAt: -1 })
    .lean();
  const computed = trades.map((trade) => withMetrics(trade, totalCapital));
  queryCache.trades.data = computed;
  queryCache.trades.until = Date.now() + LIST_CACHE_TTL_MS;
  return computed;
};

export const getTradeById = async (id) => {
  const totalCapital = await getTotalCapital();
  const trade = await Trade.findById(id);
  if (!trade) throw createError('Trade not found', 404);
  return withMetrics(trade, totalCapital);
};

export const createTrade = async (payload) => {
  const normalizedPayload = {
    ...payload,
    stopLoss: withDefaultStopLoss({
      entryPrice: payload.entryPrice,
      side: payload.side,
      stopLoss: payload.stopLoss
    })
  };
  const trade = await Trade.create(normalizedPayload);
  invalidateTradeCaches();
  const totalCapital = await getTotalCapital();
  return withMetrics(trade, totalCapital);
};

export const getTradeImports = async () => {
  const imports = await ImportBatch.find({ source: { $in: ['ZERODHA', 'DHAN'] } })
    .select('-previewRows')
    .sort({ createdAt: -1 })
    .lean();
  if (!imports.length) return [];

  const importIds = imports.map((item) => item._id);
  const tradeCounts = await Trade.aggregate([
    { $match: { importBatchId: { $in: importIds } } },
    { $group: { _id: '$importBatchId', tradesCount: { $sum: 1 } } }
  ]);

  const countsById = new Map(tradeCounts.map((item) => [String(item._id), item.tradesCount]));
  return imports.map((item) => ({
    ...item,
    tradesCount: countsById.get(String(item._id)) || 0
  }));
};

export const getTradeImportById = async (importId) => {
  const importBatch = await ImportBatch.findById(importId).lean();
  if (!importBatch) throw createError('Import batch not found', 404);
  return importBatch;
};

export const deleteTradeImport = async (importId) => {
  const importBatch = await ImportBatch.findById(importId);
  if (!importBatch) throw createError('Import batch not found', 404);

  const deletedTrades = await Trade.deleteMany({ importBatchId: importBatch._id });
  await ImportBatch.findByIdAndDelete(importBatch._id);
  invalidateTradeCaches();

  return {
    importId: importBatch._id,
    deletedTrades: deletedTrades.deletedCount || 0
  };
};

export const importZerodhaTrades = async ({ csvText, fileName }) => {
  if (!csvText || typeof csvText !== 'string') {
    throw createError('csvText is required', 400);
  }

  const rows = parseDelimitedRows(csvText);
  if (rows.length < 2) {
    throw createError('CSV must include headers and at least one row', 400);
  }

  const headers = rows[0];
  const symbolIdx = findHeaderIndex(headers, ['symbol', 'tradingsymbol', 'trading symbol']);
  const sideIdx = findHeaderIndex(headers, ['trade type', 'type', 'buy/sell', 'transaction type', 'side']);
  const qtyIdx = findHeaderIndex(headers, ['quantity', 'qty', 'filled quantity', 'executed quantity']);
  const priceIdx = findHeaderIndex(headers, ['price', 'trade price', 'average price', 'avg price']);
  const orderIdIdx = findHeaderIndex(headers, ['order id', 'order_id', 'orderid']);
  const tradeIdIdx = findHeaderIndex(headers, ['trade id', 'trade_id', 'tradeid']);
  const execTimeIdx = findHeaderIndex(headers, [
    'order execution time',
    'order_execution_time',
    'execution time',
    'time',
    'timestamp'
  ]);
  const tradeDateIdx = findHeaderIndex(headers, ['trade date', 'trade_date', 'date']);

  if (
    [symbolIdx, sideIdx, qtyIdx, priceIdx].some((idx) => idx < 0) ||
    (execTimeIdx < 0 && tradeDateIdx < 0)
  ) {
    throw createError('CSV missing required columns. Need symbol, side, quantity, price, and trade date/time.', 400);
  }

  const normalizedRows = rows
    .slice(1)
    .map((r, index) => {
      const symbol = String(r[symbolIdx] || '').trim().toUpperCase();
      const sideRaw = String(r[sideIdx] || '').trim().toUpperCase();
      const side = sideRaw === 'BUY' || sideRaw === 'B' ? 'BUY' : sideRaw === 'SELL' || sideRaw === 'S' ? 'SELL' : null;
      const qty = toSafeNumber(r[qtyIdx]);
      const price = toSafeNumber(r[priceIdx]);
      const executionTime =
        toDate(execTimeIdx >= 0 ? r[execTimeIdx] : null) ||
        toDate(tradeDateIdx >= 0 ? r[tradeDateIdx] : null);
      const orderId = String(orderIdIdx >= 0 ? r[orderIdIdx] || '' : '').trim();
      const tradeId = String(tradeIdIdx >= 0 ? r[tradeIdIdx] || '' : '').trim();
      return { symbol, side, qty, price, executionTime, orderId, tradeId, index };
    })
    .filter((r) => r.symbol && r.side && r.qty > 0 && r.price > 0 && r.executionTime);

  if (!normalizedRows.length) {
    throw createError('No valid trade rows found in the CSV', 400);
  }

  const groupedByOrder = new Map();
  for (const row of normalizedRows) {
    const fallbackId = row.tradeId || `${row.symbol}-${row.side}-${row.executionTime.toISOString()}-${row.index}`;
    const orderGroupId = row.orderId || fallbackId;
    const key = `${row.symbol}__${row.side}__${orderGroupId}`;
    if (!groupedByOrder.has(key)) {
      groupedByOrder.set(key, {
        symbol: row.symbol,
        side: row.side,
        orderId: row.orderId,
        tradeIds: row.tradeId ? [row.tradeId] : [],
        executionTime: row.executionTime,
        firstIndex: row.index,
        qty: 0,
        gross: 0
      });
    }

    const group = groupedByOrder.get(key);
    group.qty += row.qty;
    group.gross += row.qty * row.price;
    if (row.executionTime < group.executionTime) group.executionTime = row.executionTime;
    if (row.index < group.firstIndex) group.firstIndex = row.index;
    if (row.tradeId) group.tradeIds.push(row.tradeId);
  }

  const orderEvents = Array.from(groupedByOrder.values())
    .map((item) => ({
      symbol: item.symbol,
      side: item.side,
      executionTime: item.executionTime,
      firstIndex: item.firstIndex,
      qty: item.qty,
      avgPrice: item.gross / item.qty,
      importRef: item.orderId
        ? `Order ${item.orderId}`
        : item.tradeIds.length
          ? `Trade ${item.tradeIds[0]}`
          : 'Zerodha fill'
    }))
    .filter((item) => item.qty > 0)
    .sort((a, b) => a.executionTime - b.executionTime || a.firstIndex - b.firstIndex);

  const symbols = [...new Set(orderEvents.map((item) => item.symbol))];
  const existingTrades = await Trade.find({ symbol: { $in: symbols } }).sort({ entryDate: 1, createdAt: 1 });
  const initialOpenState = buildOpenStateFromExistingTrades(existingTrades);

  const { payloads, touchedExistingTrades } = buildTradesFromOrderEvents(
    orderEvents,
    'Zerodha',
    'zerodha-import',
    { initialOpenState }
  );

  if (!payloads.length && touchedExistingTrades.size === 0) {
    throw createError('No importable trade groups could be built', 400);
  }

  payloads.sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate));

  const importBatch = await ImportBatch.create({
    source: 'ZERODHA',
    fileName: String(fileName || '').trim() || null,
    importedCount: payloads.length,
    previewRows: toPreviewRows(normalizedRows, 'ZERODHA')
  });

  payloads.forEach((payload) => {
    payload.importBatchId = importBatch._id;
  });

  const created = payloads.length ? await Trade.insertMany(payloads, { ordered: false }) : [];
  if (touchedExistingTrades.size > 0) {
    await Promise.all([...touchedExistingTrades].map((trade) => trade.save()));
  }
  invalidateTradeCaches();
  const totalCapital = await getTotalCapital();
  const computed = created.map((trade) => withMetrics(trade, totalCapital));

  return {
    importedCount: computed.length,
    updatedExistingTrades: touchedExistingTrades.size,
    importId: importBatch._id,
    trades: computed
  };
};

export const importDhanTrades = async ({ csvText, fileName }) => {
  if (!csvText || typeof csvText !== 'string') {
    throw createError('csvText is required', 400);
  }

  const rows = parseDelimitedRows(csvText);
  if (rows.length < 2) {
    throw createError('Tradebook must include headers and at least one row', 400);
  }

  const headers = rows[0];
  const symbolIdx = findHeaderIndex(headers, ['name', 'symbol', 'security']);
  const sideIdx = findHeaderIndex(headers, ['buy/sell', 'side', 'transaction type']);
  const qtyIdx = findHeaderIndex(headers, ['quantity/lot', 'quantity', 'qty']);
  const priceIdx = findHeaderIndex(headers, ['trade price', 'price']);
  const dateIdx = findHeaderIndex(headers, ['date', 'trade date']);
  const timeIdx = findHeaderIndex(headers, ['time', 'trade time']);
  const statusIdx = findHeaderIndex(headers, ['status']);
  const orderTypeIdx = findHeaderIndex(headers, ['order', 'order type', 'product']);
  const exchangeIdx = findHeaderIndex(headers, ['exchange']);

  if ([symbolIdx, sideIdx, qtyIdx, priceIdx, dateIdx].some((idx) => idx < 0)) {
    throw createError('Dhan tradebook missing required columns. Need date, name, buy/sell, quantity, price.', 400);
  }

  const normalizedRows = rows
    .slice(1)
    .map((r, index) => {
      const name = String(r[symbolIdx] || '').trim();
      const symbol = name.toUpperCase();
      const sideRaw = String(r[sideIdx] || '').trim().toUpperCase();
      const side = sideRaw === 'BUY' || sideRaw === 'B' ? 'BUY' : sideRaw === 'SELL' || sideRaw === 'S' ? 'SELL' : null;
      const qty = toSafeNumber(r[qtyIdx]);
      const price = toSafeNumber(r[priceIdx]);
      const dateText = String(r[dateIdx] || '').trim();
      const timeText = timeIdx >= 0 ? String(r[timeIdx] || '').trim() : '';
      const executionTime = toDate(timeText ? `${dateText} ${timeText}` : dateText);
      const status = statusIdx >= 0 ? String(r[statusIdx] || '').trim().toUpperCase() : '';
      const orderType = orderTypeIdx >= 0 ? String(r[orderTypeIdx] || '').trim().toUpperCase() : '';
      const exchange = exchangeIdx >= 0 ? String(r[exchangeIdx] || '').trim().toUpperCase() : '';
      return { symbol, side, qty, price, executionTime, status, orderType, exchange, index };
    })
    .filter((r) => r.symbol && r.side && r.qty > 0 && r.price > 0 && r.executionTime)
    .filter((r) => !r.status || r.status === 'TRADED');

  if (!normalizedRows.length) {
    throw createError('No valid traded rows found in Dhan tradebook', 400);
  }

  const groupedByOrder = new Map();
  for (const row of normalizedRows) {
    const orderGroupId = `${row.symbol}__${row.side}__${row.executionTime.toISOString()}__${row.orderType || 'NA'}__${row.exchange || 'NA'}`;
    if (!groupedByOrder.has(orderGroupId)) {
      groupedByOrder.set(orderGroupId, {
        symbol: row.symbol,
        side: row.side,
        executionTime: row.executionTime,
        firstIndex: row.index,
        qty: 0,
        gross: 0,
        orderType: row.orderType || 'UNKNOWN',
        exchange: row.exchange || 'NA'
      });
    }
    const group = groupedByOrder.get(orderGroupId);
    group.qty += row.qty;
    group.gross += row.qty * row.price;
    if (row.executionTime < group.executionTime) group.executionTime = row.executionTime;
    if (row.index < group.firstIndex) group.firstIndex = row.index;
  }

  const orderEvents = Array.from(groupedByOrder.values())
    .map((item) => ({
      symbol: item.symbol,
      side: item.side,
      executionTime: item.executionTime,
      firstIndex: item.firstIndex,
      qty: item.qty,
      avgPrice: item.gross / item.qty,
      importRef: `${item.orderType} ${item.exchange}`.trim()
    }))
    .filter((item) => item.qty > 0)
    .sort((a, b) => a.executionTime - b.executionTime || a.firstIndex - b.firstIndex);

  const symbols = [...new Set(orderEvents.map((item) => item.symbol))];
  const existingTrades = await Trade.find({ symbol: { $in: symbols } }).sort({ entryDate: 1, createdAt: 1 });
  const initialOpenState = buildOpenStateFromExistingTrades(existingTrades);

  const { payloads, skippedUnmatchedSellQty, touchedExistingTrades } = buildTradesFromOrderEvents(
    orderEvents,
    'Dhan',
    'dhan-import',
    { allowShort: false, initialOpenState }
  );
  if (!payloads.length && touchedExistingTrades.size === 0) {
    throw createError('No importable trade groups could be built from Dhan tradebook', 400);
  }

  payloads.sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate));

  const importBatch = await ImportBatch.create({
    source: 'DHAN',
    fileName: String(fileName || '').trim() || 'Dhan Tradebook',
    importedCount: payloads.length,
    previewRows: toPreviewRows(normalizedRows, 'DHAN')
  });

  payloads.forEach((payload) => {
    payload.importBatchId = importBatch._id;
  });

  const created = payloads.length ? await Trade.insertMany(payloads, { ordered: false }) : [];
  if (touchedExistingTrades.size > 0) {
    await Promise.all([...touchedExistingTrades].map((trade) => trade.save()));
  }
  invalidateTradeCaches();
  const totalCapital = await getTotalCapital();
  const computed = created.map((trade) => withMetrics(trade, totalCapital));

  return {
    importedCount: computed.length,
    updatedExistingTrades: touchedExistingTrades.size,
    importId: importBatch._id,
    trades: computed,
    skippedUnmatchedSellQty
  };
};

export const updateTrade = async (id, payload) => {
  const trade = await Trade.findById(id);
  if (!trade) throw createError('Trade not found', 404);

  const nextEntryPrice = payload.entryPrice ?? trade.entryPrice;
  const nextSide = payload.side ?? trade.side;
  const nextStopLoss = withDefaultStopLoss({
    entryPrice: nextEntryPrice,
    side: nextSide,
    stopLoss: payload.stopLoss ?? trade.stopLoss
  });
  Object.assign(trade, payload, { stopLoss: nextStopLoss });
  validatePositionSize(trade);
  await trade.save();
  invalidateTradeCaches();

  const totalCapital = await getTotalCapital();
  return withMetrics(trade, totalCapital);
};

export const deleteTrade = async (id) => {
  const trade = await Trade.findByIdAndDelete(id);
  if (!trade) throw createError('Trade not found', 404);
  invalidateTradeCaches();
  return null;
};

export const addPyramid = async (id, payload) => {
  const trade = await Trade.findById(id);
  if (!trade) throw createError('Trade not found', 404);

  trade.pyramids.push(payload);
  await trade.save();
  invalidateTradeCaches();

  const totalCapital = await getTotalCapital();
  return withMetrics(trade, totalCapital);
};

export const updatePyramid = async (id, pid, payload) => {
  const trade = await Trade.findById(id);
  if (!trade) throw createError('Trade not found', 404);

  const pyramid = trade.pyramids.id(pid);
  if (!pyramid) throw createError('Pyramid entry not found', 404);

  Object.assign(pyramid, payload);
  validatePositionSize(trade);
  await trade.save();
  invalidateTradeCaches();

  const totalCapital = await getTotalCapital();
  return withMetrics(trade, totalCapital);
};

export const deletePyramid = async (id, pid) => {
  const trade = await Trade.findById(id);
  if (!trade) throw createError('Trade not found', 404);

  const pyramid = trade.pyramids.id(pid);
  if (!pyramid) throw createError('Pyramid entry not found', 404);

  pyramid.deleteOne();

  const totalEntryQty =
    Number(trade.entryQty || 0) + trade.pyramids.reduce((acc, item) => acc + Number(item.qty || 0), 0);
  const exitedQty = trade.exits.reduce((acc, item) => acc + Number(item.exitQty || 0), 0);

  if (exitedQty > totalEntryQty + 1e-9) {
    throw createError('Cannot remove this pyramid because existing exits exceed remaining size', 400);
  }

  await trade.save();
  invalidateTradeCaches();

  const totalCapital = await getTotalCapital();
  return withMetrics(trade, totalCapital);
};

export const addExit = async (id, payload) => {
  const trade = await Trade.findById(id);
  if (!trade) throw createError('Trade not found', 404);

  validateExitQty(trade, payload.exitQty);

  trade.exits.push(payload);
  await trade.save();
  invalidateTradeCaches();

  const totalCapital = await getTotalCapital();
  return withMetrics(trade, totalCapital);
};

export const addStopLossAdjustment = async (id, payload) => {
  const trade = await Trade.findById(id);
  if (!trade) throw createError('Trade not found', 404);

  const qty = Number(payload.qty || 0);
  const stopLoss = Number(payload.stopLoss || 0);
  const date = payload.date ? new Date(payload.date) : new Date();
  if (qty <= 0 || stopLoss <= 0) {
    throw createError('Quantity and stop loss must be greater than 0', 400);
  }
  if (Number.isNaN(date.getTime())) {
    throw createError('Invalid stop loss adjustment date', 400);
  }

  const openQty = getTotalEntryQty(trade) - getTotalExitQty(trade);
  if (openQty <= 1e-9) {
    throw createError('Cannot add stop loss adjustment to a closed trade', 400);
  }
  if (qty > openQty + 1e-9) {
    throw createError('Adjustment quantity cannot exceed current open quantity', 400);
  }

  trade.stopLossAdjustments.push({
    date,
    qty,
    stopLoss
  });
  await trade.save();
  invalidateTradeCaches();

  const totalCapital = await getTotalCapital();
  return withMetrics(trade, totalCapital);
};

export const updateExit = async (id, eid, payload) => {
  const trade = await Trade.findById(id);
  if (!trade) throw createError('Trade not found', 404);

  const exit = trade.exits.id(eid);
  if (!exit) throw createError('Exit not found', 404);

  const nextQty = payload.exitQty ?? exit.exitQty;
  validateExitQty(trade, nextQty, eid);

  Object.assign(exit, payload);
  await trade.save();
  invalidateTradeCaches();

  const totalCapital = await getTotalCapital();
  return withMetrics(trade, totalCapital);
};

export const deleteExit = async (id, eid) => {
  const trade = await Trade.findById(id);
  if (!trade) throw createError('Trade not found', 404);

  const exit = trade.exits.id(eid);
  if (!exit) throw createError('Exit not found', 404);

  exit.deleteOne();
  await trade.save();
  invalidateTradeCaches();

  const totalCapital = await getTotalCapital();
  return withMetrics(trade, totalCapital);
};

export const getDashboard = async () => {
  if (queryCache.dashboard.data && Date.now() < queryCache.dashboard.until) {
    return queryCache.dashboard.data;
  }

  const totalCapital = await getTotalCapital();
  const trades = await Trade.find()
    .select('-screenshot')
    .sort({ entryDate: -1, createdAt: -1 })
    .lean();

  const openSymbols = [
    ...new Set(
      trades
        .map((trade) => {
          const metrics = calcTradeMetrics(trade, totalCapital);
          return metrics.status === 'OPEN' ? trade.symbol : null;
        })
        .filter(Boolean)
    )
  ];

  const livePriceBySymbol = {};
  await Promise.all(
    openSymbols.map(async (symbol) => {
      try {
        const quote = await fetchSymbolQuote(symbol);
        if (quote && typeof quote.price === 'number') {
          livePriceBySymbol[symbol] = quote.price;
        }
      } catch {
        // Keep dashboard resilient when a symbol quote is unavailable.
      }
    })
  );

  const computedTrades = trades.map((trade) => {
    const livePrice = livePriceBySymbol[trade.symbol];
    const tradeForMetrics =
      livePrice === undefined ? trade : { ...trade, lastPrice: livePrice };
    return withMetrics(tradeForMetrics, totalCapital);
  });
  const analytics = buildDashboardAnalytics(computedTrades);

  const payload = {
    openTrades: computedTrades.filter((trade) => trade.metrics.status === 'OPEN'),
    analytics,
    totalCapital
  };
  queryCache.dashboard.data = payload;
  queryCache.dashboard.until = Date.now() + LIST_CACHE_TTL_MS;
  return payload;
};

export const getTradeQuote = async (id) => {
  const trade = await Trade.findById(id).select('symbol');
  if (!trade) throw createError('Trade not found', 404);

  const quote = await fetchSymbolQuote(trade.symbol);
  if (!quote) {
    throw createError(`Live quote not available for ${trade.symbol}`, 404);
  }

  return quote;
};

export const clearTradeReadCaches = () => {
  invalidateTradeCaches();
};
