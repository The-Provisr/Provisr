# MCP manifest validation

The existing `src.servers.policy_server:app` runtime on port 5100 serves
`POST /tools/validate_manifest` alongside the policy tools. A standalone
`src.servers.manifest_server:app` is also available for development.

Set `MANIFEST_SERVICE_URL` to the BE-M03 manifest service (default
`http://localhost:8090`, Docker `http://manifest-service:8090`). Validation sends
the manifest directly to `POST /v1/manifests/validate`; policy-service and
provisioning-service URLs are not fallbacks.

Requests contain `context` and an object `manifest`. Context requires workspace
membership and `manifest:read`; validation is read-only and does not require an
idempotency key. Orchestration supplies both `manifest:read` and `manifest:write`
because its separate schema validator uses the latter.

Canonical BE-D01 manifests are forwarded unchanged. Current OR-012 agent drafts
include `cloud_context` and `policy_context`: their existing ResourceManifest
schema and cloud/policy checks run first, then a read-only projection maps the
three supported draft types (EC2, RDS, S3) into BE-D01's canonical shape. Generated
logical identifiers are separate from the original cloud names, which remain in
resource properties. Neither the submitted draft nor stored manifest is mutated.
Malformed policy constraint types and nonfinite budgets are rejected before
evaluation. Duplicate resources with the same type and cloud name are rejected
before generated logical identifiers can conceal them.
This validation does not replace formal OPA checks or execution gates.

The result is `{ valid, errors: [{ field, code, message, allowed_values }] }`.
Backend errors preserve order; `allowed_values` is null when the backend omits it.
Invalid envelopes return 403, missing/non-object manifests return 422, and backend
timeouts, failures or malformed/contradictory verdicts return 502. Logs contain
outcome, error count and trace IDs, never manifest content or backend error text.

BE-D01 remains responsible for canonical manifest semantics. Its current
validator checks resource domains/type format but has no complete supported-kind
registry; this adapter does not claim to establish template availability.

Run `uv run pytest` and `uv run ruff check src tests` from `mcp/`.

## MCP-007 cloud capabilities

`POST /tools/get_cloud_account_capabilities` is mounted in the same port-5100
runtime. It requires a validated `cloud:read` context with workspace membership;
an optional top-level `workspace_id` must match that context. No idempotency key
is required for this read-only tool.

Set `CLOUD_ACCOUNT_SERVICE_URL` (default localhost:8089) and inject
`ORCHESTRATOR_SERVICE_TOKEN` into MCP and cloud-account-service. The tool calls
`GET /v1/workspaces/{workspace_id}/cloud-capabilities`, forwards trace IDs, checks
the returned workspace, filters unrestricted fields, and validates masked
identities and readiness timestamps. Empty workspaces return `accounts: []` and
a warning. Unconfigured authentication returns 503; unavailable/malformed backend
responses return a sanitized 502 without raw provider text or metadata.

This task consumes BE-B08 (PR #136, following BE-D03 #135). OR-009 calls the tool
before agent planning. Discovery facts do not replace execution authorization,
formal policy checks, quotas, drift checks, confirmation or approval.

## MCP-019 approval requirements

`POST /tools/get_approval_requirements` is mounted in the same port-5100 runtime.
It requires a validated `approval:read` context with workspace membership. The
evaluation is read-only, so it takes no idempotency key; a retry produces a new
audit record with the same `input_digest`.

The body is `context` plus the run context: optional `run_id`, `environment`,
`provider`, `region`, `public_exposure`, `resource_changes[]` (`address`, `type`,
`action`, `public`, `properties`), `cost_estimate.estimated_monthly_usd`
(required) with optional `source`, and `policy` (`decision`, `violations`) from
check_policy. Unknown fields are rejected with 422, so callers cannot supply
`workspace_id`, `user_id` or a requester role. Workspace and user come from the
validated context. BE-E01 resolves the role, the workspace environment and the
cost threshold on the server.

Set `APPROVAL_SERVICE_URL` (default `http://localhost:8084`) and inject
`ORCHESTRATOR_SERVICE_TOKEN` into MCP and approval-service. The tool forwards the
fields the caller set, unchanged, to `POST /v1/approval-requirements/evaluate`
with trace IDs. BE-E01 is the only place that normalizes and evaluates them (see
`backend/internal/approval/APPROVAL_RULES.md`), and it appends the audit event
before it responds.

The result is `{ requires_approval, reason, required_approver_role, risk_level,
triggered_rules, rule_set_version, input_digest, evaluation_id, evaluated_at }`.
A decision without an evaluation ID or digest is never returned. A decision is
also never returned if it contradicts itself, for example when approval does not
match the triggered rules, or when an approver is set without approval.

Errors:
- A DENY policy decision returns 409, because approval cannot override a deny.
- Input that BE-E01 rejects returns a sanitized 422.
- A membership miss returns 403 `invalid_context`.
- Unconfigured authentication returns 503.
- An unavailable or malformed backend returns a sanitized 502.

Logs contain the outcome, the decision and trace IDs. They never contain resource
properties or backend error text. OR-017 calls this tool after check_policy and
before the user confirms.
