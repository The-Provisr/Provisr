# BE-D08 — Remote Terraform state backend management

Every connected cloud account gets a provisioner-managed remote state backend
using the provider's native state service. BE-D04 bundles carry partial backend
blocks (`backend "s3" {}` etc.); this package supplies the controlled settings
at `terraform init`. There is no local-state fallback.

## Entry points

- **In-process (BE-D09 executor):** `Manager.Prepare(ctx, req, runID)` verifies
  (and on first run creates) the backend, then returns credential-free
  `-backend-config` values. `HCL(values)` renders them as a backend file. Use
  one idempotency key per execution attempt so each attempt re-verifies access.
- **Private route on provisioning-service (8083):**
  `POST /v1/state-backends/ensure`, `Authorization: Bearer $ORCHESTRATOR_SERVICE_TOKEN`.

```json
{
  "provider": "aws",
  "context": {
    "workspace_id": "uuid", "user_id": "uuid", "correlation_id": "uuid",
    "permissions": ["iac:write"], "idempotency_key": "ensure-run-attempt-1"
  }
}
```

The response is `{state_backend_id, provider, status, created, verified_at}` only.
Bucket names, keys, credentials and state contents are never returned. No route
reads, lists or downloads state. Errors: 400 `invalid_request`, 401, 403
`forbidden`, 404 `cloud_account_not_active`, 409 `backend_conflict`, 422
`provider_not_onboarded`, 502 `backend_unavailable`. Provider error text is never
forwarded.

## Flow

1. Check live admin/engineer membership. Share-lock the workspace's **active**
   account for the provider so a concurrent disconnect waits.
2. Take a per-account advisory lock, so concurrent first runs create once.
3. Replay a recorded result for a repeated `(backend, idempotency_key)`.
4. Assume the delegated role (15-minute credentials, never stored), verify,
   create on first run, re-verify.
5. In one transaction, upsert `provisr_iac.state_backends` (`ready`), record the
   idempotent result, and append a hash-chained audit event
   (`state_backend_provisioned` / `state_backend_verified`). A failed attempt is
   recorded as `failed` with `state_backend_failed`; the same key stays retryable.

## Per provider

| Provider | Storage | Locking | Status |
|---|---|---|---|
| AWS | S3 `provisr-tfstate-<account>-<hash>` | DynamoDB `provisr-tf-locks-<hash>` (`LockID`) | Implemented |
| Azure | Storage account `ptfs<hash>`, container `tfstate` | Native blob lease | Fails closed: 422 |
| GCP | GCS `provisr-tfstate-<hash>` | Native object lock | Fails closed: 422 |

Names are deterministic over (workspace, cloud identity), so two workspaces never
share a backend. A reconnected account re-references its existing bucket. Azure and GCP
naming and init config are implemented. Their drivers stay unsupported until
delegated onboarding exists for those providers (see `cloudaccount/CAPABILITIES.md`).

State keys are per run: `workspaces/<ws>/runs/<run>/terraform.tfstate` (GCS:
`prefix`). A run therefore manages only its own resources.

AWS hardening:
- `ExpectedBucketOwner` on every S3 call, which rejects buckets held by any
  other account (409).
- ACLs disabled (`BucketOwnerEnforced`) and all public access blocked.
- Versioning enabled.
- SSE-KMS with an AWS-managed key and a bucket key.
- A TLS-only bucket policy, using the account's partition.
- Tags `provisr:managed` and `provisr:workspace`.

An owned bucket with this name but no tags is adopted, for example after a crash
following `CreateBucket`. A bucket or table tagged for another workspace fails
closed. Drifted hardening on an owned bucket is re-applied and reported as
`repaired`. The lock table is on-demand. DynamoDB encrypts it at rest, and it
holds only lock IDs and digests.

The delegated role needs `s3:CreateBucket`, `s3:ListBucket` (HeadBucket),
`s3:Get/PutBucketTagging`, `s3:Get/PutBucketVersioning`,
`s3:Get/PutBucketPublicAccessBlock`, `s3:Get/PutEncryptionConfiguration`,
`s3:Get/PutBucketPolicy`, `s3:PutBucketOwnershipControls`, and
`dynamodb:DescribeTable/CreateTable/ListTagsOfResource/TagResource`. Terraform
itself additionally needs object read/write on the bucket and
`dynamodb:GetItem/PutItem/DeleteItem` on the table.

Terraform ≥ 1.11 warns that `dynamodb_table` is deprecated in favour of S3-native
`use_lockfile`. DynamoDB is kept because the task specifies it. Switching later
is a one-line change in `InitConfig`.

## Setup and tests

Apply migration `000026_terraform_state_backends` (it follows BE-E01's `000023`).
provisioning-service requires `DATABASE_URL`, `CLOUD_ACCOUNT_MASTER_KEY` and
`ORCHESTRATOR_SERVICE_TOKEN`. When `AWS_ENDPOINT_URL` is set (LocalStack), S3 uses
path-style addressing.

```bash
go test ./internal/statebackend
TEST_DATABASE_URL=postgres://.../provisr_or_planning_test_x go test -race ./internal/statebackend
STATEBACKEND_LOCALSTACK=1 AWS_ENDPOINT_URL=http://localhost:4566 \
  AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test go test -run LocalStack ./internal/statebackend
```

The Postgres tests prove several properties:
- Concurrent first runs create once.
- Idempotent replay skips provider work.
- Failures are recorded and stay retryable.
- An audit failure rolls back the result.
- Run and workspace isolation hold.
- Everything works under the least-privilege `provisr_app` role.

The LocalStack test needs `sts` enabled, as in docker-compose.
