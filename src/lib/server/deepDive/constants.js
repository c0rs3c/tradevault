export const DEEP_DIVE_BENCHMARKS = [
  {
    key: 'NIFTY',
    symbol: 'NIFTY',
    displayName: 'Nifty 50',
    yfinanceTicker: '^NSEI',
    assetType: 'benchmark'
  },
  {
    key: 'MIDSML400',
    symbol: 'MIDSML400',
    displayName: 'Nifty MidSmallcap 400',
    yfinanceTicker: '^CRSLDX',
    assetType: 'benchmark'
  },
  {
    key: 'CNXSMALLCAP',
    symbol: 'CNXSMALLCAP',
    displayName: 'Nifty Smallcap',
    yfinanceTicker: '^CNXSC',
    assetType: 'benchmark'
  }
];

export const DEEP_DIVE_DEFAULT_BENCHMARK_KEYS = DEEP_DIVE_BENCHMARKS.map((item) => item.key);
export const DEEP_DIVE_DEFAULT_MIN_LIQUIDITY = 5_00_00_000;

export const normalizeDeepDiveSymbol = (value) => {
  const upper = String(value || '').trim().toUpperCase();
  if (!upper) return '';
  return upper
    .replace(/^NSE:/, '')
    .replace(/^BSE:/, '')
    .replace(/[-\s](EQ|BE|BZ|BL|SM|ST)$/i, '')
    .replace(/\s+/g, '');
};

export const defaultStockYfinanceTicker = (symbol) => `${normalizeDeepDiveSymbol(symbol)}.NS`;
