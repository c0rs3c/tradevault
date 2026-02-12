#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Bootstrapping Trade Vault"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed. Install Node.js 18+ and rerun." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed. Install npm and rerun." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is not installed. Install python3 and rerun." >&2
  exit 1
fi

echo "==> Installing Node dependencies"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

echo "==> Installing Python dependencies"
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "==> Created .env from .env.example"
else
  echo "==> .env already exists (left unchanged)"
fi

cat <<'EOF'

Bootstrap complete.

Next steps:
1) Edit .env with your Mongo URI and auth credentials.
2) Start the app:
   npm run dev

EOF

