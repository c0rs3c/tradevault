import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { queryScreenerPostgres } from '@/lib/server/postgres';
import { resolvePythonBin } from '@/lib/server/utils/pythonRuntime';

const NSE_UNIVERSE_FILE_PATH = path.resolve(process.cwd(), 'data/nse-universe.csv');
const NSE_UNIVERSE_SYNC_SCRIPT_PATH = path.resolve(process.cwd(), 'scripts/sync_nse_universe_history.py');
const NSE_UNIVERSE_HISTORY_START_DATE = '2020-01-01';
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE_MIN = 25;
const PAGE_SIZE_MAX = 250;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MARKET_CAP_STALE_DAYS = 7;
const NSE_UNIVERSE_SYNC_STALE_MS = 2 * 60 * 1000;

let ensureTablesPromise = null;
let ensureSymbolsPromise = null;
let activeNseUniverseSync = null;
const NSE_UNIVERSE_SYNC_STATE_KEY = 'nse-universe';

const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const maybeNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const maybeInteger = (value) => {
  const num = maybeNumber(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
};

const formatDateKey = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const parseDateParam = (value, label = 'date') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw createError(`Invalid ${label}`, 400);
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw createError(`Invalid ${label}`, 400);
  }
  return raw;
};

const parseOptionalNumberParam = (value, label) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw createError(`Invalid ${label}`, 400);
  }
  return parsed;
};

const normalizeNseUniverseSymbol = (value) => {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^NSE:/, '')
    .replace(/^BSE:/, '')
    .replace(/-(EQ|BE|BZ|BL|SM|ST)$/g, '')
    .replace(/\s+/g, '');
  if (!normalized) return '';
  if (!/^[A-Z0-9][A-Z0-9&._-]{0,39}$/.test(normalized)) {
    throw createError('Invalid symbol', 400);
  }
  return normalized;
};

const buildYfinanceTickerCandidates = (symbol) => {
  const normalized = normalizeNseUniverseSymbol(symbol);
  return [...new Set([`${normalized.replaceAll('&', '_')}.NS`, `${normalized}.NS`])];
};

const buildYfinanceTicker = (symbol) => buildYfinanceTickerCandidates(symbol)[0];

const parseUniverseSymbolsCsv = (text) =>
  [...new Set(
    String(text || '')
      .split(/[\s,\r\n\t]+/)
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .map((item) => item.replace(/^NSE:/i, ''))
      .map((item) => normalizeNseUniverseSymbol(item))
      .filter(Boolean)
  )];

const loadUniverseSymbolsFromFile = async () => {
  const text = await fs.readFile(NSE_UNIVERSE_FILE_PATH, 'utf8');
  const symbols = parseUniverseSymbolsCsv(text);
  if (!symbols.length) {
    throw createError('No symbols found in data/nse-universe.csv', 500);
  }
  return symbols;
};

