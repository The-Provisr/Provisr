import { proxyWorkspace } from "@/lib/team/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return proxyWorkspace(req, "/members");
}
