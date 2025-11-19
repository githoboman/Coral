#!/usr/bin/env bash
set -euo pipefail

# === Tovira Development Deployment Script (2025 Best Practice) ===

COMPOSE_FILE="docker-compose.yml"
CONTAINER_NAME="tovira_dev"
PORT=8000

echo "Starting Tovira development environment..."

# Step 1: Ensure .env file exists
if [[ ! -f ".env" ]]; then
  echo "ERROR: .env file not found!"
  echo "   Please create a .env file with your environment variables."
  echo "   Example: cp .env.example .env && nano .env"
  exit 1
fi

# Step 2: Verify docker-compose.dev.yml exists
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: $COMPOSE_FILE not found in current directory!"
  exit 1
fi

# Step 3: Clean stop of any previous dev stack
echo "Stopping old dev stack (if running)..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true

# Step 4: Build & start dev server with hot reload
echo "Building (if needed) and starting dev server..."
docker compose -f "$COMPOSE_FILE" up --build

# Step 5: Wait a moment for the dev server to boot
echo "Waiting for dev server to become ready..."
sleep 6

# Step 6: Final status confirmation
echo ""
echo "Active development service:"
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo "Your API is live at http://localhost:$PORT"
echo "Hot reload is ON — just edit files and save!"
echo ""
echo "To stop: Ctrl+C  (or run: docker compose -f $COMPOSE_FILE down)"