const ensureNseUniverseTables = async () => {
  if (!ensureTablesPromise) {
    ensureTablesPromise = (async () => {
      await queryScreenerPostgres(`
        CREATE TABLE IF NOT EXISTS nse_universe_symbols (
          symbol TEXT PRIMARY KEY,
          tv_symbol TEXT NOT NULL UNIQUE,
          yfinance_ticker TEXT NOT NULL,
          company_name TEXT NOT NULL DEFAULT '',
          market_cap BIGINT,
          market_cap_updated_at TIMESTAMPTZ,
          last_history_sync_date DATE,
          latest_history_sync_at TIMESTAMPTZ,
          last_success_at TIMESTAMPTZ,
          last_error TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await queryScreenerPostgres(`
        CREATE TABLE IF NOT EXISTS nse_universe_daily_bars (
          symbol TEXT NOT NULL REFERENCES nse_universe_symbols(symbol) ON DELETE CASCADE,
          trade_date DATE NOT NULL,
          open NUMERIC,
          high NUMERIC,
          low NUMERIC,
          close NUMERIC,
          adj_close NUMERIC,
          volume BIGINT,
          sma_10 NUMERIC,
          sma_20 NUMERIC,
          sma_50 NUMERIC,
          sma_200 NUMERIC,
          volume_sma_30 NUMERIC,
          rupee_volume_crore NUMERIC,
          market_cap BIGINT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY(symbol, trade_date)
        )
      `);
      await queryScreenerPostgres(`
        CREATE INDEX IF NOT EXISTS idx_nse_universe_daily_bars_trade_date
        ON nse_universe_daily_bars(trade_date DESC, symbol ASC)
      `);
      await queryScreenerPostgres(`
        CREATE INDEX IF NOT EXISTS idx_nse_universe_symbols_company_name
        ON nse_universe_symbols(company_name)
      `);
      await queryScreenerPostgres(`
        CREATE TABLE IF NOT EXISTS nse_universe_sync_state (
          sync_key TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'idle',
          sync_date DATE,
          python_bin TEXT NOT NULL DEFAULT '',
          started_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ,
          finished_at TIMESTAMPTZ,
          current_count INTEGER NOT NULL DEFAULT 0,
          total_count INTEGER NOT NULL DEFAULT 0,
          current_symbol TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL DEFAULT '',
          recent_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
          summary JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((error) => {
      ensureTablesPromise = null;
      throw error;
    });
  }
  return ensureTablesPromise;
};

const ensureNseUniverseSymbolsSeeded = async () => {
  await ensureNseUniverseTables();
  if (!ensureSymbolsPromise) {
    ensureSymbolsPromise = (async () => {
      const symbols = await loadUniverseSymbolsFromFile();
      const staleAmpersandSymbols = symbols
        .filter((symbol) => symbol.includes('_'))
        .map((symbol) => symbol.replaceAll('_', '&'))
        .filter(Boolean);

      if (staleAmpersandSymbols.length) {
        const placeholders = staleAmpersandSymbols.map((_, index) => `$${index + 1}`).join(', ');
        await queryScreenerPostgres(
          `
            DELETE FROM nse_universe_daily_bars
            WHERE symbol IN (${placeholders})
          `,
          staleAmpersandSymbols
        );
        await queryScreenerPostgres(
          `
            DELETE FROM nse_universe_symbols
            WHERE symbol IN (${placeholders})
          `,
          staleAmpersandSymbols
        );
      }

      for (let index = 0; index < symbols.length; index += 500) {
        const chunk = symbols.slice(index, index + 500);
        const values = [];
        const placeholders = chunk
          .map((symbol, chunkIndex) => {
            const base = chunkIndex * 3;
            values.push(symbol, `NSE:${symbol}`, buildYfinanceTicker(symbol));
            return `($${base + 1}, $${base + 2}, $${base + 3})`;
          })
          .join(', ');

        await queryScreenerPostgres(
          `
            INSERT INTO nse_universe_symbols (symbol, tv_symbol, yfinance_ticker)
            VALUES ${placeholders}
            ON CONFLICT (symbol) DO UPDATE SET
              tv_symbol = EXCLUDED.tv_symbol,
              yfinance_ticker = EXCLUDED.yfinance_ticker,
              updated_at = NOW()
          `,
          values
        );
      }
    })().catch((error) => {
      ensureSymbolsPromise = null;
      throw error;
    });
  }
  return ensureSymbolsPromise;
};

const persistSyncState = async (state) => {
  await ensureNseUniverseTables();
  const recentLines = JSON.stringify(Array.isArray(state?.recentLines) ? state.recentLines : []);
  const summary = state?.summary ? JSON.stringify(state.summary) : null;
  await queryScreenerPostgres(
    `
      INSERT INTO nse_universe_sync_state (
        sync_key,
        status,
        sync_date,
        python_bin,
        started_at,
        updated_at,
        finished_at,
        current_count,
        total_count,
        current_symbol,
        message,
        recent_lines,
        summary
      )
      VALUES ($1, $2, $3::date, $4, $5::timestamptz, $6::timestamptz, $7::timestamptz, $8, $9, $10, $11, $12::jsonb, $13::jsonb)
      ON CONFLICT (sync_key) DO UPDATE SET
        status = EXCLUDED.status,
        sync_date = EXCLUDED.sync_date,
        python_bin = EXCLUDED.python_bin,
        started_at = EXCLUDED.started_at,
        updated_at = EXCLUDED.updated_at,
        finished_at = EXCLUDED.finished_at,
        current_count = EXCLUDED.current_count,
        total_count = EXCLUDED.total_count,
        current_symbol = EXCLUDED.current_symbol,
        message = EXCLUDED.message,
        recent_lines = EXCLUDED.recent_lines,
        summary = EXCLUDED.summary
    `,
    [
      NSE_UNIVERSE_SYNC_STATE_KEY,
      String(state?.status || 'idle'),
      state?.syncDate || null,
      String(state?.pythonBin || ''),
      state?.startedAt || null,
      state?.updatedAt || null,
      state?.finishedAt || null,
      Number(state?.current || 0),
      Number(state?.total || 0),
      String(state?.currentSymbol || ''),
      String(state?.message || ''),
      recentLines,
      summary
    ]
  );
};

const readPersistedSyncState = async () => {
  await ensureNseUniverseTables();
  const result = await queryScreenerPostgres(
    `
      SELECT
        status,
        sync_date,
        python_bin,
        started_at,
        updated_at,
        finished_at,
        current_count,
        total_count,
        current_symbol,
        message,
        recent_lines,
        summary
      FROM nse_universe_sync_state
      WHERE sync_key = $1
      LIMIT 1
    `,
    [NSE_UNIVERSE_SYNC_STATE_KEY]
  );

  const row = result.rows[0];
  if (!row) return null;

  let recentLines = [];
  let summary = null;

  try {
    recentLines = Array.isArray(row.recent_lines)
      ? row.recent_lines
      : JSON.parse(String(row.recent_lines || '[]'));
  } catch {
    recentLines = [];
  }

  try {
    summary = row.summary && typeof row.summary === 'object' ? row.summary : JSON.parse(String(row.summary || 'null'));
  } catch {
    summary = null;
  }

  return {
    status: row.status || 'idle',
    syncDate: formatDateKey(row.sync_date) || null,
    pythonBin: row.python_bin || '',
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    current: maybeInteger(row.current_count) || 0,
    total: maybeInteger(row.total_count) || 0,
    currentSymbol: row.current_symbol || '',
    message: row.message || '',
    recentLines,
    summary
  };
};

const isStaleRunningSync = (state) => {
  if (!state || state.status !== 'running' || !state.updatedAt) return false;
  const updatedAtMs = new Date(state.updatedAt).getTime();
  if (Number.isNaN(updatedAtMs)) return false;
  return Date.now() - updatedAtMs > NSE_UNIVERSE_SYNC_STALE_MS;
};

const recoverStaleSyncState = async (state) => {
  if (!isStaleRunningSync(state)) return state;
  const recovered = {
    ...state,
    status: 'failed',
    finishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    message: state.message
      ? `${state.message} | Sync status recovered after becoming stale.`
      : 'Sync status recovered after becoming stale.'
  };
  await persistSyncState(recovered);
  return recovered;
};

const parseSyncSummary = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const createActiveSyncState = ({ syncDate, pythonBin }) => ({
  status: 'running',
  syncDate,
  pythonBin,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  finishedAt: null,
  current: 0,
  total: 0,
  currentSymbol: '',
  message: 'Starting NSE Universe sync...',
  recentLines: [],
  summary: null
});

const pushActiveSyncLine = (line) => {
  if (!activeNseUniverseSync || !line) return;
  const trimmed = String(line).trim();
  if (!trimmed) return;

  const parsedSummary = parseSyncSummary(trimmed);
  if (parsedSummary?.status) {
    activeNseUniverseSync.summary = parsedSummary;
    activeNseUniverseSync.updatedAt = new Date().toISOString();
    void persistSyncState(activeNseUniverseSync).catch(() => {});
    return;
  }

  activeNseUniverseSync.updatedAt = new Date().toISOString();
  activeNseUniverseSync.message = trimmed;
  activeNseUniverseSync.recentLines = [...activeNseUniverseSync.recentLines, trimmed].slice(-8);

  const progressMatch = trimmed.match(/^(\d+)\/(\d+)\s+(synced|skipped|failed)\s+([A-Z0-9&._-]+)/i);
  if (progressMatch) {
    activeNseUniverseSync.current = Number(progressMatch[1]) || activeNseUniverseSync.current;
    activeNseUniverseSync.total = Number(progressMatch[2]) || activeNseUniverseSync.total;
    activeNseUniverseSync.currentSymbol = progressMatch[4] || activeNseUniverseSync.currentSymbol;
    void persistSyncState(activeNseUniverseSync).catch(() => {});
    return;
  }

  const totalMatch = trimmed.match(/preparing to sync\s+(\d+)\s+symbol/i);
  if (totalMatch) {
    activeNseUniverseSync.total = Number(totalMatch[1]) || activeNseUniverseSync.total;
  }
  void persistSyncState(activeNseUniverseSync).catch(() => {});
};

const finishActiveSync = (status, message) => {
  if (!activeNseUniverseSync) return;
  activeNseUniverseSync.status = status;
  activeNseUniverseSync.updatedAt = new Date().toISOString();
  activeNseUniverseSync.finishedAt = new Date().toISOString();
  if (message) {
    activeNseUniverseSync.message = message;
    activeNseUniverseSync.recentLines = [...activeNseUniverseSync.recentLines, message].slice(-8);
  }
  void persistSyncState(activeNseUniverseSync).catch(() => {});
};

const runNseUniverseSyncScript = async ({ syncDate }) =>
  new Promise((resolve, reject) => {
    const pythonBin = resolvePythonBin();
    activeNseUniverseSync = createActiveSyncState({ syncDate, pythonBin });
    void persistSyncState(activeNseUniverseSync).catch(() => {});

    const child = spawn(pythonBin, [NSE_UNIVERSE_SYNC_SCRIPT_PATH, '--end-date', syncDate], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NSE_UNIVERSE_HISTORY_START_DATE,
        NSE_UNIVERSE_MARKET_CAP_STALE_DAYS: String(DEFAULT_MARKET_CAP_STALE_DAYS),
        PYTHONUNBUFFERED: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = String(chunk || '');
      stdout += text;
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => pushActiveSyncLine(line));
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk || '');
      stderr += text;
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => pushActiveSyncLine(line));
    });

    child.on('error', (error) => {
      finishActiveSync('failed', error.message || 'Failed to start NSE Universe sync');
      reject(error);
    });

    child.on('close', (code) => {
      const lastNonEmptyOutput = [...stdout.split(/\r?\n/), ...stderr.split(/\r?\n/)]
        .map((line) => line.trim())
        .filter(Boolean)
        .pop();

      if (code === 0) {
        finishActiveSync('success', activeNseUniverseSync?.summary?.message || 'NSE Universe sync completed');
        resolve({
          started: true,
          syncDate,
          status: activeNseUniverseSync
        });
        return;
      }

      const message = lastNonEmptyOutput || `NSE Universe sync failed (exit ${code})`;
      finishActiveSync('failed', message);
      reject(createError(message, 500));
    });
  }).finally(() => {
    setTimeout(() => {
      if (activeNseUniverseSync?.status !== 'running') {
        activeNseUniverseSync = activeNseUniverseSync ? { ...activeNseUniverseSync } : null;
      }
    }, 0);
  });

