# AGENTS.md — mcp

## Stack
FastAPI, Pydantic, httpx, Python 3.12+

## Dev
```bash
cd mcp && uv run uvicorn src.servers.<name>:app --reload --port 5100
uv run pytest
uv run ruff check src
```

## Tool architecture
6 tool server groups, each exposes MCP-style tools. Tools return structured JSON.
- `policy_server.py` — get_policy_requirements, check_policy, explain_policy_violation, suggest_policy_compliant_fix
- `cloud_state_server.py` — get_cloud_account_capabilities, get_existing_resources, check_name_conflicts, check_quota_limits, get_drift_status
- `iac_server.py` — generate_iac, create_plan, get_iac_execution_status
- `cost_server.py` — estimate_cost, compare_provider_costs, compare_cost_options
- `approval_server.py` — get_approval_requirements, create_approval_request, get_approval_status
- `domain_server.py` — domain manifest generators (MCP-023..029)

## Context envelope (MCP-002)
Every tool call receives validated context:
```json
{
  "workspace_id": "uuid",
  "user_id": "uuid",
  "permissions": ["admin"],
  "request_id": "uuid",
  "correlation_id": "string",
  "idempotency_key": "string"
}
```
Missing or invalid context → reject with 403.

## Critical rules
- Tools are adapters + validators, NOT authority for privileged execution
- Domain tools produce manifest fragments, never mutate cloud resources
- `render_component` emits only from registered schemas — rejects unknown payloads
- Domain-first then provider: `domain/compute/aws.py`, `domain/database/gcp.py`