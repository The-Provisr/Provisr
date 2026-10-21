import { forward, gatewayAuth, jsonResult, noWorkspaceResponse } from "@/lib/cloud-accounts/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await gatewayAuth();
  if (auth.workspaceId === null) {
    return noWorkspaceResponse();
  }
  const result = await forward(auth.token, `/v1/workspaces/${auth.workspaceId}/cloud-accounts`);
  return jsonResult(result);
}

export async function POST(req: Request) {
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

  const idempotencyKey = req.headers.get("Idempotency-Key");
  const result = await forward(
    auth.token,
    `/v1/workspaces/${auth.workspaceId}/cloud-accounts`,
    {
      method: "POST",
      body: JSON.stringify(body),
      ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
    },
  );
  return jsonResult(result);
}