export const getNseUniverseSyncStatus = async () => {
  await ensureNseUniverseSymbolsSeeded();

  const [summaryResult, latestDateResult] = await Promise.all([
    queryScreenerPostgres(
      `
        SELECT
          COUNT(*)::INT AS total_symbols,
          COUNT(*) FILTER (WHERE last_history_sync_date IS NOT NULL)::INT AS synced_symbols,
          COUNT(*) FILTER (WHERE COALESCE(last_error, '') <> '')::INT AS errored_symbols,
          MAX(last_history_sync_date) AS latest_history_sync_date,
          MIN(last_history_sync_date) AS earliest_history_sync_date
        FROM nse_universe_symbols
      `
    ),
    queryScreenerPostgres(
      `
        SELECT MAX(trade_date) AS latest_trade_date, MIN(trade_date) AS earliest_trade_date
        FROM nse_universe_daily_bars
      `
    )
  ]);

  const summaryRow = summaryResult.rows[0] || {};
  const latestRow = latestDateResult.rows[0] || {};

  const persistedSync = await recoverStaleSyncState(await readPersistedSyncState());

  return {
    sync: activeNseUniverseSync?.status === 'running' ? activeNseUniverseSync : persistedSync,
    inventory: {
      totalSymbols: maybeInteger(summaryRow.total_symbols) || 0,
      syncedSymbols: maybeInteger(summaryRow.synced_symbols) || 0,
      erroredSymbols: maybeInteger(summaryRow.errored_symbols) || 0,
      earliestSyncedDate: formatDateKey(summaryRow.earliest_history_sync_date) || null,
      latestSyncedDate: formatDateKey(summaryRow.latest_history_sync_date) || null,
      earliestTradeDate: formatDateKey(latestRow.earliest_trade_date) || null,
      latestTradeDate: formatDateKey(latestRow.latest_trade_date) || null
    }
  };
};

