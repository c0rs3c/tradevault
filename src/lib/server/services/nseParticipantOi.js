import { parseCsv } from '../utils/csv.js';
import NseParticipantOiSnapshot from '../models/NseParticipantOiSnapshot.js';

export const DEFAULT_BACKFILL_START_DATE = '2025-05-01';
export const DEFAULT_BACKFILL_END_DATE = '2026-05-01';

const NSE_ARCHIVE_URL = 'https://archives.nseindia.com/content/nsccl';
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/csv,text/plain,*/*',
  Referer: 'https://www.nseindia.com/'
};

const FIELD_CANDIDATES = {
  clientType: ['Client Type'],
  futureIndexLong: ['Future Index Long'],
  futureIndexShort: ['Future Index Short'],
  futureStockLong: ['Future Stock Long'],
  futureStockShort: ['Future Stock Short'],
  optionIndexCallLong: ['Option Index Call Long'],
  optionIndexPutLong: ['Option Index Put Long'],
  optionIndexCallShort: ['Option Index Call Short'],
  optionIndexPutShort: ['Option Index Put Short'],
  optionStockCallLong: ['Option Stock Call Long'],
  optionStockPutLong: ['Option Stock Put Long'],
  optionStockCallShort: ['Option Stock Call Short'],
  optionStockPutShort: ['Option Stock Put Short'],
  totalLongContracts: ['Total Long Contracts'],
  totalShortContracts: ['Total Short Contracts']
};

const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeHeader = (header) =>
  String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const toDateOnly = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const formatDateKey = (value) => {
  const date = toDateOnly(value);
  return date.toISOString().slice(0, 10);
};

const formatArchiveDate = (value) => {
  const date = toDateOnly(value);
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  return `${dd}${mm}${yyyy}`;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const toSafeNumber = (value) => {
  if (value === null || value === undefined) return 0;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) return 0;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
};

const isWeekend = (value) => {
  const date = toDateOnly(value);
  const day = date.getUTCDay();
  return day === 0 || day === 6;
};

export const buildDateRange = (startDate = DEFAULT_BACKFILL_START_DATE, endDate = DEFAULT_BACKFILL_END_DATE) => {
  const start = toDateOnly(startDate);
  const end = toDateOnly(endDate);
  if (start > end) return [];

  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

const findHeaderIndexes = (headers) => {
  const normalizedHeaders = headers.map(normalizeHeader);
  const indexes = {};

  Object.entries(FIELD_CANDIDATES).forEach(([field, candidates]) => {
    const normalizedCandidates = candidates.map(normalizeHeader);
    indexes[field] = normalizedHeaders.findIndex((header) => normalizedCandidates.includes(header));
  });

  return indexes;
};

export const parseParticipantOiCsv = ({ csvText, tradeDate, sourceUrl = '' }) => {
  const rows = parseCsv(String(csvText || ''));
  if (!rows.length) {
    throw createError(`NSE participant CSV is empty for ${formatDateKey(tradeDate)}`, 502);
  }

  const headerRowIndex = rows.findIndex((row) => {
    const indexes = findHeaderIndexes(row);
    return indexes.clientType >= 0 && indexes.futureIndexLong >= 0 && indexes.futureIndexShort >= 0;
  });

  if (headerRowIndex < 0) {
    throw createError(`NSE participant CSV header is invalid for ${formatDateKey(tradeDate)}`, 502);
  }

  const headerIndexes = findHeaderIndexes(rows[headerRowIndex]);

  const parsedRows = rows
    .slice(headerRowIndex + 1)
    .map((row) => {
      const clientType = String(row[headerIndexes.clientType] || '').trim().toUpperCase();
      if (!clientType) return null;

      return {
        tradeDate: toDateOnly(tradeDate),
        clientType,
        futureIndexLong: toSafeNumber(row[headerIndexes.futureIndexLong]),
        futureIndexShort: toSafeNumber(row[headerIndexes.futureIndexShort]),
        futureStockLong: toSafeNumber(row[headerIndexes.futureStockLong]),
        futureStockShort: toSafeNumber(row[headerIndexes.futureStockShort]),
        optionIndexCallLong: toSafeNumber(row[headerIndexes.optionIndexCallLong]),
        optionIndexPutLong: toSafeNumber(row[headerIndexes.optionIndexPutLong]),
        optionIndexCallShort: toSafeNumber(row[headerIndexes.optionIndexCallShort]),
        optionIndexPutShort: toSafeNumber(row[headerIndexes.optionIndexPutShort]),
        optionStockCallLong: toSafeNumber(row[headerIndexes.optionStockCallLong]),
        optionStockPutLong: toSafeNumber(row[headerIndexes.optionStockPutLong]),
        optionStockCallShort: toSafeNumber(row[headerIndexes.optionStockCallShort]),
        optionStockPutShort: toSafeNumber(row[headerIndexes.optionStockPutShort]),
        totalLongContracts: toSafeNumber(row[headerIndexes.totalLongContracts]),
        totalShortContracts: toSafeNumber(row[headerIndexes.totalShortContracts]),
        sourceUrl,
        downloadedAt: new Date()
      };
    })
    .filter(Boolean);

  if (!parsedRows.length) {
    throw createError(`NSE participant CSV has no participant rows for ${formatDateKey(tradeDate)}`, 502);
  }

  return parsedRows;
};

const fetchWithRetry = async (url, { attempts = 3, timeoutMs = 15000 } = {}) => {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: REQUEST_HEADERS,
        signal: controller.signal,
        cache: 'no-store'
      });

      if (response.status === 404 || response.status === 403) {
        clearTimeout(timer);
        return { kind: 'missing', status: response.status };
      }

      if (!response.ok) {
        const error = createError(`Failed to download NSE participant CSV (${response.status})`, 502);
        error.retryable = RETRYABLE_STATUS_CODES.has(response.status);
        throw error;
      }

      const csvText = await response.text();
      clearTimeout(timer);
      return { kind: 'ok', csvText };
    } catch (error) {
      clearTimeout(timer);
      const isAbort = error?.name === 'AbortError';
      const retryable = isAbort || error?.retryable;
      lastError = error;

      if (!retryable || attempt === attempts) {
        break;
      }

      await sleep(500 * attempt + randomBetween(150, 350));
    }
  }

  throw lastError || createError('Failed to download NSE participant CSV', 502);
};

export const upsertParticipantSnapshots = async (rows) => {
  if (!rows.length) return { upserted: 0 };

  const result = await NseParticipantOiSnapshot.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: {
          tradeDate: row.tradeDate,
          clientType: row.clientType
        },
        update: { $set: row },
        upsert: true
      }
    })),
    { ordered: true }
  );

  const inserted = Number(result.upsertedCount || 0);
  const modified = Number(result.modifiedCount || 0);
  const matched = Number(result.matchedCount || 0);

  return { upserted: inserted + modified + matched };
};

export const getNseParticipantArchiveUrl = (tradeDate) =>
  `${NSE_ARCHIVE_URL}/fao_participant_oi_${formatArchiveDate(tradeDate)}.csv`;

export const syncParticipantOiForDates = async (dates) => {
  const results = {
    attemptedDates: 0,
    importedDates: 0,
    skippedWeekends: 0,
    skippedMissing: 0,
    failedDates: [],
    rowsProcessed: 0,
    dateResults: []
  };

  // Sequential by design to stay polite with NSE archive requests.
  // eslint-disable-next-line no-restricted-syntax
  for (const date of dates) {
    const tradeDate = toDateOnly(date);
    const tradeDateKey = formatDateKey(tradeDate);

    if (isWeekend(tradeDate)) {
      results.skippedWeekends += 1;
      results.dateResults.push({ tradeDate: tradeDateKey, status: 'weekend' });
      continue;
    }

    results.attemptedDates += 1;
    const sourceUrl = getNseParticipantArchiveUrl(tradeDate);

    try {
      await sleep(randomBetween(250, 700));
      const response = await fetchWithRetry(sourceUrl);

      if (response.kind === 'missing') {
        results.skippedMissing += 1;
        results.dateResults.push({ tradeDate: tradeDateKey, status: 'missing' });
        continue;
      }

      const rows = parseParticipantOiCsv({
        csvText: response.csvText,
        tradeDate,
        sourceUrl
      });
      const writeResult = await upsertParticipantSnapshots(rows);

      results.importedDates += 1;
      results.rowsProcessed += rows.length;
      results.dateResults.push({
        tradeDate: tradeDateKey,
        status: 'imported',
        rowCount: rows.length,
        upsertedRows: writeResult.upserted
      });
    } catch (error) {
      const message = error?.message || 'Unknown error';
      results.failedDates.push({ tradeDate: tradeDateKey, message });
      results.dateResults.push({ tradeDate: tradeDateKey, status: 'failed', message });
    }
  }

  return results;
};

export const getTradingDatesWithinRange = (startDate = DEFAULT_BACKFILL_START_DATE, endDate = DEFAULT_BACKFILL_END_DATE) =>
  buildDateRange(startDate, endDate).filter((date) => !isWeekend(date));

export const getLatestTradingDates = (count, endDate = DEFAULT_BACKFILL_END_DATE) => {
  const dates = getTradingDatesWithinRange(DEFAULT_BACKFILL_START_DATE, endDate);
  return dates.slice(Math.max(0, dates.length - count));
};

export const getDateKey = formatDateKey;
