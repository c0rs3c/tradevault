import path from 'path';
import { spawn } from 'child_process';

const PYTHON_BIN = process.env.MARKET_DATA_PYTHON || 'python3';
const QUOTE_SCRIPT_PATH = path.resolve(process.cwd(), 'scripts/get_quote.py');
const QUOTE_PROVIDER = String(process.env.QUOTE_PROVIDER || '').trim();
const QUOTE_SERVICE_URL = String(process.env.QUOTE_SERVICE_URL || '').trim();
const QUOTE_SERVICE_TOKEN = String(process.env.QUOTE_SERVICE_TOKEN || '').trim();
const REMOTE_QUOTE_TIMEOUT_MS = 15000;

const fetchLocalPythonQuote = (symbol) =>
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

const createConfigError = (message) => {
  const error = new Error(message);
  error.code = 'QUOTE_CONFIG_ERROR';
  return error;
};

const normalizeQuote = (quote) => {
  if (!quote || typeof quote.price !== 'number' || !Number.isFinite(quote.price)) return null;
  return {
    symbol: String(quote.symbol || '').trim().toUpperCase() || null,
    price: Number(quote.price),
    currency: quote.currency || null,
    asOf: quote.asOf || null,
    source: quote.source || null
  };
};

const fetchRemoteHttpQuote = async (symbol) => {
  if (!QUOTE_SERVICE_URL) {
    throw createConfigError('QUOTE_PROVIDER=remote_http requires QUOTE_SERVICE_URL');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_QUOTE_TIMEOUT_MS);

  try {
    const url = new URL(QUOTE_SERVICE_URL);
    url.searchParams.set('symbol', symbol);

    const headers = {
      Accept: 'application/json'
    };
    if (QUOTE_SERVICE_TOKEN) {
      headers.Authorization = `Bearer ${QUOTE_SERVICE_TOKEN}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: controller.signal
    });

    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) {
      throw new Error('Remote quote service rejected the request. Check QUOTE_SERVICE_TOKEN.');
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      if (!response.ok) {
        throw new Error(`Remote quote service request failed (${response.status})`);
      }
      throw new Error('Remote quote service returned invalid JSON');
    }

    if (!response.ok) {
      const message = String(payload?.message || '').trim();
      throw new Error(message || `Remote quote service request failed (${response.status})`);
    }

    return normalizeQuote(payload);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Remote quote service timed out after ${REMOTE_QUOTE_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const resolveQuoteProvider = () => {
  if (QUOTE_PROVIDER === 'remote_http' || QUOTE_PROVIDER === 'local_python') {
    return QUOTE_PROVIDER;
  }
  return QUOTE_SERVICE_URL ? 'remote_http' : 'local_python';
};

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
  const provider = resolveQuoteProvider();
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const quote =
        provider === 'remote_http'
          ? await fetchRemoteHttpQuote(candidate)
          : await fetchLocalPythonQuote(candidate);
      if (quote) return quote;
    } catch (error) {
      lastError = error;
      if (error?.code === 'QUOTE_CONFIG_ERROR') break;
      if (provider === 'remote_http' && /rejected the request/i.test(String(error?.message || ''))) break;
    }
  }

  if (lastError) throw lastError;
  return null;
};
