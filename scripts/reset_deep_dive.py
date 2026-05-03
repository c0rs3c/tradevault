#!/usr/bin/env python3
import argparse
import os
from pathlib import Path

from pymongo import MongoClient


DEEP_DIVE_COLLECTIONS_ALL = [
    "deep_dive_price_bars",
    "deep_dive_company_profiles",
    "deep_dive_sync_state",
    "deep_dive_ingestion_runs",
    "deep_dive_symbols",
    "deep_dive_stock_lists",
]

DEEP_DIVE_COLLECTIONS_KEEP_LISTS = [
    "deep_dive_price_bars",
    "deep_dive_company_profiles",
    "deep_dive_sync_state",
    "deep_dive_ingestion_runs",
    "deep_dive_symbols",
]


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


def main():
    load_dotenv()

    parser = argparse.ArgumentParser(description="Reset Deep Dive MongoDB collections")
    parser.add_argument("--confirm", action="store_true", help="Required to execute the reset")
    parser.add_argument(
        "--keep-lists",
        action="store_true",
        help="Delete ingested data but keep saved deep_dive_stock_lists",
    )
    args = parser.parse_args()

    if not args.confirm:
        raise SystemExit("Refusing to run without --confirm")

    mongo_uri = str(os.getenv("DEEP_DIVE_MONGO_URI", "")).strip()
    if not mongo_uri:
        raise SystemExit("Missing DEEP_DIVE_MONGO_URI")

    db_name = str(os.getenv("DEEP_DIVE_DB_NAME", "")).strip() or None
    client = MongoClient(mongo_uri)
    db = client.get_database(db_name) if db_name else client.get_default_database()

    collections = DEEP_DIVE_COLLECTIONS_KEEP_LISTS if args.keep_lists else DEEP_DIVE_COLLECTIONS_ALL

    print(
        f"[deep-dive-reset] database={db.name} mode={'keep-lists' if args.keep_lists else 'full'}",
        flush=True,
    )

    try:
        for name in collections:
            if name in db.list_collection_names():
                db[name].drop()
                print(f"[deep-dive-reset] dropped {name}", flush=True)
            else:
                print(f"[deep-dive-reset] skipped {name} (not present)", flush=True)
    finally:
        client.close()

    print("[deep-dive-reset] done", flush=True)


if __name__ == "__main__":
    main()
