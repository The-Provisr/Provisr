#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Starting backend services ==="

cd "$ROOT/infra/docker"
docker compose up -d postgres redis localstack jaeger 2>/dev/null || true
cd "$ROOT/backend"

# Start each Go service in background
for svc in cmd/*/; do
  name=$(basename "$svc")
  port=$(grep -o 'port = "[^"]*"' "$svc/main.go" 2>/dev/null | cut -d'"' -f2 || echo "8080")
  echo "  → $name on :$port"
  (cd "$svc" && go run .) &
done

echo ""
echo "Backend services starting. Press Ctrl+C to stop."
wait