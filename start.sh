#!/bin/sh
# Railway injects PORT as an environment variable.
# This script is run as a shell script so $PORT expands naturally.
set -e

PORT="${PORT:-8000}"
echo "[start] Starting Aapki Pathshaala API on port $PORT"
exec uvicorn main:app --host 0.0.0.0 --port "$PORT"
