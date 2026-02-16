import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from '../utils/csv';

const NSE_EQUITY_CSV_URL = 'https://archives.nseindia.com/content/equities/EQUITY_L.csv';
const SYMBOLS_FILE_PATH = path.join(process.cwd(), 'data', 'nse_equity_symbols.csv');

const symbolsCache = {
  symbols: null,
  updatedAt: null
};

const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const parseSymbols = (csvText) => {
  const rows = parseCsv(String(csvText || ''));
  if (!rows.length) return [];
  const header = rows[0].map((cell) => String(cell || '').trim().toUpperCase());
  const symbolIndex = header.findIndex((cell) => cell === 'SYMBOL');
  const index = symbolIndex >= 0 ? symbolIndex : 0;

  const symbols = rows
    .slice(1)
    .map((row) => String(row[index] || '').trim().toUpperCase())
    .filter(Boolean);

  return [...new Set(symbols)].sort((a, b) => a.localeCompare(b));
};

const readSymbolsFromFile = async () => {
  try {
    const csv = await readFile(SYMBOLS_FILE_PATH, 'utf8');
    const symbols = parseSymbols(csv);
    if (!symbols.length) return null;
    const fileStats = await stat(SYMBOLS_FILE_PATH);
    return { symbols, updatedAt: fileStats.mtime.toISOString() };
  } catch {
    return null;
  }
};

export const refreshSymbolsFromNse = async () => {
  const response = await fetch(NSE_EQUITY_CSV_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/csv,text/plain,*/*'
    }
  });

  if (!response.ok) {
    throw createError(`Failed to download NSE symbols CSV (${response.status})`, 502);
  }

  const csvText = await response.text();
  const symbols = parseSymbols(csvText);
  if (!symbols.length) {
    throw createError('Downloaded NSE symbols CSV is empty or invalid', 502);
  }

  await mkdir(path.dirname(SYMBOLS_FILE_PATH), { recursive: true });
  await writeFile(SYMBOLS_FILE_PATH, csvText, 'utf8');

  const updatedAt = new Date().toISOString();
  symbolsCache.symbols = symbols;
  symbolsCache.updatedAt = updatedAt;

  return { symbols, count: symbols.length, updatedAt };
};

export const getSymbols = async () => {
  if (Array.isArray(symbolsCache.symbols) && symbolsCache.symbols.length) {
    return {
      symbols: symbolsCache.symbols,
      count: symbolsCache.symbols.length,
      updatedAt: symbolsCache.updatedAt
    };
  }

  const fileData = await readSymbolsFromFile();
  if (fileData) {
    symbolsCache.symbols = fileData.symbols;
    symbolsCache.updatedAt = fileData.updatedAt;
    return {
      symbols: fileData.symbols,
      count: fileData.symbols.length,
      updatedAt: fileData.updatedAt
    };
  }

  return refreshSymbolsFromNse();
};
