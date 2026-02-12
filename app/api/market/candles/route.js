import { NextResponse } from 'next/server';

const toUnixSeconds = (value) => Math.floor(new Date(value).getTime() / 1000);

const symbolCandidates = (symbol) => {
  const clean = String(symbol || '')
    .trim()
    .toUpperCase()
    .replace(/^NSE:/, '')
    .replace(/^BSE:/, '')
    .replace(/-EQ$/i, '')
    .replace(/-BE$/i, '')
    .replace(/\s+/g, '');
  if (!clean) return [];
  if (clean.includes('.')) return [clean];
  return [clean, `${clean}.NS`, `${clean}.BO`];
};

const INTERVAL_MAP = {
  '30m': { yahoo: '30m', maxLookbackDays: 59 },
  '1h': { yahoo: '60m', maxLookbackDays: 729 },
  '1D': { yahoo: '1d', maxLookbackDays: null },
  '1W': { yahoo: '1wk', maxLookbackDays: null }
};
const isNseSymbol = (value) => String(value || '').toUpperCase().endsWith('.NS');

const fetchYahooCandles = async (symbol, fromSeconds, toSeconds, interval) => {
  const intervalConfig = INTERVAL_MAP[interval] || INTERVAL_MAP['1D'];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const startSeconds = intervalConfig.maxLookbackDays
    ? Math.max(fromSeconds, nowSeconds - intervalConfig.maxLookbackDays * 24 * 60 * 60)
    : fromSeconds;

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('period1', String(startSeconds));
  url.searchParams.set('period2', String(toSeconds));
  url.searchParams.set('interval', intervalConfig.yahoo);
  url.searchParams.set('events', 'history');

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) return null;

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  if (!result) return null;

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const candles = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const open = Number(opens[i]);
    const high = Number(highs[i]);
    const low = Number(lows[i]);
    const close = Number(closes[i]);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    candles.push({
      time: Number(timestamps[i]),
      open,
      high,
      low,
      close,
      volume: Number.isFinite(Number(volumes[i])) ? Number(volumes[i]) : 0
    });
  }

  return candles.length ? candles : null;
};

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const interval = searchParams.get('interval') || '1D';
    const expectedPriceRaw = Number(searchParams.get('expectedPrice'));
    const expectedPrice = Number.isFinite(expectedPriceRaw) && expectedPriceRaw > 0 ? expectedPriceRaw : null;

    if (!symbol) {
      return NextResponse.json({ message: 'symbol is required' }, { status: 400 });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const fromSeconds = from ? toUnixSeconds(from) : nowSeconds - 365 * 24 * 60 * 60;
    const toSeconds = to ? toUnixSeconds(to) : nowSeconds;
    if (!Number.isFinite(fromSeconds) || !Number.isFinite(toSeconds) || fromSeconds >= toSeconds) {
      return NextResponse.json({ message: 'Invalid from/to range' }, { status: 400 });
    }

    const candidates = symbolCandidates(symbol);
    const successful = [];
    for (const candidate of candidates) {
      const candles = await fetchYahooCandles(candidate, fromSeconds, toSeconds, interval);
      if (candles) {
        successful.push({ symbol: candidate, candles, intervalFallback: null });
        continue;
      }
      // Fallback to daily if selected interval returns nothing for a valid symbol.
      if (interval !== '1D') {
        const fallbackDaily = await fetchYahooCandles(candidate, fromSeconds, toSeconds, '1D');
        if (fallbackDaily) {
          successful.push({
            symbol: candidate,
            candles: fallbackDaily,
            intervalFallback: '1D'
          });
        }
      }
    }

    if (successful.length) {
      const nsCandidates = successful.filter((item) => isNseSymbol(item.symbol));
      const candidatePool = nsCandidates.length ? nsCandidates : successful;
      let selected = candidatePool[0];
      if (expectedPrice) {
        selected = candidatePool
          .map((item) => {
            const lastClose = Number(item.candles[item.candles.length - 1]?.close);
            if (!Number.isFinite(lastClose) || lastClose <= 0) {
              return { ...item, score: Number.POSITIVE_INFINITY };
            }
            // Compare on a multiplicative scale to penalize regime mismatches (e.g. 200 vs 0.02).
            const score = Math.abs(Math.log(lastClose / expectedPrice));
            return { ...item, score };
          })
          .sort((a, b) => a.score - b.score)[0];
      }

      return NextResponse.json({
        symbol: selected.symbol,
        candles: selected.candles,
        ...(selected.intervalFallback ? { intervalFallback: selected.intervalFallback } : {})
      });
    }

    return NextResponse.json({ message: `No candle data found for ${symbol}` }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { message: error?.message || 'Failed to fetch market candles' },
      { status: 500 }
    );
  }
}
