#!/usr/bin/env python3
import argparse
import json
import math
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, unquote

import yfinance as yf

try:
    import psycopg  # type: ignore
except ModuleNotFoundError:
    try:
        import psycopg2 as psycopg  # type: ignore
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "Missing PostgreSQL driver. Install requirements.txt so either 'psycopg' or 'psycopg2' is available."
        ) from exc


ROOT = Path(__file__).resolve().parent.parent
NSE_UNIVERSE_FILE_PATH = ROOT / "data" / "nse-universe.csv"
HISTORY_START_DATE = datetime.strptime(
    str(os.getenv("NSE_UNIVERSE_HISTORY_START_DATE") or "2020-01-01").strip()[:10],
    "%Y-%m-%d",
).date()
MARKET_CAP_STALE_DAYS = max(1, int(os.getenv("NSE_UNIVERSE_MARKET_CAP_STALE_DAYS", "7")))
BATCH_SIZE = max(1, int(os.getenv("NSE_UNIVERSE_SYNC_BATCH_SIZE", "20")))


def load_dotenv():
    for filename in (".env", ".env.local"):
        path = ROOT / filename
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


def numeric(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def int_value(value):
    number = numeric(value)
    return int(number) if number is not None else None


def normalize_symbol(value: str) -> str:
    upper = str(value or "").strip().upper()
    if not upper:
        return ""
    upper = upper.replace("NSE:", "").replace("BSE:", "")
    for suffix in ("-EQ", "-BE", "-BZ", "-BL", "-SM", "-ST"):
        if upper.endswith(suffix):
            upper = upper[: -len(suffix)]
    return upper.replace(" ", "")


def build_yfinance_ticker(symbol: str) -> str:
    return build_yfinance_ticker_candidates(symbol)[0]


def build_yfinance_ticker_candidates(symbol: str):
    normalized = normalize_symbol(symbol)
    candidates = [f"{normalized.replace('&', '_')}.NS", f"{normalized}.NS"]
    output = []
    seen = set()
    for candidate in candidates:
        if candidate and candidate not in seen:
            seen.add(candidate)
            output.append(candidate)
    return output


def parse_universe_symbols(text: str):
    seen = set()
    output = []
    for raw_item in str(text or "").replace("\n", ",").split(","):
        symbol = normalize_symbol(raw_item)
        if symbol and symbol not in seen:
            seen.add(symbol)
            output.append(symbol)
    return output


def load_universe_symbols():
    if not NSE_UNIVERSE_FILE_PATH.exists():
        raise SystemExit(f"Missing universe file: {NSE_UNIVERSE_FILE_PATH}")
    symbols = parse_universe_symbols(NSE_UNIVERSE_FILE_PATH.read_text(encoding="utf-8"))
    if not symbols:
        raise SystemExit("No symbols found in data/nse-universe.csv")
    return symbols


def parse_date_key(value: str) -> date:
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def add_days(base_date: date, days: int) -> date:
    return base_date + timedelta(days=days)


def safe_rollback(conn):
    try:
        conn.rollback()
    except Exception:
        pass


def chunked(items, size):
    for index in range(0, len(items), size):
        yield items[index : index + size]


def extract_symbol_frame(dataframe, ticker):
    if dataframe is None or getattr(dataframe, "empty", True):
        return None
    columns = dataframe.columns
    if getattr(columns, "nlevels", 1) > 1:
        level_zero = columns.get_level_values(0)
        if ticker in level_zero:
            return dataframe[ticker]
        return None
    return dataframe


def dataframe_to_rows(frame, symbol, start_date):
    if frame is None or frame.empty:
        return []
    rows = []
    for index, row in frame.iterrows():
        raw_date = index.to_pydatetime().date() if hasattr(index, "to_pydatetime") else index
        trade_date = raw_date if isinstance(raw_date, date) else parse_date_key(str(raw_date))
        if trade_date < start_date:
            continue
        close_value = numeric(row.get("Close"))
        adj_close_value = numeric(row.get("Adj Close"))
        if close_value is None and adj_close_value is None:
            continue
        rows.append(
            (
                symbol,
                trade_date,
                numeric(row.get("Open")),
                numeric(row.get("High")),
                numeric(row.get("Low")),
                close_value,
                adj_close_value,
                int_value(row.get("Volume")),
            )
        )
    return rows


def get_pg_connection():
    dsn = str(os.getenv("SCREENER_PG_DSN") or os.getenv("DATABASE_URL") or "").strip()
    if dsn:
        parsed = urlparse(dsn)
        parsed_password = unquote(parsed.password) if parsed.password else ""
        if parsed_password:
            return psycopg.connect(dsn)
        socket_dir = str(os.getenv("SCREENER_PG_SOCKET_DIR") or "/tmp").strip()
        return psycopg.connect(
            host=socket_dir,
            port=parsed.port or int(os.getenv("SCREENER_PG_PORT") or "5432"),
            dbname=(parsed.path or "").replace("/", "", 1) or str(os.getenv("SCREENER_PG_DB") or "trade_journal").strip(),
            user=unquote(parsed.username) if parsed.username else str(os.getenv("SCREENER_PG_USER") or "praween").strip(),
            password=None,
        )

    host = str(os.getenv("SCREENER_PG_HOST") or "127.0.0.1").strip()
    socket_dir = str(os.getenv("SCREENER_PG_SOCKET_DIR") or "/tmp").strip()
    user = str(os.getenv("SCREENER_PG_USER") or "praween").strip()
    password = str(os.getenv("SCREENER_PG_PASSWORD") or "").strip()
    database = str(os.getenv("SCREENER_PG_DB") or "earnings_screener_db").strip()
    port = int(os.getenv("SCREENER_PG_PORT") or "5432")

    return psycopg.connect(
        host=host if password else socket_dir,
        port=port,
        dbname=database,
        user=user,
        password=password or None,
    )


def ensure_tables(conn):
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS nse_universe_symbols (
                  symbol TEXT PRIMARY KEY,
                  tv_symbol TEXT NOT NULL UNIQUE,
                  yfinance_ticker TEXT NOT NULL,
                  company_name TEXT NOT NULL DEFAULT '',
                  market_cap BIGINT,
                  market_cap_updated_at TIMESTAMPTZ,
                  last_history_sync_date DATE,
                  latest_history_sync_at TIMESTAMPTZ,
                  last_success_at TIMESTAMPTZ,
                  last_error TEXT NOT NULL DEFAULT '',
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS nse_universe_daily_bars (
                  symbol TEXT NOT NULL REFERENCES nse_universe_symbols(symbol) ON DELETE CASCADE,
                  trade_date DATE NOT NULL,
                  open NUMERIC,
                  high NUMERIC,
                  low NUMERIC,
                  close NUMERIC,
                  adj_close NUMERIC,
                  volume BIGINT,
                  sma_10 NUMERIC,
                  sma_20 NUMERIC,
                  sma_50 NUMERIC,
                  sma_200 NUMERIC,
                  volume_sma_30 NUMERIC,
                  rupee_volume_crore NUMERIC,
                  market_cap BIGINT,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  PRIMARY KEY(symbol, trade_date)
                )
                """
            )
        conn.commit()
    except Exception:
        safe_rollback(conn)
        raise


def seed_symbols(conn, symbols):
    try:
        stale_ampersand_symbols = [symbol.replace("_", "&") for symbol in symbols if "_" in symbol]
        with conn.cursor() as cur:
            if stale_ampersand_symbols:
                cur.execute(
                    "DELETE FROM nse_universe_daily_bars WHERE symbol = ANY(%s)",
                    [stale_ampersand_symbols],
                )
                cur.execute(
                    "DELETE FROM nse_universe_symbols WHERE symbol = ANY(%s)",
                    [stale_ampersand_symbols],
                )
            for chunk in chunked(symbols, 500):
                values = []
                placeholders = []
                for index, symbol in enumerate(chunk):
                    values.extend([symbol, f"NSE:{symbol}", build_yfinance_ticker(symbol)])
                    placeholders.append("(%s, %s, %s)")
                cur.execute(
                    f"""
                    INSERT INTO nse_universe_symbols (symbol, tv_symbol, yfinance_ticker)
                    VALUES {", ".join(placeholders)}
                    ON CONFLICT (symbol) DO UPDATE SET
                      tv_symbol = EXCLUDED.tv_symbol,
                      yfinance_ticker = EXCLUDED.yfinance_ticker,
                      updated_at = NOW()
                    """,
                    values,
                )
        conn.commit()
    except Exception:
        safe_rollback(conn)
        raise


def load_symbol_state(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              symbol,
              tv_symbol,
              yfinance_ticker,
              company_name,
              market_cap,
              market_cap_updated_at,
              last_history_sync_date
            FROM nse_universe_symbols
            ORDER BY symbol ASC
            """
        )
        rows = cur.fetchall()
    output = {}
    for row in rows:
        output[row[0]] = {
            "symbol": row[0],
            "tv_symbol": row[1],
            "yfinance_ticker": row[2],
            "company_name": row[3] or "",
            "market_cap": row[4],
            "market_cap_updated_at": row[5],
            "last_history_sync_date": row[6],
        }
    return output


def should_refresh_market_cap(symbol_state):
    market_cap = symbol_state.get("market_cap")
    updated_at = symbol_state.get("market_cap_updated_at")
    if market_cap is None or updated_at is None:
        return True
    if isinstance(updated_at, datetime):
        age = utc_now() - updated_at.astimezone(timezone.utc)
        return age.days >= MARKET_CAP_STALE_DAYS
    return True


def fetch_symbol_metadata(ticker, load_company_name):
    info = None
    market_cap = None
    company_name = ""

    try:
        ticker_obj = yf.Ticker(ticker)
        fast_info = getattr(ticker_obj, "fast_info", None)
        if fast_info:
            try:
                market_cap = int_value(fast_info.get("market_cap"))
            except Exception:
                market_cap = None
            if market_cap is None:
                try:
                    market_cap = int_value(fast_info.get("marketCap"))
                except Exception:
                    market_cap = None

        if market_cap is None or load_company_name:
            try:
                info = ticker_obj.info or {}
            except Exception:
                info = {}
            if market_cap is None:
                market_cap = int_value(info.get("marketCap"))
            if load_company_name:
                company_name = str(info.get("longName") or info.get("shortName") or "").strip()
    except Exception:
        return market_cap, company_name

    return market_cap, company_name


def fetch_symbol_metadata_with_fallback(ticker_candidates, load_company_name):
    last_market_cap = None
    last_company_name = ""
    for ticker in ticker_candidates:
        market_cap, company_name = fetch_symbol_metadata(ticker, load_company_name)
        if market_cap is not None or company_name:
            return ticker, market_cap, company_name
        last_market_cap = market_cap
        last_company_name = company_name
    return ticker_candidates[0], last_market_cap, last_company_name


def fetch_history_with_fallback(ticker_candidates, start_date_iso, history_end_exclusive):
    last_error = None
    for ticker in ticker_candidates:
        try:
            frame = yf.Ticker(ticker).history(
                start=start_date_iso,
                end=history_end_exclusive,
                auto_adjust=False,
            )
            if frame is not None and not frame.empty:
                return ticker, frame
            last_error = RuntimeError(f"no history returned for {ticker}")
        except Exception as exc:
            last_error = exc
    if last_error:
        raise last_error
    raise RuntimeError("no history returned")


def upsert_symbol_metadata(conn, symbol, market_cap, company_name):
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE nse_universe_symbols
                SET
                  market_cap = COALESCE(%s::BIGINT, market_cap),
                  company_name = CASE
                    WHEN %s <> '' THEN %s
                    ELSE company_name
                  END,
                  market_cap_updated_at = CASE
                    WHEN %s::BIGINT IS NOT NULL THEN NOW()
                    ELSE market_cap_updated_at
                  END,
                  updated_at = NOW()
                WHERE symbol = %s
                """,
                [market_cap, company_name, company_name, market_cap, symbol],
            )
        conn.commit()
    except Exception:
        safe_rollback(conn)
        raise


def upsert_daily_rows(conn, rows, market_cap):
    if not rows:
        return 0
    try:
        with conn.cursor() as cur:
            for chunk in chunked(rows, 400):
                placeholders = []
                values = []
                for row in chunk:
                    placeholders.append("(%s, %s, %s, %s, %s, %s, %s, %s, %s)")
                    values.extend([*row, market_cap])
                cur.execute(
                    f"""
                    INSERT INTO nse_universe_daily_bars (
                      symbol,
                      trade_date,
                      open,
                      high,
                      low,
                      close,
                      adj_close,
                      volume,
                      market_cap
                    )
                    VALUES {", ".join(placeholders)}
                    ON CONFLICT (symbol, trade_date) DO UPDATE SET
                      open = EXCLUDED.open,
                      high = EXCLUDED.high,
                      low = EXCLUDED.low,
                      close = EXCLUDED.close,
                      adj_close = EXCLUDED.adj_close,
                      volume = EXCLUDED.volume,
                      market_cap = COALESCE(EXCLUDED.market_cap, nse_universe_daily_bars.market_cap),
                      updated_at = NOW()
                    """,
                    values,
                )
        conn.commit()
    except Exception:
        safe_rollback(conn)
        raise
    return len(rows)


def recompute_indicators(conn, symbol):
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH calc AS (
                  SELECT
                    symbol,
                    trade_date,
                    AVG(close) OVER (
                      PARTITION BY symbol
                      ORDER BY trade_date
                      ROWS BETWEEN 9 PRECEDING AND CURRENT ROW
                    ) AS sma_10,
                    AVG(close) OVER (
                      PARTITION BY symbol
                      ORDER BY trade_date
                      ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
                    ) AS sma_20,
                    AVG(close) OVER (
                      PARTITION BY symbol
                      ORDER BY trade_date
                      ROWS BETWEEN 49 PRECEDING AND CURRENT ROW
                    ) AS sma_50,
                    AVG(close) OVER (
                      PARTITION BY symbol
                      ORDER BY trade_date
                      ROWS BETWEEN 199 PRECEDING AND CURRENT ROW
                    ) AS sma_200,
                    AVG(volume) OVER (
                      PARTITION BY symbol
                      ORDER BY trade_date
                      ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
                    ) AS volume_sma_30
                  FROM nse_universe_daily_bars
                  WHERE symbol = %s
                )
                UPDATE nse_universe_daily_bars bars
                SET
                  sma_10 = calc.sma_10,
                  sma_20 = calc.sma_20,
                  sma_50 = calc.sma_50,
                  sma_200 = calc.sma_200,
                  volume_sma_30 = calc.volume_sma_30,
                  rupee_volume_crore = CASE
                    WHEN bars.close IS NOT NULL AND calc.volume_sma_30 IS NOT NULL
                      THEN (bars.close * calc.volume_sma_30) / 10000000.0
                    ELSE NULL
                  END,
                  updated_at = NOW()
                FROM calc
                WHERE bars.symbol = calc.symbol
                  AND bars.trade_date = calc.trade_date
                """,
                [symbol],
            )
        conn.commit()
    except Exception:
        safe_rollback(conn)
        raise


