# MCP-014 — generate_iac

`POST /tools/generate_iac` is mounted in the existing MCP runtime on port 5100.
For a standalone runtime, use `uvicorn src.servers.iac_server:app --port 5100`.
Both use the existing workspace membership/context validator.

```json
{
  "manifest_id": "immutable-manifest-uuid",
  "context": {
    "workspace_id": "uuid", "user_id": "uuid", "request_id": "run-uuid",
    "session_id": "uuid", "correlation_id": "uuid",
    "permissions": ["iac:write"], "idempotency_key": "generate-run-version-1"
  }
}
```

The tool accepts only an immutable manifest ID and context. Terraform content,
confirmation flags and arbitrary manifest JSON cannot be supplied. BE-D04 loads
the persisted manifest and verifies live membership plus exact run/session/version
validation and manifest-confirmation locks. This draft confirmation is distinct
from final plan/cost/execution confirmation. The adapter grants no execution rights.

Set `MANIFEST_SERVICE_URL` (default `http://localhost:8090`) and
`ORCHESTRATOR_SERVICE_TOKEN` in the environment, using the same service token as
manifest-service. Docker already supplies those values to MCP; the BE-D04 PR
adds the token to manifest-service. Native scripts inherit both variables.
Do not store service tokens in committed files. No new service or dependency is
introduced. Merge BE-D04 before this PR becomes operational.

Success returns `iac_artifact_id`, manifest ID/version, workspace/run/session IDs,
`terraform_files` (`path`, `content`), `summary` (resource and file counts),
`file_list`, `file_count`, `total_size`, `hash`, and `template_source` (`template`).
The adapter checks all context links, paths, counts, and the SHA-256 file digest.
Digest input is the sorted file sequence of UTF-8 `path + NUL + content + NUL`.
Unsupported resources return safe structured 422 diagnostics. Access, missing
manifest, and stale/retry conflicts retain safe 403/404/409 statuses. Other backend
failures and malformed responses return 502 without copying upstream error bodies.
Requests have a 10-second timeout and responses are bounded to 8 MiB.

Run Python tests and Ruff from the repository root. The optional real integration
test uses an already started BE-D04 manifest-service and a disposable PostgreSQL
database with all migrations:

```sh
TEST_DATABASE_URL='postgres://.../provisr_or_planning_test_iac?sslmode=disable' \
IAC_TEST_BACKEND_URL='http://127.0.0.1:8090' \
IAC_TEST_SERVICE_TOKEN='<test-only-service-token>' \
uv run pytest mcp/tests/test_iac_backend_integration.py -q
```

It seeds a test run, calls the actual MCP adapter and backend, verifies generated
S3 Terraform, and proves retry produces one artifact and one audit event. Without
those test variables, CI skips only this real-service integration test; mounted
adapter tests still run. OR-013 orchestration, BE-D05 planning and BE-D08 remote
state initialization remain their scheduled tasks.
