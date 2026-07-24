#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Verifying LocalStack resources ==="

# Verify SQS queues
awslocal sqs list-queues --output json 2>/dev/null || {
  echo "LocalStack not running. Start with: cd infra/docker && docker compose up -d localstack"
  exit 1
}

echo "LocalStack is running."
echo "  SQS queues: $(awslocal sqs list-queues --output text | wc -l | xargs)"

# Verify S3 buckets
echo "  S3 buckets: $(awslocal s3 ls 2>/dev/null | wc -l | xargs)"

# Verify DynamoDB tables
echo "  DynamoDB tables: $(awslocal dynamodb list-tables --output text 2>/dev/null | wc -l | xargs)"