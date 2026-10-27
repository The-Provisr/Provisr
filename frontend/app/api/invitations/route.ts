import { proxyInvitation } from "@/lib/team/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return proxyInvitation(req, "/v1/invitations");
}
