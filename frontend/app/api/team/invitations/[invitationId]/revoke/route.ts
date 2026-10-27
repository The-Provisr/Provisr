import { proxyWorkspace } from "@/lib/team/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ invitationId: string }> };

export async function POST(req: Request, { params }: Params) {
  const { invitationId } = await params;
  return proxyWorkspace(req, `/invitations/${encodeURIComponent(invitationId)}/revoke`, {
    method: "POST",
  });
}
