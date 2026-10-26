import { Body, Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../middleware/current-user.decorator";
import type { RequestUser } from "../middleware/auth.types";
import {
  WorkspaceServiceClient,
  type PermissionCheckInput,
} from "../services/workspace-service.client";
import { gatewayContext, sendUpstream } from "./gateway-request";

// user_id is deliberately absent: the gateway always injects the authenticated
// user so a caller can never probe another user's permissions.
export const permissionCheckSchema = z
  .object({
    workspace_id: z.string().uuid(),
    resource_type: z.string().trim().min(1).max(100),
    action: z.string().trim().min(1).max(100),
    resource_id: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export const permissionCheckBatchSchema = z
  .object({ checks: z.array(permissionCheckSchema).min(1).max(100) })
  .strict();

export type PermissionCheckDto = z.infer<typeof permissionCheckSchema>;
export type PermissionCheckBatchDto = z.infer<typeof permissionCheckBatchSchema>;

@Controller("permissions")
export class PermissionsController {
  constructor(private readonly workspace: WorkspaceServiceClient) {}

  @Post("check")
  async check(
    @Body(new ZodValidationPipe(permissionCheckSchema)) dto: PermissionCheckDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user);
    const input: PermissionCheckInput = { ...dto, user_id: user.userId };
    sendUpstream(res, await this.workspace.checkPermission(input, ctx));
  }

  @Post("check-batch")
  async checkBatch(
    @Body(new ZodValidationPipe(permissionCheckBatchSchema)) dto: PermissionCheckBatchDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user);
    const checks: PermissionCheckInput[] = dto.checks.map((check) => ({
      ...check,
      user_id: user.userId,
    }));
    sendUpstream(res, await this.workspace.checkBatch(checks, ctx));
  }
}
