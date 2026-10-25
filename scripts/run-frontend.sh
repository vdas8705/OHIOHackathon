#!/usr/bin/env bash
# Start the Simul AI React/Vite frontend.
set -euo pipefail

# Resolve the repo root from this script's own location, independent of where
# it is invoked from (works with ./scripts/run-frontend.sh, bash scripts/..., etc.).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_NODE="$ROOT/.toolchain/node-v20.18.1-darwin-arm64/bin"

cd "$ROOT/frontend"

# Prefer a system Node if present; otherwise use the locally downloaded one.
if ! command -v node >/dev/null 2>&1; then
  if [ -d "$LOCAL_NODE" ]; then
    export PATH="$LOCAL_NODE:$PATH"
  else
    echo "Node.js not found. Install Node 18+ (e.g. from https://nodejs.org)." >&2
    exit 1
  fi
fi

if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies..."
  npm install
fi

echo "Starting frontend on http://localhost:5173 ..."
npm run dev
