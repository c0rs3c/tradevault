#!/usr/bin/env python3
import argparse
import math
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from google.cloud import firestore
from google.oauth2 import service_account
import yfinance as yf


DEEP_DIVE_BENCHMARKS = [
    {
        "key": "NIFTY",
        "symbol": "NIFTY",
        "displayName": "Nifty 50",
        "yfinanceTicker": "^NSEI",
        "assetType": "benchmark",
    },
    {
        "key": "MIDSML400",
        "symbol": "MIDSML400",
        "displayName": "Nifty MidSmallcap 400",
        "yfinanceTicker": "^CRSLDX",
        "assetType": "benchmark",
    },
    {
        "key": "CNXSMALLCAP",
        "symbol": "CNXSMALLCAP",
        "displayName": "CNX Smallcap",
        "yfinanceTicker": "^CNXSC",
        "assetType": "benchmark",
    },
]

PRICE_COLLECTION = "deep_dive_price_bars"
SYMBOL_COLLECTION = "deep_dive_symbols"
LIST_COLLECTION = "deep_dive_stock_lists"
PROFILE_COLLECTION = "deep_dive_company_profiles"
STATE_COLLECTION = "deep_dive_sync_state"
RUN_COLLECTION = "deep_dive_ingestion_runs"


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
    return upper.replace(" ", "")


def stock_ticker(symbol: str) -> str:
    return f"{normalize_symbol(symbol)}.NS"


def stock_ticker_candidates(symbol: str) -> List[str]:
    normalized = normalize_symbol(symbol)
    if not normalized:
        return []
    candidates = [f"{normalized}.NS"]
    if "_" in normalized:
        candidates.append(f"{normalized.replace('_', '&')}.NS")
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


def days_ago(days: int) -> datetime:
    now = utc_now()
    date = now - timedelta(days=days)
    return datetime(date.year, date.month, date.day, tzinfo=timezone.utc)


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
    import json

    return json.loads(raw)


def get_db():
    project_id = str(os.getenv("DEEP_DIVE_FIRESTORE_PROJECT_ID", "")).strip() or None
    service_account_info = get_service_account_info()
    if service_account_info:
        credentials = service_account.Credentials.from_service_account_info(service_account_info)
        return firestore.Client(project=project_id or service_account_info.get("project_id"), credentials=credentials)
    return firestore.Client(project=project_id)


def chunked(items, size):
    for index in range(0, len(items), size):
        yield items[index : index + size]


def query_in_chunks(collection, field, values, chunk_size=30):
    docs = []
    for chunk in chunked(values, chunk_size):
        docs.extend(collection.where(field, "in", list(chunk)).stream())
    return docs


def commit_sets_in_chunks(db, collection_name, rows, build_doc_id, chunk_size=400):
    total = 0
    for chunk in chunked(rows, chunk_size):
        batch = db.batch()
        for row in chunk:
            ref = db.collection(collection_name).document(build_doc_id(row))
            batch.set(ref, row, merge=True)
            total += 1
        batch.commit()
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
                "active": True,
                "updatedAt": now,
                "createdAt": now,
            },
            merge=True,
        )
    batch.commit()


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
    docs = [document_to_dict(doc) for doc in db.collection(SYMBOL_COLLECTION).where("active", "==", True).stream()]
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
        date_utc = as_utc_midnight(date_value)
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


def get_price_sync_targets(db, mode: str, history_years: int, overlap_days: int):
    symbol_docs = load_active_symbols(db)
    states = load_sync_states(db, [doc["symbol"] for doc in symbol_docs])
    targets = []
    default_backfill_start = days_ago(history_years * 365)

    for doc in symbol_docs:
        state = states.get(doc["symbol"]) or {}
        latest_bar_date = as_utc_midnight(state.get("latestBarDate"))
        if mode == "backfill_prices" and latest_bar_date:
            continue
        if latest_bar_date:
            start_date = latest_bar_date - timedelta(days=overlap_days)
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


def fetch_docs_with_fallback(symbol_doc, start_key: str, end_date: str):
    candidates = symbol_doc.get("yfinanceTickers") or [symbol_doc["yfinanceTicker"]]
    last_error = None
    for candidate in candidates:
        try:
            frame = fetch_history_for_ticker(candidate, start_key, end_date)
            symbol_frame = extract_symbol_frame(frame, candidate)
            docs = dataframe_to_bar_documents(symbol_frame, symbol_doc, candidate)
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


def sync_prices(db, mode: str, history_years: int, overlap_days: int, batch_size: int):
    summary = SyncSummary(run_type=mode)
    targets = get_price_sync_targets(db, mode, history_years, overlap_days)
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
        .where("symbol", "==", symbol)
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
    load_dotenv()
    parser = argparse.ArgumentParser(description="Deep Dive historical price and profile ingestion")
    parser.add_argument(
        "--mode",
        required=True,
        choices=["backfill_prices", "sync_prices", "sync_profiles", "daily_sync"],
    )
    parser.add_argument("--history-years", type=int, default=int(os.getenv("DEEP_DIVE_HISTORY_YEARS", "3")))
    parser.add_argument("--overlap-days", type=int, default=int(os.getenv("DEEP_DIVE_SYNC_OVERLAP_DAYS", "10")))
    parser.add_argument("--profile-refresh-days", type=int, default=int(os.getenv("DEEP_DIVE_PROFILE_REFRESH_DAYS", "30")))
    parser.add_argument("--batch-size", type=int, default=int(os.getenv("DEEP_DIVE_BATCH_SIZE", "25")))
    args = parser.parse_args()

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
    started_at = utc_now()

    try:
        log(f"starting mode={args.mode}")
        if args.mode == "backfill_prices":
            summary = sync_prices(db, args.mode, args.history_years, args.overlap_days, args.batch_size)
        elif args.mode == "sync_prices":
            summary = sync_prices(db, args.mode, args.history_years, args.overlap_days, args.batch_size)
        elif args.mode == "sync_profiles":
            summary = sync_profiles(db, args.profile_refresh_days)
        else:
            price_summary = sync_prices(db, "sync_prices", args.history_years, args.overlap_days, args.batch_size)
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


if __name__ == "__main__":
    main()
