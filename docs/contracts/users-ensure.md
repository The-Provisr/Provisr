# Contract — `POST /v1/users/ensure`

Handoff contract for the backend task (coordinate with FE-B01; the backend
endpoint does not exist yet). The frontend calls this from the post-auth route
to synchronously materialize a user record before the dashboard renders.

## Method & path

```
POST /v1/users/ensure
```

## Auth

- Header: `Authorization: Bearer <Clerk session JWT>`
- The token is verified against Clerk's JWKS. No static orchestration API key
  is accepted at this endpoint.
- Response shape: the caller's `workspaceId` (or `null`).

## Request

Headers:

| Header | Required | Notes |
|---|---|---|
| `Authorization` | yes | `Bearer <Clerk session JWT>` |
| `Content-Type` | yes | `application/json` |
| `Idempotency-Key` | yes | Set to the Clerk user ID (`clerkId`). Safe on every sign-in, safe to retry. |

Body:

```json
{
  "clerkId": "user_2abc…",
  "email": "user@example.com",
  "name": "Jane Doe",
  "avatarUrl": "https://img.clerk.com/…"
}
```

| Field | Type | Notes |
|---|---|---|
| `clerkId` | string | Clerk user ID. Primary key / upsert key. |
| `email` | string \| null | Primary email, may be absent. |
| `name` | string \| null | First + last name joined, may be absent. |
| `avatarUrl` | string \| null | User image URL, may be absent. |

## Response

### `200 OK` — user upserted (always)

```json
{
  "id": "uuid",
  "workspaceId": "uuid-or-null"
}
```

Semantics:

- **Upsert** on `clerk_id`. A repeat call with the same `Idempotency-Key` /
  `clerkId` returns the existing record — it must **never** return `409`.
- `workspaceId` is `null` for a brand-new user who has not created a workspace.
- Same-user retries produce exactly one backend user record.

### Errors

| Status | Code | Notes |
|---|---|---|
| `401` | `unauthorized` | Missing/invalid Bearer token |
| `400` | `invalid_body` | Malformed JSON |
| `400` | `missing_clerk_id` | `clerkId` absent |
| `500` | `internal` | Unexpected failure |

## Frontend consumer

`frontend/lib/orchestration/users.ts` — `ensureUser(token, input)`.
Server-only module (`import 'server-only'`). Base URL from
`process.env.ORCHESTRATION_API_URL`.

## Security note — middleware and `/api/*`

Middleware performs **no auth enforcement on `/api/*` by design**
(`frontend/middleware.ts` skips all redirects for `/api/*`). Every route
handler must carry its own check (`auth.protect()` for session requests,
`verifyToken` for bearer-token endpoints like this one).

## Metadata ownership (workspace routing claim)

`sessionClaims.metadata.workspaceId` drives routing: signed-in users without a
workspace go to `/onboarding`, users with one go to `/dashboard`.

**Interim ownership (this task):** the Next.js post-auth route syncs it. After
`ensureUser()` returns, it compares `record.workspaceId` to
`sessionClaims.metadata.workspaceId`; if different, it calls
`clerkClient().users.updateUserMetadata(userId, { publicMetadata: { workspaceId } })`.
This is a **reconcile, not an authoritative write**, so the backend can later
take ownership without conflict.

**Long-term ownership (backend):** the backend should write
`publicMetadata.workspaceId` when a workspace is created (and
`onboardingComplete` when onboarding gains a second step). The frontend
reconcile above is the interim path only.

**Prerequisite:** the Clerk Dashboard session token must be customized to
include `{"metadata": "{{user.public_metadata}}"}`. Without it,
`sessionClaims.metadata` is `undefined` on every request and routing falls back
to onboarding for all users.

## Dev stub

For local testing only (throwaway, never merge as a real backend):
`frontend/app/api/dev/orchestration/users/ensure/route.ts`. The route is
guarded at the top of the handler — in a production build
(`NODE_ENV === "production"`) it returns `404` before any auth logic runs.
Set `ORCHESTRATION_API_URL=http://localhost:3000/api/dev/orchestration` in
`.env.local` (never `.env.example`). Branch control:

- `?workspaceId=` (empty) → `workspaceId: null` → routes to `/onboarding`
- `?workspaceId=<value>` → routes to `/dashboard`
- header `x-stub-workspace-id` → same behavior
- default (no param/header) → `null` (brand-new user)

Idempotency is tracked in a module-level `Map` keyed on `clerkId`.
