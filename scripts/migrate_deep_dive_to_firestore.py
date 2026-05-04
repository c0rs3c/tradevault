#!/usr/bin/env python3
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from google.cloud import firestore
from google.oauth2 import service_account
from pymongo import MongoClient


COLLECTIONS = [
    "deep_dive_symbols",
    "deep_dive_stock_lists",
    "deep_dive_price_bars",
    "deep_dive_company_profiles",
    "deep_dive_sync_state",
    "deep_dive_ingestion_runs",
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


def get_firestore_db():
    project_id = str(os.getenv("DEEP_DIVE_FIRESTORE_PROJECT_ID", "")).strip() or None
    raw = str(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY", "")).strip()
    if raw:
        info = json.loads(raw)
        credentials = service_account.Credentials.from_service_account_info(info)
        return firestore.Client(project=project_id or info.get("project_id"), credentials=credentials)
    return firestore.Client(project=project_id)


def get_mongo_db():
    mongo_uri = str(os.getenv("DEEP_DIVE_MONGO_URI", "")).strip()
    if not mongo_uri:
        raise SystemExit("Missing DEEP_DIVE_MONGO_URI for one-time migration")
    client = MongoClient(mongo_uri)
    db_name = str(os.getenv("DEEP_DIVE_DB_NAME", "")).strip() or None
    db = client.get_database(db_name) if db_name else client.get_default_database()
    return client, db


def normalize_value(value):
    if isinstance(value, list):
        return [normalize_value(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_value(item) for key, item in value.items()}
    return value


def build_doc_id(collection_name, document):
    if collection_name in {"deep_dive_symbols", "deep_dive_company_profiles", "deep_dive_sync_state"}:
        return str(document["symbol"])
    if collection_name == "deep_dive_price_bars":
        date_value = document["date"]
        if isinstance(date_value, datetime):
            day = date_value.astimezone(timezone.utc).strftime("%Y-%m-%d")
        else:
            day = str(date_value)[:10]
        return f"{document['symbol']}_{day}"
    return str(document["_id"])


def iter_documents(mongo_collection, batch_size):
    cursor = mongo_collection.find({}).batch_size(batch_size)
    try:
        for document in cursor:
            yield document
    finally:
        cursor.close()


def migrate_collection(mongo_db, firestore_db, collection_name, batch_size):
    total = 0
    written = 0
    batch = firestore_db.batch()
    ops_in_batch = 0

    for document in iter_documents(mongo_db[collection_name], batch_size):
        total += 1
        firestore_doc = normalize_value({key: value for key, value in document.items() if key != "_id"})
        doc_id = build_doc_id(collection_name, document)
        batch.set(firestore_db.collection(collection_name).document(doc_id), firestore_doc, merge=True)
        ops_in_batch += 1
        written += 1

        if ops_in_batch >= 400:
            batch.commit()
            batch = firestore_db.batch()
            ops_in_batch = 0

    if ops_in_batch:
        batch.commit()

    return total, written


def main():
    load_dotenv()

    parser = argparse.ArgumentParser(description="One-time Deep Dive MongoDB to Firestore migration")
    parser.add_argument("--confirm", action="store_true", help="Required to execute the migration")
    parser.add_argument("--batch-size", type=int, default=500)
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

    mongo_client, mongo_db = get_mongo_db()
    firestore_db = get_firestore_db()

    print(f"[deep-dive-migrate] mongo_db={mongo_db.name}", flush=True)
    print(
        f"[deep-dive-migrate] firestore_project={firestore_db.project}",
        flush=True,
    )

    try:
        for collection_name in COLLECTIONS:
            total, written = migrate_collection(mongo_db, firestore_db, collection_name, args.batch_size)
            print(
                f"[deep-dive-migrate] migrated {collection_name}: {written}/{total}",
                flush=True,
            )
    finally:
        mongo_client.close()

    print("[deep-dive-migrate] done", flush=True)


if __name__ == "__main__":
    main()
