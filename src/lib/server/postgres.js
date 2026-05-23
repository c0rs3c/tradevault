import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { parseCsv } from '@/lib/server/utils/csv';

const execFileAsync = promisify(execFile);

const DEFAULT_PG_HOST = String(process.env.SCREENER_PG_HOST || '127.0.0.1').trim();
const SOCKET_PG_HOST = String(process.env.SCREENER_PG_SOCKET_DIR || '/tmp').trim();
const DEFAULT_PG_PORT = Number(process.env.SCREENER_PG_PORT || 5432);
const DEFAULT_PG_DB = String(process.env.SCREENER_PG_DB || 'earnings_screener_db').trim();
const DEFAULT_PG_USER = String(process.env.SCREENER_PG_USER || 'praween').trim();
const DEFAULT_PG_PASSWORD = String(process.env.SCREENER_PG_PASSWORD || '').trim();
const SCREENER_PG_DSN = String(process.env.SCREENER_PG_DSN || process.env.DATABASE_URL || '').trim();
const PSQL_BIN = String(process.env.PSQL_BIN || 'psql').trim();
const PG_POOL_MAX = Math.max(1, Number(process.env.SCREENER_PG_POOL_MAX || 4));
const PG_POOL_IDLE_TIMEOUT_MS = Math.max(1000, Number(process.env.SCREENER_PG_IDLE_TIMEOUT_MS || 5000));
const PG_POOL_CONNECTION_TIMEOUT_MS = Math.max(1000, Number(process.env.SCREENER_PG_CONNECTION_TIMEOUT_MS || 5000));
const PG_POOL_MAX_LIFETIME_SECONDS = Math.max(30, Number(process.env.SCREENER_PG_MAX_LIFETIME_SECONDS || 60));

const parseConnectionFromDsn = (dsn) => {
  if (!dsn) return null;
  try {
    const parsed = new URL(dsn);
    return {
      host: parsed.hostname || DEFAULT_PG_HOST,
      port: parsed.port ? Number(parsed.port) : DEFAULT_PG_PORT,
      database: parsed.pathname ? parsed.pathname.replace(/^\//, '') : DEFAULT_PG_DB,
      user: parsed.username ? decodeURIComponent(parsed.username) : DEFAULT_PG_USER,
      password: parsed.password ? decodeURIComponent(parsed.password) : DEFAULT_PG_PASSWORD
    };
  } catch {
    return null;
  }
};

const resolvedPsqlConnection = parseConnectionFromDsn(SCREENER_PG_DSN) || {
  host: DEFAULT_PG_HOST,
  port: Number.isFinite(DEFAULT_PG_PORT) ? DEFAULT_PG_PORT : 5432,
  database: DEFAULT_PG_DB,
  user: DEFAULT_PG_USER,
  password: DEFAULT_PG_PASSWORD
};

const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

let cachedPool = global.screenerPostgresPool;

if (!cachedPool) {
  cachedPool = global.screenerPostgresPool = new Pool(
    SCREENER_PG_DSN
      ? {
          connectionString: SCREENER_PG_DSN,
          application_name: 'trade-journal',
          max: PG_POOL_MAX,
          idleTimeoutMillis: PG_POOL_IDLE_TIMEOUT_MS,
          connectionTimeoutMillis: PG_POOL_CONNECTION_TIMEOUT_MS,
          maxLifetimeSeconds: PG_POOL_MAX_LIFETIME_SECONDS,
          allowExitOnIdle: true
        }
      : {
          host: DEFAULT_PG_PASSWORD ? DEFAULT_PG_HOST : SOCKET_PG_HOST,
          port: Number.isFinite(DEFAULT_PG_PORT) ? DEFAULT_PG_PORT : 5432,
          database: DEFAULT_PG_DB,
          user: DEFAULT_PG_USER,
          password: DEFAULT_PG_PASSWORD,
          application_name: 'trade-journal',
          max: PG_POOL_MAX,
          idleTimeoutMillis: PG_POOL_IDLE_TIMEOUT_MS,
          connectionTimeoutMillis: PG_POOL_CONNECTION_TIMEOUT_MS,
          maxLifetimeSeconds: PG_POOL_MAX_LIFETIME_SECONDS,
          allowExitOnIdle: true
        }
  );
}

export const normalizeScreenerSymbol = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return '';
  if (!/^[A-Z0-9][A-Z0-9&._-]{0,39}$/.test(normalized)) {
    throw createError('Invalid symbol', 400);
  }
  return normalized;
};

const fallbackValue = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (Array.isArray(value)) {
    return `ARRAY[${value.map((item) => fallbackValue(item)).join(', ')}]`;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  const normalized = String(value);
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return normalized;
  return `'${normalized.replaceAll("'", "''")}'`;
};

const interpolateSql = (text, params) =>
  String(text || '').replace(/\$(\d+)/g, (_, indexText) => {
    const index = Number(indexText) - 1;
    return fallbackValue(params[index]);
  });

const runPsqlFallback = async (text, params) => {
  const sql = interpolateSql(text, params);
  let stdout = '';
  try {
    const result = await execFileAsync(
      PSQL_BIN,
      ['-U', resolvedPsqlConnection.user, '-d', resolvedPsqlConnection.database, '--csv', '-c', sql],
      {
        env: {
          ...process.env,
          PGHOST: resolvedPsqlConnection.password ? resolvedPsqlConnection.host : SOCKET_PG_HOST,
          PGPORT: String(Number.isFinite(resolvedPsqlConnection.port) ? resolvedPsqlConnection.port : 5432),
          PGDATABASE: resolvedPsqlConnection.database,
          PGUSER: resolvedPsqlConnection.user,
          PGPASSWORD: resolvedPsqlConnection.password,
          PAGER: 'cat'
        },
        maxBuffer: 10 * 1024 * 1024
      }
    );
    stdout = result.stdout;
  } catch (error) {
    const stderr = String(error?.stderr || '').trim();
    const fallbackMessage = stderr || 'Failed to query PostgreSQL via psql fallback';
    throw createError(fallbackMessage, 500);
  }

  const rows = parseCsv(String(stdout || '').trim());
  if (!rows.length) return { rows: [] };
  const headers = rows[0];
  const resultRows = rows.slice(1).map((row) =>
    headers.reduce((acc, key, index) => {
      acc[key] = row[index] ?? '';
      return acc;
    }, {})
  );
  return { rows: resultRows };
};

export const queryScreenerPostgres = async (text, params = []) => {
  try {
    return await cachedPool.query(text, params);
  } catch (error) {
    const message = String(error?.message || '');
    if (
      message.includes('client password must be a string') ||
      message.includes('password authentication failed') ||
      message.includes('SASL:')
    ) {
      return runPsqlFallback(text, params);
    }
    throw createError(error.message || 'Failed to query PostgreSQL', 500);
  }
};
