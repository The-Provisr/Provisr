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

const workspaces = new Map<string, WorkspaceRecord & { baseSlug: string }>();
const usedBaseSlugs = new Set<string>();
const byIdempotencyKey = new Map<string, string>();

function slugify(name: string): string {
  let slug = name.toLowerCase().replaceAll(" ", "-").replace(/[^a-z0-9-]/g, "");
  if (slug.length > 64) slug = slug.slice(0, 64);
  slug = slug.replace(/^-+|-+$/g, "");
  return slug === "" ? "workspace" : slug;
}

async function authenticate(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await verifyToken(authHeader.slice("Bearer ".length), {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }

  const unauthorized = await authenticate(req);
  if (unauthorized) return unauthorized;

  // BE-A03 returns a top-level array of workspace + role. The in-memory
  // workspaces were all created by the caller in dev, so they are admin.
  const list = Array.from(workspaces.values()).map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    environment: workspace.environment,
    description: workspace.description,
    created_at: workspace.created_at,
    updated_at: workspace.updated_at,
    role: "admin",
  }));

  return Response.json(list, { status: 200 });
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }

  const unauthorized = await authenticate(req);
  if (unauthorized) return unauthorized;

  const idempotencyKey = req.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    return Response.json(
      { error: "idempotency_key_required", message: "Idempotency-Key header is required for mutations", status: 400 },
      { status: 400 },
    );
  }

  const replayId = byIdempotencyKey.get(idempotencyKey);
  if (replayId) {
    return Response.json(workspaces.get(replayId), { status: 201 });
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

  workspaces.set(record.id, { ...record, baseSlug });
  usedBaseSlugs.add(baseSlug);
  byIdempotencyKey.set(idempotencyKey, record.id);

  return Response.json(record, { status: 201 });
}
