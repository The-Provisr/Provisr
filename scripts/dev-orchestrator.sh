#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Starting orchestrator ==="

cd "$ROOT/infra/docker"
docker compose up -d postgres redis 2>/dev/null || true
cd "$ROOT"

pnpm --filter @provisr/orchestrator dev