# AGENTS.md — Provisr

## What this repo is
5-layer monorepo for multi-cloud infrastructure provisioning.
Agent plans + explains. Orchestration enforces strict flow. Services validate/execute/audit.

## Directory map
```
frontend/        Next.js (TypeScript) — Clerk auth, chat UI, 22x component registry
orchestrator/    NestJS (TypeScript) — API gateway, state machine FSM, SSE
agent/           FastAPI (Python) — ReAct loop, prompt registry, manifest drafting
mcp/             FastAPI (Python) — MCP tool servers (policy, cloud, IaC, cost, approval, domains)
backend/         Go (7 services) — policy, state, provisioning, approval, audit, notification, reconciler, workspace (merged: members + invitations + permissions)
packages/
  proto/         .proto source of truth (buf)
  shared-contracts/ TS types generated from proto + Zod schemas
infra/docker/    docker-compose.yml with profiles
scripts/         Native dev scripts
```

## Build & test
```bash
task lint        # Lint all layers
task test        # Test all layers
task build       # Build all layers
task dev         # Start all services (native hot-reload)
task dev:backend # Go services only
task dev:agent   # Agent + MCP only
task dev:frontend# Frontend only
```

## Run modes
```bash
./scripts/dev.sh                    # Native: all services with hot-reload
docker compose --profile all up     # Docker: all services
docker compose --profile backend up # Docker: backend only
```

## Critical boundaries (NEVER do these)
- NEVER bypass the strict agent flow (PRD §9): get policy → context → manifest → IaC → plan → policy check → confirmation → approval → execute
- NEVER execute IaC from agent code. Only backend workers execute after all gates pass.
- NEVER expose cloud credentials, approval tokens, or raw Rego bundles to users or logs.
- NEVER skip policy checks. `check_policy` runs before user confirmation AND before execution.
- NEVER allow users to directly edit manifests or Terraform. Changes through chat/UI only.
- NEVER assume PostgreSQL is default. Agent must recommend engine based on context (AG-012A).
- NEVER put secrets in .env files committed to repo. Use Vault or env vars via infra config.

## Convention
- Commits: `feat(layer): message`, `fix(layer): message`, `docs: message`
- Layers: frontend, orchestrator, agent, mcp, backend, infra
- PRs reference design discussion issue. Squash-merge.
- Every mutation needs idempotency key. Every state transition needs audit event.

## Design discussion workflow
1. Open RFC issue using design-discussion template
2. 48h review, 2 approvals (1 from layer CO)
3. Branch: `feat/NNN-desc`
4. PR references RFC. Same reviewers approve.