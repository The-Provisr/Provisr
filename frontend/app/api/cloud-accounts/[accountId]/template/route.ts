import { forward, gatewayAuth, jsonResult, noWorkspaceResponse } from "@/lib/cloud-accounts/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ accountId: string }> };

/**
 * Forwards to the orchestrator template route, which currently returns 501
 * (no backend generator yet). The UI falls back to a client-rendered template
 * when this does not return a body.
 */
export async function GET(_req: Request, { params }: Params) {
  const auth = await gatewayAuth();
  if (auth.workspaceId === null) {
    return noWorkspaceResponse();
  }
  const { accountId } = await params;
  const result = await forward(
    auth.token,
    `/v1/workspaces/${auth.workspaceId}/cloud-accounts/${encodeURIComponent(accountId)}/template`,
  );
  return jsonResult(result);
}
