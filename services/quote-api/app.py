import os
from datetime import datetime, timezone

from flask import Flask, jsonify, request

try:
    import yfinance as yf
except ModuleNotFoundError as exc:
    raise RuntimeError("yfinance is not installed") from exc


app = Flask(__name__)

QUOTE_SERVICE_TOKEN = str(os.environ.get("QUOTE_SERVICE_TOKEN", "")).strip()


def to_iso(ts):
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
    except Exception:
        return None


def get_bearer_token():
    auth_header = str(request.headers.get("Authorization", "")).strip()
    if auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    return str(request.headers.get("x-api-key", "")).strip()


def require_token():
    if not QUOTE_SERVICE_TOKEN:
        return jsonify({"message": "QUOTE_SERVICE_TOKEN is not configured on server"}), 500
    token = get_bearer_token()
    if token != QUOTE_SERVICE_TOKEN:
        return jsonify({"message": "Unauthorized"}), 401
    return None


def fetch_quote(symbol):
    ticker = yf.Ticker(symbol)

    price = None
    currency = None
    as_of = None
    lookup_errors = []

    try:
        fast = ticker.fast_info or {}
        price = fast.get("last_price") or fast.get("regular_market_price")
        currency = fast.get("currency")
        as_of = to_iso(fast.get("last_price_time"))
    except Exception as exc:
        lookup_errors.append(f"fast_info: {exc}")

    if price is None:
        try:
            info = ticker.info or {}
            price = info.get("regularMarketPrice")
            currency = currency or info.get("currency")
            as_of = as_of or to_iso(info.get("regularMarketTime"))
        except Exception as exc:
            lookup_errors.append(f"info: {exc}")

    if price is None:
        try:
            history = ticker.history(period="5d", interval="1d", auto_adjust=False)
            if history is not None and not history.empty:
                close_series = history.get("Close")
                if close_series is not None:
                    latest_close = close_series.dropna()
                    if not latest_close.empty:
                        price = latest_close.iloc[-1]
                        latest_index = latest_close.index[-1]
                        if hasattr(latest_index, "timestamp"):
                            as_of = as_of or to_iso(latest_index.timestamp())
            fast = ticker.fast_info or {}
            currency = currency or fast.get("currency")
        except Exception as exc:
            lookup_errors.append(f"history: {exc}")

    if price is None:
        if lookup_errors:
            raise RuntimeError("; ".join(lookup_errors))
        return None

    return {
        "symbol": symbol,
        "price": float(price),
        "currency": currency,
        "asOf": as_of or datetime.now(timezone.utc).isoformat(),
        "source": "yfinance",
    }


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "quote-api"})


@app.get("/quote")
def quote():
    auth_error = require_token()
    if auth_error:
        return auth_error

    symbol = str(request.args.get("symbol", "")).strip().upper()
    if not symbol:
        return jsonify({"message": "symbol query parameter is required"}), 400

    try:
        quote_data = fetch_quote(symbol)
    except Exception as exc:
        return jsonify({"message": f"Failed to fetch quote: {exc}"}), 502

    if not quote_data:
        return jsonify({"message": f"Quote not found for {symbol}"}), 404

    return jsonify(quote_data)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
