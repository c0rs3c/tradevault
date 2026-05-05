#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path

from google.cloud import firestore
from google.oauth2 import service_account


SYMBOL_KEYED_COLLECTIONS = [
    "deep_dive_symbols",
    "deep_dive_company_profiles",
    "deep_dive_sync_state",
]

PRICE_BARS_COLLECTION = "deep_dive_price_bars"
STOCK_LISTS_COLLECTION = "deep_dive_stock_lists"
INGESTION_RUNS_COLLECTION = "deep_dive_ingestion_runs"


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


def get_firestore_db():
    project_id = str(os.getenv("DEEP_DIVE_FIRESTORE_PROJECT_ID", "")).strip() or None
    raw = str(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY", "")).strip()
    if raw:
        info = json.loads(raw)
        credentials = service_account.Credentials.from_service_account_info(info)
        return firestore.Client(project=project_id or info.get("project_id"), credentials=credentials)
    return firestore.Client(project=project_id)


def normalized_symbol(symbol):
    return str(symbol or "").strip().upper().replace("_", "&")


def commit_batch(batch):
    if batch is not None:
        batch.commit()


def record_mapping(mappings, old_symbol, new_symbol):
    if old_symbol and new_symbol and old_symbol != new_symbol:
        mappings.add((old_symbol, new_symbol))


def replace_symbol_keyed_documents(db):
    total = 0
    moved = 0
    mappings = set()
    batch = db.batch()
    ops = 0

    for collection_name in SYMBOL_KEYED_COLLECTIONS:
        for snapshot in db.collection(collection_name).stream():
            total += 1
            data = snapshot.to_dict() or {}
            old_symbol = str(data.get("symbol") or snapshot.id).strip().upper()
            new_symbol = normalized_symbol(old_symbol)
            if new_symbol == old_symbol:
                continue

            # Deep Dive uses symbol-based document ids, so this repair has to move the document.
            target_ref = db.collection(collection_name).document(new_symbol)
            batch.set(target_ref, {**data, "symbol": new_symbol}, merge=True)
            batch.delete(snapshot.reference)
            record_mapping(mappings, old_symbol, new_symbol)
            moved += 1
            ops += 2

            if ops >= 350:
                commit_batch(batch)
                batch = db.batch()
                ops = 0

    if ops:
        commit_batch(batch)

    return total, moved, mappings


def replace_price_bars(db):
    total = 0
    moved = 0
    mappings = set()
    batch = db.batch()
    ops = 0

    for snapshot in db.collection(PRICE_BARS_COLLECTION).stream():
        total += 1
        data = snapshot.to_dict() or {}
        old_symbol = str(data.get("symbol") or "").strip().upper()
        new_symbol = normalized_symbol(old_symbol)
        if not old_symbol or new_symbol == old_symbol:
            continue

        date_value = data.get("date")
        date_key = date_value.isoformat()[:10] if hasattr(date_value, "isoformat") else str(date_value)[:10]
        target_id = f"{new_symbol}_{date_key}"
        target_ref = db.collection(PRICE_BARS_COLLECTION).document(target_id)
        batch.set(target_ref, {**data, "symbol": new_symbol}, merge=True)
        batch.delete(snapshot.reference)
        record_mapping(mappings, old_symbol, new_symbol)
        moved += 1
        ops += 2

        if ops >= 350:
          commit_batch(batch)
          batch = db.batch()
          ops = 0

    if ops:
        commit_batch(batch)

    return total, moved, mappings


def replace_stock_list_symbols(db):
    total = 0
    updated = 0
    mappings = set()
    batch = db.batch()
    ops = 0

    for snapshot in db.collection(STOCK_LISTS_COLLECTION).stream():
        total += 1
        data = snapshot.to_dict() or {}
        raw_symbols = [str(item or "").strip().upper() for item in data.get("symbols", []) if str(item or "").strip()]
        symbols = [normalized_symbol(item) for item in raw_symbols]
        deduped_symbols = list(dict.fromkeys(symbols))
        for old_symbol, new_symbol in zip(raw_symbols, symbols):
            record_mapping(mappings, old_symbol, new_symbol)

        source_text = str(data.get("sourceText") or "")
        next_source_text = "\n".join(deduped_symbols) if deduped_symbols else source_text.replace("_", "&")

        if deduped_symbols == data.get("symbols", []) and next_source_text == source_text:
            continue

        batch.set(
            snapshot.reference,
            {
                "symbols": deduped_symbols,
                "sourceText": next_source_text,
            },
            merge=True,
        )
        updated += 1
        ops += 1

        if ops >= 350:
            commit_batch(batch)
            batch = db.batch()
            ops = 0

    if ops:
        commit_batch(batch)

    return total, updated, mappings


def replace_ingestion_run_failed_symbols(db):
    total = 0
    updated = 0
    mappings = set()
    batch = db.batch()
    ops = 0

    for snapshot in db.collection(INGESTION_RUNS_COLLECTION).stream():
        total += 1
        data = snapshot.to_dict() or {}
        failed_symbols = data.get("failedSymbols", [])
        next_failed_symbols = []
        changed = False

        for item in failed_symbols:
            current_symbol = str((item or {}).get("symbol") or "").strip().upper()
            next_symbol = normalized_symbol(current_symbol)
            next_item = {**(item or {}), "symbol": next_symbol}
            next_failed_symbols.append(next_item)
            if next_symbol != current_symbol:
                record_mapping(mappings, current_symbol, next_symbol)
                changed = True

        if not changed:
            continue

        batch.set(snapshot.reference, {"failedSymbols": next_failed_symbols}, merge=True)
        updated += 1
        ops += 1

        if ops >= 350:
            commit_batch(batch)
            batch = db.batch()
            ops = 0

    if ops:
        commit_batch(batch)

    return total, updated, mappings


def main():
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="One-time Deep Dive symbol repair: replace '_' with '&' in Firestore documents"
    )
    parser.add_argument("--confirm", action="store_true", help="Required to execute the repair")
    args = parser.parse_args()

    if not args.confirm:
        raise SystemExit("Refusing to run without --confirm")

    if (
        not str(os.getenv("DEEP_DIVE_FIRESTORE_PROJECT_ID", "")).strip()
        and not str(os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")).strip()
        and not str(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY", "")).strip()
    ):
        raise SystemExit(
            "Missing Firestore configuration. Set DEEP_DIVE_FIRESTORE_PROJECT_ID with GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_KEY."
        )

    db = get_firestore_db()

    print(f"[deep-dive-symbol-fix] firestore_project={db.project}", flush=True)

    keyed_total, keyed_moved, keyed_mappings = replace_symbol_keyed_documents(db)
    print(
        f"[deep-dive-symbol-fix] symbol keyed docs moved: {keyed_moved}/{keyed_total}",
        flush=True,
    )

    bars_total, bars_moved, bar_mappings = replace_price_bars(db)
    print(
        f"[deep-dive-symbol-fix] price bars moved: {bars_moved}/{bars_total}",
        flush=True,
    )

    lists_total, lists_updated, list_mappings = replace_stock_list_symbols(db)
    print(
        f"[deep-dive-symbol-fix] stock lists updated: {lists_updated}/{lists_total}",
        flush=True,
    )

    runs_total, runs_updated, run_mappings = replace_ingestion_run_failed_symbols(db)
    print(
        f"[deep-dive-symbol-fix] ingestion runs updated: {runs_updated}/{runs_total}",
        flush=True,
    )

    all_mappings = sorted(keyed_mappings | bar_mappings | list_mappings | run_mappings)
    if all_mappings:
        print("[deep-dive-symbol-fix] edited symbols:", flush=True)
        for old_symbol, new_symbol in all_mappings:
            print(f"[deep-dive-symbol-fix]   {old_symbol} -> {new_symbol}", flush=True)
    else:
        print("[deep-dive-symbol-fix] edited symbols: none", flush=True)

    print("[deep-dive-symbol-fix] done", flush=True)


if __name__ == "__main__":
    main()
