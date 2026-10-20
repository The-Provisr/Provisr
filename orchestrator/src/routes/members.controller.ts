import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../middleware/current-user.decorator";
import type { RequestUser } from "../middleware/auth.types";
import { WorkspaceAccessService } from "../services/workspace-access.service";
import { WorkspaceServiceClient, type WorkspaceRole } from "../services/workspace-service.client";
import { gatewayContext, sendUpstream } from "./gateway-request";

export const workspaceRoleSchema = z.enum(["admin", "engineer", "approver", "auditor", "viewer"]);

export const addMemberSchema = z
  .object({ user_id: z.string().uuid(), role: workspaceRoleSchema })
  .strict();

export const updateMemberRoleSchema = z.object({ role: workspaceRoleSchema }).strict();

export type AddMemberDto = z.infer<typeof addMemberSchema>;
export type UpdateMemberRoleDto = z.infer<typeof updateMemberRoleSchema>;

const roleFilterSchema = workspaceRoleSchema.optional();

@Controller("workspaces/:workspaceId/members")
export class MembersController {
  constructor(
    private readonly workspace: WorkspaceServiceClient,
    private readonly access: WorkspaceAccessService,
  ) {}

  @Get()
  async list(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Query("role", new ZodValidationPipe(roleFilterSchema)) role: WorkspaceRole | undefined,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user);
    await this.access.assertAllowed(user.userId, workspaceId, "member", "list", ctx);
    sendUpstream(res, await this.workspace.listMembers(workspaceId, role, ctx));
  }

  @Post()
  async add(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Body(new ZodValidationPipe(addMemberSchema)) dto: AddMemberDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user, idempotencyKey);
    await this.access.assertAllowed(user.userId, workspaceId, "member", "add", ctx);
    sendUpstream(res, await this.workspace.addMember(workspaceId, dto, ctx));
  }

  @Patch(":userId")
  async updateRole(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(updateMemberRoleSchema)) dto: UpdateMemberRoleDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user, idempotencyKey);
    await this.access.assertAllowed(user.userId, workspaceId, "member", "update_role", ctx);
    sendUpstream(res, await this.workspace.updateMemberRole(workspaceId, userId, dto, ctx));
  }

  @Delete(":userId")
  async remove(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user, idempotencyKey);
    await this.access.assertAllowed(user.userId, workspaceId, "member", "remove", ctx);
    sendUpstream(res, await this.workspace.removeMember(workspaceId, userId, ctx));
  }
}
