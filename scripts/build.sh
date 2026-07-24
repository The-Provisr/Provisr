#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Building all layers ==="

echo "[1/3] Building Go services..."
(cd "$ROOT/backend" && go build ./cmd/...)
echo "  OK"

echo "[2/3] Building TypeScript packages..."
pnpm --filter @provisr/shared-contracts build
pnpm --filter @provisr/orchestrator build
pnpm --filter @provisr/frontend build
echo "  OK"

echo "[3/3] Checking Python packages..."
(cd "$ROOT/agent" && uv run python -m compileall src -q)
(cd "$ROOT/mcp" && uv run python -m compileall src -q)
echo "  OK"

echo ""
echo "=== All layers build successfully ==="