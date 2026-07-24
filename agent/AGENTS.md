# AGENTS.md — agent

## Stack
FastAPI, Pydantic, httpx, Redis, Python 3.12+

## Dev
```bash
cd agent && uv run uvicorn src.entrypoints.api:app --reload --port 5000
uv run pytest
uv run ruff check src
```

## ReAct loop rules (AG-001, AG-019)
- Max 8 iterations per session. Hit limit → graceful clarification, not error.
- First call: `get_policy_requirements` (when policies enabled). No manifest before policy.
- NEVER execute IaC. NEVER bypass approval. NEVER expose secrets in output.
- Every inferred value below 90% confidence requires `ask_user` confirmation.

## Manifest rules (AG-011, PRD §13)
- Provider-neutral top level, provider-specific resource details
- Include: provider, region, account, environment, resources, dependencies, tags, security, cost, policy refs, schema version
- Include `source_metadata` per field: user_prompt, image_detection, policy_default, ai_assumption
- Include `confidence` for inferred values. Below 90% → ask_user.
- Unsupported resources → structured unsupported result with alternatives, never silent ignore.

## Component payload schemas (AG-006)
Each UI component has a Pydantic schema in `schemas/components.py`.
Agent emits typed payloads only from registered schemas. No arbitrary HTML.

## Provider recommendation (AG-009A)
- User explicit choice → honor it if workspace connected and policy allows
- No preference → compare cost, policy, capability, region, existing state
- Explain recommendation with evidence

## Database engine (AG-012A)
- Ask clarifying questions when engine matters
- Support: PostgreSQL, MySQL, Oracle, SQL Server
- Recommend based on workload, cost, licensing, managed service availability, policy
- Provider mapping: e.g., PostgreSQL → RDS/Aurora PostgreSQL, Azure Database for PostgreSQL, Cloud SQL/AlloyDB
- Unsupported → structured result with closest alternatives