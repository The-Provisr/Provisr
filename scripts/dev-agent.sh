#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Starting agent + MCP ==="

cd "$ROOT/infra/docker"
docker compose up -d redis 2>/dev/null || true
cd "$ROOT"

echo "  → Agent on :5000"
(cd "$ROOT/agent" && uv run uvicorn app.main:app --reload --port 5000) &

echo "  → MCP on :5100"
(cd "$ROOT/mcp" && uv run uvicorn src.servers.policy_server:app --reload --port 5100) &

echo ""
echo "Agent layer starting. Press Ctrl+C to stop."
wait
