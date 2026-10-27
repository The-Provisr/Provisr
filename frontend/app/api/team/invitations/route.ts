import { proxyWorkspace } from "@/lib/team/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return proxyWorkspace(req, "/invitations");
}

export async function POST(req: Request) {
  return proxyWorkspace(req, "/invitations", { method: "POST", withBody: true });
}
