#!/usr/bin/env bash
# Start the BranchPoint FastAPI backend.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT/backend"

# Free port 8000 if a stale backend from a previous run is still holding it.
STALE="$(lsof -nP -tiTCP:8000 2>/dev/null || true)"
if [ -n "$STALE" ]; then
  echo "[backend] Port 8000 is in use (PIDs: $STALE). Stopping the stale process..."
  kill $STALE 2>/dev/null || true
  sleep 1
  STALE="$(lsof -nP -tiTCP:8000 2>/dev/null || true)"
  [ -n "$STALE" ] && kill -9 $STALE 2>/dev/null || true
fi

if [ ! -d .venv ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt
fi

echo "Starting backend on http://127.0.0.1:8000 ..."
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
