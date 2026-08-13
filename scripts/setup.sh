#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Provisr Setup ==="

# Check prerequisites
command -v pnpm >/dev/null 2>&1 || { echo "Missing: pnpm. Install: npm install -g pnpm"; exit 1; }
command -v uv >/dev/null 2>&1 || { echo "Missing: uv. Install: curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1; }
command -v go >/dev/null 2>&1 || { echo "Missing: go. See https://go.dev/dl/"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Missing: docker."; exit 1; }
command -v buf >/dev/null 2>&1 || echo "Warning: buf not found. Install: brew install buf"

echo "[1/4] Installing TypeScript dependencies..."
pnpm install

echo "[2/4] Syncing Python dependencies..."
(cd "$ROOT/agent" && uv sync)
(cd "$ROOT/mcp" && uv sync)

echo "[3/4] Downloading Go dependencies..."
(cd "$ROOT/backend" && go mod download)
for svc in "$ROOT/backend/cmd/"*/; do
  (cd "$svc" && go mod download 2>/dev/null || true)
done

echo "[4/4] Setting up pre-commit hooks..."
pre-commit install 2>/dev/null || echo "  pre-commit not installed. Run: brew install pre-commit && pre-commit install"

echo ""
echo "=== Setup complete ==="
echo "Run ./scripts/dev.sh to start all services"
echo "Or use task dev for Taskfile-based launch"