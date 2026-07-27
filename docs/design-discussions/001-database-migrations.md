---
name: Design discussion
about: Propose a design change for team review before implementation
title: "Design: Initial database schema for core domain model"
labels: ["design-discussion"]
assignees: ["Hesanda"]
---

## Problem

Backend layer has no persistence. 7 Go services (policy, state, provisioning, approval, audit, notification, reconciler) depend on a shared database. Without migrations, no service can start, no data can be stored, no end-to-end flow can run.

Backlog item: BE-A02 — Database Migrations (Sprint 1, Week 8)

## Proposed solution

11 tables across 8 PostgreSQL schemas (`provisr_<domain>`), implemented as golang-migrate SQL files in `backend/migrations/`. Each domain gets its own file pair (up/down).

### Schema breakdown

| Schema | Tables | PRD § |
|---|---|---|
| `provisr_identity` | `organizations`, `users`, `workspaces`, `memberships` | §6 |
| `provisr_cloud` | `cloud_accounts` | §7 |
| `provisr_state` | `chat_sessions`, `provisioning_runs` | §8, §20 |
| `provisr_manifest` | `manifests` | §13 |
| `provisr_iac` | `artifacts` | §14 |
| `provisr_approval` | `approval_tickets` | §16 |
| `provisr_audit` | `audit_events` | §21 |
| `provisr_events` | `sse_events` | §18 |

### Key constraints

- `idempotency_key UNIQUE` on `provisioning_runs` (PRD §20)
- `state_version INTEGER` on `provisioning_runs` — optimistic locking (PRD §20)
- `hash CHAR(64)` + `previous_hash CHAR(64)` on `audit_events` — hash-chained immutability (PRD §21)
- `metadata JSONB` on `cloud_accounts` — encrypted at app layer (PRD §19)
- `token_approve_hash` / `token_reject_hash CHAR(64)` on `approval_tickets` — never store raw approval tokens (PRD §16)
- All FKs indexed; composite status indexes on high-query tables
- Every table carries `org_id` for future RLS tenancy

## Layers affected

- [ ] frontend
- [ ] orchestrator
- [ ] agent
- [ ] mcp
- [x] backend
- [ ] infra
- [ ] packages / shared contracts

## Alternatives considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Single `public` schema | Simpler, fewer migration files | No domain isolation, no RLS boundary | ❌ |
| Single monolithic migration | One file to run | Hard to review, hard to roll back per domain | ❌ |
| ORM migrations (GORM/Ent) | Auto-schema generation | Breaks `golang-migrate` convention in `backend/AGENTS.md` | ❌ |
| Per-domain schema (proposed) | Domain isolation, RLS-ready, matches audit boundaries | More files | ✅ |

## Open questions

1. Should `organizations` be included now or deferred to multi-tenancy sprint? (It's a parent FK for RLS — easier to add early.)
2. Enum values for `provisioning_runs.state` — full 13-state FSM or collapsed MVP subset?
3. `golang-migrate` bootstrap — should a shared `cmd/migrate` binary be added in this task or deferred to service implementation?

## Review deadline

By: 2026-07-29 (48h from opening)
