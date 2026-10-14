# Planning orchestration (OR-M01, OR-009–012)

Apply the existing migrations and `backend/migrations/000021_run_planning_lifecycle.up.sql`
before starting the updated orchestrator and state service. Migration 20's lease index
also supports a fresh PostgreSQL migration transaction without using an uncommitted enum value.

Set `ORCHESTRATOR_SERVICE_TOKEN` to the same secret on the orchestrator, Python agent,
and backend state service through environment variables or Vault. The agent requires it
for sessions carrying trusted execution context, and the state service requires it for
manifest validation/storage. The token never appears in run records or SSE payloads.
Docker Compose wires the service URLs; native defaults are:

| Variable | Default |
| --- | --- |
| `AGENT_URL` | `http://localhost:5000` |
| `CLOUD_ACCOUNT_SERVICE_URL` | `http://localhost:8089` |
| `POLICY_SERVICE_URL` | `http://localhost:8081` |
| `STATE_SERVICE_URL` | `http://localhost:8082` |
| `MCP_URL` | `http://localhost:5100` |

The durable worker advances `RECEIVED → POLICY_LOADED → CLOUD_CONTEXT_LOADED →
MANIFEST_CREATING`. These are the OR-006 database enum values; the former
`pending_agent`, `manifest_ready`, and `pending_iac` labels correspond to
`MANIFEST_CREATING`, `MANIFEST_VALIDATING`, and `IAC_GENERATING`. Run status filters
accept the canonical enum values.

Cloud context includes verified active accounts and capability metadata from the
cloud-account service. Account metadata must supply `supported_regions`; optional
`resource_counts` and `quota_limits` are numeric maps. Missing counts/quotas remain
explicitly unknown (`null`). Credential fields are excluded. Without a verified
active account, the run fails with “Connect a provider account to proceed.”

The HTTP bridge creates a Python `/v1/sessions` session with the run's request ID,
workspace/user IDs, policy snapshot, and cloud context. It persists the session ID
before sending a turn, reuses it for clarification and revisions, and applies a
120-second timeout. A PostgreSQL session advisory lock serializes workers for a run;
state-version checks reject stale HTTP results after cancellation or another mutation.

## User endpoints

The gateway's existing prefix is `/v1`. Every endpoint remains workspace-scoped
through `?workspaceId=<uuid>`, authenticated, and checked for workspace permission.

- `POST /runs`: `{ "sessionId": "<uuid>", "prompt": "...", "idempotencyKey": "..." }`.
  Supply a stable idempotency key when retrying run creation.
- `POST /runs/:id/clarify`: `{ "answers": { "answer": "..." }, "idempotencyKey": "..." }`.
  A plain agent question expects the `answer` field. Structured questions declare
  field names, types (`string`, `number`, `boolean`, `strings`), and optional choices.
  Unknown, missing, and incorrectly typed fields are rejected. Answers are retained
  in `answers_history`; replays with the same key do not resume twice. Independent
  expiry polling cancels unanswered questions after one hour, even during agent calls.
- `POST /runs/:id/revise`: `{ "prompt": "..." }`. Chat adjustments reuse the same run
  and agent session. Revisions retain prior immutable versions and require fresh validation.
- `POST /runs/:id/confirm`: `{ "manifestVersion": "2" }` (also accepts `v2`). It atomically
  locks the active validated version and enters `IAC_GENERATING`. `planVersion` is optional
  for compatibility; this endpoint confirms a manifest before a plan exists.

MCP `/tools/validate_manifest` checks schema, connected account/region, and policy;
`/tools/validate_manifest_schema` independently checks the agent's JSON schema.
The orchestrator allows at most three draft validation attempts. BE-D01/D02 are
implemented by the state service's private `/v1/manifests/validate` and `/v1/manifests`
endpoints. Storage reloads authoritative run snapshots, revalidates, allocates an
incremental version under a run row lock, and commits the manifest plus chained audit
in one transaction. The database rejects updates/deletions of manifest versions.

`GET /workspaces/:wid/events` streams persisted SSE events, including clarification,
assistant messages, registered component payloads, manifest-ready, and confirmation
events. Reconnect with the `Last-Event-ID` header to replay later events. Heartbeats
carry no ID. Frontend component schemas are shared with the orchestrator through
`@provisr/shared-contracts`.

## Verification

Run `pnpm --filter @provisr/orchestrator test`, `build`, and `lint`.
Run agent/MCP pytest and frontend registry tests for cross-layer contracts.

For PostgreSQL proof, provision a disposable PostgreSQL 16 database named
`provisr_or_planning_test_*` and the infrastructure's `provisr_app` role. Set
`TEST_DATABASE_URL` to that database and run:

```sh
pnpm --filter @provisr/orchestrator exec vitest run test/integration/state-machine-transitions.integration.test.ts
cd backend && go test ./internal/manifest -count=1
```

The Vitest fixture applies all migrations to the empty test database. Go tests reuse
that migrated database. HTTP dependencies/models are simulated; PostgreSQL transactions,
enum/column compatibility, rollback, immutable versions, and audit hashes are real.
The MCP schema drift test compares `manifest.schema.json` with the current agent model.

For rollback, stop the planning worker and state service before migration 21's down
migration; it removes planning snapshots and confirmation/session metadata. Existing
manifest contents and audit/SSE event rows remain. Reverting the code also requires
matching the canonical FSM migration version.
