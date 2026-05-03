# Deep Dive Setup

## MongoDB URL vs `DEEP_DIVE_DB_NAME`

With the current Atlas URL style used in this repo, `DEEP_DIVE_DB_NAME` is needed unless the database name is embedded directly in the URI.

Example of the current style:

```env
DEEP_DIVE_MONGO_URI=mongodb+srv://user:password@cluster0.example.mongodb.net/?appName=cluster0
```

That URI does not include a database name in the path. It ends at `.net/` and then goes straight to query parameters, so the app and ingestion script cannot infer which database to use for Deep Dive.

You can configure this in either of these two ways.

### Option 1: Keep the URI as-is and set `DEEP_DIVE_DB_NAME`

```env
DEEP_DIVE_MONGO_URI=mongodb+srv://user:password@cluster0.example.mongodb.net/?appName=cluster0
DEEP_DIVE_DB_NAME=trade-journal-deep-dive
```

### Option 2: Put the database name directly into the URI

```env
DEEP_DIVE_MONGO_URI=mongodb+srv://user:password@cluster0.example.mongodb.net/trade-journal-deep-dive?appName=cluster0
```

In this second form, `DEEP_DIVE_DB_NAME` is optional.

## How to choose the database name in MongoDB Atlas

`DEEP_DIVE_DB_NAME` is simply the database name inside your MongoDB cluster. You choose it.

In MongoDB Atlas:

1. Open the cluster.
2. Go to `Browse Collections`.
3. If the database does not exist yet, create one.
4. Use a name such as `trade-journal-deep-dive`.
5. Put that exact name into `DEEP_DIVE_DB_NAME`.

## Initial local setup

For the first run, it is reasonable to backfill locally before relying on GitHub Actions.

Add these values to `.env`:

```env
DEEP_DIVE_MONGO_URI=your_deep_dive_cluster_url
DEEP_DIVE_DB_NAME=trade-journal-deep-dive
```

If you choose the URI form with the database name embedded, the second line can be omitted.

## Initial backfill flow

Recommended sequence:

1. Start the app.
2. Create at least one stock list in `/deep-dive`.
3. Install Python requirements.
4. Run the price backfill.
5. Run the company profile sync.

Run these commands from the project root:

`/Users/praweenprakash/Documents/software_development/projects/trade-journal`

The Python dependency file is:

`/Users/praweenprakash/Documents/software_development/projects/trade-journal/requirements.txt`

Commands:

```bash
python3 -m pip install -r requirements.txt
python3 scripts/deep_dive_ingest.py --mode backfill_prices
python3 scripts/deep_dive_ingest.py --mode sync_profiles
```

What each mode does:

- `backfill_prices`: downloads and stores historical daily OHLCV bars for all symbols saved in your Deep Dive stock lists plus the built-in benchmark indexes.
- `sync_profiles`: downloads and stores company metadata such as company name, sector, industry, description, market cap, and other profile fields for the saved stock symbols.
- Default backfill horizon is `3 years` unless you override it with `DEEP_DIVE_HISTORY_YEARS` or `--history-years`.

After the initial load, incremental sync can be run with:

```bash
python3 scripts/deep_dive_ingest.py --mode daily_sync
```

Terminal progress:

- `backfill_prices` now prints batch-level and symbol-level progress while it runs.
- `sync_profiles` now prints profile refresh progress symbol by symbol.
- Progress lines include counts such as `5/2340` so you can see how far the run has moved through the total symbol set.

Ticker fallback:

- For stock symbols that use `_` in the saved symbol, the ingestion script first tries the normalized ticker as usual.
- If that returns no data, it tries a fallback where `_` is replaced with `&`.
- Example: `ARE_M` will first try `ARE_M.NS` and then try `ARE&M.NS`.

Reruns and duplication:

- Re-running the ingestion script does not intentionally duplicate stored price bars.
- Price writes use upserts keyed by `symbol + date`.
- The script also creates a unique MongoDB index on `symbol + date` in `deep_dive_price_bars` to enforce idempotency at the database level.

## Resetting Deep Dive data

Run from the project root:

```bash
python3 scripts/reset_deep_dive.py --confirm
```

This removes:
- `deep_dive_price_bars`
- `deep_dive_company_profiles`
- `deep_dive_sync_state`
- `deep_dive_ingestion_runs`
- `deep_dive_symbols`
- `deep_dive_stock_lists`

If you want to wipe ingested data but keep your saved stock lists:

```bash
python3 scripts/reset_deep_dive.py --confirm --keep-lists
```

## Why the first run should be manual

The scheduled sync is incremental by design. It works best after the historical dataset already exists.

The manual first run establishes:
- stored stock universe from your Deep Dive lists
- historical daily price bars
- benchmark history
- company profile documents
- sync-state markers such as `latestBarDate`

After that, the daily sync can fetch only recent overlap windows instead of doing a large historical pull each time.
