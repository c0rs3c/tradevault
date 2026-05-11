#!/usr/bin/env python3
import argparse
import json
import math
import os
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from google.cloud import firestore
from google.oauth2 import service_account
from google.cloud.firestore_v1.base_query import FieldFilter
from google.api_core.exceptions import ResourceExhausted, TooManyRequests
try:
    from google.api_core.retry import RetryError
except ImportError:  # google-api-core compatibility across local environments
    from google.api_core.exceptions import RetryError
import yfinance as yf


DEEP_DIVE_BENCHMARKS = [
    {
        "key": "NIFTY",
        "symbol": "NIFTY",
        "displayName": "Nifty 50",
        "yfinanceTicker": "^NSEI",
        "assetType": "benchmark",
    },
]

PRICE_COLLECTION = "deep_dive_price_bars"
SYMBOL_COLLECTION = "deep_dive_symbols"
LIST_COLLECTION = "deep_dive_stock_lists"
PROFILE_COLLECTION = "deep_dive_company_profiles"
STATE_COLLECTION = "deep_dive_sync_state"
RUN_COLLECTION = "deep_dive_ingestion_runs"
DEEP_DIVE_DB_PROVIDER = str(os.getenv("DEEP_DIVE_DB_PROVIDER", "mongodb")).strip().lower()
FIRESTORE_WRITE_CHUNK_SIZE = max(1, int(os.getenv("DEEP_DIVE_FIRESTORE_WRITE_CHUNK_SIZE", "100")))
FIRESTORE_WRITE_DELAY_MS = max(0, int(os.getenv("DEEP_DIVE_FIRESTORE_WRITE_DELAY_MS", "150")))
FIRESTORE_WRITE_MAX_RETRIES = max(0, int(os.getenv("DEEP_DIVE_FIRESTORE_WRITE_MAX_RETRIES", "8")))


def log(message: str):
    print(f"[deep-dive] {message}", flush=True)


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


def normalize_symbol(value: str) -> str:
    upper = str(value or "").strip().upper()
    if not upper:
        return ""
    upper = upper.replace("NSE:", "").replace("BSE:", "")
    for suffix in ("-EQ", "-BE", "-BZ", "-BL", "-SM", "-ST"):
        if upper.endswith(suffix):
            upper = upper[: -len(suffix)]
    # Normalize pasted symbols so Deep Dive consistently stores "&" instead of "_".
    return upper.replace("_", "&").replace(" ", "")


SYMBOL_ALIASES = {
    "^NSEI": "NIFTY",
    "NIFTY50": "NIFTY",
    "NIFTY 50": "NIFTY",
}


def parse_symbols_arg(value: str) -> List[str]:
    return [
        SYMBOL_ALIASES.get(symbol, symbol)
        for symbol in (normalize_symbol(item) for item in str(value or "").replace("\n", ",").split(","))
        if symbol
    ]


def stock_ticker(symbol: str) -> str:
    return f"{normalize_symbol(symbol)}.NS"


def stock_ticker_candidates(symbol: str) -> List[str]:
    normalized = normalize_symbol(symbol)
    if not normalized:
        return []
    candidates = [f"{normalized}.NS"]
    return list(dict.fromkeys(candidates))


