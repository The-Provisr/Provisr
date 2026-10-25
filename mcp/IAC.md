# MCP-014 — generate_iac

`POST /tools/generate_iac` is mounted in the existing MCP runtime on port 5100.
For a standalone runtime, use `uvicorn src.servers.iac_server:app --port 5100`.
Both require `Authorization: Bearer <ORCHESTRATOR_SERVICE_TOKEN>` from the trusted internal caller before validating workspace membership/context. Keep this service token server-side; never expose it to browsers or model prompts.

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
Backend requests and response streaming share a 10-second total deadline, alongside HTTPX I/O timeouts; responses are bounded to 8 MiB. Deadline cancellation closes the stream and returns a sanitized 502.

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


## MCP-015 — create_plan

Design: [discussion #172](https://github.com/The-Provisr/Provisr/discussions/172).
Depends on BE-D05's provisioning-service plan endpoint. This task is logbook
Week 15 / sprint-plan Week 14; OR-014 wires it into the run flow next sprint.

`POST /tools/create_plan` accepts `iac_artifact_id` (nonzero UUID) and the same
complete MCP context as `generate_iac`, with `iac:write` and an idempotency key.
Trusted service bearer authentication runs before membership lookup. Membership
and permission validation precede backend dispatch. No Terraform, credentials,
confirmation claims or commands are accepted in the request.

The adapter calls `POST /v1/iac/plans` at `PROVISIONING_SERVICE_URL` (native
fallback `http://localhost:8083`), forwarding service authorization and request,
correlation and idempotency headers. Docker explicitly sets this URL. Reuse
`ORCHESTRATOR_SERVICE_TOKEN`; the tool does not authorize execution.

Returns `plan_artifact_id`, `iac_artifact_id`, `manifest_id`, `manifest_version`,
`run_id`, `workspace_id`, `session_id`, `hash`, `raw_plan_json_reference` and
`summary`. Summary includes `create_count`, `update_count`, `delete_count`,
`unchanged_count` and `resource_changes` (address, resource_type, change_type,
risk_tags). Replacements count as both create and delete; data reads do not
increment managed-resource counts. Result provenance, private reference,
resource addresses/types, unique risk tags and counts are checked before return.
Raw JSON, binary plans, credentials and arbitrary extra fields are never returned.
The JSON reference is an opaque private storage reference, not a download URL.

A 110-second total deadline bounds streaming as well as idle response time;
BE-D05's request deadline is 100 seconds. Maximum response is 2 MiB. Known
403/404/409/422 backend errors map to fixed safe messages. Other backend/network
or malformed-response errors become 502; total deadline becomes 504. Backend
bodies and exception details are never echoed. Retry with the same key after
an ambiguous timeout. Backend remains responsible for immutable audited storage,
confirmed-manifest selection, delegated identity and remote state configuration.

Validation:

```sh
PYTHONPATH=packages/manifest-contracts:mcp uv run --package provisr-mcp pytest mcp/tests/test_iac_planning.py -q
uv run --package provisr-mcp ruff check mcp/src
```

Mounted-route tests exercise authentication order, membership/permission and
idempotency rejection, input injection, forwarding, result provenance/counts,
error sanitization, oversized responses and slow-stream cancellation/closure.
No AWS calls, Terraform execution, FSM transitions or approval bypass occur in
this adapter.