def mark_symbol_success(conn, symbol, latest_trade_date):
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE nse_universe_symbols
                SET
                  last_history_sync_date = GREATEST(COALESCE(last_history_sync_date, %s), %s),
                  latest_history_sync_at = NOW(),
                  last_success_at = NOW(),
                  last_error = '',
                  updated_at = NOW()
                WHERE symbol = %s
                """,
                [latest_trade_date, latest_trade_date, symbol],
            )
        conn.commit()
    except Exception:
        safe_rollback(conn)
        raise


def mark_symbol_failure(conn, symbol, message):
    safe_rollback(conn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE nse_universe_symbols
                SET
                  latest_history_sync_at = NOW(),
                  last_error = LEFT(%s, 1000),
                  updated_at = NOW()
                WHERE symbol = %s
                """,
                [str(message or "Unknown error"), symbol],
            )
        conn.commit()
    except Exception:
        safe_rollback(conn)
        raise


def mark_symbol_up_to_date(conn, symbol):
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE nse_universe_symbols
                SET
                  latest_history_sync_at = NOW(),
                  updated_at = NOW()
                WHERE symbol = %s
                """,
                [symbol],
            )
        conn.commit()
    except Exception:
        safe_rollback(conn)
        raise


def main():
    load_dotenv()

    parser = argparse.ArgumentParser(description="Sync NSE Universe OHLCV history to PostgreSQL using yfinance.")
    parser.add_argument("--end-date", required=True, help="Sync through this market date in YYYY-MM-DD format.")
    args = parser.parse_args()

    end_date = parse_date_key(args.end_date)
    history_start_date = HISTORY_START_DATE
    history_end_exclusive = add_days(end_date, 1).isoformat()

    symbols = load_universe_symbols()
    conn = get_pg_connection()

    try:
        ensure_tables(conn)
        seed_symbols(conn, symbols)
        state_by_symbol = load_symbol_state(conn)

        jobs = []
        skipped = 0
        for symbol in symbols:
            symbol_state = state_by_symbol.get(symbol) or {}
            last_history_sync_date = symbol_state.get("last_history_sync_date")
            next_start = history_start_date if last_history_sync_date is None else max(
                history_start_date,
                add_days(last_history_sync_date, 1),
            )
            if next_start > end_date:
                skipped += 1
                mark_symbol_up_to_date(conn, symbol)
                continue
            jobs.append(
                {
                    "symbol": symbol,
                    "ticker": build_yfinance_ticker(symbol),
                    "ticker_candidates": build_yfinance_ticker_candidates(symbol),
                    "start_date": next_start,
                    "company_name": symbol_state.get("company_name") or "",
                    "market_cap": symbol_state.get("market_cap"),
                    "refresh_market_cap": should_refresh_market_cap(symbol_state),
                }
            )

        total_jobs = len(jobs)
        print(f"preparing to sync {total_jobs} symbols through {end_date.isoformat()}", flush=True)

        synced = 0
        failed = 0
        inserted_rows = 0
        processed = 0

        for batch in chunked(jobs, BATCH_SIZE):
            batch_start = min(item["start_date"] for item in batch).isoformat()
            ticker_string = " ".join(item["ticker"] for item in batch)
            try:
                frame = yf.download(
                    tickers=ticker_string,
                    start=batch_start,
                    end=history_end_exclusive,
                    interval="1d",
                    auto_adjust=False,
                    group_by="ticker",
                    progress=False,
                    threads=True,
                )
            except Exception as exc:
                frame = None
                batch_error = str(exc)
            else:
                batch_error = ""

            for item in batch:
                processed += 1
                symbol = item["symbol"]
                ticker = item["ticker"]
                try:
                    ticker_candidates = item.get("ticker_candidates") or [ticker]
                    market_cap = item["market_cap"]
                    company_name = item["company_name"]
                    if item["refresh_market_cap"] or not company_name:
                        resolved_ticker, fetched_market_cap, fetched_company_name = fetch_symbol_metadata_with_fallback(
                            ticker_candidates,
                            load_company_name=not company_name,
                        )
                        ticker = resolved_ticker or ticker
                        market_cap = fetched_market_cap if fetched_market_cap is not None else market_cap
                        company_name = fetched_company_name or company_name
                        upsert_symbol_metadata(conn, symbol, market_cap, company_name)

                    if batch_error:
                        raise RuntimeError(batch_error)

                    symbol_frame = extract_symbol_frame(frame, ticker)
                    if symbol_frame is None or symbol_frame.empty:
                        resolved_ticker, single_frame = fetch_history_with_fallback(
                            ticker_candidates,
                            item["start_date"].isoformat(),
                            history_end_exclusive,
                        )
                        ticker = resolved_ticker or ticker
                        symbol_rows = dataframe_to_rows(single_frame, symbol, item["start_date"])
                    else:
                        symbol_rows = dataframe_to_rows(symbol_frame, symbol, item["start_date"])

                    if not symbol_rows:
                        skipped += 1
                        mark_symbol_success(conn, symbol, max(item["start_date"], end_date))
                        print(
                            f"{processed}/{total_jobs} skipped {symbol} no_new_rows start={item['start_date'].isoformat()} end={end_date.isoformat()}",
                            flush=True,
                        )
                        continue

                    inserted_rows += upsert_daily_rows(conn, symbol_rows, market_cap)
                    recompute_indicators(conn, symbol)
                    latest_trade_date = symbol_rows[-1][1]
                    mark_symbol_success(conn, symbol, latest_trade_date)
                    synced += 1
                    print(
                        f"{processed}/{total_jobs} synced {symbol} rows={len(symbol_rows)} range={symbol_rows[0][1].isoformat()}..{latest_trade_date.isoformat()}",
                        flush=True,
                    )
                except Exception as exc:
                    failed += 1
                    try:
                        mark_symbol_failure(conn, symbol, exc)
                    except Exception:
                        pass
                    print(
                        f"{processed}/{total_jobs} failed {symbol} error={str(exc)[:240]}",
                        flush=True,
                    )

        summary = {
            "status": "success",
            "message": f"NSE Universe sync finished for {processed} symbols through {end_date.isoformat()}",
            "processedSymbols": processed,
            "syncedSymbols": synced,
            "skippedSymbols": skipped,
            "failedSymbols": failed,
            "insertedRows": inserted_rows,
            "endDate": end_date.isoformat(),
            "lookbackStartDate": history_start_date.isoformat(),
        }
        print(json.dumps(summary), flush=True)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
