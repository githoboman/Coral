#!/bin/bash
set -e

# Use the Render-provided port, default to 10000 if not set
PORT=${PORT:-10000}

echo "Starting Gunicorn on port $PORT..."
exec gunicorn app.main:app \
    --workers 4 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind "0.0.0.0:$PORT" \
    --timeout 120 \
    --access-logfile - \
    --error-logfile - \
    --log-level info
