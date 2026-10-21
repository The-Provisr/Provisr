import { forward, gatewayAuth, jsonResult, noWorkspaceResponse } from "@/lib/cloud-accounts/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await gatewayAuth();
  if (auth.workspaceId === null) {
    return noWorkspaceResponse();
  }
  const result = await forward(
    auth.token,
    `/v1/workspaces/${auth.workspaceId}/cloud-capabilities`,
  );
  return jsonResult(result);
}
