#!/usr/bin/env python3
import argparse
import math
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yfinance as yf
from pymongo import MongoClient, UpdateOne


PRICE_COLLECTION = "deep_dive_price_bars"
SYMBOL_COLLECTION = "deep_dive_symbols"
STATE_COLLECTION = "deep_dive_sync_state"


def load_dotenv():
    root = Path(__file__).resolve().parent.parent
    for filename in (".env", ".env.local"):
        path = root / filename
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def utc_now():
    return datetime.now(timezone.utc)


def days_ago(days: int) -> datetime:
    now = utc_now()
    date = now - timedelta(days=days)
    return datetime(date.year, date.month, date.day, tzinfo=timezone.utc)


def as_market_date_utc(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    raw = str(value)[:10]
    parsed = datetime.fromisoformat(raw)
    return datetime(parsed.year, parsed.month, parsed.day, tzinfo=timezone.utc)


def numeric(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def normalize_symbol(value: str) -> str:
    upper = str(value or "").strip().upper()
    if not upper:
        return ""
    upper = upper.replace("NSE:", "").replace("BSE:", "")
    for suffix in ("-EQ", "-BE", "-BZ", "-BL", "-SM", "-ST"):
        if upper.endswith(suffix):
            upper = upper[: -len(suffix)]
    return upper.replace("_", "&").replace(" ", "")


def stock_ticker(symbol: str) -> str:
    return f"{normalize_symbol(symbol)}.NS"


def dataframe_to_bar_documents(frame, symbol_doc, source_ticker):
    if frame is None or frame.empty:
        return []
    output = []
    for index, row in frame.iterrows():
        date_value = index.to_pydatetime() if hasattr(index, "to_pydatetime") else index
        date_utc = as_market_date_utc(date_value)
        if not date_utc:
            continue
        close_value = numeric(row.get("Close"))
        adj_close_value = numeric(row.get("Adj Close"))
        if close_value is None and adj_close_value is None:
            continue
        output.append(
            {
                "symbol": symbol_doc["symbol"],
                "assetType": symbol_doc["assetType"],
                "date": date_utc,
                "open": numeric(row.get("Open")),
                "high": numeric(row.get("High")),
                "low": numeric(row.get("Low")),
                "close": close_value,
                "adjClose": adj_close_value,
                "volume": numeric(row.get("Volume")),
                "sourceTicker": source_ticker,
                "source": "yfinance",
                "updatedAt": utc_now(),
            }
        )
    return output


def merge_bar_documents(primary_docs, extra_docs):
    merged = {}
    for row in primary_docs or []:
        merged[row["date"]] = row
    for row in extra_docs or []:
        merged[row["date"]] = row
    return [merged[key] for key in sorted(merged.keys())]


def latest_row_has_missing_close(frame):
    if frame is None or frame.empty:
        return False
    latest = frame.iloc[-1]
    return numeric(latest.get("Close")) is None and numeric(latest.get("Adj Close")) is None


def extract_symbol_frame(dataframe, ticker):
    if dataframe is None or getattr(dataframe, "empty", True):
        return None
    columns = dataframe.columns
    if getattr(columns, "nlevels", 1) > 1:
        if ticker in columns.get_level_values(0):
            return dataframe[ticker]
        return None
    return dataframe


def fetch_history_for_ticker(ticker_string: str, start_key: str, end_date: str):
    return yf.download(
        tickers=ticker_string,
        start=start_key,
        end=end_date,
        interval="1d",
        auto_adjust=False,
        group_by="ticker",
        progress=False,
        threads=True,
    )


def fetch_latest_day_docs(symbol_doc, ticker):
    try:
        frame = yf.Ticker(ticker).history(period="1d", auto_adjust=False)
    except Exception:
        return []
    return dataframe_to_bar_documents(frame, symbol_doc, ticker)


def bulk_upsert_bars(db, rows, dry_run):
    if not rows:
        return 0
    if dry_run:
        return len(rows)
    operations = []
    for row in rows:
        created_at = row.get("createdAt") or utc_now()
        set_payload = {key: value for key, value in row.items() if key != "createdAt"}
        operations.append(
            UpdateOne(
                {"symbol": row["symbol"], "date": row["date"]},
                {"$set": set_payload, "$setOnInsert": {"createdAt": created_at}},
                upsert=True,
            )
        )
    db[PRICE_COLLECTION].bulk_write(operations, ordered=False)
    return len(rows)


def update_sync_state(db, symbol_doc, docs, dry_run):
    if not docs or dry_run:
        return
    now = utc_now()
    db[STATE_COLLECTION].update_one(
        {"symbol": symbol_doc["symbol"]},
        {
            "$set": {
                "symbol": symbol_doc["symbol"],
                "assetType": symbol_doc["assetType"],
                "lastSyncedAt": now,
                "lastAttemptedAt": now,
                "lastStatus": "success",
                "lastError": "",
                "updatedAt": now,
            },
            "$min": {"earliestBarDate": docs[0]["date"]},
            "$max": {"latestBarDate": docs[-1]["date"]},
            "$setOnInsert": {"createdAt": now},
        },
        upsert=True,
    )


def main():
    load_dotenv()

    parser = argparse.ArgumentParser(description="Repair recent Deep Dive price bars by refetching a recent window.")
    parser.add_argument("--days", type=int, default=7, help="Calendar days to refetch for every active symbol.")
    parser.add_argument("--batch-size", type=int, default=25, help="Symbols per yfinance batch.")
    parser.add_argument("--symbols", type=str, default="", help="Optional comma-separated symbol list.")
    parser.add_argument("--apply", action="store_true", help="Write repaired bars. Default is dry run.")
    args = parser.parse_args()

    mongo_uri = str(os.getenv("DEEP_DIVE_MONGO_URI", "")).strip()
    if not mongo_uri:
        raise SystemExit("Missing DEEP_DIVE_MONGO_URI")
    db_name = str(os.getenv("DEEP_DIVE_DB_NAME", "")).strip() or None

    client = MongoClient(mongo_uri)
    db = client.get_database(db_name) if db_name else client.get_default_database()

    selected_symbols = [normalize_symbol(item) for item in args.symbols.replace("\n", ",").split(",") if normalize_symbol(item)]
    symbol_filter = {"active": True}
    if selected_symbols:
      symbol_filter["symbol"] = {"$in": selected_symbols}

    symbol_docs = list(
        db[SYMBOL_COLLECTION]
        .find(symbol_filter, {"_id": 0, "symbol": 1, "assetType": 1, "yfinanceTicker": 1})
        .sort("symbol", 1)
    )
    if not symbol_docs:
        print('{"status":"no_symbols"}')
        client.close()
        return

    start_key = days_ago(args.days).strftime("%Y-%m-%d")
    end_date = (utc_now() + timedelta(days=1)).strftime("%Y-%m-%d")
    total_rows = 0
    total_symbols = 0
    failed = []

    buckets = defaultdict(list)
    for symbol_doc in symbol_docs:
        ticker = str(symbol_doc.get("yfinanceTicker") or "").strip() or stock_ticker(symbol_doc["symbol"])
        symbol_doc["yfinanceTicker"] = ticker
        buckets[start_key].append(symbol_doc)

    for bucket_start, bucket in buckets.items():
        total_batches = math.ceil(len(bucket) / args.batch_size)
        for chunk_index in range(0, len(bucket), args.batch_size):
            chunk = bucket[chunk_index : chunk_index + args.batch_size]
            batch_number = (chunk_index // args.batch_size) + 1
            ticker_string = " ".join(item["yfinanceTicker"] for item in chunk)
            mapping = {item["yfinanceTicker"]: item for item in chunk}
            print(
                f"[repair-deep-dive] batch {batch_number}/{total_batches} "
                f"symbols {chunk_index + 1}-{chunk_index + len(chunk)} of {len(bucket)}",
                flush=True,
            )
            try:
                frame = fetch_history_for_ticker(ticker_string, bucket_start, end_date)
            except Exception as exc:  # noqa: BLE001
                for symbol_doc in chunk:
                    failed.append({"symbol": symbol_doc["symbol"], "error": str(exc)})
                continue

            for source_ticker, symbol_doc in mapping.items():
                try:
                    symbol_frame = extract_symbol_frame(frame, source_ticker)
                    docs = dataframe_to_bar_documents(symbol_frame, symbol_doc, source_ticker)
                    if latest_row_has_missing_close(symbol_frame):
                        docs = merge_bar_documents(docs, fetch_latest_day_docs(symbol_doc, source_ticker))
                    if not docs:
                        failed.append({"symbol": symbol_doc["symbol"], "error": "No bars returned"})
                        continue
                    rows_written = bulk_upsert_bars(db, docs, dry_run=not args.apply)
                    update_sync_state(db, symbol_doc, docs, dry_run=not args.apply)
                    total_rows += rows_written
                    total_symbols += 1
                    print(
                        f"[repair-deep-dive] {symbol_doc['symbol']} -> {len(docs)} bar(s), {rows_written} write(s)",
                        flush=True,
                    )
                except Exception as exc:  # noqa: BLE001
                    failed.append({"symbol": symbol_doc["symbol"], "error": str(exc)})

    print(
        {
            "mode": "repair_recent_prices",
            "apply": bool(args.apply),
            "days": args.days,
            "symbolsAttempted": len(symbol_docs),
            "symbolsSucceeded": total_symbols,
            "rowsUpserted": total_rows,
            "failedSymbols": len(failed),
        },
        flush=True,
    )
    client.close()


if __name__ == "__main__":
    main()
