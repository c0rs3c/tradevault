import { Types } from 'mongoose';
import { connectDeepDiveDB } from '@/lib/server/deepDive/db';
import { getDeepDiveModels } from '@/lib/server/deepDive/models';
import {
  DEEP_DIVE_BENCHMARKS,
  DEEP_DIVE_DEFAULT_MIN_LIQUIDITY,
  normalizeDeepDiveSymbol,
  defaultStockYfinanceTicker
} from '@/lib/server/deepDive/constants';

const DAY_MS = 24 * 60 * 60 * 1000;

const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const toDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const toUtcDate = (value) => {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const subtractDays = (date, days) => new Date(date.getTime() - days * DAY_MS);

const safeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const hasAnyPriceBars = (bars) => Array.isArray(bars) && bars.length > 0;

const round = (value, digits = 2) => {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
};

const pctChange = (start, end) => {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return null;
  return ((end / start) - 1) * 100;
};

const median = (numbers) => {
  const sorted = numbers.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
};

const average = (numbers) => {
  const valid = numbers.filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, item) => sum + item, 0) / valid.length;
};

const normalizeSymbolsText = (text) =>
  [...new Set(
    String(text || '')
      .split(/[\s,;\n\r\t]+/)
      .map((item) => normalizeDeepDiveSymbol(item))
      .filter(Boolean)
  )];

const numberParam = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const compareMaybeNumber = (a, b) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
};

const findBoundaryBar = (bars, targetDate) => {
  const target = toDateKey(targetDate);
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    if (bars[index].dateKey <= target) return bars[index];
  }
  return null;
};

const getCloseValue = (bar) => safeNumber(bar?.adjClose) ?? safeNumber(bar?.close);

const computeLiquidity20d = (bars, effectiveEndBar) => {
  if (!effectiveEndBar) return null;
  const eligible = bars.filter((bar) => bar.dateKey <= effectiveEndBar.dateKey);
  const slice = eligible.slice(-20);
  if (!slice.length) return null;
  const values = slice
    .map((bar) => {
      const close = getCloseValue(bar);
      const volume = safeNumber(bar?.volume);
      return Number.isFinite(close) && Number.isFinite(volume) ? close * volume : null;
    })
    .filter(Number.isFinite);
  if (!values.length) return null;
  return average(values);
};

const getSortMetric = (row, sortBy) => {
  if (!sortBy || sortBy === 'stockChangePct') return row.stockChangePct;
  if (sortBy === 'symbol') return row.symbol;
  if (sortBy === 'companyName') return row.companyName || '';
  if (sortBy === 'liquidity20d') return row.liquidity20d;
  if (sortBy.startsWith('xMultiple:')) {
    const key = sortBy.split(':')[1];
    return row.benchmarks?.[key]?.xMultiple ?? null;
  }
  if (sortBy.startsWith('rsRatio:')) {
    const key = sortBy.split(':')[1];
    return row.benchmarks?.[key]?.rsRatioPct ?? null;
  }
  if (sortBy.startsWith('benchmarkChangePct:')) {
    const key = sortBy.split(':')[1];
    return row.benchmarks?.[key]?.benchmarkChangePct ?? null;
  }
  return row.stockChangePct;
};

const sortRows = (rows, sortBy, direction) => {
  const normalizedDirection = direction === 'asc' ? 'asc' : 'desc';
  const modifier = normalizedDirection === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = getSortMetric(a, sortBy);
    const right = getSortMetric(b, sortBy);
    if (typeof left === 'string' || typeof right === 'string') {
      return modifier * String(left || '').localeCompare(String(right || ''));
    }
    return modifier * compareMaybeNumber(left, right);
  });
};

const parsePerBenchmarkThresholds = (input, keys) =>
  keys.reduce((acc, key) => {
    acc[key] = numberParam(input?.[key]);
    return acc;
  }, {});

const getModels = async () => {
  const connection = await connectDeepDiveDB();
  return getDeepDiveModels(connection);
};

