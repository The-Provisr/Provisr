import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PostAuthHandoff } from "@/components/auth/post-auth-handoff";
import { reconcileWorkspaceMetadata } from "@/lib/orchestration/metadata";
import { ensureUser } from "@/lib/orchestration/users";

export const dynamic = "force-dynamic";

export default async function PostAuthPage() {
  const { userId, getToken, sessionClaims } = await auth.protect();
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const token = await getToken();
  if (!token) redirect("/sign-in");

  const record = await ensureUser(
    token,
    {
      email: user.primaryEmailAddress?.emailAddress ?? null,
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
      avatarUrl: user.imageUrl ?? null,
    },
    userId,
  );

  await reconcileWorkspaceMetadata({
    userId,
    backendWorkspaceId: record.workspaceId,
    claimedWorkspaceId: sessionClaims?.metadata?.workspaceId,
  });

  const target = record.workspaceId ? "/dashboard" : "/onboarding";

  return <PostAuthHandoff target={target} expectedWorkspaceId={record.workspaceId} />;
}
