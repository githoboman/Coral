#!/usr/bin/env bash
set -euo pipefail  # Fail fast on any error

# === Tovira Production Deployment Script (2025 Best Practice) ===
# Uses Docker Compose → cleaner, safer, future-proof

COMPOSE_FILE="docker-compose.yml"
IMAGE_NAME="tovira-api:latest"
CONTAINER_NAME="tovira-api-prod"
PORT=8000

echo "🚀 Starting Tovira production deployment..."

# Step 1: Ensure .env file exists
if [[ ! -f ".env" ]]; then
  echo "❌ ERROR: .env file not found!"
  echo "   Please create a .env file with your production environment variables."
  echo "   Example: cp .env.example .env && nano .env"
  exit 1
fi

# Step 2: Verify docker-compose.yml exists
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "❌ ERROR: $COMPOSE_FILE not found in current directory!"
  exit 1
fi

# Step 3: Prune old images (optional but keeps system clean)
echo "🧹 Pruning unused images and containers..."
docker system prune -f >/dev/null 2>&1 || true

# Step 4: Build & deploy with zero-downtime strategy
echo "🏗️  Building and deploying production stack..."

# This does everything in the correct order:
# - Builds fresh image
# - Stops + removes old container
# - Starts new one with latest code
docker compose -f "$COMPOSE_FILE" up -d --build

# Step 5: Wait a moment for health check to pass
echo "⏳ Waiting for service to become healthy..."
sleep 8

# Step 6: Verify it's actually running and healthy
if docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}" | grep -q "Up"; then
  if docker inspect $CONTAINER_NAME --format='{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; then
    echo "✅ Deployment successful! API is healthy and running."
  else
    echo "⚠️  Container is running but health check may still be starting..."
  fi
else
  echo "❌ Deployment failed! Container did not start."
  echo "   Showing logs..."
  docker compose -f "$COMPOSE_FILE" logs --tail=50
  exit 1
fi

# Step 7: Final status
echo ""
echo "🎉 Active production service:"
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo "🌐 Your API is live at: http://localhost:$PORT"
echo "   Or on your server IP: http://$(curl -s ifconfig.me || hostname -I | awk '{print $1}'):$PORT"
echo ""
echo "🔄 To view logs:     docker compose -f $COMPOSE_FILE logs -f"
echo "🛑 To stop:          docker compose -f $COMPOSE_FILE down"