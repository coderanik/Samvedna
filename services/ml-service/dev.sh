#!/usr/bin/env bash
# Start ML service with venv
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi

exec .venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port "${ML_PORT:-8001}"
