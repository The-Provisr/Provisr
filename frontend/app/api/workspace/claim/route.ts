import { auth, currentUser } from "@clerk/nextjs/server";
import { reconcileWorkspaceMetadata } from "@/lib/orchestration/metadata";
import { ensureUser } from "@/lib/orchestration/users";

export async function POST(req: Request) {
  const { userId, getToken, sessionClaims } = await auth.protect();
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await getToken();
  if (!token) {
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

  const { workspaceId } = body as { workspaceId?: string };
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    return Response.json({ error: "missing_workspace_id" }, { status: 400 });
  }

  const record = await ensureUser(
    token,
    {
      email: user.primaryEmailAddress?.emailAddress ?? null,
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
      avatarUrl: user.imageUrl ?? null,
      workspaceId,
    },
    userId,
  );

  await reconcileWorkspaceMetadata({
    userId,
    backendWorkspaceId: record.workspaceId,
    claimedWorkspaceId: sessionClaims?.metadata?.workspaceId,
  });

  return Response.json({ workspaceId: record.workspaceId });
}
