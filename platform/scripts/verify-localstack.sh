#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="http://localhost:4566"
REGION="us-east-1"

echo "Waiting for LocalStack to be healthy..."
until curl -sf "${ENDPOINT}/_localstack/health" >/dev/null 2>&1; do
  sleep 1
done
echo "LocalStack is up."

export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION="${REGION}"

awslocal() {
  aws --endpoint-url="${ENDPOINT}" "$@"
}

echo "Creating SQS queues..."
awslocal sqs create-queue --queue-name provisr-provisioning-queue
awslocal sqs create-queue --queue-name provisr-reconciler-queue

echo "Creating S3 buckets..."
awslocal s3api create-bucket --bucket provisr-state-artifacts
awslocal s3api create-bucket --bucket provisr-audit-logs

echo "Creating DynamoDB table..."
awslocal dynamodb create-table \
  --table-name provisr-locks \
  --attribute-definitions AttributeName=lock_id,AttributeType=S \
  --key-schema AttributeName=lock_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

echo "Creating EventBridge event bus..."
awslocal events create-event-bus --name provisr-event-bus

echo ""
echo "Verifying resources..."
echo "--- SQS Queues ---"
awslocal sqs list-queues
echo "--- S3 Buckets ---"
awslocal s3api list-buckets --query "Buckets[].Name"
echo "--- DynamoDB Tables ---"
awslocal dynamodb list-tables
echo "--- EventBridge Buses ---"
awslocal events list-event-buses

echo ""
echo "LocalStack resources initialized successfully."
