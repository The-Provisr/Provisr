import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PostAuthHandoff } from "@/components/auth/post-auth-handoff";
import { reconcileWorkspaceMetadata } from "@/lib/orchestration/metadata";
import { ensureUser } from "@/lib/orchestration/users";

export const dynamic = "force-dynamic";

export default async function PostAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>;
}) {
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

  // If the onboarding wizard chose AWS, land directly on the cloud accounts
  // page with the connect panel open (FE-M05 onboarding redirect).
  const { connect } = await searchParams;
  const target = record.workspaceId
    ? connect === "aws"
      ? "/workspace/cloud-accounts?connect=aws"
      : "/dashboard"
    : "/onboarding";

  return <PostAuthHandoff target={target} expectedWorkspaceId={record.workspaceId} />;
}
