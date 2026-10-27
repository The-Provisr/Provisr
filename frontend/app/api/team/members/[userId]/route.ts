import { proxyWorkspace } from "@/lib/team/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { userId } = await params;
  return proxyWorkspace(req, `/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    withBody: true,
  });
}

export async function DELETE(req: Request, { params }: Params) {
  const { userId } = await params;
  return proxyWorkspace(req, `/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
}
