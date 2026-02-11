import path from 'path';
import { spawn } from 'child_process';

const PYTHON_BIN = process.env.MARKET_DATA_PYTHON || 'python3';
const QUOTE_SCRIPT_PATH = path.resolve(process.cwd(), 'scripts/get_quote.py');

const fetchYFinanceQuote = (symbol) =>
  new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [QUOTE_SCRIPT_PATH, symbol], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to run ${PYTHON_BIN}: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 2) {
        return reject(
          new Error('Python package yfinance is not installed. Run: python3 -m pip install yfinance')
        );
      }

      if (code !== 0) {
        return reject(new Error(stderr.trim() || `Quote script failed (exit ${code})`));
      }

      const output = stdout.trim();
      if (!output) return resolve(null);

      try {
        const parsed = JSON.parse(output);
        if (!parsed || typeof parsed.price !== 'number') return resolve(null);
        resolve(parsed);
      } catch {
        reject(new Error('Quote script returned invalid JSON'));
      }
    });
  });

const toIsoFromUnixSeconds = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return new Date(num * 1000).toISOString();
};

const fetchYahooHttpQuote = async (symbol) => {
  const endpoint = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Yahoo quote API failed (${response.status})`);
  }

  const data = await response.json();
  const item = data?.quoteResponse?.result?.[0];
  const price = Number(item?.regularMarketPrice);
  if (!Number.isFinite(price)) return null;

  return {
    symbol,
    price,
    currency: item?.currency || null,
    asOf: toIsoFromUnixSeconds(item?.regularMarketTime) || new Date().toISOString(),
    source: 'yahoo-http'
  };
};

const buildCandidateSymbols = (symbol) => {
  const trimmed = String(symbol || '').trim().toUpperCase();
  if (!trimmed) return [];

  if (trimmed.startsWith('NSE:')) {
    const core = trimmed.slice(4);
    return [core, `${core}.NS`];
  }

  if (trimmed.startsWith('BSE:')) {
    const core = trimmed.slice(4);
    return [core, `${core}.BO`];
  }

  if (trimmed.includes('.')) return [trimmed];

  const candidates = [`${trimmed}.NS`, `${trimmed}.BO`, trimmed];
  if (trimmed === 'INFOBEAN') {
    candidates.unshift('INFOBEANS.NS');
  } else if (trimmed === 'INFOBEANS') {
    candidates.unshift('INFOBEAN.NS');
  }

  return [...new Set(candidates)];
};

export const fetchSymbolQuote = async (symbol) => {
  const candidates = buildCandidateSymbols(symbol);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const quote = await fetchYahooHttpQuote(candidate);
      if (quote) return quote;
    } catch (error) {
      lastError = error;
    }
  }

  for (const candidate of candidates) {
    try {
      const quote = await fetchYFinanceQuote(candidate);
      if (quote) return quote;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return null;
};