export const ensureDeepDiveBenchmarks = async () => {
  const { DeepDiveSymbol } = await getModels();
  await Promise.all(
    DEEP_DIVE_BENCHMARKS.map((item) =>
      DeepDiveSymbol.updateOne(
        { symbol: item.symbol },
        {
          $setOnInsert: {
            symbol: item.symbol,
            assetType: 'benchmark',
            benchmarkKey: item.key
          },
          $set: {
            displayName: item.displayName,
            yfinanceTicker: item.yfinanceTicker,
            active: true
          }
        },
        { upsert: true }
      )
    )
  );
};

const upsertStockSymbols = async (symbols) => {
  if (!symbols.length) return;
  const { DeepDiveSymbol } = await getModels();
  await Promise.all(
    symbols.map((symbol) =>
      DeepDiveSymbol.updateOne(
        { symbol },
        {
          $setOnInsert: {
            symbol,
            assetType: 'stock'
          },
          $set: {
            displayName: symbol,
            yfinanceTicker: defaultStockYfinanceTicker(symbol),
            active: true
          }
        },
        { upsert: true }
      )
    )
  );
};

export const listDeepDiveStockLists = async ({ ownerUsername }) => {
  await ensureDeepDiveBenchmarks();
  const { DeepDiveStockList } = await getModels();
  const lists = await DeepDiveStockList.find({ ownerUsername }).sort({ updatedAt: -1 }).lean();
  return {
    lists: lists.map((item) => ({
      id: String(item._id),
      title: item.title,
      description: item.description || '',
      symbolCount: Array.isArray(item.symbols) ? item.symbols.length : 0,
      updatedAt: item.updatedAt,
      createdAt: item.createdAt
    }))
  };
};

export const createDeepDiveStockList = async ({ ownerUsername, title, description = '', text = '' }) => {
  const normalizedTitle = String(title || '').trim();
  if (!normalizedTitle) {
    throw createError('title is required', 400);
  }

  const symbols = normalizeSymbolsText(text);
  if (!symbols.length) {
    throw createError('At least one valid stock symbol is required', 400);
  }

  await ensureDeepDiveBenchmarks();
  await upsertStockSymbols(symbols);

  const { DeepDiveStockList } = await getModels();
  const created = await DeepDiveStockList.create({
    ownerUsername,
    title: normalizedTitle,
    description: String(description || '').trim(),
    sourceText: String(text || '').trim(),
    symbols
  });

  return {
    id: String(created._id),
    title: created.title,
    description: created.description || '',
    symbols: created.symbols,
    symbolCount: created.symbols.length,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt
  };
};

export const getDeepDiveStockList = async ({ ownerUsername, id }) => {
  if (!Types.ObjectId.isValid(id)) throw createError('Invalid list id', 400);
  const { DeepDiveStockList } = await getModels();
  const list = await DeepDiveStockList.findOne({ _id: id, ownerUsername }).lean();
  if (!list) throw createError('Stock list not found', 404);
  return {
    id: String(list._id),
    title: list.title,
    description: list.description || '',
    sourceText: list.sourceText || '',
    symbols: list.symbols || [],
    symbolCount: Array.isArray(list.symbols) ? list.symbols.length : 0,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt
  };
};

