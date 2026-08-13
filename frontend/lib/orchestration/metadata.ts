import "server-only";
import { clerkClient } from "@clerk/nextjs/server";

/**
 * Reconcile the caller's workspaceId claim with what the backend actually
 * returned from ensureUser.
 *
 * Interim ownership: the Next.js post-auth route writes publicMetadata so the
 * session claim (custom session token `{"metadata": "{{user.public_metadata}}"}`)
 * carries workspaceId for routing. Long-term ownership belongs to the backend —
 * see docs/contracts/users-ensure.md. This is a reconcile, not an
 * authoritative write, so the backend can later take over without conflict.
 */
export async function reconcileWorkspaceMetadata(params: {
  userId: string;
  backendWorkspaceId: string | null;
  claimedWorkspaceId: string | null | undefined;
}): Promise<void> {
  const { userId, backendWorkspaceId, claimedWorkspaceId } = params;

  if (backendWorkspaceId === claimedWorkspaceId) {
    return;
  }

  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, {
    publicMetadata: {
      workspaceId: backendWorkspaceId,
    },
  });
}