export const searchNseUniverseSymbols = async ({ query = '', limit = 12 }) => {
  await ensureNseUniverseSymbolsSeeded();

  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    const result = await queryScreenerPostgres(
      `
        SELECT symbol, company_name
        FROM nse_universe_symbols
        ORDER BY symbol ASC
        LIMIT $1
      `,
      [Math.max(1, Math.min(50, Number(limit) || 12))]
    );
    return {
      query: '',
      suggestions: result.rows.map((row) => ({
        symbol: row.symbol || '',
        companyName: row.company_name || ''
      }))
    };
  }

  const cappedLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  const likeQuery = `%${normalizedQuery}%`;
  const startsWithQuery = `${normalizedQuery}%`;
  const result = await queryScreenerPostgres(
    `
      SELECT symbol, company_name
      FROM nse_universe_symbols
      WHERE symbol ILIKE $1 OR company_name ILIKE $1
      ORDER BY
        CASE
          WHEN symbol ILIKE $2 THEN 1
          WHEN company_name ILIKE $2 THEN 2
          WHEN symbol ILIKE $3 THEN 3
          WHEN company_name ILIKE $3 THEN 4
          ELSE 5
        END,
        symbol ASC
      LIMIT $4
    `,
    [likeQuery, normalizedQuery, startsWithQuery, cappedLimit]
  );

  return {
    query: normalizedQuery,
    suggestions: result.rows.map((row) => ({
      symbol: row.symbol || '',
      companyName: row.company_name || ''
    }))
  };
};

