# Provisr Agent

FastAPI service for Provisr's private agent layer. Its canonical entrypoint accepts
the orchestrator-owned run dispatch envelope, invokes Claude through an
Anthropic-compatible Messages API, and validates model output.

The service proposes `ResourceManifest` objects. It does not approve requests,
run Terraform, access cloud credentials, or own authoritative provisioning state.

## Local development

```powershell
uv sync --dev
uv run uvicorn app.main:app --reload --port 5000
```

The default state backend is in-memory. To use Redis:

```text
PROVISR_STATE_BACKEND=redis
PROVISR_REDIS_URL=redis://localhost:6379/0
```

Claude runs through the Anthropic SDK pointed at Claude Platform on AWS: a
short-lived API key, the `aws-external-anthropic` endpoint, and a workspace ID.
Never put the API key in this repository.

```text
ANTHROPIC_API_KEY=<short-lived-claude-platform-on-aws-key>
ANTHROPIC_BASE_URL=https://aws-external-anthropic.us-east-1.api.aws
ANTHROPIC_WORKSPACE_ID=<workspace-id>
ANTHROPIC_MODEL=claude-sonnet-4-5
```

## API

- `GET /health/live`
- `GET /health/ready`
- `POST /runs/{run_id}/dispatch` (canonical orchestrator boundary)

The older `/v1/sessions` routes remain temporarily as compatibility routes in the
same application. Public session and SSE ownership is moving to the orchestrator.
Only `pending_agent` model dispatch is implemented in this phase. Policy,
cloud-context, and later provisioning phases fail closed until real integrations
exist; the agent never fabricates tool-call evidence.

## Verification

```powershell
uv run ruff format --check .
uv run ruff check .
uv run mypy app
uv run pytest
```

# provisr-agent
