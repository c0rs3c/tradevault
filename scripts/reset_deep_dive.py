#!/usr/bin/env python3
import argparse
import os
from pathlib import Path

from google.cloud import firestore
from google.oauth2 import service_account


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


def get_db():
    project_id = str(os.getenv("DEEP_DIVE_FIRESTORE_PROJECT_ID", "")).strip() or None
    raw = str(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY", "")).strip()
    if raw:
        import json

        info = json.loads(raw)
        credentials = service_account.Credentials.from_service_account_info(info)
        return firestore.Client(project=project_id or info.get("project_id"), credentials=credentials)
    return firestore.Client(project=project_id)


def delete_collection(db, name):
    total = 0
    while True:
        docs = list(db.collection(name).limit(200).stream())
        if not docs:
            return total
        batch = db.batch()
        for doc in docs:
            batch.delete(doc.reference)
        batch.commit()
        total += len(docs)


def main():
    load_dotenv()

    parser = argparse.ArgumentParser(description="Reset Deep Dive Firestore collections")
    parser.add_argument("--confirm", action="store_true", help="Required to execute the reset")
    parser.add_argument(
        "--keep-lists",
        action="store_true",
        help="Delete ingested data but keep saved deep_dive_stock_lists",
    )
    args = parser.parse_args()

    if not args.confirm:
        raise SystemExit("Refusing to run without --confirm")

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
    collections = DEEP_DIVE_COLLECTIONS_KEEP_LISTS if args.keep_lists else DEEP_DIVE_COLLECTIONS_ALL

    print(
        f"[deep-dive-reset] project={project_id or '(default)'} mode={'keep-lists' if args.keep_lists else 'full'}",
        flush=True,
    )

    for name in collections:
        removed = delete_collection(db, name)
        print(f"[deep-dive-reset] cleared {name} ({removed}+ docs)", flush=True)

    print("[deep-dive-reset] done", flush=True)


if __name__ == "__main__":
    main()
