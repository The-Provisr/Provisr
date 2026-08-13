# AGENTS.md — orchestrator

## Stack
NestJS, TypeScript, Zod, pino, Vitest.

## Dev
```bash
pnpm --filter @provisr/orchestrator dev     # localhost:4000 (hot-reload)
pnpm --filter @provisr/orchestrator test
pnpm --filter @provisr/orchestrator build
```

## Module pattern (from AG-001..AG-027 backlog references)
```
src/routes/          Controllers — thin, validate input, delegate to services
src/state-machine/   Workflow FSM + guards — strict transition enforcement
src/services/        Business logic — agent bridge, policy orchestration, provider recommender
src/events/          Outbox + SSE publisher
src/middleware/      Auth (Clerk), idempotency, validation
```
- `index.ts` only re-exports. No logic.
- Controllers inject services via constructor DI.
- Services are factory functions, not singletons.
- Config passed in, never read from process.env inside functions.

## Strict flow enforcement (PRD §9, OR-006)
State machine enforces this order. No step can be skipped:
```
START → get_policy_requirements → get_cloud_capabilities → get_existing_resources
→ ask_user (if needed) → create_manifest → validate_manifest → generate_iac
→ create_plan → check_policy → request_user_confirmation
→ create_approval_request (if needed) → execute_iac → sync_cloud_state → END
```
Hard guards (OR-007): `execute_iac` blocked unless ALL gates pass.

## Testing (OR-026)
- Vitest. Tests dir mirrors src structure: `src/routes/foo.ts` → `test/routes/foo.test.ts`
- Mock DB, Redis, external HTTP. Never mock pure business logic.
- Integration tests verify state machine rejects illegal transitions.

## Error handling
- Typed error classes with `.code` property
- Global exception filter returns `{ error, message, code, request_id }`
- Include correlation_id in every log line