export const updateDeepDiveStockList = async ({ ownerUsername, id, title, description, text }) => {
  if (!Types.ObjectId.isValid(id)) throw createError('Invalid list id', 400);
  const updates = {};
  if (title !== undefined) {
    const normalizedTitle = String(title || '').trim();
    if (!normalizedTitle) throw createError('title cannot be empty', 400);
    updates.title = normalizedTitle;
  }
  if (description !== undefined) updates.description = String(description || '').trim();
  if (text !== undefined) {
    const symbols = normalizeSymbolsText(text);
    if (!symbols.length) throw createError('At least one valid stock symbol is required', 400);
    await upsertStockSymbols(symbols);
    updates.sourceText = String(text || '').trim();
    updates.symbols = symbols;
  }

  const { DeepDiveStockList } = await getModels();
  const updated = await DeepDiveStockList.findOneAndUpdate(
    { _id: id, ownerUsername },
    { $set: updates },
    { new: true }
  ).lean();
  if (!updated) throw createError('Stock list not found', 404);
  return {
    id: String(updated._id),
    title: updated.title,
    description: updated.description || '',
    sourceText: updated.sourceText || '',
    symbols: updated.symbols || [],
    symbolCount: Array.isArray(updated.symbols) ? updated.symbols.length : 0,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt
  };
};

export const deleteDeepDiveStockList = async ({ ownerUsername, id }) => {
  if (!Types.ObjectId.isValid(id)) throw createError('Invalid list id', 400);
  const { DeepDiveStockList } = await getModels();
  const deleted = await DeepDiveStockList.findOneAndDelete({ _id: id, ownerUsername }).lean();
  if (!deleted) throw createError('Stock list not found', 404);
  return { id, deleted: true };
};

export const getDeepDiveStatus = async () => {
  await ensureDeepDiveBenchmarks();
  const { DeepDiveSyncState, DeepDiveIngestionRun } = await getModels();
  const [syncStates, latestRun] = await Promise.all([
    DeepDiveSyncState.find({}).lean(),
    DeepDiveIngestionRun.findOne({}).sort({ startedAt: -1 }).lean()
  ]);

  const benchmarkStatuses = DEEP_DIVE_BENCHMARKS.map((item) => {
    const state = syncStates.find((entry) => entry.symbol === item.symbol);
    return {
      key: item.key,
      symbol: item.symbol,
      displayName: item.displayName,
      latestBarDate: state?.latestBarDate ? toDateKey(state.latestBarDate) : null,
      earliestBarDate: state?.earliestBarDate ? toDateKey(state.earliestBarDate) : null,
      lastSyncedAt: state?.lastSyncedAt || null,
      lastStatus: state?.lastStatus || '',
      lastError: state?.lastError || ''
    };
  });

  const latestAvailableDate = syncStates
    .map((item) => item?.latestBarDate)
    .filter(Boolean)
    .map((item) => new Date(item))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    latestAvailableDate: latestAvailableDate ? toDateKey(latestAvailableDate) : null,
    benchmarkStatuses,
    latestRun: latestRun
      ? {
          runType: latestRun.runType,
          status: latestRun.status,
          startedAt: latestRun.startedAt,
          finishedAt: latestRun.finishedAt,
          rowsUpserted: latestRun.rowsUpserted,
          symbolsAttempted: latestRun.symbolsAttempted,
          symbolsSucceeded: latestRun.symbolsSucceeded,
          failedSymbols: latestRun.failedSymbols || []
        }
      : null
  };
};

