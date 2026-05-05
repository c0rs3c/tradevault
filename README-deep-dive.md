# Deep Dive Setup

## Provider Selection

Deep Dive now supports both MongoDB and Firestore through one env flag:

```env
DEEP_DIVE_DB_PROVIDER=mongodb
```

Allowed values:

- `mongodb`: recommended for historical bar storage and backfills
- `firestore`: supported, but slower for large historical datasets

## Firestore Configuration

Use these only when `DEEP_DIVE_DB_PROVIDER=firestore`.

Use one of these authentication paths:

### Option 1: Service account file

```env
DEEP_DIVE_FIRESTORE_PROJECT_ID=your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
```

### Option 2: Inline service account JSON

```env
DEEP_DIVE_FIRESTORE_PROJECT_ID=your-gcp-project-id
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"your-gcp-project-id",...}
```

`DEEP_DIVE_FIRESTORE_PROJECT_ID` is recommended even when the credentials already include the project.

## What Gets Stored

These collections are used:

- `deep_dive_symbols`
- `deep_dive_stock_lists`
- `deep_dive_price_bars`
- `deep_dive_company_profiles`
- `deep_dive_sync_state`
- `deep_dive_ingestion_runs`

To keep writes idempotent:

- symbol documents use the Firestore document id = `symbol`
- profile documents use the Firestore document id = `symbol`
- sync-state documents use the Firestore document id = `symbol`
- price-bar documents use the Firestore document id = `symbol_YYYY-MM-DD`

## Initial Local Setup

1. Create a Firebase or GCP project.
2. Enable Firestore in Native mode.
3. Create a service account with Firestore access.
4. Download the JSON key or copy it into `FIREBASE_SERVICE_ACCOUNT_KEY`.
5. Add the Firestore env vars to `.env` or `.env.local`.
6. Install dependencies:

```bash
npm install
python3 -m pip install -r requirements.txt
```

## Existing Mongo Data Migration

If your Deep Dive data already exists in MongoDB, do not backfill again.

Use the one-time migration script instead:

```env
DEEP_DIVE_MONGO_URI=your-existing-mongo-uri
DEEP_DIVE_DB_NAME=your-existing-mongo-db
DEEP_DIVE_DB_PROVIDER=firestore
DEEP_DIVE_FIRESTORE_PROJECT_ID=your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
```

Or replace `GOOGLE_APPLICATION_CREDENTIALS` with `FIREBASE_SERVICE_ACCOUNT_KEY`.

Run:

```bash
python3 scripts/migrate_deep_dive_to_firestore.py --confirm
```

What it does:

- copies all six Deep Dive collections from MongoDB into Firestore
- preserves stock-list ids from MongoDB by using the old Mongo `_id` as the Firestore doc id
- uses deterministic Firestore ids for symbols, profiles, sync-state docs, and price bars
- does not call `yfinance`
- is safe to rerun because writes are upserts

After that, start using the app against Firestore and use only incremental syncs going forward.

## Symbol Repair

If some Deep Dive symbols were migrated with `_` but should actually use `&`, run this one-time Firestore repair:

```bash
python3 scripts/replace_deep_dive_symbol_underscores.py --confirm
```

What it does:

- moves symbol-keyed Firestore documents from `_` symbols to `&` symbols
- rewrites price-bar document ids to match the corrected symbol
- updates saved Deep Dive stock lists
- updates `failedSymbols` inside ingestion-run logs

For new list pastes, Deep Dive now normalizes symbols on input and automatically stores `&` instead of `_`.

## Initial Backfill Flow

If you want Deep Dive to keep using MongoDB, set:

```env
DEEP_DIVE_DB_PROVIDER=mongodb
DEEP_DIVE_MONGO_URI=your-deep-dive-mongo-uri
DEEP_DIVE_DB_NAME=your-deep-dive-db-name
```

If you want Deep Dive to use Firestore, set:

```env
DEEP_DIVE_DB_PROVIDER=firestore
DEEP_DIVE_FIRESTORE_PROJECT_ID=your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
```

Recommended sequence:

1. Start the app.
2. Create at least one stock list in `/deep-dive`.
3. Run the price backfill.
4. Run the company profile sync.

Commands from the project root:

```bash
python3 scripts/deep_dive_ingest.py --mode backfill_prices
python3 scripts/deep_dive_ingest.py --mode sync_profiles
```

After the initial load, incremental sync can be run with:

```bash
python3 scripts/deep_dive_ingest.py --mode daily_sync
```

## Resetting Deep Dive Data

Full reset:

```bash
python3 scripts/reset_deep_dive.py --confirm
```

Keep saved stock lists:

```bash
python3 scripts/reset_deep_dive.py --confirm --keep-lists
```

## GitHub / Hosted Setup

Recommended secrets:

- `DEEP_DIVE_FIRESTORE_PROJECT_ID`
- `GOOGLE_APPLICATION_CREDENTIALS` only if your runner writes this to a file before running Python/Node
- or `FIREBASE_SERVICE_ACCOUNT_KEY`

Optional variables:

- `DEEP_DIVE_HISTORY_YEARS`
- `DEEP_DIVE_SYNC_OVERLAP_DAYS`
- `DEEP_DIVE_PROFILE_REFRESH_DAYS`
- `DEEP_DIVE_BATCH_SIZE`
