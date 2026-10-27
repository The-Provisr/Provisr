import { proxyInvitation } from "@/lib/team/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return proxyInvitation(req, "/v1/invitations/accept", { method: "POST", withBody: true });
}
