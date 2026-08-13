#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Provisr: Starting all services ==="

# Start infra dependencies
echo "[1/5] Starting infra dependencies..."
cd "$ROOT/infra/docker"
docker compose up -d postgres redis localstack jaeger 2>/dev/null || true
cd "$ROOT"

# Start backend (Go)
echo "[2/5] Starting backend services..."
(
  cd "$ROOT/backend"
  for svc in cmd/*/; do
    name=$(basename "$svc")
    echo "  → $name on port $(grep -o 'port = "[^"]*"' "$svc/main.go" 2>/dev/null | cut -d'"' -f2)"
  done
) &

# Start orchestrator (NestJS)
echo "[3/5] Starting orchestrator..."
pnpm --filter @provisr/orchestrator dev &
ORCH_PID=$!

# Start agent + MCP
echo "[4/5] Starting agent + MCP..."
(cd "$ROOT/agent" && uv run uvicorn src.entrypoints.api:app --reload --port 5000) &
(cd "$ROOT/mcp" && uv run uvicorn src.servers.policy_server:app --reload --port 5100) &

# Start frontend
echo "[5/5] Starting frontend..."
pnpm --filter @provisr/frontend dev &
FRONTEND_PID=$!

echo ""
echo "=== All services starting ==="
echo "  Frontend:     http://localhost:3000"
echo "  Orchestrator: http://localhost:4000"
echo "  Agent:        http://localhost:5000"
echo "  MCP:          http://localhost:5100"
echo ""
echo "Press Ctrl+C to stop all services"

trap "kill $ORCH_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait