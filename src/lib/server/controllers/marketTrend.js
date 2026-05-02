import NseParticipantOiSnapshot from '../models/NseParticipantOiSnapshot.js';
import {
  DEFAULT_BACKFILL_END_DATE,
  DEFAULT_BACKFILL_START_DATE,
  getDateKey,
  getLatestTradingDates,
  getTradingDatesWithinRange,
  syncParticipantOiForDates
} from '../services/nseParticipantOi.js';

const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const toParticipantSummaryRow = (row) => {
  const indexFuturesNet = Number(row.futureIndexLong || 0) - Number(row.futureIndexShort || 0);
  const callShortVsPutShort =
    Number(row.optionIndexCallShort || 0) - Number(row.optionIndexPutShort || 0);
  const callNet = Number(row.optionIndexCallLong || 0) - Number(row.optionIndexCallShort || 0);
  const putNet = Number(row.optionIndexPutLong || 0) - Number(row.optionIndexPutShort || 0);

  return {
    clientType: row.clientType,
    futureIndexLong: Number(row.futureIndexLong || 0),
    futureIndexShort: Number(row.futureIndexShort || 0),
    optionIndexCallLong: Number(row.optionIndexCallLong || 0),
    optionIndexPutLong: Number(row.optionIndexPutLong || 0),
    optionIndexCallShort: Number(row.optionIndexCallShort || 0),
    optionIndexPutShort: Number(row.optionIndexPutShort || 0),
    totalLongContracts: Number(row.totalLongContracts || 0),
    totalShortContracts: Number(row.totalShortContracts || 0),
    indexFuturesNet,
    callNet,
    putNet,
    callShortVsPutShort
  };
};

export const syncMarketTrendBackfill = async () => {
  const dates = getTradingDatesWithinRange(DEFAULT_BACKFILL_START_DATE, DEFAULT_BACKFILL_END_DATE);
  return syncParticipantOiForDates(dates);
};

export const syncMarketTrendIncremental = async () => {
  const allTradingDates = getTradingDatesWithinRange(
    DEFAULT_BACKFILL_START_DATE,
    DEFAULT_BACKFILL_END_DATE
  );
  const existing = await NseParticipantOiSnapshot.distinct('tradeDate', {
    tradeDate: {
      $gte: new Date(`${DEFAULT_BACKFILL_START_DATE}T00:00:00.000Z`),
      $lte: new Date(`${DEFAULT_BACKFILL_END_DATE}T00:00:00.000Z`)
    }
  });

  const existingKeys = new Set(existing.map((item) => getDateKey(item)));
  const recentDates = getLatestTradingDates(5, DEFAULT_BACKFILL_END_DATE);
  const recentKeys = new Set(recentDates.map((item) => getDateKey(item)));

  const targetDates = allTradingDates.filter((date) => {
    const key = getDateKey(date);
    return !existingKeys.has(key) || recentKeys.has(key);
  });

  if (!targetDates.length) {
    return {
      attemptedDates: 0,
      importedDates: 0,
      skippedWeekends: 0,
      skippedMissing: 0,
      failedDates: [],
      rowsProcessed: 0,
      dateResults: []
    };
  }

  return syncParticipantOiForDates(targetDates);
};

export const getMarketTrendDashboard = async () => {
  const snapshots = await NseParticipantOiSnapshot.find({
    tradeDate: {
      $gte: new Date(`${DEFAULT_BACKFILL_START_DATE}T00:00:00.000Z`),
      $lte: new Date(`${DEFAULT_BACKFILL_END_DATE}T00:00:00.000Z`)
    }
  })
    .sort({ tradeDate: 1, clientType: 1 })
    .lean();

  if (!snapshots.length) {
    return {
      meta: {
        startDate: DEFAULT_BACKFILL_START_DATE,
        endDate: DEFAULT_BACKFILL_END_DATE,
        availableTradingDays: 0,
        latestTradeDate: null,
        lastSyncedAt: null
      },
      charts: {
        fiiIndexPositioningNets: []
      },
      latestParticipants: []
    };
  }

  const groupedByDate = snapshots.reduce((acc, row) => {
    const key = getDateKey(row.tradeDate);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(row);
    return acc;
  }, new Map());

  const fiiSeries = [];
  let latestTradeDate = null;
  let latestParticipants = [];
  const participantSnapshots = [];

  Array.from(groupedByDate.entries()).forEach(([tradeDate, rows]) => {
    const fiiRow = rows.find((row) => row.clientType === 'FII');
    if (fiiRow) {
      const futureLong = Number(fiiRow.futureIndexLong || 0);
      const futureShort = Number(fiiRow.futureIndexShort || 0);
      const futureNet = Number(fiiRow.futureIndexLong || 0) - Number(fiiRow.futureIndexShort || 0);
      const callLong = Number(fiiRow.optionIndexCallLong || 0);
      const putLong = Number(fiiRow.optionIndexPutLong || 0);
      const callShort = Number(fiiRow.optionIndexCallShort || 0);
      const putShort = Number(fiiRow.optionIndexPutShort || 0);

      fiiSeries.push({
        date: tradeDate,
        futureIndexLong: futureLong,
        futureIndexShort: futureShort,
        fiiIndexFuturesNet: futureNet,
        optionIndexCallLong: callLong,
        optionIndexPutLong: putLong,
        optionIndexCallShort: callShort,
        optionIndexPutShort: putShort,
        callNet: callLong - callShort,
        putNet: putLong - putShort
      });
    }

    latestTradeDate = tradeDate;
    latestParticipants = rows.map(toParticipantSummaryRow);
    participantSnapshots.push({
      date: tradeDate,
      participants: latestParticipants
    });
  });

  if (!fiiSeries.length) {
    throw createError('Stored NSE participant data does not contain FII rows', 500);
  }
  const latestDoc = snapshots.reduce((acc, row) => {
    if (!acc) return row;
    return new Date(row.updatedAt) > new Date(acc.updatedAt) ? row : acc;
  }, null);

  return {
    meta: {
      startDate: DEFAULT_BACKFILL_START_DATE,
      endDate: DEFAULT_BACKFILL_END_DATE,
      availableTradingDays: fiiSeries.length,
      latestTradeDate,
      lastSyncedAt: latestDoc?.updatedAt ? new Date(latestDoc.updatedAt).toISOString() : null
    },
    charts: {
      fiiIndexPositioningNets: fiiSeries.map((row) => ({
        date: row.date,
        value: row.fiiIndexFuturesNet,
        callNet: row.callNet,
        putNet: row.putNet
      }))
    },
    latestParticipants,
    participantSnapshots
  };
};
