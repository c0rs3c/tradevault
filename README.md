# Trade Journal (Next.js)

Trading journal app with pyramiding, multi-exits, dashboard analytics, Zerodha CSV import, import history, and one-click import rollback.

## Tech Stack
- Next.js (App Router)
- React + Tailwind CSS + Recharts
- MongoDB + Mongoose
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
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/trades`
- `POST /api/trades`
- `GET /api/trades/dashboard`
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
MARKET_DATA_PYTHON=python3
AUTH_USERNAME=your_username
AUTH_PASSWORD=your_password
AUTH_SECRET=your_long_random_secret
```

## Run

```bash
npm install
npm run dev
```

App runs on `http://localhost:3000`.

## Notes
- Zerodha importer merges split fills by `order_id`.
- Import status (`OPEN/CLOSED`) is inferred by FIFO matching opposite-side fills over time.
- Import page stores batches and supports one-click rollback (`Delete Import`) that removes all trades from that batch.
- Live quote endpoint uses `scripts/get_quote.py` and requires `yfinance` in your Python env.
- App is protected by username/password authentication using a persistent cookie session.
- Session stays active until logout.
