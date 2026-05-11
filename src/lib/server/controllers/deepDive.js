import path from 'path';
import { spawn } from 'child_process';
import { connectDeepDiveDB } from '@/lib/server/deepDive/db';
import { getDeepDiveModels } from '@/lib/server/deepDive/models';
import {
  DEEP_DIVE_BENCHMARKS,
  DEEP_DIVE_DEFAULT_MIN_LIQUIDITY,
  normalizeDeepDiveSymbol,
  defaultStockYfinanceTicker
} from '@/lib/server/deepDive/constants';
import { resolvePythonBin } from '@/lib/server/utils/pythonRuntime';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEEP_DIVE_INGEST_SCRIPT_PATH = path.resolve(process.cwd(), 'scripts/deep_dive_ingest.py');
const PRICE_SYNC_RUN_TYPES = ['sync_prices', 'daily_sync', 'backfill_prices'];
const NIFTY_BENCHMARK = DEEP_DIVE_BENCHMARKS.find((item) => item.key === 'NIFTY') || DEEP_DIVE_BENCHMARKS[0];
const DEEP_DIVE_SHARED_OWNER = '__shared_deep_dive__';
let activeDeepDiveSync = null;

const createActiveSyncState = (mode, pythonBin) => ({
  mode,
  pythonBin,
  status: 'running',
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  current: 0,
  total: 0,
  currentSymbol: '',
  currentBatch: 0,
  totalBatches: 0,
  message: 'Starting Deep Dive sync...',
  recentLines: []
});

const pushActiveSyncLine = (line) => {
  if (!activeDeepDiveSync || !line) return;

  activeDeepDiveSync.updatedAt = new Date().toISOString();
  activeDeepDiveSync.message = line;
  activeDeepDiveSync.recentLines = [...activeDeepDiveSync.recentLines, line].slice(-5);

  const progressMatch = line.match(/(\d+)\/(\d+)\s+(?:synced|failed|no bars for)\s+([A-Z0-9&._-]+)/i);
  if (progressMatch) {
    activeDeepDiveSync.current = Number(progressMatch[1]) || activeDeepDiveSync.current;
    activeDeepDiveSync.total = Number(progressMatch[2]) || activeDeepDiveSync.total;
    activeDeepDiveSync.currentSymbol = progressMatch[3] || activeDeepDiveSync.currentSymbol;
  }

  const batchMatch = line.match(/batch\s+(\d+)\/(\d+)\s+\((\d+)-(\d+)\s+of\s+(\d+)\)/i);
  if (batchMatch) {
    activeDeepDiveSync.currentBatch = Number(batchMatch[1]) || activeDeepDiveSync.currentBatch;
    activeDeepDiveSync.totalBatches = Number(batchMatch[2]) || activeDeepDiveSync.totalBatches;
    activeDeepDiveSync.current = Number(batchMatch[3]) || activeDeepDiveSync.current;
    activeDeepDiveSync.total = Number(batchMatch[5]) || activeDeepDiveSync.total;
  }

  const prepMatch = line.match(/preparing to sync prices for\s+(\d+)\s+symbol/i);
  if (prepMatch) {
    activeDeepDiveSync.total = Number(prepMatch[1]) || activeDeepDiveSync.total;
  }
};

const finishActiveSync = (status, message) => {
  if (!activeDeepDiveSync) return;
  activeDeepDiveSync.status = status;
  activeDeepDiveSync.updatedAt = new Date().toISOString();
  activeDeepDiveSync.finishedAt = new Date().toISOString();
  if (message) {
    activeDeepDiveSync.message = message;
    activeDeepDiveSync.recentLines = [...activeDeepDiveSync.recentLines, message].slice(-5);
  }
};

const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const isValidDeepDiveId = (value) => Boolean(String(value || '').trim());

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

