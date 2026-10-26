import { Body, Controller, Headers, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../middleware/current-user.decorator";
import type { RequestUser } from "../middleware/auth.types";
import { AllowNoWorkspaceMembership } from "../middleware/allow-no-workspace.decorator";
import { WorkspaceBootstrapService } from "../services/workspace-bootstrap.service";

const ensureSchema = z.object({
  name: z.string().max(255).nullable().optional(), email: z.string().max(255).nullable().optional(),
  avatarUrl: z.string().max(2048).nullable().optional(), workspaceId: z.string().uuid().nullable().optional(),
}).strict();

@Controller("users")
export class UsersController {
  constructor(@Inject(WorkspaceBootstrapService) private readonly bootstrap: WorkspaceBootstrapService) {}

  @Post("ensure")
  @HttpCode(200)
  @AllowNoWorkspaceMembership()
  ensure(@Body(new ZodValidationPipe(ensureSchema)) input: z.infer<typeof ensureSchema>,
    @CurrentUser() user: RequestUser, @Headers("idempotency-key") key: string | undefined, @Req() req: Request) {
    return this.bootstrap.ensure(user, input, key, String(req.res?.locals?.correlationId ?? "unknown"));
  }
}
