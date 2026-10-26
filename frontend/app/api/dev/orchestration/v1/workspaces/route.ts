// THROWAWAY dev stub — never merge to main as a real backend.
// Production code paths must not branch on stub-vs-real.
//
// Stands in for the orchestrator's POST /v1/workspaces route while OR-004
// (delegation to BE-A03 CreateWorkspace) is still a NotImplementedError. The
// response and error shapes mirror BE-A03 so the frontend can be built and
// demoed end to end locally.
import { verifyToken } from "@clerk/nextjs/server";

type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  environment: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

const ENVIRONMENTS = ["development", "staging", "production"];

const workspaces = new Map<string, {
  record: WorkspaceRecord;
  ownerId: string;
  canonicalPayload: string;
}>();
const usedBaseSlugs = new Set<string>();
const byIdempotencyKey = new Map<string, string>();

function slugify(name: string): string {
  let slug = name.toLowerCase().replaceAll(" ", "-").replace(/[^a-z0-9-]/g, "");
  if (slug.length > 64) slug = slug.slice(0, 64);
  slug = slug.replace(/^-+|-+$/g, "");
  return slug === "" ? "workspace" : slug;
}

async function authenticate(req: Request): Promise<Response | string> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const claims = await verifyToken(authHeader.slice("Bearer ".length), {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    if (typeof claims.sub !== "string" || !claims.sub.trim()) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    return claims.sub;
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }

  const subject = await authenticate(req);
  if (typeof subject !== "string") return subject;

  // Only workspaces created by this verified caller imply admin membership.
  const list = Array.from(workspaces.values())
    .filter((workspace) => workspace.ownerId === subject)
    .map(({ record }) => ({ ...record, role: "admin" }));

  return Response.json(list, { status: 200 });
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }

  const subject = await authenticate(req);
  if (typeof subject !== "string") return subject;

  const idempotencyKey = req.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    return Response.json(
      { error: "idempotency_key_required", message: "Idempotency-Key header is required for mutations", status: 400 },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json", message: "request body is not valid JSON", status: 400 }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "invalid_json", message: "request body is not valid JSON", status: 400 }, { status: 400 });
  }

  const { name, description, environment } = body as {
    name?: unknown;
    description?: unknown;
    environment?: unknown;
  };

  if (typeof name !== "string" || name.length < 3 || name.length > 64) {
    return Response.json(
      { error: "validation_error", message: "name must be between 3 and 64 characters", status: 400 },
      { status: 400 },
    );
  }
  if (typeof environment !== "string" || !ENVIRONMENTS.includes(environment)) {
    return Response.json(
      { error: "validation_error", message: "environment must be development, staging, or production", status: 400 },
      { status: 400 },
    );
  }
  if (description !== undefined && (typeof description !== "string" || description.length > 500)) {
    return Response.json(
      { error: "validation_error", message: "description must be at most 500 characters", status: 400 },
      { status: 400 },
    );
  }

  const canonicalPayload = JSON.stringify({ name, environment, description: description ?? null });
  const scopedKey = JSON.stringify([subject, idempotencyKey]);
  const replayId = byIdempotencyKey.get(scopedKey);
  const replay = replayId ? workspaces.get(replayId) : undefined;
  if (replay) {
    if (replay.canonicalPayload !== canonicalPayload) {
      return Response.json(
        { error: "duplicate_idempotency_key", message: "Idempotency-Key was already used for another request", status: 409 },
        { status: 409 },
      );
    }
    return Response.json(replay.record, { status: 201 });
  }

  const baseSlug = slugify(name);
  if (usedBaseSlugs.has(baseSlug)) {
    return Response.json(
      { error: "slug_taken", message: `slug "${baseSlug}" is already taken`, status: 409 },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const record: WorkspaceRecord = {
    id: crypto.randomUUID(),
    name,
    slug: `${baseSlug}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
    environment,
    description: typeof description === "string" ? description : null,
    created_at: now,
    updated_at: now,
  };

  workspaces.set(record.id, { record, ownerId: subject, canonicalPayload });
  usedBaseSlugs.add(baseSlug);
  byIdempotencyKey.set(scopedKey, record.id);

  return Response.json(record, { status: 201 });
}
