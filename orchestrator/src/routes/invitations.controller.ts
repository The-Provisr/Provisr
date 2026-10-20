import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { ForbiddenError } from "../common/errors/typed-errors";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AllowNoWorkspaceMembership } from "../middleware/allow-no-workspace.decorator";
import { CurrentUser } from "../middleware/current-user.decorator";
import type { RequestUser } from "../middleware/auth.types";
import { WorkspaceAccessService } from "../services/workspace-access.service";
import { WorkspaceServiceClient } from "../services/workspace-service.client";
import { gatewayContext, sendUpstream } from "./gateway-request";
import { workspaceRoleSchema } from "./members.controller";

export const createInvitationSchema = z
  .object({ email: z.string().trim().email().max(320), role: workspaceRoleSchema })
  .strict();

export const acceptInvitationSchema = z.object({ name: z.string().trim().min(1).max(255) }).strict();

export type CreateInvitationDto = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationDto = z.infer<typeof acceptInvitationSchema>;

const invitationCodeSchema = z.string().trim().min(1).max(128);

@Controller()
export class InvitationsController {
  constructor(
    private readonly workspace: WorkspaceServiceClient,
    private readonly access: WorkspaceAccessService,
  ) {}

  @Post("workspaces/:workspaceId/invitations")
  async create(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Body(new ZodValidationPipe(createInvitationSchema)) dto: CreateInvitationDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user, idempotencyKey);
    await this.access.assertAllowed(user.userId, workspaceId, "invitation", "create", ctx);
    sendUpstream(res, await this.workspace.createInvitation(workspaceId, dto, ctx));
  }

  @Get("workspaces/:workspaceId/invitations")
  async list(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user);
    await this.access.assertAllowed(user.userId, workspaceId, "invitation", "list", ctx);
    sendUpstream(res, await this.workspace.listInvitations(workspaceId, ctx));
  }

  @Get("workspaces/:workspaceId/invitations/:invitationId")
  async get(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("invitationId", new ParseUUIDPipe()) invitationId: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user);
    await this.access.assertAllowed(user.userId, workspaceId, "invitation", "view", ctx);
    sendUpstream(res, await this.workspace.getInvitation(workspaceId, invitationId, ctx));
  }

  @Post("workspaces/:workspaceId/invitations/:invitationId/revoke")
  async revoke(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("invitationId", new ParseUUIDPipe()) invitationId: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user, idempotencyKey);
    await this.access.assertAllowed(user.userId, workspaceId, "invitation", "revoke", ctx);
    sendUpstream(res, await this.workspace.revokeInvitation(workspaceId, invitationId, ctx));
  }

  /**
   * Invitee-facing endpoints. The caller is authenticated but is very likely
   * not yet a member of any workspace, so the zero-membership rejection is
   * skipped. No workspace permission check applies; the invitation code is the
   * secret and the backend enforces revocation, expiry, and email match.
   */
  @Get("invitations")
  @AllowNoWorkspaceMembership()
  async lookupByCode(
    @Query("code", new ZodValidationPipe(invitationCodeSchema)) code: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user);
    sendUpstream(res, await this.workspace.getInvitationByCode(code, ctx));
  }

  @Post("invitations/accept")
  @AllowNoWorkspaceMembership()
  async accept(
    @Query("code", new ZodValidationPipe(invitationCodeSchema)) code: string,
    @Body(new ZodValidationPipe(acceptInvitationSchema)) dto: AcceptInvitationDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<void> {
    const email = user.email;
    if (email === undefined || email.length === 0) {
      throw new ForbiddenError("Your account has no email address to match the invitation");
    }
    const ctx = gatewayContext(req, res, user, idempotencyKey);
    // Identity is injected from the verified session; the client cannot accept
    // an invitation on another user's behalf.
    sendUpstream(
      res,
      await this.workspace.acceptInvitation(code, { user_id: user.userId, name: dto.name, email }, ctx),
    );
  }
}
