#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_CSV_PATH = 'data/CF-Event-equities-15-May-2026.csv';

const parseArgs = (argv) => {
  const args = { csvPath: DEFAULT_CSV_PATH, dbUrl: '', psqlBin: process.env.PSQL_BIN || 'psql' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--csv-path' && argv[index + 1]) {
      args.csvPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--db-url' && argv[index + 1]) {
      args.dbUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--psql-bin' && argv[index + 1]) {
      args.psqlBin = argv[index + 1];
      index += 1;
    }
  }
  return args;
};

const parseCsvRecords = (content) => {
  const rows = [];
  let row = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (inQuotes && content[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && content[index + 1] === '\n') {
        index += 1;
      }
      row.push(current);
      current = '';
      if (row.some((value) => String(value || '').trim())) rows.push(row);
      row = [];
      continue;
    }

    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    if (row.some((value) => String(value || '').trim())) rows.push(row);
  }

  return rows;
};

const normalizeSymbol = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^NSE:/, '')
    .replace(/^BSE:/, '')
    .replaceAll('_', '&')
    .replaceAll(' ', '');

const parseEventDate = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const monthIndex = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
    monthText.toLowerCase()
  );
  if (monthIndex < 0) return null;
  const year = yearText.length === 2 ? Number(`20${yearText}`) : Number(yearText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const loadCsvEvents = (csvPath) => {
  const content = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsvRecords(content);
  if (!rows.length) throw new Error(`CSV file is empty: ${csvPath}`);

  const headers = rows[0].map((header) => String(header || '').trim().toLowerCase());
  const symbolIndex = headers.indexOf('symbol');
  const companyIndex = headers.indexOf('company');
  const dateIndex = headers.indexOf('date');
  if (symbolIndex < 0 || companyIndex < 0 || dateIndex < 0) {
    throw new Error(`Expected symbol/company/date headers in ${csvPath}`);
  }

  const eventsBySymbol = new Map();
  for (const columns of rows.slice(1)) {
    const symbol = normalizeSymbol(columns[symbolIndex]);
    const companyName = String(columns[companyIndex] || '').trim();
    const earningsDate = parseEventDate(columns[dateIndex]);
    if (!symbol || !earningsDate) continue;

    if (!eventsBySymbol.has(symbol)) {
      eventsBySymbol.set(symbol, new Map());
    }
    eventsBySymbol.get(symbol).set(earningsDate, { symbol, companyName, earningsDate });
  }

  return new Map(
    [...eventsBySymbol.entries()].map(([symbol, events]) => [
      symbol,
      [...events.values()].sort((left, right) => left.earningsDate.localeCompare(right.earningsDate))
    ])
  );
};

const buildPsqlConnection = (args) => {
  if (args.dbUrl) {
    return { connectionArgs: [args.dbUrl], env: { ...process.env, PAGER: 'cat' } };
  }

  const dsn = String(process.env.SCREENER_PG_DSN || process.env.DATABASE_URL || '').trim();
  const explicitPassword = String(process.env.SCREENER_PG_PASSWORD || '').trim();
  if (dsn) {
    try {
      const parsed = new URL(dsn);
      const database = parsed.pathname.replace(/^\//, '') || 'postgres';
      const user = decodeURIComponent(parsed.username || process.env.SCREENER_PG_USER || 'praween');
      const password = decodeURIComponent(parsed.password || explicitPassword || '');
      if (password) {
        return { connectionArgs: [dsn], env: { ...process.env, PAGER: 'cat' } };
      }
      return { connectionArgs: ['-U', user, '-d', database], env: { ...process.env, PAGER: 'cat' } };
    } catch {
      return { connectionArgs: [dsn], env: { ...process.env, PAGER: 'cat' } };
    }
  }

  const database = String(process.env.SCREENER_PG_DB || 'earnings_screener_db').trim();
  const user = String(process.env.SCREENER_PG_USER || 'praween').trim();
  if (explicitPassword) {
    const host = String(process.env.SCREENER_PG_HOST || '127.0.0.1').trim();
    const port = String(process.env.SCREENER_PG_PORT || '5432').trim();
    return {
      connectionArgs: [`postgresql://${user}:${explicitPassword}@${host}:${port}/${database}`],
      env: { ...process.env, PAGER: 'cat' }
    };
  }

  return { connectionArgs: ['-U', user, '-d', database], env: { ...process.env, PAGER: 'cat' } };
};

const runPsql = ({ psqlBin, connectionArgs, env, args = [] }) =>
  execFileSync(psqlBin, [...connectionArgs, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env
  });

const deriveQuarterFromEarningsDate = (earningsDate) => {
  const [yearText, monthText] = String(earningsDate || '').split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;

  if (month >= 4 && month <= 6) {
    return { periodLabel: `Mar ${year}`, periodEnd: `${year}-03-31` };
  }
  if (month >= 7 && month <= 9) {
    return { periodLabel: `Jun ${year}`, periodEnd: `${year}-06-30` };
  }
  if (month >= 10 && month <= 12) {
    return { periodLabel: `Sep ${year}`, periodEnd: `${year}-09-30` };
  }
  return { periodLabel: `Dec ${year - 1}`, periodEnd: `${year - 1}-12-31` };
};

const quoteCsvField = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

const buildAlignedCsv = (alignedRows) => {
  const lines = ['symbol,company_name,period_label,period_end,earnings_date,source_file'];
  for (const row of alignedRows) {
    lines.push(
      [
        row.symbol,
        row.companyName,
        row.periodLabel,
        row.periodEnd,
        row.earningsDate,
        row.sourceFile
      ]
        .map(quoteCsvField)
        .join(',')
    );
  }
  return `${lines.join('\n')}\n`;
};

const buildImportSql = ({ alignedCsvPath }) => `
CREATE TABLE IF NOT EXISTS screener_earnings_dates (
  symbol TEXT NOT NULL,
  company_name TEXT,
  period_label TEXT NOT NULL,
  period_end DATE NOT NULL,
  earnings_date DATE NOT NULL,
  source_file TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, period_end)
);

CREATE TEMP TABLE temp_screener_earnings_dates (
  symbol TEXT NOT NULL,
  company_name TEXT,
  period_label TEXT NOT NULL,
  period_end DATE NOT NULL,
  earnings_date DATE NOT NULL,
  source_file TEXT NOT NULL
);

\\copy temp_screener_earnings_dates (symbol, company_name, period_label, period_end, earnings_date, source_file) FROM '${alignedCsvPath.replaceAll("'", "''")}' WITH (FORMAT csv, HEADER true);

DELETE FROM screener_earnings_dates
WHERE symbol IN (SELECT DISTINCT symbol FROM temp_screener_earnings_dates);

INSERT INTO screener_earnings_dates (
  symbol,
  company_name,
  period_label,
  period_end,
  earnings_date,
  source_file,
  updated_at
)
SELECT
  symbol,
  company_name,
  period_label,
  period_end,
  earnings_date,
  source_file,
  NOW()
FROM temp_screener_earnings_dates
ON CONFLICT (symbol, period_end) DO UPDATE SET
  company_name = EXCLUDED.company_name,
  period_label = EXCLUDED.period_label,
  earnings_date = EXCLUDED.earnings_date,
  source_file = EXCLUDED.source_file,
  updated_at = NOW();

SELECT COUNT(*) AS total_rows, COUNT(DISTINCT symbol) AS total_symbols FROM screener_earnings_dates;
`;

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const csvPath = path.resolve(process.cwd(), args.csvPath);
  if (!fs.existsSync(csvPath)) throw new Error(`CSV file not found: ${csvPath}`);

  const psqlConfig = { psqlBin: args.psqlBin, ...buildPsqlConnection(args) };
  const eventsBySymbol = loadCsvEvents(csvPath);

  const dedupedRows = new Map();
  for (const [symbol, events] of eventsBySymbol.entries()) {
    for (const event of events) {
      const derivedQuarter = deriveQuarterFromEarningsDate(event.earningsDate);
      if (!derivedQuarter) continue;
      const dedupeKey = `${symbol}__${derivedQuarter.periodEnd}`;
      dedupedRows.set(dedupeKey, {
        symbol,
        companyName: event.companyName,
        periodLabel: derivedQuarter.periodLabel,
        periodEnd: derivedQuarter.periodEnd,
        earningsDate: event.earningsDate,
        sourceFile: path.basename(csvPath)
      });
    }
  }
  const alignedRows = [...dedupedRows.values()].sort(
    (left, right) => left.symbol.localeCompare(right.symbol) || left.periodEnd.localeCompare(right.periodEnd)
  );

  const alignedCsvPath = path.join(os.tmpdir(), `aligned-screener-earnings-dates-${Date.now()}.csv`);
  const sqlPath = path.join(os.tmpdir(), `ingest-screener-earnings-dates-${Date.now()}.sql`);

  fs.writeFileSync(alignedCsvPath, buildAlignedCsv(alignedRows), 'utf8');
  fs.writeFileSync(sqlPath, buildImportSql({ alignedCsvPath }), 'utf8');

  try {
    const stdout = runPsql({
      ...psqlConfig,
      args: ['-v', 'ON_ERROR_STOP=1', '-f', sqlPath]
    });
    process.stdout.write(stdout);
  } finally {
    fs.rmSync(alignedCsvPath, { force: true });
    fs.rmSync(sqlPath, { force: true });
  }
};

try {
  main();
} catch (error) {
  console.error(error?.stderr || error?.message || error);
  process.exit(1);
}
