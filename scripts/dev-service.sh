#!/usr/bin/env bash
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: ./scripts/dev-service.sh <service-name>"
  echo "Available: policy state provisioning approval audit notification reconciler"
  exit 1
fi

SERVICE="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Map short names to directory names
case "$SERVICE" in
  policy) DIR="policy-service" ;;
  state) DIR="state-service" ;;
  provisioning) DIR="provisioning-service" ;;
  approval) DIR="approval-service" ;;
  audit) DIR="audit-service" ;;
  notification) DIR="notification-service" ;;
  reconciler) DIR="reconciler" ;;
  *) echo "Unknown service: $SERVICE"; exit 1 ;;
esac

cd "$ROOT/infra/docker"
docker compose up -d postgres redis 2>/dev/null || true
cd "$ROOT"

echo "Starting $SERVICE-service..."
cd "$ROOT/backend/cmd/$DIR"
go run .