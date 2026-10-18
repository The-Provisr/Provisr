import { auth, currentUser } from "@clerk/nextjs/server";
import { reconcileWorkspaceMetadata } from "@/lib/orchestration/metadata";
import { ensureUser } from "@/lib/orchestration/users";
import {
  createWorkspace,
  WorkspaceCreateError,
  type WorkspaceEnvironment,
} from "@/lib/orchestration/workspaces";

const ENVIRONMENTS: WorkspaceEnvironment[] = ["development", "staging", "production"];
const PROVIDERS = ["aws", "azure", "gcp"] as const;

type Provider = (typeof PROVIDERS)[number];

export async function POST(req: Request) {
  const { userId, getToken, sessionClaims } = await auth.protect();
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const { name, description, environment, providers } = body as {
    name?: unknown;
    description?: unknown;
    environment?: unknown;
    providers?: unknown;
  };

  if (typeof name !== "string" || name.trim().length < 3 || name.trim().length > 64) {
    return Response.json(
      { error: "name must be between 3 and 64 characters" },
      { status: 400 },
    );
  }
  if (typeof environment !== "string" || !ENVIRONMENTS.includes(environment as WorkspaceEnvironment)) {
    return Response.json(
      { error: "environment must be development, staging, or production" },
      { status: 400 },
    );
  }

  const trimmedDescription =
    typeof description === "string" && description.trim() !== ""
      ? description.trim().slice(0, 500)
      : undefined;

  const selectedProviders: Provider[] = Array.isArray(providers)
    ? providers.filter((value): value is Provider => PROVIDERS.includes(value as Provider))
    : [];

  const token = await getToken();
  if (!token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const idempotencyKey = req.headers.get("Idempotency-Key")?.trim() || crypto.randomUUID();

  let workspace;
  try {
    workspace = await createWorkspace(
      token,
      {
        name: name.trim(),
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
        environment: environment as WorkspaceEnvironment,
      },
      idempotencyKey,
    );
  } catch (err) {
    if (err instanceof WorkspaceCreateError) {
      const status = err.code === "slug_taken" ? 409 : err.status;
      return Response.json({ error: err.message, code: err.code }, { status });
    }
    return Response.json({ error: "workspace_create_failed" }, { status: 502 });
  }

  // Point the caller's user record at the new workspace. The workspace already
  // exists, so a failure here must not lose it — fall back to the id we have.
  let backendWorkspaceId = workspace.id;
  try {
    const record = await ensureUser(
      token,
      {
        email: user.primaryEmailAddress?.emailAddress ?? null,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
        avatarUrl: user.imageUrl ?? null,
        workspaceId: workspace.id,
      },
      userId,
    );
    backendWorkspaceId = record.workspaceId ?? workspace.id;
  } catch {
    backendWorkspaceId = workspace.id;
  }

  // Reconcile the Clerk session claim so middleware routes them to /dashboard.
  await reconcileWorkspaceMetadata({
    userId,
    backendWorkspaceId,
    claimedWorkspaceId: sessionClaims?.metadata?.workspaceId,
    providers: selectedProviders,
  });

  return Response.json(
    {
      workspaceId: workspace.id,
      slug: workspace.slug,
      environment: workspace.environment,
    },
    { status: 201 },
  );
}
