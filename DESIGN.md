# DESIGN.md — Provisr Design Philosophy

## Core principle
**Agent plans and explains. Orchestration enforces strict flow. Services validate, approve, execute, audit, and sync state.**

System prompts guide the agent, but orchestration state machines enforce the strict flow. The agent has intelligence; the control plane has authority.

## Five-layer architecture

```
User prompt (natural language)
  → frontend (Next.js UX, Clerk auth, component registry)
    → orchestrator (NestJS API gateway, strict FSM, SSE)
      → agent (Python ReAct loop, manifest drafting)
        → mcp tools (Python, get policy → get context → generate manifest → plan → check)
      → orchestrator validates, enforces gates
      → backend (Go services: policy check → approval → Terraform execute → audit)
    → frontend streams progress via SSE
  → Cloud resources provisioned
```

## Strict flow (PRD §9)
States execute in order. No skipping. Guards prevent:
- Manifest before policy loaded → blocked
- IaC before manifest validated → blocked
- Execution before user confirmation + policy pass + approval (if required) → blocked

## Key decisions

| Decision | Rationale |
|---|---|
| TypeScript for orchestrator | PRD §22 specifies TS workspace. NestJS for structure. |
| Python for agent + MCP | Rich AI/LLM ecosystem. LangChain compatibility. |
| Go for backend services | Performance, strong concurrency, excellent cloud SDK support. |
| Protobuf for contracts | Type-safe cross-language contracts. Go + TS code generation via buf. |
| pnpm for TS workspaces | Disk-efficient, strict isolation, workspace protocol. |
| uv for Python workspaces | 10-100x faster than pip, native workspace support. |
| Docker Compose profiles | Same infra across devs. Profiles for layer-isolated development. |
| Multi-module Go | go.work links independent service modules. Each service manages own deps. |

## Security posture
- No long-lived cloud secrets in browser. No user-submitted access keys.
- Short-lived delegated credentials for provider execution (Vault, STS).
- Every tool call scoped to workspace + user permissions.
- Every mutation idempotent and audited.
- Agent outputs untrusted until validated by orchestrator + backend.