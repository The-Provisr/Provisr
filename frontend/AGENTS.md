# AGENTS.md — frontend

## Stack
Next.js App Router, TypeScript, Tailwind CSS, Clerk auth.

## Dev
```bash
pnpm --filter @provisr/frontend dev    # localhost:3000
pnpm --filter @provisr/frontend build
pnpm --filter @provisr/frontend lint
```

## Patterns
- App Router: file-based routes in `app/` directory
- Component registry: `components/registry/registry.ts` maps `type` → React component. All UI payloads validated before render.
- SSE: `lib/sse-client.ts` subscribes to orchestrator. Resumable with last event ID.
- Auth: Clerk `<SignedIn>` / `<SignedOut>` wrappers. Protected routes via middleware.
- State: no global store. Per-page state via React hooks. SSE events update in place.

## Component registry rules (FE-C01)
- Every component registered in `registry.ts` with schema version
- Unknown component types render safe fallback, never arbitrary HTML
- Component payloads come from orchestrator, never from agent directly
- All 22 components listed in backlog FE-C exist in `components/registry/components/`

## Testing
- Vitest for unit tests
- Component registry tests verify unknown types fail safely