const safePct = (part, total) => {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return (part / total) * 100;
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

const normalizeSearchText = (value) => String(value || '').trim().toUpperCase();

const matchesFuzzy = (candidate, query) => {
  const source = normalizeSearchText(candidate);
  const needle = normalizeSearchText(query);
  if (!needle) return 0;
  if (source === needle) return 1000;
  if (source.startsWith(needle)) return 750 - (source.length - needle.length);
  if (source.includes(needle)) return 500 - source.indexOf(needle);
  let queryIndex = 0;
  let gaps = 0;
  for (let index = 0; index < source.length && queryIndex < needle.length; index += 1) {
    if (source[index] === needle[queryIndex]) {
      queryIndex += 1;
    } else {
      gaps += 1;
    }
  }
  if (queryIndex === needle.length) return 250 - gaps;
  return null;
};

const numberParam = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const selectedDateToUtcStart = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
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

const getOpenValue = (bar) => safeNumber(bar?.open);
const getHighValue = (bar) => safeNumber(bar?.high);
const getLowValue = (bar) => safeNumber(bar?.low);
const getVolumeValue = (bar) => safeNumber(bar?.volume);

const computeBoundaryGapPct = (startBar, endBar, trendReferencePct = null) => {
  const startHigh = getHighValue(startBar);
  const startLow = getLowValue(startBar);
  const endHigh = getHighValue(endBar);
  const endLow = getLowValue(endBar);
  const useUpMove = Number.isFinite(trendReferencePct) ? trendReferencePct >= 0 : false;
  return useUpMove ? pctChange(startLow, endHigh) : pctChange(startHigh, endLow);
};

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
  if (!sortBy || sortBy === 'changePct') return row.changePct;
  if (sortBy === 'symbol') return row.symbol;
  if (sortBy === 'companyName') return row.companyName || '';
  if (sortBy === 'sector') return row.sector || '';
  if (sortBy === 'industry') return row.industry || '';
  if (sortBy === 'liquidity20d') return row.liquidity20d;
  if (sortBy === 'xIndex') return row.xIndex;
  return row.changePct;
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

const consolidateOwnerStockLists = async (DeepDiveStockList) => {
  const lists = await DeepDiveStockList.find({}).sort({ updatedAt: -1, createdAt: -1 }).lean();
  if (!lists.length) return null;

  const canonical = lists.find((item) => item.ownerUsername === DEEP_DIVE_SHARED_OWNER) || lists[0];
  const mergedSymbols = [
    ...new Set(
      lists.flatMap((item) => (item.symbols || []).map((symbol) => normalizeDeepDiveSymbol(symbol)).filter(Boolean))
    )
  ];
  const mergedSourceText = mergedSymbols.join('\n');

  await DeepDiveStockList.updateOne(
    { _id: canonical._id },
    {
      $set: {
        ownerUsername: DEEP_DIVE_SHARED_OWNER,
        title: canonical.title || 'Deep Dive Universe',
        description: canonical.description || '',
        symbols: mergedSymbols,
        sourceText: mergedSourceText
      }
    }
  );

  const redundantIds = lists.slice(1).map((item) => item._id);
  if (redundantIds.length) {
    await DeepDiveStockList.deleteMany({ _id: { $in: redundantIds } });
  }

  return {
    ...canonical,
    title: canonical.title || 'Deep Dive Universe',
    description: canonical.description || '',
    symbols: mergedSymbols,
    sourceText: mergedSourceText
  };
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
            yfinanceTickers: item.yfinanceTickers || [item.yfinanceTicker],
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
  const canonical = await consolidateOwnerStockLists(DeepDiveStockList);
  const lists = canonical ? [canonical] : [];
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
  const symbols = normalizeSymbolsText(text);
  if (!symbols.length) {
    throw createError('At least one valid stock symbol is required', 400);
  }

  await ensureDeepDiveBenchmarks();
  await upsertStockSymbols(symbols);

  const { DeepDiveStockList } = await getModels();
  const existing = await consolidateOwnerStockLists(DeepDiveStockList);
  const nextTitle = String(title || '').trim() || existing?.title || 'Deep Dive Universe';
  const nextDescription = String(description || '').trim() || existing?.description || '';
  const mergedSymbols = [...new Set([...(existing?.symbols || []), ...symbols])];
  const sourceText = mergedSymbols.join('\n');

  let created;
  if (existing?._id) {
    created = await DeepDiveStockList.findOneAndUpdate(
      { _id: existing._id, ownerUsername: DEEP_DIVE_SHARED_OWNER },
      {
        $set: {
          ownerUsername: DEEP_DIVE_SHARED_OWNER,
          title: nextTitle,
          description: nextDescription,
          sourceText,
          symbols: mergedSymbols
        }
      },
      { new: true }
    ).lean();
  } else {
    created = await DeepDiveStockList.create({
      ownerUsername: DEEP_DIVE_SHARED_OWNER,
      title: nextTitle,
      description: nextDescription,
      sourceText,
      symbols: mergedSymbols
    });
  }

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
  if (!isValidDeepDiveId(id)) throw createError('Invalid list id', 400);
  const { DeepDiveStockList } = await getModels();
  await consolidateOwnerStockLists(DeepDiveStockList);
  const list = await DeepDiveStockList.findOne({ _id: id, ownerUsername: DEEP_DIVE_SHARED_OWNER }).lean();
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
  if (!isValidDeepDiveId(id)) throw createError('Invalid list id', 400);
  const { DeepDiveStockList } = await getModels();
  const canonical = await consolidateOwnerStockLists(DeepDiveStockList);
  if (canonical && String(canonical._id) !== String(id)) {
    throw createError('Only the consolidated Deep Dive universe can be updated', 400);
  }
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
    const existing = canonical?.symbols || [];
    const mergedSymbols = [...new Set([...existing, ...symbols])];
    updates.sourceText = mergedSymbols.join('\n');
    updates.symbols = mergedSymbols;
  }

  const updated = await DeepDiveStockList.findOneAndUpdate(
    { _id: id, ownerUsername: DEEP_DIVE_SHARED_OWNER },
    { $set: { ...updates, ownerUsername: DEEP_DIVE_SHARED_OWNER } },
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
  if (!isValidDeepDiveId(id)) throw createError('Invalid list id', 400);
  const { DeepDiveStockList } = await getModels();
  await consolidateOwnerStockLists(DeepDiveStockList);
  const deleted = await DeepDiveStockList.findOneAndDelete({ _id: id, ownerUsername: DEEP_DIVE_SHARED_OWNER }).lean();
  if (!deleted) throw createError('Stock list not found', 404);
  return { id, deleted: true };
};

export const getDeepDiveStatus = async () => {
  await ensureDeepDiveBenchmarks();
  const { DeepDiveSyncState, DeepDiveIngestionRun } = await getModels();
  const [syncStates, latestRun] = await Promise.all([
    DeepDiveSyncState.find({}).lean(),
    DeepDiveIngestionRun.findOne({ runType: { $in: PRICE_SYNC_RUN_TYPES } }).sort({ startedAt: -1 }).lean()
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
    activeSync: activeDeepDiveSync,
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

export const getDeepDiveImportInventory = async ({ ownerUsername, query = '', page = 1, pageSize = 100, asOfDate = '' }) => {
  await ensureDeepDiveBenchmarks();
  const {
    DeepDiveStockList,
    DeepDivePriceBar,
    DeepDiveCompanyProfile,
    DeepDiveSyncState,
    DeepDiveIngestionRun
  } = await getModels();

  const canonical = await consolidateOwnerStockLists(DeepDiveStockList);
  const lists = canonical ? [canonical] : [];
  const stockSymbols = [...new Set((canonical?.symbols || []).map((symbol) => normalizeDeepDiveSymbol(symbol)).filter(Boolean))];
  const selectedDate = selectedDateToUtcStart(asOfDate);

  const normalizedQuery = normalizeSearchText(query);
  const matchedSymbols = normalizedQuery
    ? stockSymbols
        .map((symbol) => ({ symbol, score: matchesFuzzy(symbol, normalizedQuery) }))
        .filter((item) => item.score !== null)
        .sort((a, b) => (b.score - a.score) || a.symbol.localeCompare(b.symbol))
        .map((item) => item.symbol)
    : [...stockSymbols].sort((a, b) => a.localeCompare(b));
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 100));
  const totalMatches = matchedSymbols.length;
  const totalPages = Math.max(1, Math.ceil(totalMatches / safePageSize));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const pageSymbols = matchedSymbols.slice((currentPage - 1) * safePageSize, currentPage * safePageSize);

  const [profiles, syncStates, latestRun, allSyncStates] = await Promise.all([
    DeepDiveCompanyProfile.find({ symbol: { $in: pageSymbols } }).lean(),
    DeepDiveSyncState.find({ symbol: { $in: pageSymbols } }).lean(),
    DeepDiveIngestionRun.findOne({ runType: { $in: PRICE_SYNC_RUN_TYPES } }).sort({ startedAt: -1 }).lean()
    ,
    DeepDiveSyncState.find({ symbol: { $in: stockSymbols } }).select({ symbol: 1, latestBarDate: 1 }).lean()
  ]);

  const profileBySymbol = new Map(profiles.map((item) => [item.symbol, item]));
  const syncStateBySymbol = new Map(syncStates.map((item) => [item.symbol, item]));

  const loadBarSnapshot = async (symbol) => {
    const [selectedBar, latestBar, firstBar, barsCount] = await Promise.all([
      selectedDate
        ? DeepDivePriceBar.findOne({ symbol, date: selectedDate }).select({
            date: 1,
            open: 1,
            high: 1,
            low: 1,
            close: 1,
            adjClose: 1,
            volume: 1
          }).lean()
        : Promise.resolve(null),
      DeepDivePriceBar.findOne({ symbol }).sort({ date: -1 }).select({
        date: 1,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        adjClose: 1,
        volume: 1
      }).lean(),
      DeepDivePriceBar.findOne({ symbol }).sort({ date: 1 }).select({ date: 1 }).lean(),
      DeepDivePriceBar.countDocuments({ symbol })
    ]);

    return [symbol, { selectedBar, latestBar, firstBar, barsCount }];
  };

  const barSnapshots = await Promise.all(
    pageSymbols.map((symbol) => loadBarSnapshot(symbol))
  );

  const barSnapshotBySymbol = new Map(barSnapshots);

  const stocks = pageSymbols
    .map((symbol) => {
      const snapshot = barSnapshotBySymbol.get(symbol) || {};
      const displayedBar = (selectedDate ? snapshot.selectedBar : snapshot.latestBar) || {};
      const latestBar = snapshot.latestBar || {};
      const firstBar = snapshot.firstBar || {};
      const profile = profileBySymbol.get(symbol) || {};
      const syncState = syncStateBySymbol.get(symbol) || {};
      const barsCount = Number(snapshot.barsCount || 0);
      return {
        symbol,
        companyName: String(profile.companyName || '').trim(),
        sector: String(profile.sector || '').trim(),
        industry: String(profile.industry || '').trim(),
        latestDate: displayedBar.date ? toDateKey(displayedBar.date) : null,
        latestOpen: round(safeNumber(displayedBar.open), 4),
        latestHigh: round(safeNumber(displayedBar.high), 4),
        latestLow: round(safeNumber(displayedBar.low), 4),
        latestClose: round(safeNumber(displayedBar.adjClose) ?? safeNumber(displayedBar.close), 4),
        latestVolume: round(safeNumber(displayedBar.volume), 0),
        barsCount,
        approxYears: round(barsCount / 252, 1),
        firstBarDate: firstBar.date ? toDateKey(firstBar.date) : null,
        lastSyncedAt: syncState.lastSyncedAt || null,
        lastProfileSyncedAt: syncState.lastProfileSyncedAt || profile.lastProfileSyncedAt || null,
        lastStatus: String(syncState.lastStatus || '').trim(),
        lastError: String(syncState.lastError || '').trim()
      };
    })
    .sort((a, b) => String(a.symbol || '').localeCompare(String(b.symbol || '')));

  const benchmarkProfile = await DeepDiveCompanyProfile.findOne({ symbol: NIFTY_BENCHMARK.symbol }).lean();
  const benchmarkSnapshotEntries = await loadBarSnapshot(NIFTY_BENCHMARK.symbol);
  const benchmarkSnapshot = benchmarkSnapshotEntries[1] || {};
  const benchmarkDisplayedBar = (selectedDate ? benchmarkSnapshot.selectedBar : benchmarkSnapshot.latestBar) || {};
  const benchmarkRow = {
    symbol: 'NIFTY50',
    companyName: NIFTY_BENCHMARK.displayName,
    sector: 'Benchmark',
    industry: 'Index',
    latestDate: benchmarkDisplayedBar.date ? toDateKey(benchmarkDisplayedBar.date) : null,
    latestOpen: round(safeNumber(benchmarkDisplayedBar.open), 4),
    latestHigh: round(safeNumber(benchmarkDisplayedBar.high), 4),
    latestLow: round(safeNumber(benchmarkDisplayedBar.low), 4),
    latestClose: round(safeNumber(benchmarkDisplayedBar.adjClose) ?? safeNumber(benchmarkDisplayedBar.close), 4),
    latestVolume: round(safeNumber(benchmarkDisplayedBar.volume), 0),
    barsCount: Number(benchmarkSnapshot.barsCount || 0),
    approxYears: round(Number(benchmarkSnapshot.barsCount || 0) / 252, 1),
    firstBarDate: benchmarkSnapshot.firstBar?.date ? toDateKey(benchmarkSnapshot.firstBar.date) : null,
    lastSyncedAt: null,
    lastProfileSyncedAt: benchmarkProfile?.lastProfileSyncedAt || null,
    lastStatus: 'success',
    lastError: '',
    pinned: true
  };

  return {
    lists: lists.map((item) => ({
      id: String(item._id),
      title: item.title,
      description: item.description || '',
      symbolCount: Array.isArray(item.symbols) ? item.symbols.length : 0,
      updatedAt: item.updatedAt,
      createdAt: item.createdAt
    })),
    summary: {
      totalLists: lists.length,
      totalSymbols: stockSymbols.length,
      latestAvailableDate: allSyncStates
        .map((item) => item.latestBarDate)
        .filter(Boolean)
        .map((item) => toDateKey(item))
        .sort((a, b) => b.localeCompare(a))[0] || null
    },
    query: normalizedQuery,
    asOfDate: selectedDate ? toDateKey(selectedDate) : null,
    page: currentPage,
    pageSize: safePageSize,
    totalMatches,
    totalPages,
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
      : null,
    benchmarkRow,
    stocks
  };
};

export const getDeepDiveErrorInventory = async ({ ownerUsername, query = '', page = 1, pageSize = 100 }) => {
  await ensureDeepDiveBenchmarks();
  const {
    DeepDiveStockList,
    DeepDiveCompanyProfile,
    DeepDiveSyncState
  } = await getModels();

  const canonical = await consolidateOwnerStockLists(DeepDiveStockList);
  const stockSymbols = [...new Set((canonical?.symbols || []).map((symbol) => normalizeDeepDiveSymbol(symbol)).filter(Boolean))];
  const normalizedQuery = normalizeSearchText(query);

  const [profiles, syncStates] = await Promise.all([
    DeepDiveCompanyProfile.find({ symbol: { $in: stockSymbols } }).lean(),
    DeepDiveSyncState.find({ symbol: { $in: stockSymbols } }).lean()
  ]);

  const profileBySymbol = new Map(profiles.map((item) => [item.symbol, item]));
  const syncStateBySymbol = new Map(syncStates.map((item) => [item.symbol, item]));

  const errorRows = stockSymbols
    .map((symbol) => {
      const profile = profileBySymbol.get(symbol) || {};
      const syncState = syncStateBySymbol.get(symbol) || {};
      const hasBars = Boolean(syncState.latestBarDate);
      const hasError = Boolean(String(syncState.lastError || '').trim());
      if (hasBars && !hasError) return null;
      return {
        symbol,
        companyName: String(profile.companyName || '').trim(),
        sector: String(profile.sector || '').trim(),
        industry: String(profile.industry || '').trim(),
        latestBarDate: syncState.latestBarDate ? toDateKey(syncState.latestBarDate) : null,
        lastSyncedAt: syncState.lastSyncedAt || null,
        lastStatus: String(syncState.lastStatus || '').trim() || (hasBars ? 'unknown' : 'no_price_history'),
        lastError: String(syncState.lastError || '').trim(),
        issue: hasBars ? 'Sync Error' : 'No Bars'
      };
    })
    .filter(Boolean);

  const matchedRows = normalizedQuery
    ? errorRows
        .map((row) => ({
          row,
          score: Math.max(
            matchesFuzzy(row.symbol, normalizedQuery) ?? -1,
            matchesFuzzy(row.companyName, normalizedQuery) ?? -1
          )
        }))
        .filter((item) => item.score >= 0)
        .sort((a, b) => (b.score - a.score) || a.row.symbol.localeCompare(b.row.symbol))
        .map((item) => item.row)
    : errorRows.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 100));
  const totalMatches = matchedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalMatches / safePageSize));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const rows = matchedRows.slice((currentPage - 1) * safePageSize, currentPage * safePageSize);

  return {
    query: normalizedQuery,
    page: currentPage,
    pageSize: safePageSize,
    totalMatches,
    totalPages,
    rows
  };
};

