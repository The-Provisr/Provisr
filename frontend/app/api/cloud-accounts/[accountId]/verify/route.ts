import { forward, gatewayAuth, jsonResult, noWorkspaceResponse } from "@/lib/cloud-accounts/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ accountId: string }> };

export async function POST(req: Request, { params }: Params) {
  const auth = await gatewayAuth();
  if (auth.workspaceId === null) {
    return noWorkspaceResponse();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const { accountId } = await params;
  const idempotencyKey = req.headers.get("Idempotency-Key");
  const result = await forward(
    auth.token,
    `/v1/workspaces/${auth.workspaceId}/cloud-accounts/${encodeURIComponent(accountId)}/verify`,
    {
      method: "POST",
      body: JSON.stringify(body),
      ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
    },
  );
  return jsonResult(result);
}
