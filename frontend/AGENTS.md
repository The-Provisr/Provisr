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

## Landing page assets
- Store generated landing-page illustrations and supporting media in [`public/assets`](./public/assets/).
- Reference these files from React as `/assets/<filename>`.
- Keep the hero artwork separate unless a task explicitly changes the hero.
- Use descriptive kebab-case filenames and document each production asset in `public/assets/manifest.json`.
- Generated illustrations must match the near-black canvas, restrained violet/magenta atmosphere, and high-contrast editorial direction in `DESIGN.md`.
- Do not use remote stock-image URLs, embedded credentials, text-heavy raster UI, third-party logos, or watermarked imagery.
- Reuse an existing illustration through intentional crops when it represents the same concept instead of creating near-duplicate assets.

## Component registry rules (FE-C01)
- Every component registered in `registry.ts` with schema version
- Unknown component types render safe fallback, never arbitrary HTML
- Component payloads come from orchestrator, never from agent directly
- All 22 components listed in backlog FE-C exist in `components/registry/components/`

## Testing
- Vitest for unit tests
- Component registry tests verify unknown types fail safely