export const getNseUniverseSnapshot = async ({
  query = '',
  selectedDate = '',
  minMarketCapCr = '',
  maxMarketCapCr = '',
  minRupeeVolumeCr = '',
  maxRupeeVolumeCr = '',
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE
} = {}) => {
  await ensureNseUniverseSymbolsSeeded();

  const normalizedQuery = String(query || '').trim();
  const parsedMinMarketCapCr = parseOptionalNumberParam(minMarketCapCr, 'minMarketCapCr');
  const parsedMaxMarketCapCr = parseOptionalNumberParam(maxMarketCapCr, 'maxMarketCapCr');
  const parsedMinRupeeVolumeCr = parseOptionalNumberParam(minRupeeVolumeCr, 'minRupeeVolumeCr');
  const parsedMaxRupeeVolumeCr = parseOptionalNumberParam(maxRupeeVolumeCr, 'maxRupeeVolumeCr');
  if (
    parsedMinMarketCapCr !== null &&
    parsedMaxMarketCapCr !== null &&
    parsedMinMarketCapCr > parsedMaxMarketCapCr
  ) {
    throw createError('minMarketCapCr cannot exceed maxMarketCapCr', 400);
  }
  if (
    parsedMinRupeeVolumeCr !== null &&
    parsedMaxRupeeVolumeCr !== null &&
    parsedMinRupeeVolumeCr > parsedMaxRupeeVolumeCr
  ) {
    throw createError('minRupeeVolumeCr cannot exceed maxRupeeVolumeCr', 400);
  }
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, Number(pageSize) || DEFAULT_PAGE_SIZE));
  const offset = (safePage - 1) * safePageSize;
  const requestedDate = selectedDate ? parseDateParam(selectedDate, 'selectedDate') : '';
  const effectiveDateResult = requestedDate
    ? await queryScreenerPostgres(
        `
          SELECT MAX(trade_date) AS effective_date
          FROM nse_universe_daily_bars
          WHERE trade_date <= $1::date
        `,
        [requestedDate]
      )
    : await queryScreenerPostgres(`
        SELECT MAX(trade_date) AS effective_date
        FROM nse_universe_daily_bars
      `);

  const effectiveDate = formatDateKey(effectiveDateResult.rows[0]?.effective_date);

  const status = await getNseUniverseSyncStatus();

  if (!effectiveDate) {
    return {
      requestedDate: requestedDate || null,
      effectiveDate: null,
      latestAvailableDate: status.inventory.latestTradeDate,
      earliestAvailableDate: status.inventory.earliestTradeDate,
      total: 0,
      page: safePage,
      pageSize: safePageSize,
      rows: [],
      sync: status.sync,
      inventory: status.inventory
    };
  }

  const params = [effectiveDate];
  const whereClauses = ['bars.trade_date = $1::date'];
  if (normalizedQuery) {
    params.push(`%${normalizedQuery}%`);
    whereClauses.push(`(bars.symbol ILIKE $${params.length} OR symbols.company_name ILIKE $${params.length})`);
  }
  if (parsedMinMarketCapCr !== null) {
    params.push(parsedMinMarketCapCr * 10000000);
    whereClauses.push(`COALESCE(bars.market_cap, symbols.market_cap) >= $${params.length}`);
  }
  if (parsedMaxMarketCapCr !== null) {
    params.push(parsedMaxMarketCapCr * 10000000);
    whereClauses.push(`COALESCE(bars.market_cap, symbols.market_cap) <= $${params.length}`);
  }
  if (parsedMinRupeeVolumeCr !== null) {
    params.push(parsedMinRupeeVolumeCr);
    whereClauses.push(`bars.rupee_volume_crore >= $${params.length}`);
  }
  if (parsedMaxRupeeVolumeCr !== null) {
    params.push(parsedMaxRupeeVolumeCr);
    whereClauses.push(`bars.rupee_volume_crore <= $${params.length}`);
  }

  params.push(safePageSize, offset);

  const result = await queryScreenerPostgres(
    `
      WITH filtered AS (
        SELECT
          bars.symbol,
          symbols.company_name,
          symbols.market_cap AS symbol_market_cap,
          profiles.about_text,
          bars.trade_date,
          bars.open,
          bars.high,
          bars.low,
          bars.close,
          bars.adj_close,
          bars.volume,
          bars.sma_10,
          bars.sma_20,
          bars.sma_50,
          bars.sma_200,
          bars.volume_sma_30,
          bars.rupee_volume_crore,
          bars.market_cap,
          COUNT(*) OVER()::INT AS total_count
        FROM nse_universe_daily_bars bars
        INNER JOIN nse_universe_symbols symbols
          ON symbols.symbol = bars.symbol
        LEFT JOIN screener_company_profiles profiles
          ON profiles.symbol = bars.symbol
        WHERE ${whereClauses.join(' AND ')}
      )
      SELECT *
      FROM filtered
      ORDER BY rupee_volume_crore DESC NULLS LAST, volume DESC NULLS LAST, symbol ASC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `,
    params
  );

  const total = maybeInteger(result.rows[0]?.total_count) || 0;

  return {
    requestedDate: requestedDate || effectiveDate,
    effectiveDate,
    latestAvailableDate: status.inventory.latestTradeDate,
    earliestAvailableDate: status.inventory.earliestTradeDate,
    total,
    page: safePage,
    pageSize: safePageSize,
    rows: result.rows.map((row) => ({
      symbol: row.symbol || '',
      companyName: row.company_name || '',
      aboutText: row.about_text || '',
      tradeDate: formatDateKey(row.trade_date),
      open: maybeNumber(row.open),
      high: maybeNumber(row.high),
      low: maybeNumber(row.low),
      close: maybeNumber(row.close),
      adjClose: maybeNumber(row.adj_close),
      volume: maybeInteger(row.volume),
      sma10: maybeNumber(row.sma_10),
      sma20: maybeNumber(row.sma_20),
      sma50: maybeNumber(row.sma_50),
      sma200: maybeNumber(row.sma_200),
      volumeSma30: maybeNumber(row.volume_sma_30),
      rupeeVolumeCrore: maybeNumber(row.rupee_volume_crore),
      marketCap: maybeInteger(row.market_cap) ?? maybeInteger(row.symbol_market_cap)
    })),
    sync: status.sync,
    inventory: status.inventory
  };
};

