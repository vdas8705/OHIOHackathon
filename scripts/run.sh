#!/usr/bin/env bash
# Start BOTH the BranchPoint backend and frontend together.
# Press Ctrl+C once to stop both.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_NODE="$ROOT/.toolchain/node-v20.18.1-darwin-arm64/bin"

# --- make the local Node available if no system Node exists ---
if ! command -v node >/dev/null 2>&1 && [ -d "$LOCAL_NODE" ]; then
  export PATH="$LOCAL_NODE:$PATH"
fi

# --- one-time setup: backend venv ---
if [ ! -d "$ROOT/backend/.venv" ]; then
  echo "[setup] Creating Python virtual environment..."
  python3 -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install --upgrade pip >/dev/null
  "$ROOT/backend/.venv/bin/pip" install -r "$ROOT/backend/requirements.txt"
fi

# --- one-time setup: frontend deps ---
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "[setup] Installing frontend dependencies..."
  (cd "$ROOT/frontend" && npm install)
fi

PIDS=()
cleanup() {
  echo ""
  echo "[run] Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

echo "[run] Starting backend  -> http://127.0.0.1:8000"
(cd "$ROOT/backend" && exec .venv/bin/python -m uvicorn app.main:app --reload --port 8000) &
PIDS+=($!)

echo "[run] Starting frontend -> http://localhost:5173"
(cd "$ROOT/frontend" && exec npm run dev) &
PIDS+=($!)

echo ""
echo "============================================================"
echo "  BranchPoint is starting."
echo "  Open the app at:  http://localhost:5173"
echo "  Backend API at:   http://127.0.0.1:8000/docs"
echo "  Press Ctrl+C to stop both."
echo "============================================================"

# Wait for either process to exit, then clean up the other.
wait -n 2>/dev/null || wait
cleanup
