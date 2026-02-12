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
          new Error(
            'Python package yfinance is not installed. Run: python3 -m pip install yfinance'
          )
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

const sanitizeSymbolCore = (value) => {
  const upper = String(value || '').trim().toUpperCase();
  if (!upper) return '';

  // Broker exports often use suffixes like INFY-EQ; yfinance expects INFY.
  const withoutSeries = upper.replace(/[-\s](EQ|BE|BZ|BL|SM|ST)$/i, '');
  return withoutSeries.replace(/\s+/g, '');
};

const buildCandidateSymbols = (symbol) => {
  const trimmed = String(symbol || '').trim().toUpperCase();
  if (!trimmed) return [];

  if (trimmed.startsWith('NSE:')) {
    const core = sanitizeSymbolCore(trimmed.slice(4));
    return [core, `${core}.NS`];
  }

  if (trimmed.startsWith('BSE:')) {
    const core = sanitizeSymbolCore(trimmed.slice(4));
    return [core, `${core}.BO`];
  }

  if (trimmed.includes(':')) {
    const [rawCore, exchange] = trimmed.split(':');
    const core = sanitizeSymbolCore(rawCore);
    if (core && exchange === 'NSE') return [`${core}.NS`, core];
    if (core && exchange === 'BSE') return [`${core}.BO`, core];
    return [sanitizeSymbolCore(trimmed)];
  }

  if (trimmed.includes('.')) {
    const [core, suffix] = trimmed.split('.', 2);
    const sanitizedCore = sanitizeSymbolCore(core);
    return [`${sanitizedCore}.${suffix}`];
  }

  const sanitized = sanitizeSymbolCore(trimmed);
  if (!sanitized) return [];

  const candidates = [`${sanitized}.NS`, `${sanitized}.BO`, sanitized];
  if (sanitized === 'INFOBEAN') {
    candidates.unshift('INFOBEANS.NS');
  } else if (sanitized === 'INFOBEANS') {
    candidates.unshift('INFOBEAN.NS');
  }

  return [...new Set(candidates)];
};

export const fetchSymbolQuote = async (symbol) => {
  const candidates = buildCandidateSymbols(symbol);
  let lastError = null;

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