const runDeepDiveIngestionScript = ({ mode = 'daily_sync' } = {}) =>
  new Promise((resolve, reject) => {
    const normalizedMode = ['backfill_prices', 'sync_prices', 'sync_profiles', 'daily_sync'].includes(mode)
      ? mode
      : 'daily_sync';
    const pythonBin = resolvePythonBin();
    activeDeepDiveSync = createActiveSyncState(normalizedMode, pythonBin);
    const child = spawn(pythonBin, [DEEP_DIVE_INGEST_SCRIPT_PATH, '--mode', normalizedMode], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const flushBufferedLines = (buffer, sink) => {
      const lines = buffer.split('\n');
      const pending = lines.pop() || '';
      lines
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          sink += `${line}\n`;
          pushActiveSyncLine(line);
        });
      return { pending, sink };
    };

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const flushed = flushBufferedLines(stdoutBuffer, stdout);
      stdoutBuffer = flushed.pending;
      stdout = flushed.sink;
    });
    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
      const flushed = flushBufferedLines(stderrBuffer, stderr);
      stderrBuffer = flushed.pending;
      stderr = flushed.sink;
    });
    child.on('error', (error) => {
      finishActiveSync('failed', `Failed to run ${pythonBin}: ${error.message}`);
      reject(new Error(`Failed to run ${pythonBin}: ${error.message}`));
    });
    child.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        const line = stdoutBuffer.trim();
        stdout += `${line}\n`;
        pushActiveSyncLine(line);
      }
      if (stderrBuffer.trim()) {
        const line = stderrBuffer.trim();
        stderr += `${line}\n`;
        pushActiveSyncLine(line);
      }

      if (code !== 0) {
        finishActiveSync('failed', stderr.trim() || stdout.trim() || `Deep Dive sync failed (exit ${code})`);
        reject(new Error(stderr.trim() || stdout.trim() || `Deep Dive sync failed (exit ${code})`));
        return;
      }

      const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const jsonLine = [...lines].reverse().find((line) => line.startsWith('{') && line.endsWith('}'));
      let summary = null;
      if (jsonLine) {
        try {
          summary = JSON.parse(jsonLine.replace(/'/g, '"'));
        } catch {
          summary = null;
        }
      }

      if (summary && activeDeepDiveSync) {
        activeDeepDiveSync.current = Number(summary.symbolsAttempted || activeDeepDiveSync.current);
        activeDeepDiveSync.total = Number(summary.symbolsAttempted || activeDeepDiveSync.total);
      }
      finishActiveSync('success', `Finished ${normalizedMode}`);

      resolve({
        mode: normalizedMode,
        summary,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });

export const triggerDeepDiveSync = async ({ mode = 'daily_sync' } = {}) => {
  const result = await runDeepDiveIngestionScript({ mode });
  return result;
};

const loadAllImportedSymbols = async (DeepDiveStockList) => {
  const canonical = await consolidateOwnerStockLists(DeepDiveStockList);
  return [...new Set((canonical?.symbols || []).map((symbol) => normalizeDeepDiveSymbol(symbol)).filter(Boolean))];
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
  let stockList = null;
  if (stockListId) {
    if (!isValidDeepDiveId(stockListId)) {
      throw createError('Invalid stockListId', 400);
    }
    await consolidateOwnerStockLists(DeepDiveStockList);
    stockList = await DeepDiveStockList.findOne({ _id: stockListId, ownerUsername: DEEP_DIVE_SHARED_OWNER }).lean();
    if (!stockList) throw createError('Stock list not found', 404);
  }

  const selectedSymbolsOverride = Array.isArray(payload?.selectedSymbols)
    ? payload.selectedSymbols.map((item) => normalizeDeepDiveSymbol(item)).filter(Boolean)
    : [];
  const stockSymbols = selectedSymbolsOverride.length
    ? [...new Set(selectedSymbolsOverride)]
    : stockList
      ? [...new Set((stockList.symbols || []).map((item) => normalizeDeepDiveSymbol(item)).filter(Boolean))]
      : await loadAllImportedSymbols(DeepDiveStockList);

  if (!stockSymbols.length) {
    return {
      stockList: stockList
        ? { id: String(stockList._id), title: stockList.title, symbolCount: 0 }
        : { id: 'all-imported', title: 'All Imported Stocks', symbolCount: 0 },
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
    const periodGapPct = computeBoundaryGapPct(startBar, endBar, changePct);
    benchmarkStatsByKey[benchmark.key] = {
      benchmark,
      startBar,
      endBar,
      startClose,
      endClose,
      changePct,
      periodGapPct
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
      startHigh: round(getHighValue(startBar), 4),
      startLow: round(getLowValue(startBar), 4),
      endHigh: round(getHighValue(endBar), 4),
      endLow: round(getLowValue(endBar), 4),
      changePct: round(changePct),
      periodGapPct: round(periodGapPct)
    });
  }

  const minStockChangePct = numberParam(payload?.minStockChangePct);
  const maxStockChangePct = numberParam(payload?.maxStockChangePct);
  const minLiquidity20d =
    numberParam(payload?.minLiquidity20d) ?? DEEP_DIVE_DEFAULT_MIN_LIQUIDITY;
  const sectorFilter = String(payload?.sector || '').trim();
  const industryFilter = String(payload?.industry || '').trim();
  const sortBy = String(payload?.sortBy || 'changePct').trim();
  const sortDirection = String(payload?.sortDirection || 'desc').trim().toLowerCase();
  const topN = numberParam(payload?.topN);
  const requestedPage = Math.max(1, Number(payload?.page) || 1);
  const requestedPageSize = Math.min(5000, Math.max(1, Number(payload?.pageSize) || 100));
  const relativeBenchmarkKey = DEEP_DIVE_BENCHMARKS.some((item) => item.key === String(payload?.relativeBenchmarkKey || '').trim())
    ? String(payload.relativeBenchmarkKey).trim()
    : 'NIFTY';
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
    const stockGapPct = computeBoundaryGapPct(startBar, endBar, stockChangePct);
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
      const benchmarkGapPct = benchmarkStats.periodGapPct;
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
        Number.isFinite(stockGapPct) &&
        Number.isFinite(benchmarkGapPct) &&
        Math.abs(benchmarkGapPct) > 0.000001
          ? stockGapPct / benchmarkGapPct
          : null;

      benchmarkMetrics[benchmark.key] = {
        key: benchmark.key,
        displayName: benchmark.displayName,
        benchmarkGapPct: round(benchmarkGapPct),
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
      stockStartHigh: round(getHighValue(startBar), 4),
      stockStartLow: round(getLowValue(startBar), 4),
      stockEndHigh: round(getHighValue(endBar), 4),
      stockEndLow: round(getLowValue(endBar), 4),
      stockChangePct: round(stockChangePct),
      changePct: round(stockGapPct),
      latestDate: latestBarDate,
      liquidity20d: round(liquidity20d, 2),
      barsCount: Number(stockBars.length || 0),
      approxYears: round(stockBars.length / 252, 1),
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
    row.relativeBenchmarkKey = relativeBenchmarkKey;
    row.relativePerformanceMultiple = benchmarkMetrics[relativeBenchmarkKey]?.xMultiple ?? null;
    row.xIndex = benchmarkMetrics[relativeBenchmarkKey]?.xMultiple ?? null;
    row.relativePerformancePct = round(
      safePct(row.changePct, benchmarkMetrics[relativeBenchmarkKey]?.benchmarkGapPct)
    );

    if (Number.isFinite(minStockChangePct) && (!Number.isFinite(row.changePct) || row.changePct < minStockChangePct)) {
      continue;
    }
    if (Number.isFinite(maxStockChangePct) && (!Number.isFinite(row.changePct) || row.changePct > maxStockChangePct)) {
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
  const totalRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / requestedPageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const pageStart = (currentPage - 1) * requestedPageSize;
  const paginatedRows = sortedRows.slice(pageStart, pageStart + requestedPageSize);

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
      id: stockList ? String(stockList._id) : 'all-imported',
      title: stockList?.title || 'All Imported Stocks',
      symbolCount: stockSymbols.length
    },
    benchmarkSummaries,
    rows: paginatedRows,
    totalRows,
    page: currentPage,
    pageSize: requestedPageSize,
    totalPages,
    skippedSymbols,
    symbolStatuses,
    symbolStatusSummary,
    effectiveDates,
    filters: {
      availableSectors: sectors,
      availableIndustries: industries
    },
    relativeBenchmarkKey,
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