def as_utc_midnight(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value.astimezone(timezone.utc)
        return datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)
    raw = str(value)[:10]
    try:
        return datetime.fromisoformat(raw).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def as_market_date_utc(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    raw = str(value)[:10]
    try:
        parsed = datetime.fromisoformat(raw)
        return datetime(parsed.year, parsed.month, parsed.day, tzinfo=timezone.utc)
    except ValueError:
        return None


def days_ago(days: int) -> datetime:
    now = utc_now()
    date = now - timedelta(days=days)
    return datetime(date.year, date.month, date.day, tzinfo=timezone.utc)


def current_market_date_utc() -> datetime:
    now = utc_now()
    return datetime(now.year, now.month, now.day, tzinfo=timezone.utc)


def numeric(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def document_to_dict(snapshot):
    data = snapshot.to_dict() or {}
    data["_id"] = snapshot.id
    return data


def get_service_account_info():
    raw = str(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY", "")).strip()
    if not raw:
        return None
    return json.loads(raw)


def get_db():
    project_id = str(os.getenv("DEEP_DIVE_FIRESTORE_PROJECT_ID", "")).strip() or None
    service_account_info = get_service_account_info()
    if service_account_info:
        credentials = service_account.Credentials.from_service_account_info(service_account_info)
        return firestore.Client(project=project_id or service_account_info.get("project_id"), credentials=credentials)
    return firestore.Client(project=project_id)


def get_mongo_db():
    from pymongo import ASCENDING, DESCENDING, MongoClient

    mongo_uri = str(os.getenv("DEEP_DIVE_MONGO_URI", "")).strip()
    if not mongo_uri:
        raise SystemExit("Missing DEEP_DIVE_MONGO_URI")
    client = MongoClient(mongo_uri)
    db_name = str(os.getenv("DEEP_DIVE_DB_NAME", "")).strip() or None
    db = client.get_database(db_name) if db_name else client.get_default_database()
    return client, db, ASCENDING, DESCENDING


def chunked(items, size):
    for index in range(0, len(items), size):
        yield items[index : index + size]


def query_in_chunks(collection, field, values, chunk_size=30):
    docs = []
    for chunk in chunked(values, chunk_size):
        docs.extend(collection.where(filter=FieldFilter(field, "in", list(chunk))).stream())
    return docs


def is_quota_error(exc):
    if isinstance(exc, (ResourceExhausted, TooManyRequests)):
        return True
    if isinstance(exc, RetryError):
        return "429" in str(exc) or "Quota exceeded" in str(exc)
    return False


def commit_with_backoff(batch, operation_name):
    attempt = 0
    while True:
        try:
            batch.commit()
            if FIRESTORE_WRITE_DELAY_MS:
                time.sleep(FIRESTORE_WRITE_DELAY_MS / 1000)
            return
        except Exception as exc:  # noqa: BLE001
            if not is_quota_error(exc) or attempt >= FIRESTORE_WRITE_MAX_RETRIES:
                raise
            sleep_seconds = min(30, (2 ** attempt) * 1.5)
            log(
                f"{operation_name}: Firestore quota throttled, retrying in {round(sleep_seconds, 1)}s "
                f"(attempt {attempt + 1}/{FIRESTORE_WRITE_MAX_RETRIES})"
            )
            time.sleep(sleep_seconds)
            attempt += 1


def commit_sets_in_chunks(db, collection_name, rows, build_doc_id, chunk_size=FIRESTORE_WRITE_CHUNK_SIZE):
    total = 0
    for chunk in chunked(rows, chunk_size):
        batch = db.batch()
        for row in chunk:
            ref = db.collection(collection_name).document(build_doc_id(row))
            batch.set(ref, row, merge=True)
            total += 1
        commit_with_backoff(batch, f"commit:{collection_name}")
    return total


def ensure_benchmarks(db):
    batch = db.batch()
    now = utc_now()
    for item in DEEP_DIVE_BENCHMARKS:
        ref = db.collection(SYMBOL_COLLECTION).document(item["symbol"])
        batch.set(
            ref,
            {
                "symbol": item["symbol"],
                "assetType": "benchmark",
                "benchmarkKey": item["key"],
                "displayName": item["displayName"],
                "yfinanceTicker": item["yfinanceTicker"],
                "yfinanceTickers": item.get("yfinanceTickers") or [item["yfinanceTicker"]],
                "active": True,
                "updatedAt": now,
                "createdAt": now,
            },
            merge=True,
        )
    commit_with_backoff(batch, f"commit:{SYMBOL_COLLECTION}:benchmarks")


def ensure_stock_symbols(db):
    lists = [document_to_dict(doc) for doc in db.collection(LIST_COLLECTION).stream()]
    symbols = sorted(
        {
            normalize_symbol(symbol)
            for item in lists
            for symbol in item.get("symbols", [])
            if normalize_symbol(symbol)
        }
    )
    if not symbols:
        return
    now = utc_now()
    rows = [
        {
            "symbol": symbol,
            "assetType": "stock",
            "displayName": symbol,
            "yfinanceTicker": stock_ticker(symbol),
            "yfinanceTickers": stock_ticker_candidates(symbol),
            "active": True,
            "updatedAt": now,
            "createdAt": now,
        }
        for symbol in symbols
    ]
    commit_sets_in_chunks(db, SYMBOL_COLLECTION, rows, lambda row: row["symbol"])


def load_active_symbols(db):
    ensure_benchmarks(db)
    ensure_stock_symbols(db)
    docs = [
        document_to_dict(doc)
        for doc in db.collection(SYMBOL_COLLECTION)
        .where(filter=FieldFilter("active", "==", True))
        .stream()
    ]
    docs.sort(key=lambda item: (item.get("assetType") != "benchmark", item.get("symbol", "")))
    return docs


def extract_symbol_frame(dataframe, ticker):
    if dataframe is None or getattr(dataframe, "empty", True):
        return None
    columns = dataframe.columns
    if getattr(columns, "nlevels", 1) > 1:
        if ticker in columns.get_level_values(0):
            return dataframe[ticker]
        return None
    return dataframe


def dataframe_to_bar_documents(frame, symbol_doc, source_ticker=None):
    if frame is None or frame.empty:
        return []
    output = []
    for index, row in frame.iterrows():
        date_value = index.to_pydatetime() if hasattr(index, "to_pydatetime") else index
        date_utc = as_market_date_utc(date_value)
        if not date_utc:
            continue
        open_value = numeric(row.get("Open"))
        high_value = numeric(row.get("High"))
        low_value = numeric(row.get("Low"))
        close_value = numeric(row.get("Close"))
        adj_close_value = numeric(row.get("Adj Close"))
        volume_value = numeric(row.get("Volume"))
        if close_value is None and adj_close_value is None:
            continue
        output.append(
            {
                "symbol": symbol_doc["symbol"],
                "assetType": symbol_doc["assetType"],
                "date": date_utc,
                "open": open_value,
                "high": high_value,
                "low": low_value,
                "close": close_value,
                "adjClose": adj_close_value,
                "volume": volume_value,
                "sourceTicker": source_ticker or symbol_doc["yfinanceTicker"],
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


@dataclass
class SyncSummary:
    run_type: str
    symbols_attempted: int = 0
    symbols_succeeded: int = 0
    rows_upserted: int = 0
    failed_symbols: Optional[List[dict]] = None

    def __post_init__(self):
        if self.failed_symbols is None:
            self.failed_symbols = []


def record_run(db, summary: SyncSummary, started_at: datetime, status: str):
    finished_at = utc_now()
    db.collection(RUN_COLLECTION).add(
        {
            "runType": summary.run_type,
            "status": status,
            "startedAt": started_at,
            "finishedAt": finished_at,
            "symbolsAttempted": summary.symbols_attempted,
            "symbolsSucceeded": summary.symbols_succeeded,
            "rowsUpserted": summary.rows_upserted,
            "failedSymbols": summary.failed_symbols,
            "errorSummary": summary.failed_symbols[0]["error"] if summary.failed_symbols else "",
            "createdAt": finished_at,
            "updatedAt": finished_at,
        }
    )


def load_sync_states(db, symbols):
    if not symbols:
        return {}
    docs = query_in_chunks(db.collection(STATE_COLLECTION), "symbol", symbols)
    return {doc.id: document_to_dict(doc) for doc in docs}


def get_price_sync_targets(db, mode: str, history_years: int, overlap_days: int, selected_symbols=None):
    symbol_docs = load_active_symbols(db)
    selected = set(selected_symbols or [])
    if selected:
        symbol_docs = [doc for doc in symbol_docs if doc["symbol"] in selected]
    states = load_sync_states(db, [doc["symbol"] for doc in symbol_docs])
    targets = []
    default_backfill_start = days_ago(history_years * 365)
    current_date = current_market_date_utc()

    for doc in symbol_docs:
        state = states.get(doc["symbol"]) or {}
        latest_bar_date = as_utc_midnight(state.get("latestBarDate"))
        if mode == "backfill_prices" and latest_bar_date:
            continue
        if latest_bar_date:
            days_since_latest = max(0, (current_date - latest_bar_date).days)
            if days_since_latest <= 0:
                continue
            start_date = latest_bar_date
        else:
            start_date = default_backfill_start
        targets.append(
            {
                "symbol": doc["symbol"],
                "assetType": doc["assetType"],
                "yfinanceTicker": doc["yfinanceTicker"],
                "start_date": start_date,
            }
        )
    return targets


def bulk_upsert_bars(db, bar_documents):
    if not bar_documents:
        return 0
    rows = [{**bar, "createdAt": bar.get("createdAt") or utc_now()} for bar in bar_documents]
    return commit_sets_in_chunks(
        db,
        PRICE_COLLECTION,
        rows,
        lambda row: f"{row['symbol']}_{row['date'].strftime('%Y-%m-%d')}",
    )


def fetch_history_for_ticker(ticker: str, start_key: str, end_date: str):
    return yf.download(
        tickers=ticker,
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


def fetch_docs_with_fallback(symbol_doc, start_key: str, end_date: str):
    candidates = symbol_doc.get("yfinanceTickers") or [symbol_doc["yfinanceTicker"]]
    last_error = None
    for candidate in candidates:
        try:
            frame = fetch_history_for_ticker(candidate, start_key, end_date)
            symbol_frame = extract_symbol_frame(frame, candidate)
            docs = dataframe_to_bar_documents(symbol_frame, symbol_doc, candidate)
            if latest_row_has_missing_close(symbol_frame):
                docs = merge_bar_documents(docs, fetch_latest_day_docs(symbol_doc, candidate))
            if docs:
                return docs, candidate, None
            last_error = "No bars returned"
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
    return [], None, last_error


def update_sync_state_for_success(db, symbol_doc, earliest_bar, latest_bar):
    now = utc_now()
    ref = db.collection(STATE_COLLECTION).document(symbol_doc["symbol"])
    snapshot = ref.get()
    current = snapshot.to_dict() or {}
    next_payload = {
        "symbol": symbol_doc["symbol"],
        "assetType": symbol_doc["assetType"],
        "lastSyncedAt": now,
        "lastAttemptedAt": now,
        "lastStatus": "success",
        "lastError": "",
        "earliestBarDate": min(filter(None, [current.get("earliestBarDate"), earliest_bar])),
        "latestBarDate": max(filter(None, [current.get("latestBarDate"), latest_bar])),
        "updatedAt": now,
        "createdAt": current.get("createdAt") or now,
    }
    ref.set(next_payload, merge=True)


def update_sync_state_for_failure(db, symbol_doc, error_message):
    now = utc_now()
    db.collection(STATE_COLLECTION).document(symbol_doc["symbol"]).set(
        {
            "symbol": symbol_doc["symbol"],
            "assetType": symbol_doc["assetType"],
            "lastAttemptedAt": now,
            "lastStatus": "failed",
            "lastError": str(error_message)[:1000],
            "updatedAt": now,
            "createdAt": now,
        },
        merge=True,
    )


def sync_prices(db, mode: str, history_years: int, overlap_days: int, batch_size: int, selected_symbols=None):
    summary = SyncSummary(run_type=mode)
    targets = get_price_sync_targets(db, mode, history_years, overlap_days, selected_symbols=selected_symbols)
    summary.symbols_attempted = len(targets)
    if not targets:
        log(f"{mode}: no symbols require price sync")
        return summary

    log(
        f"{mode}: preparing to sync prices for {summary.symbols_attempted} symbol(s) "
        f"with batch size {batch_size}"
    )

    buckets = defaultdict(list)
    for target in targets:
        buckets[target["start_date"].strftime("%Y-%m-%d")].append(target)

    end_date = (utc_now() + timedelta(days=1)).strftime("%Y-%m-%d")
    processed = 0

    for start_key, bucket in buckets.items():
        log(
            f"{mode}: syncing {len(bucket)} symbol(s) from {start_key} to {end_date} "
            f"across {math.ceil(len(bucket) / batch_size)} batch(es)"
        )
        for chunk_index in range(0, len(bucket), batch_size):
            chunk = bucket[chunk_index : chunk_index + batch_size]
            ticker_string = " ".join(item["yfinanceTicker"] for item in chunk)
            mapping = {item["yfinanceTicker"]: item for item in chunk}
            batch_number = (chunk_index // batch_size) + 1
            log(
                f"{mode}: batch {batch_number}/{math.ceil(len(bucket) / batch_size)} "
                f"({processed + 1}-{processed + len(chunk)} of {summary.symbols_attempted})"
            )
            try:
                frame = fetch_history_for_ticker(ticker_string, start_key, end_date)
            except Exception as exc:  # noqa: BLE001
                for symbol_doc in chunk:
                    summary.failed_symbols.append({"symbol": symbol_doc["symbol"], "error": str(exc)})
                    update_sync_state_for_failure(db, symbol_doc, exc)
                    log(
                        f"{mode}: {processed + 1}/{summary.symbols_attempted} failed "
                        f"{symbol_doc['symbol']} - {exc}"
                    )
                    processed += 1
                continue

            for source_ticker, symbol_doc in mapping.items():
                try:
                    symbol_frame = extract_symbol_frame(frame, source_ticker)
                    docs = dataframe_to_bar_documents(symbol_frame, symbol_doc, source_ticker)
                    if latest_row_has_missing_close(symbol_frame):
                        docs = merge_bar_documents(docs, fetch_latest_day_docs(symbol_doc, source_ticker))
                    used_ticker = source_ticker
                    if not docs:
                        docs, used_ticker, last_error = fetch_docs_with_fallback(symbol_doc, start_key, end_date)
                        if used_ticker and used_ticker != source_ticker:
                            db.collection(SYMBOL_COLLECTION).document(symbol_doc["symbol"]).set(
                                {
                                    "yfinanceTicker": used_ticker,
                                    "updatedAt": utc_now(),
                                },
                                merge=True,
                            )
                            symbol_doc["yfinanceTicker"] = used_ticker
                    if not docs:
                        failure_reason = last_error or "No bars returned"
                        update_sync_state_for_failure(db, symbol_doc, failure_reason)
                        summary.failed_symbols.append(
                            {"symbol": symbol_doc["symbol"], "error": failure_reason}
                        )
                        log(
                            f"{mode}: {processed + 1}/{summary.symbols_attempted} no bars for "
                            f"{symbol_doc['symbol']} ({failure_reason})"
                        )
                        processed += 1
                        continue
                    rows_written = bulk_upsert_bars(db, docs)
                    summary.rows_upserted += rows_written
                    summary.symbols_succeeded += 1
                    update_sync_state_for_success(
                        db,
                        symbol_doc,
                        docs[0]["date"],
                        docs[-1]["date"],
                    )
                    log(
                        f"{mode}: {processed + 1}/{summary.symbols_attempted} synced "
                        f"{symbol_doc['symbol']} via {used_ticker or source_ticker} "
                        f"({len(docs)} bar(s), {rows_written} write(s))"
                    )
                except Exception as exc:  # noqa: BLE001
                    summary.failed_symbols.append({"symbol": symbol_doc["symbol"], "error": str(exc)})
                    update_sync_state_for_failure(db, symbol_doc, exc)
                    log(
                        f"{mode}: {processed + 1}/{summary.symbols_attempted} failed "
                        f"{symbol_doc['symbol']} - {exc}"
                    )
                finally:
                    processed += 1

    log(
        f"{mode}: completed with {summary.symbols_succeeded}/{summary.symbols_attempted} "
        f"symbol(s) successful and {len(summary.failed_symbols)} failure(s)"
    )

    return summary


def profile_due(profile_doc, threshold_days):
    last_synced = as_utc_midnight(profile_doc.get("lastProfileSyncedAt")) if profile_doc else None
    if not last_synced:
        return True
    return last_synced <= days_ago(threshold_days)


def compute_average_traded_value(db, symbol):
    docs = (
        db.collection(PRICE_COLLECTION)
        .where(filter=FieldFilter("symbol", "==", symbol))
        .order_by("date", direction=firestore.Query.DESCENDING)
        .limit(20)
        .stream()
    )
    values = []
    for snapshot in docs:
        item = snapshot.to_dict() or {}
        close_value = numeric(item.get("adjClose"))
        if close_value is None:
            close_value = numeric(item.get("close"))
        volume_value = numeric(item.get("volume"))
        if close_value is None or volume_value is None:
            continue
        values.append(close_value * volume_value)
    if not values:
        return None
    return sum(values) / len(values)


def load_profiles(db, symbols):
    if not symbols:
        return {}
    docs = query_in_chunks(db.collection(PROFILE_COLLECTION), "symbol", symbols)
    return {doc.id: document_to_dict(doc) for doc in docs}


def sync_profiles(db, refresh_days: int):
    summary = SyncSummary(run_type="sync_profiles")
    symbol_docs = [item for item in load_active_symbols(db) if item["assetType"] == "stock"]
    profiles = load_profiles(db, [doc["symbol"] for doc in symbol_docs])
    due_docs = [doc for doc in symbol_docs if profile_due(profiles.get(doc["symbol"]), refresh_days)]
    summary.symbols_attempted = len(due_docs)
    if not due_docs:
        log("sync_profiles: no company profiles require refresh")
        return summary

    log(
        f"sync_profiles: refreshing {summary.symbols_attempted} stock profile(s) "
        f"with age threshold {refresh_days} day(s)"
    )

    for index, symbol_doc in enumerate(due_docs, start=1):
        try:
            log(
                f"sync_profiles: {index}/{summary.symbols_attempted} "
                f"{symbol_doc['symbol']}"
            )
            ticker = yf.Ticker(symbol_doc["yfinanceTicker"])
            info = ticker.info or {}
            company_name = info.get("longName") or info.get("shortName") or symbol_doc["symbol"]
            now = utc_now()
            average_traded_value = compute_average_traded_value(db, symbol_doc["symbol"])
            document = {
                "symbol": symbol_doc["symbol"],
                "companyName": company_name,
                "sector": info.get("sector") or "",
                "industry": info.get("industry") or "",
                "summary": info.get("longBusinessSummary") or "",
                "marketCap": numeric(info.get("marketCap")),
                "averageVolume": numeric(info.get("averageVolume")),
                "averageTradedValue": average_traded_value,
                "sharesOutstanding": numeric(info.get("sharesOutstanding")),
                "floatShares": numeric(info.get("floatShares")),
                "trailingPe": numeric(info.get("trailingPE")),
                "priceToBook": numeric(info.get("priceToBook")),
                "returnOnEquity": numeric(info.get("returnOnEquity")),
                "debtToEquity": numeric(info.get("debtToEquity")),
                "epsTrailing": numeric(info.get("trailingEps")),
                "dividendYield": numeric(info.get("dividendYield")),
                "fiftyTwoWeekHigh": numeric(info.get("fiftyTwoWeekHigh")),
                "fiftyTwoWeekLow": numeric(info.get("fiftyTwoWeekLow")),
                "listingDate": None,
                "source": "yfinance",
                "sourceTimestamp": now,
                "lastProfileSyncedAt": now,
                "updatedAt": now,
                "createdAt": now,
            }
            db.collection(PROFILE_COLLECTION).document(symbol_doc["symbol"]).set(document, merge=True)
            db.collection(STATE_COLLECTION).document(symbol_doc["symbol"]).set(
                {
                    "symbol": symbol_doc["symbol"],
                    "assetType": symbol_doc["assetType"],
                    "lastProfileSyncedAt": now,
                    "lastAttemptedAt": now,
                    "lastStatus": "profile_success",
                    "lastError": "",
                    "updatedAt": now,
                    "createdAt": now,
                },
                merge=True,
            )
            summary.symbols_succeeded += 1
            log(f"sync_profiles: {index}/{summary.symbols_attempted} synced {symbol_doc['symbol']}")
        except Exception as exc:  # noqa: BLE001
            summary.failed_symbols.append({"symbol": symbol_doc["symbol"], "error": str(exc)})
            update_sync_state_for_failure(db, symbol_doc, exc)
            log(f"sync_profiles: {index}/{summary.symbols_attempted} failed {symbol_doc['symbol']} - {exc}")

    log(
        f"sync_profiles: completed with {summary.symbols_succeeded}/{summary.symbols_attempted} "
        f"profile(s) successful and {len(summary.failed_symbols)} failure(s)"
    )

    return summary


def combined_summary(mode, *summaries):
    result = SyncSummary(run_type=mode)
    for summary in summaries:
        result.symbols_attempted += summary.symbols_attempted
        result.symbols_succeeded += summary.symbols_succeeded
        result.rows_upserted += summary.rows_upserted
        result.failed_symbols.extend(summary.failed_symbols)
    return result


def main():
    global firestore
    global FieldFilter
    global ResourceExhausted
    global TooManyRequests
    global RetryError
    global query_in_chunks
    global commit_sets_in_chunks
    global ensure_benchmarks
    global ensure_stock_symbols
    global load_active_symbols
    global record_run
    global load_sync_states
    global update_sync_state_for_success
    global update_sync_state_for_failure
    global compute_average_traded_value
    global load_profiles

    load_dotenv()
    parser = argparse.ArgumentParser(description="Deep Dive historical price and profile ingestion")
    parser.add_argument(
        "--mode",
        required=True,
        choices=["backfill_prices", "sync_prices", "sync_profiles", "daily_sync"],
    )
    parser.add_argument("--history-years", type=int, default=int(os.getenv("DEEP_DIVE_HISTORY_YEARS", "3")))
    parser.add_argument("--overlap-days", type=int, default=int(os.getenv("DEEP_DIVE_SYNC_OVERLAP_DAYS", "1")))
    parser.add_argument("--profile-refresh-days", type=int, default=int(os.getenv("DEEP_DIVE_PROFILE_REFRESH_DAYS", "30")))
    parser.add_argument("--batch-size", type=int, default=int(os.getenv("DEEP_DIVE_BATCH_SIZE", "25")))
    parser.add_argument(
        "--symbols",
        type=str,
        default="",
        help="Comma-separated symbols to limit processing, e.g. NIFTY or SBIN,INFY"
    )
    args = parser.parse_args()
    selected_symbols = parse_symbols_arg(args.symbols)

    if DEEP_DIVE_DB_PROVIDER not in {"mongodb", "firestore"}:
        raise SystemExit('DEEP_DIVE_DB_PROVIDER must be "mongodb" or "firestore"')

    mongo_client = None
    if DEEP_DIVE_DB_PROVIDER == "firestore":
        project_id = str(os.getenv("DEEP_DIVE_FIRESTORE_PROJECT_ID", "")).strip()
        if (
            not project_id
            and not str(os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")).strip()
            and not str(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY", "")).strip()
        ):
            raise SystemExit(
                "Missing Firestore configuration. Set DEEP_DIVE_FIRESTORE_PROJECT_ID with GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_KEY."
            )
        db = get_db()
    else:
        mongo_client, db, ASCENDING, DESCENDING = get_mongo_db()
        import pymongo

        def query_in_chunks(collection, field, values, chunk_size=30):
            docs = []
            for chunk in chunked(values, chunk_size):
                docs.extend(collection.find({field: {"$in": list(chunk)}}))
            return docs

        def commit_sets_in_chunks(db, collection_name, rows, build_doc_id, chunk_size=FIRESTORE_WRITE_CHUNK_SIZE):
            if not rows:
                return 0
            operations = []
            for row in rows:
                created_at = row.get("createdAt") or utc_now()
                set_payload = {key: value for key, value in row.items() if key != "createdAt"}
                if collection_name == PRICE_COLLECTION and row.get("symbol") and row.get("date"):
                    filter_query = {"symbol": row["symbol"], "date": row["date"]}
                else:
                    filter_query = {"_id": build_doc_id(row)}
                operations.append(
                    pymongo.UpdateOne(
                        filter_query,
                        {"$set": set_payload, "$setOnInsert": {"createdAt": created_at}},
                        upsert=True,
                    )
                )
            db[collection_name].bulk_write(operations, ordered=False)
            return len(rows)

        def ensure_benchmarks(db):
            operations = []
            now = utc_now()
            for item in DEEP_DIVE_BENCHMARKS:
                operations.append(
                    pymongo.UpdateOne(
                        {"symbol": item["symbol"]},
                        {
                            "$setOnInsert": {
                                "symbol": item["symbol"],
                                "assetType": "benchmark",
                                "benchmarkKey": item["key"],
                                "createdAt": now,
                            },
                            "$set": {
                                "displayName": item["displayName"],
                                "yfinanceTicker": item["yfinanceTicker"],
                                "yfinanceTickers": item.get("yfinanceTickers") or [item["yfinanceTicker"]],
                                "active": True,
                                "updatedAt": now,
                            },
                        },
                        upsert=True,
                    )
                )
            if operations:
                db[SYMBOL_COLLECTION].bulk_write(operations, ordered=False)

        def ensure_stock_symbols(db):
            lists = list(db[LIST_COLLECTION].find({}, {"symbols": 1}))
            symbols = sorted(
                {
                    normalize_symbol(symbol)
                    for item in lists
                    for symbol in item.get("symbols", [])
                    if normalize_symbol(symbol)
                }
            )
            if not symbols:
                return
            now = utc_now()
            operations = []
            for symbol in symbols:
                operations.append(
                    pymongo.UpdateOne(
                        {"symbol": symbol},
                        {
                            "$setOnInsert": {"symbol": symbol, "assetType": "stock", "createdAt": now},
                            "$set": {
                                "displayName": symbol,
                                "yfinanceTicker": stock_ticker(symbol),
                                "yfinanceTickers": stock_ticker_candidates(symbol),
                                "active": True,
                                "updatedAt": now,
                            },
                        },
                        upsert=True,
                    )
                )
            db[SYMBOL_COLLECTION].bulk_write(operations, ordered=False)

        def load_active_symbols(db):
            ensure_benchmarks(db)
            ensure_stock_symbols(db)
            docs = list(db[SYMBOL_COLLECTION].find({"active": True}, {"_id": 0}))
            docs.sort(key=lambda item: (item.get("assetType") != "benchmark", item.get("symbol", "")))
            return docs

        def record_run(db, summary: SyncSummary, started_at: datetime, status: str):
            finished_at = utc_now()
            db[RUN_COLLECTION].insert_one(
                {
                    "runType": summary.run_type,
                    "status": status,
                    "startedAt": started_at,
                    "finishedAt": finished_at,
                    "symbolsAttempted": summary.symbols_attempted,
                    "symbolsSucceeded": summary.symbols_succeeded,
                    "rowsUpserted": summary.rows_upserted,
                    "failedSymbols": summary.failed_symbols,
                    "errorSummary": summary.failed_symbols[0]["error"] if summary.failed_symbols else "",
                    "createdAt": finished_at,
                    "updatedAt": finished_at,
                }
            )

        def load_sync_states(db, symbols):
            if not symbols:
                return {}
            docs = list(db[STATE_COLLECTION].find({"symbol": {"$in": symbols}}, {"_id": 0}))
            return {doc["symbol"]: doc for doc in docs}

        def update_sync_state_for_success(db, symbol_doc, earliest_bar, latest_bar):
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
                    "$min": {"earliestBarDate": earliest_bar},
                    "$max": {"latestBarDate": latest_bar},
                    "$setOnInsert": {"createdAt": now},
                },
                upsert=True,
            )

        def update_sync_state_for_failure(db, symbol_doc, error_message):
            now = utc_now()
            db[STATE_COLLECTION].update_one(
                {"symbol": symbol_doc["symbol"]},
                {
                    "$set": {
                        "symbol": symbol_doc["symbol"],
                        "assetType": symbol_doc["assetType"],
                        "lastAttemptedAt": now,
                        "lastStatus": "failed",
                        "lastError": str(error_message)[:1000],
                        "updatedAt": now,
                    },
                    "$setOnInsert": {"createdAt": now},
                },
                upsert=True,
            )

        def compute_average_traded_value(db, symbol):
            cursor = db[PRICE_COLLECTION].find({"symbol": symbol}, {"close": 1, "adjClose": 1, "volume": 1}).sort("date", -1).limit(20)
            values = []
            for item in cursor:
                close_value = numeric(item.get("adjClose"))
                if close_value is None:
                    close_value = numeric(item.get("close"))
                volume_value = numeric(item.get("volume"))
                if close_value is None or volume_value is None:
                    continue
                values.append(close_value * volume_value)
            return (sum(values) / len(values)) if values else None

        def load_profiles(db, symbols):
            if not symbols:
                return {}
            docs = list(db[PROFILE_COLLECTION].find({"symbol": {"$in": symbols}}, {"_id": 0}))
            return {doc["symbol"]: doc for doc in docs}
    started_at = utc_now()

    try:
        log(f"starting mode={args.mode}")
        if args.mode == "backfill_prices":
            summary = sync_prices(
                db,
                args.mode,
                args.history_years,
                args.overlap_days,
                args.batch_size,
                selected_symbols=selected_symbols,
            )
        elif args.mode == "sync_prices":
            summary = sync_prices(
                db,
                args.mode,
                args.history_years,
                args.overlap_days,
                args.batch_size,
                selected_symbols=selected_symbols,
            )
        elif args.mode == "sync_profiles":
            summary = sync_profiles(db, args.profile_refresh_days)
        else:
            price_summary = sync_prices(
                db,
                "sync_prices",
                args.history_years,
                args.overlap_days,
                args.batch_size,
                selected_symbols=selected_symbols,
            )
            profile_summary = sync_profiles(db, args.profile_refresh_days)
            summary = combined_summary("daily_sync", price_summary, profile_summary)
        status = "success" if not summary.failed_symbols else "partial_success"
        record_run(db, summary, started_at, status)
        print(
            {
                "mode": summary.run_type,
                "status": status,
                "symbolsAttempted": summary.symbols_attempted,
                "symbolsSucceeded": summary.symbols_succeeded,
                "rowsUpserted": summary.rows_upserted,
                "failedSymbols": len(summary.failed_symbols),
            }
        )
        log(f"finished mode={summary.run_type} status={status}")
    except Exception as exc:  # noqa: BLE001
        failed = SyncSummary(run_type=args.mode, failed_symbols=[{"symbol": "", "error": str(exc)}])
        record_run(db, failed, started_at, "failed")
        log(f"fatal failure in mode={args.mode} - {exc}")
        raise
    finally:
        if mongo_client:
            mongo_client.close()


if __name__ == "__main__":
    main()
