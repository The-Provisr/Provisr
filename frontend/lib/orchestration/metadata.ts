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
 *
 * `providers` is the onboarding "connect intent" multi-select. The workspace
 * create contract (OR-003) has no provider field yet, so intent is parked on
 * publicMetadata for the follow-up Cloud Accounts redirect (FE-M05). Omitting
 * it leaves any previously stored intent untouched.
 */
export async function reconcileWorkspaceMetadata(params: {
  userId: string;
  backendWorkspaceId: string | null;
  claimedWorkspaceId: string | null | undefined;
  providers?: string[];
}): Promise<void> {
  const { userId, backendWorkspaceId, claimedWorkspaceId, providers } = params;

  if (backendWorkspaceId === claimedWorkspaceId && providers === undefined) {
    return;
  }

  const publicMetadata: Record<string, unknown> = {
    workspaceId: backendWorkspaceId,
  };
  if (providers !== undefined) {
    publicMetadata.workspaceProviders = providers;
  }

  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, { publicMetadata });
}
