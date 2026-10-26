import { z } from "zod";
import { DependencyError, ForbiddenError } from "../common/errors/typed-errors";
import type { GatewayRequestContext } from "../routes/gateway-request";
import type { WorkspaceServiceClient } from "./workspace-service.client";

const permissionResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
});

/**
 * Single authorization seam for workspace-scoped gateway routes. It delegates
 * to workspace-service BE-A03 so the role/action matrix lives in exactly one
 * place. It never fails open: an unreadable or unavailable response becomes a
 * 502, and a denial becomes a 403.
 */
export class WorkspaceAccessService {
  constructor(private readonly client: WorkspaceServiceClient) {}

  async assertAllowed(
    userId: string,
    workspaceId: string,
    resourceType: string,
    action: string,
    ctx: GatewayRequestContext,
  ): Promise<void> {
    const { body } = await this.client.checkPermission(
      {
        user_id: userId,
        workspace_id: workspaceId,
        resource_type: resourceType,
        action,
      },
      ctx,
    );

    const parsed = permissionResultSchema.safeParse(body);
    if (!parsed.success) {
      throw new DependencyError("Permission service returned an unreadable response.");
    }

    if (!parsed.data.allowed) {
      throw new ForbiddenError(parsed.data.reason !== undefined ? parsed.data.reason : undefined);
    }
  }
}
