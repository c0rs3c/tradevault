# Trade Journal (Next.js)

Trading journal app with pyramiding, multi-exits, trade and pyramid screenshot uploads, dashboard analytics, Zerodha CSV import, import history, and one-click import rollback.

## Tech Stack
- Next.js (App Router)
- React + Tailwind CSS + Recharts
- MongoDB + Mongoose
- Firestore for Deep Dive research data
- JavaScript (no TypeScript)

## App Structure

```text
trade-journal/
  app/
    api/
      settings/
      trades/
    dashboard/
    trades/
      [id]/
      import/
      new/
    settings/
    layout.jsx
    page.jsx
    globals.css
  src/
    api/
    components/
    contexts/
    lib/server/
      controllers/
      models/
      services/
      utils/
      db.js
    pages/
    utils/
  public/
  package.json
  .env.example
```

## API Endpoints
- `GET /api/health`
- `GET /api/news/watchlists`
- `POST /api/news/watchlists`
- `GET /api/news/watchlists/:id`
- `POST /api/news/watchlists/:id/sync`
- `POST /api/news/sync`
- `POST /api/news/cron-sync`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/trades`
- `POST /api/trades`
- `GET /api/trades/dashboard`
- `GET /api/market-trend`
- `POST /api/market-trend/sync`
- `GET /api/deep-dive/lists`
- `POST /api/deep-dive/lists`
- `GET /api/deep-dive/lists/:id`
- `PUT /api/deep-dive/lists/:id`
- `DELETE /api/deep-dive/lists/:id`
- `POST /api/deep-dive/rs`
- `POST /api/deep-dive/analysis/sector`
- `GET /api/deep-dive/status`
- `POST /api/trades/import/zerodha`
- `GET /api/trades/imports`
- `DELETE /api/trades/imports/:importId`
- `GET /api/trades/:id`
- `PUT /api/trades/:id`
- `DELETE /api/trades/:id`
- `GET /api/trades/:id/quote`
- `POST /api/trades/:id/pyramids`
- `PUT /api/trades/:id/pyramids/:pid`
- `DELETE /api/trades/:id/pyramids/:pid`
- `POST /api/trades/:id/exits`
- `PUT /api/trades/:id/exits/:eid`
- `DELETE /api/trades/:id/exits/:eid`

## Environment Variables
Copy `.env.example` to `.env`:

```env
MONGO_URI=mongodb://127.0.0.1:27017/trade-journal
NEWS_MONGO_URI=mongodb://127.0.0.1:27017/trade-journal-news
DEEP_DIVE_DB_PROVIDER=mongodb
DEEP_DIVE_MONGO_URI=mongodb://127.0.0.1:27017/trade-journal-deep-dive
DEEP_DIVE_DB_NAME=trade-journal-deep-dive
DEEP_DIVE_FIRESTORE_PROJECT_ID=your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
QUOTE_PROVIDER=local_python
QUOTE_SERVICE_URL=
QUOTE_SERVICE_TOKEN=
MARKET_DATA_PYTHON=python3
AUTH_USERNAME=your_username
AUTH_PASSWORD=your_password
AUTH_SECRET=your_long_random_secret
NEWS_SYNC_CRON_SECRET=your_news_sync_secret
AUTH_COOKIE_SECURE=0
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=
```

## Run

```bash
./scripts/bootstrap.sh
npm run dev
```

App runs on `http://localhost:3000`.

## Quote Providers
- `local_python`: current local subprocess flow using `scripts/get_quote.py`
- `remote_http`: hosted quote service, intended for Vercel/Render setups
- If `QUOTE_PROVIDER` is unset, development defaults to `local_python`
- In production, the app uses `remote_http` when `QUOTE_SERVICE_URL` is set, otherwise `local_python`

### Local development

Use the local Python provider:

```env
QUOTE_PROVIDER=local_python
MARKET_DATA_PYTHON=python3
```

The local provider requires `yfinance` in your Python environment.

### Hosted quote service for Vercel

Deploy the Flask quote service from `services/quote-api` to Render and configure:

