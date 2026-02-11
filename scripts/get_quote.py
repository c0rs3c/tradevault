#!/usr/bin/env python3
import json
import sys
from datetime import datetime, timezone

try:
    import yfinance as yf
except ModuleNotFoundError:
    print("yfinance is not installed", file=sys.stderr)
    sys.exit(2)


def to_iso(ts):
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
    except Exception:
        return None


def main():
    if len(sys.argv) < 2:
        print("Usage: get_quote.py <symbol>", file=sys.stderr)
        sys.exit(1)

    symbol = sys.argv[1].strip().upper()
    ticker = yf.Ticker(symbol)

    price = None
    currency = None
    as_of = None

    try:
        fast = ticker.fast_info or {}
        price = fast.get("last_price") or fast.get("regular_market_price")
        currency = fast.get("currency")
        as_of = to_iso(fast.get("last_price_time"))
    except Exception:
        pass

    if price is None:
        try:
            info = ticker.info or {}
            price = info.get("regularMarketPrice")
            currency = currency or info.get("currency")
            as_of = as_of or to_iso(info.get("regularMarketTime"))
        except Exception:
            pass

    if price is None:
        print("{}")
        return

    result = {
        "symbol": symbol,
        "price": float(price),
        "currency": currency,
        "asOf": as_of or datetime.now(timezone.utc).isoformat(),
        "source": "yfinance",
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