export const triggerNseUniverseSync = async ({ syncDate = '' } = {}) => {
  await ensureNseUniverseSymbolsSeeded();

  const persistedSync = await recoverStaleSyncState(await readPersistedSyncState());
  if (activeNseUniverseSync?.status === 'running') {
    throw createError('NSE Universe sync is already running', 409);
  }
  if (persistedSync?.status === 'running') {
    throw createError('NSE Universe sync is already running', 409);
  }

  const defaultDate = new Date().toISOString().slice(0, 10);
  const normalizedSyncDate = parseDateParam(syncDate || defaultDate, 'syncDate');

  void runNseUniverseSyncScript({ syncDate: normalizedSyncDate }).catch(() => {});

  return {
    started: true,
    syncDate: normalizedSyncDate,
    status: activeNseUniverseSync
  };
};

export const getNseUniverseSyncDefaults = async () => {
  await ensureNseUniverseSymbolsSeeded();
  const status = await getNseUniverseSyncStatus();
  const latestTradeDate = status.inventory.latestTradeDate;
  return {
    syncDate: latestTradeDate ? formatDateKey(new Date(new Date(`${latestTradeDate}T00:00:00.000Z`).getTime() + DAY_MS)) : null,
    lookbackStartDate: NSE_UNIVERSE_HISTORY_START_DATE,
    inventory: status.inventory
  };
};