In Render:
- Root Directory: `services/quote-api`
- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn app:app --bind 0.0.0.0:$PORT`
- Environment variable: `QUOTE_SERVICE_TOKEN=<shared-secret>`

In Vercel:

```env
QUOTE_PROVIDER=remote_http
QUOTE_SERVICE_URL=https://<your-render-service>.onrender.com
QUOTE_SERVICE_TOKEN=<same-shared-secret>
```

The hosted service also exposes `GET /health` for smoke checks.

## Deep Dive
- `Deep Dive` is a separate research module at `/deep-dive`.
- Historical prices, company profiles, sync state, and ingestion logs can live in MongoDB or Firestore, selected by `DEEP_DIVE_DB_PROVIDER`.
- For large historical price-bar workloads, MongoDB is the recommended backend.
- Stock lists created in the UI become the active research universe for hosted ingestion.
- If you already have Deep Dive data in MongoDB, use `python3 scripts/migrate_deep_dive_to_firestore.py --confirm` once instead of rerunning a full backfill.
- GitHub Actions workflow `.github/workflows/deep-dive-sync.yml` runs `scripts/deep_dive_ingest.py` on weekdays around 7:00 PM IST.
- For local setup, run the ingestion commands from the project root:
  - `/Users/praweenprakash/Documents/software_development/projects/trade-journal`
- The Python dependency file used by the ingestion script is:
  - `/Users/praweenprakash/Documents/software_development/projects/trade-journal/requirements.txt`
- Initial local commands:

```bash
python3 -m pip install -r requirements.txt
python3 scripts/deep_dive_ingest.py --mode backfill_prices
python3 scripts/deep_dive_ingest.py --mode sync_profiles
```

- Mode meanings:
  - `backfill_prices`: downloads and stores historical daily OHLCV bars for all symbols saved in Deep Dive stock lists plus the built-in benchmark indexes.
  - `sync_profiles`: downloads and stores company metadata such as company name, sector, industry, description, market cap, and other profile fields for the saved stock symbols.
  - `daily_sync`: runs incremental price sync plus profile refresh logic.
- Local terminal progress:
  - `backfill_prices` prints batch-level and symbol-level progress while it runs.
  - `sync_profiles` prints profile refresh progress symbol by symbol.
- Reset helper:
  - `python3 scripts/reset_deep_dive.py --confirm`
  - `python3 scripts/reset_deep_dive.py --confirm --keep-lists`
- Recommended GitHub configuration:
  - Variable or secret: `DEEP_DIVE_DB_PROVIDER`
  - Secret: `DEEP_DIVE_FIRESTORE_PROJECT_ID`
  - Secret: `FIREBASE_SERVICE_ACCOUNT_KEY` or a workflow-created `GOOGLE_APPLICATION_CREDENTIALS` file
  - If using MongoDB instead: `DEEP_DIVE_MONGO_URI` and optional `DEEP_DIVE_DB_NAME`
  - Optional repo variables: `DEEP_DIVE_HISTORY_YEARS`, `DEEP_DIVE_SYNC_OVERLAP_DAYS`, `DEEP_DIVE_PROFILE_REFRESH_DAYS`, `DEEP_DIVE_BATCH_SIZE`
- Default historical backfill horizon is `3 years` unless `DEEP_DIVE_HISTORY_YEARS` or `--history-years` overrides it.
- Manual examples:

```bash
python scripts/deep_dive_ingest.py --mode backfill_prices
python scripts/deep_dive_ingest.py --mode sync_profiles
python scripts/deep_dive_ingest.py --mode daily_sync
```

## Screener Quarterly Scraper
- Standalone PostgreSQL ingestion script: `scripts/scrape_screener_quarterly.py`
- Extracts only `Sales`, `Net Profit`, and `EPS in Rs` from the `Quarterly Results` section on a Screener company page.
- Uses one request per symbol, browser-like headers, retry/backoff, and a default `12 hour` freshness window to stay conservative.
- The app's `Earnings and Shareholding Deep Dive` screen reads the same PostgreSQL data through the Node `pg` client.

Example:

```bash
export SCREENER_PG_DSN="postgresql://user:password@localhost:5432/earnings_screener_db"
python3 scripts/scrape_screener_quarterly.py --symbol RRKABEL
```

Force a refresh even if the symbol was scraped recently:

```bash
python3 scripts/scrape_screener_quarterly.py --symbol RRKABEL --force
```

Batch mode for large symbol lists:

```bash
python3 scripts/scrape_screener_quarterly.py --symbols-file data/symbols.txt
```

Supported input formats:
- Text file: one symbol per line
- CSV: `symbol` column required, optional `url` column

For large runs, the script stays sequential and conservative by default:
- `8s` base delay between symbols
- up to `4s` random jitter between symbols
- `12h` freshness window, so reruns skip recently successful symbols

## Watchlist News Feed
- News watchlists and articles are stored in a dedicated MongoDB cluster via `NEWS_MONGO_URI`.
- Import public TradingView watchlists or upload `.txt` watchlist files from `/news`, then sync Google News for the last 7 days per ticker/company.
- The manual UI supports `Sync Now` for one watchlist and `Sync All` for the current signed-in user.
- GitHub Actions can trigger scheduled sync by calling `POST /api/news/cron-sync` with the `x-news-sync-secret` header set to `NEWS_SYNC_CRON_SECRET`.
- Store the deployed route in the GitHub Actions secret `NEWS_SYNC_URL`, for example `https://your-app.vercel.app/api/news/cron-sync`.
- To wipe all stored news data, run `npm run reset:news`. This deletes every document from the `watchlists`, `watchlistnewsmatches`, and `newsarticles` collections in `NEWS_MONGO_URI`.

## Trade Screenshot Storage
- Trade and pyramid screenshots are uploaded to Cloudflare R2 through `POST /api/uploads/trade-screenshot`.
- Configure `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PUBLIC_BASE_URL`.
- `R2_PUBLIC_BASE_URL` should point to either your bucket custom domain or your Cloudflare-managed `r2.dev` public URL.
- The app supports multiple screenshots per trade and multiple screenshots per pyramid entry.
- Screenshots are stored in R2 and the app saves the public URL plus the object key on the trade or pyramid record.
- Removing screenshots, deleting pyramids, or deleting trades also cleans up the corresponding R2 objects.

## Notes
- Zerodha importer merges split fills by `order_id`.
- Import status (`OPEN/CLOSED`) is inferred by FIFO matching opposite-side fills over time.
- Import page stores batches and supports one-click rollback (`Delete Import`) that removes all trades from that batch.
- Live quote endpoint supports both the local Python script and a hosted HTTP quote service.
- NSE F&O participant OI backfill script: `node scripts/backfill-nse-participant-oi.mjs`
- The NSE participant dashboard stores all participant rows for each imported trading day and surfaces FII-focused trend analytics on `/market-trend`.
- New trade symbol autocomplete reads from `data/nse_equity_symbols.csv`. Keep this file updated at a regular interval so newly listed or renamed symbols continue to appear in suggestions.
- On Vercel, the in-app symbol refresh should not be treated as durable storage because the platform filesystem is ephemeral. For hosted deployments, update and commit `data/nse_equity_symbols.csv` regularly or move symbol storage to a persistent database.
- App is protected by username/password authentication using a persistent cookie session.
- Session stays active until logout.
