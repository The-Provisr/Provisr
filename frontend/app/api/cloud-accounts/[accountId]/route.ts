import { forward, gatewayAuth, jsonResult, noWorkspaceResponse } from "@/lib/cloud-accounts/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ accountId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const auth = await gatewayAuth();
  if (auth.workspaceId === null) {
    return noWorkspaceResponse();
  }
  const { accountId } = await params;
  const result = await forward(
    auth.token,
    `/v1/workspaces/${auth.workspaceId}/cloud-accounts/${encodeURIComponent(accountId)}`,
  );
  return jsonResult(result);
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await gatewayAuth();
  if (auth.workspaceId === null) {
    return noWorkspaceResponse();
  }
  const { accountId } = await params;
  const idempotencyKey = req.headers.get("Idempotency-Key");
  const result = await forward(
    auth.token,
    `/v1/workspaces/${auth.workspaceId}/cloud-accounts/${encodeURIComponent(accountId)}`,
    {
      method: "DELETE",
      ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
    },
  );
  return jsonResult(result);
}
