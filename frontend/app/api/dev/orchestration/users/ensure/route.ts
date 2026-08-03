// THROWAWAY dev stub — never merge to main as a real backend.
// Production code paths must not branch on stub-vs-real.
import { verifyToken } from "@clerk/nextjs/server";

const records = new Map<string, { id: string; workspaceId: string | null }>();

function nextId(): string {
  return crypto.randomUUID();
}

export async function POST(req: Request) {
  // Throwaway stub — never serve it from a production build.
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice("Bearer ".length);

  try {
    await verifyToken(token, {});
  } catch {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const { clerkId } = body as { clerkId?: string };
  if (!clerkId) {
    return Response.json({ error: "missing_clerk_id" }, { status: 400 });
  }

  // Branch control for testing: ?workspaceId= (empty → null) → header
  // x-stub-workspace-id → default null (brand-new user).
  let workspaceId: string | null = null;
  const queryWorkspace = new URL(req.url).searchParams.get("workspaceId");
  if (queryWorkspace !== null) {
    workspaceId = queryWorkspace || null;
  } else {
    const headerWorkspace = req.headers.get("x-stub-workspace-id");
    if (headerWorkspace !== null) {
      workspaceId = headerWorkspace || null;
    }
  }

  const existing = records.get(clerkId);
  if (existing) {
    return Response.json(existing);
  }

  const record = { id: nextId(), workspaceId };
  records.set(clerkId, record);
  return Response.json(record);
}
