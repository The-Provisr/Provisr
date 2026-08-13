# ARCHITECTURE.md — System Architecture

## High-level component diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      frontend (Next.js)                         │
│  Clerk auth · Chat UI · Component registry · SSE client        │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS + SSE
┌─────────────────────────▼───────────────────────────────────────┐
│                   orchestrator (NestJS)                         │
│  API gateway · Workflow state machine · Execution guard         │
│  Event outbox · SSE publisher · Agent bridge                   │
│  Policy pre-flight · Provider recommender                      │
└────┬────────────┬────────────┬────────────┬─────────────────────┘
     │            │            │            │
     ▼            ▼            ▼            ▼
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────────────┐
│  agent  │ │   mcp   │ │ backend │ │  shared infra   │
│(Python) │ │(Python) │ │  (Go)   │ │  Postgres·Redis  │
│ ReAct   │ │ Policy  │ │ 7 svcs  │ │  LocalStack     │
│ Prompt  │ │ Cloud   │ │ Policy  │ │  Jaeger         │
│ Manifest│ │ IaC     │ │ State   │ └────────────────┘
│ Planner │ │ Cost    │ │ IaC     │
│         │ │ Appr    │ │ Appr    │
│         │ │ Domain  │ │ Audit   │
│         │ │         │ │ Notif   │
│         │ │         │ │ Recon   │
└─────────┘ └─────────┘ └─────────┘
```

## Service inventory

| Service | Layer | Language | Purpose |
|---|---|---|---|
| Frontend | frontend | TS/Next.js | User experience, Clerk auth, component registry |
| Orchestrator | orchestrator | TS/NestJS | API gateway, workflow state machine, SSE |
| Agent | agent | Python/FastAPI | ReAct loop, manifest drafting, prompt registry |
| MCP tools | mcp | Python/FastAPI | Structured tool layer (policy, cloud, IaC, cost, approval, domains) |
| Policy Service | backend | Go + OPA | OPA/Rego policy evaluation |
| State Service | backend | Go | Cloud state manager, resource tracking |
| Provisioning Service | backend | Go | IaC generation, Terraform execution worker |
| Approval Service | backend | Go | Approval tickets, HMAC tokens |
| Audit Service | backend | Go | Immutable audit trail |
| Notification Service | backend | Go | Email, WebSocket/SSE push |
| Reconciler | backend | Go | Webhook listener, drift detection |

## Event flow (EDA)
State transitions publish `StateChangedEvent` to subscribers:
- Agent receives `PENDING_AGENT` → resumes conversation
- Notification pushes to frontend SSE
- Audit stores permanently

## Data flow (request lifecycle)
See PRD §8 (Core User Journey) for the 17-step flow from prompt to cloud sync.