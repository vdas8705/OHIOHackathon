#!/usr/bin/env bash
# Start the BranchPoint FastAPI backend.
set -euo pipefail
cd "$(dirname "$0")/../backend"

if [ ! -d .venv ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt
fi

echo "Starting backend on http://127.0.0.1:8000 ..."
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
