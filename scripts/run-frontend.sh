#!/usr/bin/env bash
# Start the BranchPoint React/Vite frontend.
set -euo pipefail
cd "$(dirname "$0")/../frontend"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_NODE="$ROOT/.toolchain/node-v20.18.1-darwin-arm64/bin"

# Prefer a system Node if present; otherwise use the locally downloaded one.
if ! command -v node >/dev/null 2>&1; then
  if [ -d "$LOCAL_NODE" ]; then
    export PATH="$LOCAL_NODE:$PATH"
  else
    echo "Node.js not found. Install Node 18+ or run scripts/bootstrap-node.sh" >&2
    exit 1
  fi
fi

if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies..."
  npm install
fi

echo "Starting frontend on http://localhost:5173 ..."
npm run dev
