# Quote API

Small Flask service for hosted quote fetching with `yfinance`.

## Local run

```bash
cd services/quote-api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export QUOTE_SERVICE_TOKEN=change-me
python app.py
```

The service listens on `http://127.0.0.1:10000` by default.

## Endpoints

- `GET /health`
- `GET /quote?symbol=INFY`

Send the token as:

```text
Authorization: Bearer <QUOTE_SERVICE_TOKEN>
```