const buildRsDataset = async ({ ownerUsername, payload }) => {
  await ensureDeepDiveBenchmarks();
  const {
    DeepDiveStockList,
    DeepDivePriceBar,
    DeepDiveCompanyProfile,
    DeepDiveSyncState
  } = await getModels();

  const startDate = toUtcDate(payload?.startDate);
  const endDate = toUtcDate(payload?.endDate);
  if (!startDate || !endDate || startDate > endDate) {
    throw createError('Valid startDate and endDate are required', 400);
  }

  const stockListId = String(payload?.stockListId || '').trim();
  if (!Types.ObjectId.isValid(stockListId)) {
    throw createError('stockListId is required', 400);
  }

  const stockList = await DeepDiveStockList.findOne({ _id: stockListId, ownerUsername }).lean();
  if (!stockList) throw createError('Stock list not found', 404);

  const selectedSymbolsOverride = Array.isArray(payload?.selectedSymbols)
    ? payload.selectedSymbols.map((item) => normalizeDeepDiveSymbol(item)).filter(Boolean)
    : [];
  const stockSymbols = selectedSymbolsOverride.length
    ? [...new Set(selectedSymbolsOverride)]
    : [...new Set((stockList.symbols || []).map((item) => normalizeDeepDiveSymbol(item)).filter(Boolean))];

  if (!stockSymbols.length) {
    return {
      stockList: { id: String(stockList._id), title: stockList.title, symbolCount: 0 },
      rows: [],
      benchmarkSummaries: [],
      skippedSymbols: [],
      symbolStatuses: [],
      symbolStatusSummary: {},
      effectiveDates: {},
      filters: { availableSectors: [], availableIndustries: [] },
      dataFreshness: { latestAvailableDate: null, benchmarks: [] }
    };
  }

  const windowStartDate = subtractDays(startDate, 40);
  const benchmarkSymbols = DEEP_DIVE_BENCHMARKS.map((item) => item.symbol);
  const allSymbols = [...new Set([...stockSymbols, ...benchmarkSymbols])];

  const [bars, profiles, syncStates] = await Promise.all([
    DeepDivePriceBar.find({
      symbol: { $in: allSymbols },
      date: { $gte: windowStartDate, $lte: endDate }
    })
      .sort({ symbol: 1, date: 1 })
      .lean(),
    DeepDiveCompanyProfile.find({ symbol: { $in: stockSymbols } }).lean(),
    DeepDiveSyncState.find({ symbol: { $in: allSymbols } }).lean()
  ]);

  const profileBySymbol = new Map(profiles.map((item) => [item.symbol, item]));
  const syncStateBySymbol = new Map(syncStates.map((item) => [item.symbol, item]));
  const barsBySymbol = bars.reduce((acc, bar) => {
    const symbol = bar.symbol;
    if (!acc.has(symbol)) acc.set(symbol, []);
    acc.get(symbol).push({
      ...bar,
      dateKey: toDateKey(bar.date)
    });
    return acc;
  }, new Map());

  const benchmarkSummaries = [];
  const effectiveDates = {};
  const benchmarkStatsByKey = {};

  for (const benchmark of DEEP_DIVE_BENCHMARKS) {
    const benchmarkBars = barsBySymbol.get(benchmark.symbol) || [];
    const startBar = findBoundaryBar(benchmarkBars, startDate);
    const endBar = findBoundaryBar(benchmarkBars, endDate);
    const startClose = getCloseValue(startBar);
    const endClose = getCloseValue(endBar);
    const changePct = pctChange(startClose, endClose);
    benchmarkStatsByKey[benchmark.key] = {
      benchmark,
      startBar,
      endBar,
      startClose,
      endClose,
      changePct
    };
    effectiveDates[benchmark.key] = {
      startDate: startBar?.dateKey || null,
      endDate: endBar?.dateKey || null
    };
    benchmarkSummaries.push({
      key: benchmark.key,
      symbol: benchmark.symbol,
      displayName: benchmark.displayName,
      startDate: startBar?.dateKey || null,
      endDate: endBar?.dateKey || null,
      startClose: round(startClose, 4),
      endClose: round(endClose, 4),
      changePct: round(changePct)
    });
  }

  const minStockChangePct = numberParam(payload?.minStockChangePct);
  const maxStockChangePct = numberParam(payload?.maxStockChangePct);
  const minLiquidity20d =
    numberParam(payload?.minLiquidity20d) ?? DEEP_DIVE_DEFAULT_MIN_LIQUIDITY;
  const sectorFilter = String(payload?.sector || '').trim();
  const industryFilter = String(payload?.industry || '').trim();
  const sortBy = String(payload?.sortBy || 'stockChangePct').trim();
  const sortDirection = String(payload?.sortDirection || 'desc').trim().toLowerCase();
  const topN = numberParam(payload?.topN);
  const benchmarkKeys = DEEP_DIVE_BENCHMARKS.map((item) => item.key);
  const minXMultiples = parsePerBenchmarkThresholds(payload?.minXMultiples, benchmarkKeys);
  const minRsRatios = parsePerBenchmarkThresholds(payload?.minRsRatios, benchmarkKeys);

  const rows = [];
  const skippedSymbols = [];
  const symbolStatuses = [];

  for (const symbol of stockSymbols) {
    const stockBars = barsBySymbol.get(symbol) || [];
    const startBar = findBoundaryBar(stockBars, startDate);
    const endBar = findBoundaryBar(stockBars, endDate);
    const startClose = getCloseValue(startBar);
    const endClose = getCloseValue(endBar);
    const stockChangePct = pctChange(startClose, endClose);
    const liquidity20d = computeLiquidity20d(stockBars, endBar);
    const profile = profileBySymbol.get(symbol) || {};
    const syncState = syncStateBySymbol.get(symbol) || {};
    const hasProfile = Boolean(
      String(profile.companyName || '').trim() ||
        String(profile.sector || '').trim() ||
        String(profile.industry || '').trim() ||
        String(profile.summary || '').trim()
    );
    const hasBars = hasAnyPriceBars(stockBars);
    const hasStartBar = Boolean(startBar);
    const hasEndBar = Boolean(endBar);
    const latestBarDate = syncState?.latestBarDate ? toDateKey(syncState.latestBarDate) : null;
    const lastProfileSyncedAt = syncState?.lastProfileSyncedAt || profile?.lastProfileSyncedAt || null;
    let status = 'ready';
    let reason = '';

    if (!hasBars) {
      status = 'no_price_history';
      reason = 'No historical price bars stored yet';
    } else if (!hasStartBar && !hasEndBar) {
      status = 'missing_start_and_end_history';
      reason = 'No usable bars on or before the selected start and end dates';
    } else if (!hasStartBar) {
      status = 'missing_start_history';
      reason = 'No usable bar on or before the selected start date';
    } else if (!hasEndBar) {
      status = 'missing_end_history';
      reason = 'No usable bar on or before the selected end date';
    } else if (!Number.isFinite(stockChangePct)) {
      status = 'insufficient_boundary_data';
      reason = 'Boundary bars exist but return could not be computed';
    } else if (!hasProfile) {
      status = 'price_ready_profile_missing';
      reason = 'Price history is available but company profile has not been ingested yet';
    }

    symbolStatuses.push({
      symbol,
      companyName: String(profile.companyName || '').trim(),
      sector: String(profile.sector || '').trim(),
      industry: String(profile.industry || '').trim(),
      hasProfile,
      hasBars,
      hasStartBar,
      hasEndBar,
      latestBarDate,
      startBarDate: startBar?.dateKey || null,
      endBarDate: endBar?.dateKey || null,
      lastSyncedAt: syncState?.lastSyncedAt || null,
      lastProfileSyncedAt,
      lastStatus: String(syncState?.lastStatus || '').trim(),
      lastError: String(syncState?.lastError || '').trim(),
      status,
      reason
    });

    if (!startBar || !endBar || !Number.isFinite(stockChangePct)) {
      skippedSymbols.push({
        symbol,
        reason: reason || 'Missing boundary price bars'
      });
      continue;
    }

    const benchmarkMetrics = {};
    for (const benchmark of DEEP_DIVE_BENCHMARKS) {
      const benchmarkStats = benchmarkStatsByKey[benchmark.key];
      const benchmarkChangePct = benchmarkStats.changePct;
      const startRatio =
        Number.isFinite(startClose) && Number.isFinite(benchmarkStats.startClose) && benchmarkStats.startClose > 0
          ? startClose / benchmarkStats.startClose
          : null;
      const endRatio =
        Number.isFinite(endClose) && Number.isFinite(benchmarkStats.endClose) && benchmarkStats.endClose > 0
          ? endClose / benchmarkStats.endClose
          : null;
      const rsRatioPct =
        Number.isFinite(startRatio) && Number.isFinite(endRatio) && startRatio > 0
          ? ((endRatio / startRatio) - 1) * 100
          : null;
      const xMultiple =
        Number.isFinite(stockChangePct) &&
        Number.isFinite(benchmarkChangePct) &&
        Math.abs(benchmarkChangePct) > 0.000001
          ? stockChangePct / benchmarkChangePct
          : null;

      benchmarkMetrics[benchmark.key] = {
        key: benchmark.key,
        displayName: benchmark.displayName,
        benchmarkChangePct: round(benchmarkChangePct),
        xMultiple: round(xMultiple, 3),
        rsRatioPct: round(rsRatioPct)
      };
    }

    const row = {
      symbol,
      companyName: String(profile.companyName || '').trim(),
      sector: String(profile.sector || '').trim(),
      industry: String(profile.industry || '').trim(),
      summary: String(profile.summary || '').trim(),
      stockStartClose: round(startClose, 4),
      stockEndClose: round(endClose, 4),
      stockChangePct: round(stockChangePct),
      liquidity20d: round(liquidity20d, 2),
      profile: {
        marketCap: safeNumber(profile.marketCap),
        averageVolume: safeNumber(profile.averageVolume),
        averageTradedValue: safeNumber(profile.averageTradedValue),
        trailingPe: safeNumber(profile.trailingPe),
        priceToBook: safeNumber(profile.priceToBook),
        returnOnEquity: safeNumber(profile.returnOnEquity),
        debtToEquity: safeNumber(profile.debtToEquity),
        epsTrailing: safeNumber(profile.epsTrailing),
        dividendYield: safeNumber(profile.dividendYield),
        fiftyTwoWeekHigh: safeNumber(profile.fiftyTwoWeekHigh),
        fiftyTwoWeekLow: safeNumber(profile.fiftyTwoWeekLow)
      },
      benchmarks: benchmarkMetrics
    };

    if (Number.isFinite(minStockChangePct) && (!Number.isFinite(row.stockChangePct) || row.stockChangePct < minStockChangePct)) {
      continue;
    }
    if (Number.isFinite(maxStockChangePct) && (!Number.isFinite(row.stockChangePct) || row.stockChangePct > maxStockChangePct)) {
      continue;
    }
    if (Number.isFinite(minLiquidity20d) && (!Number.isFinite(row.liquidity20d) || row.liquidity20d < minLiquidity20d)) {
      continue;
    }
    if (sectorFilter && row.sector !== sectorFilter) continue;
    if (industryFilter && row.industry !== industryFilter) continue;

    let failedThreshold = false;
    for (const key of benchmarkKeys) {
      const xThreshold = minXMultiples[key];
      const rsThreshold = minRsRatios[key];
      if (Number.isFinite(xThreshold) && (!Number.isFinite(row.benchmarks[key]?.xMultiple) || row.benchmarks[key].xMultiple < xThreshold)) {
        failedThreshold = true;
        break;
      }
      if (Number.isFinite(rsThreshold) && (!Number.isFinite(row.benchmarks[key]?.rsRatioPct) || row.benchmarks[key].rsRatioPct < rsThreshold)) {
        failedThreshold = true;
        break;
      }
    }
    if (failedThreshold) continue;

    rows.push(row);
  }

  let sortedRows = sortRows(rows, sortBy, sortDirection);
  if (Number.isFinite(topN) && topN > 0) {
    sortedRows = sortedRows.slice(0, topN);
  }

  const sectors = [...new Set(sortedRows.map((item) => item.sector).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  const industries = [...new Set(sortedRows.map((item) => item.industry).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  const symbolStatusSummary = symbolStatuses.reduce((acc, item) => {
    acc.total = (acc.total || 0) + 1;
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  return {
    stockList: {
      id: String(stockList._id),
      title: stockList.title,
      symbolCount: stockSymbols.length
    },
    benchmarkSummaries,
    rows: sortedRows,
    skippedSymbols,
    symbolStatuses,
    symbolStatusSummary,
    effectiveDates,
    filters: {
      availableSectors: sectors,
      availableIndustries: industries
    },
    dataFreshness: {
      latestAvailableDate: syncStates
        .map((item) => item.latestBarDate)
        .filter(Boolean)
        .map((item) => new Date(item))
        .sort((a, b) => b.getTime() - a.getTime())[0]
        ?.toISOString()
        ?.slice(0, 10) || null,
      benchmarks: DEEP_DIVE_BENCHMARKS.map((item) => ({
        key: item.key,
        displayName: item.displayName,
        latestBarDate: syncStateBySymbol.get(item.symbol)?.latestBarDate
          ? toDateKey(syncStateBySymbol.get(item.symbol).latestBarDate)
          : null
      }))
    }
  };
};

export const getDeepDiveRsResults = async ({ ownerUsername, payload }) => buildRsDataset({ ownerUsername, payload });

export const getDeepDiveGroupedAnalysis = async ({ ownerUsername, payload }) => {
  const grouping = String(payload?.groupBy || 'sector').trim().toLowerCase() === 'industry' ? 'industry' : 'sector';
  const dataset = await buildRsDataset({
    ownerUsername,
    payload: {
      ...payload,
      topN: null,
      minStockChangePct: null,
      maxStockChangePct: null,
      minLiquidity20d: null,
      minXMultiples: {},
      minRsRatios: {}
    }
  });

  const selectedSymbols = new Set(
    Array.isArray(payload?.selectedSymbols)
      ? payload.selectedSymbols.map((item) => normalizeDeepDiveSymbol(item)).filter(Boolean)
      : []
  );
  const selectedRows = dataset.rows.filter((row) => selectedSymbols.has(row.symbol));
  const benchmarkKeys = DEEP_DIVE_BENCHMARKS.map((item) => item.key);

  const groupedMap = new Map();
  selectedRows.forEach((row) => {
    const groupKey = String(row[grouping] || '').trim() || 'Unclassified';
    if (!groupedMap.has(groupKey)) groupedMap.set(groupKey, []);
    groupedMap.get(groupKey).push(row);
  });

  const groups = [...groupedMap.entries()]
    .map(([group, rows]) => {
      const averages = benchmarkKeys.reduce((acc, key) => {
        acc[key] = {
          avgRsRatioPct: round(average(rows.map((row) => row.benchmarks[key]?.rsRatioPct))),
          avgXMultiple: round(average(rows.map((row) => row.benchmarks[key]?.xMultiple)), 3)
        };
        return acc;
      }, {});
      const sortedByReturn = [...rows].sort((a, b) => compareMaybeNumber(b.stockChangePct, a.stockChangePct));
      return {
        group,
        stockCount: rows.length,
        averageStockChangePct: round(average(rows.map((row) => row.stockChangePct))),
        medianStockChangePct: round(median(rows.map((row) => row.stockChangePct))),
        benchmarks: averages,
        bestConstituent: sortedByReturn[0]
          ? { symbol: sortedByReturn[0].symbol, companyName: sortedByReturn[0].companyName, stockChangePct: sortedByReturn[0].stockChangePct }
          : null,
        weakestConstituent: sortedByReturn[sortedByReturn.length - 1]
          ? {
              symbol: sortedByReturn[sortedByReturn.length - 1].symbol,
              companyName: sortedByReturn[sortedByReturn.length - 1].companyName,
              stockChangePct: sortedByReturn[sortedByReturn.length - 1].stockChangePct
            }
          : null
      };
    })
    .sort((a, b) => compareMaybeNumber(b.averageStockChangePct, a.averageStockChangePct));

  return {
    groupBy: grouping,
    selectedCount: selectedRows.length,
    groups,
    benchmarks: DEEP_DIVE_BENCHMARKS.map((item) => ({
      key: item.key,
      displayName: item.displayName
    }))
  };
};
