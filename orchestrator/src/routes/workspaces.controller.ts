import { Body, Controller, Delete, Get, Headers, Inject, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { AllowNoWorkspaceMembership } from "../middleware/allow-no-workspace.decorator";
import { WorkspaceBootstrapService } from "../services/workspace-bootstrap.service";
import { NotImplementedError } from "../common/errors/typed-errors";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../middleware/current-user.decorator";
import type { RequestUser } from "../middleware/auth.types";

export const createWorkspaceSchema = z
  .object({
    name: z.string().min(3).max(64),
    description: z.string().max(500).optional(),
    avatar: z.enum(["🚀", "🏗️", "☁️", "⚡", "🔒", "🧭"]).optional(),
    providers: z.array(z.enum(["aws", "azure", "gcp"])).max(3).optional(),
    environment: z.enum(["development", "staging", "production"]).default("development"),
  })
  .strict();

export const updateWorkspaceSchema = createWorkspaceSchema.omit({ avatar: true, providers: true }).partial().strict();

export type CreateWorkspaceDto = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceDto = z.infer<typeof updateWorkspaceSchema>;

@Controller("workspaces")
export class WorkspacesController {
  constructor(@Inject(WorkspaceBootstrapService) private readonly bootstrap: WorkspaceBootstrapService) {}

  @Get()
  @AllowNoWorkspaceMembership()
  list(@CurrentUser() user: RequestUser) { return this.bootstrap.workspaces(user); }

  @Post()
  @AllowNoWorkspaceMembership()
  create(@Body(new ZodValidationPipe(createWorkspaceSchema)) dto: CreateWorkspaceDto,
    @CurrentUser() user: RequestUser, @Headers("idempotency-key") key?: string) {
    return this.bootstrap.workspaces(user, dto, key);
  }

  @Get(":id")
  get(@Param("id", new ParseUUIDPipe()) _id: string): never {
    // TODO(OR-004): delegate to workspace service (BE-A03)
    throw new NotImplementedError("Workspace retrieval");
  }

  @Patch(":id")
  update(
    @Param("id", new ParseUUIDPipe()) _id: string,
    @Body(new ZodValidationPipe(updateWorkspaceSchema)) _dto: UpdateWorkspaceDto,
  ): never {
    // TODO(OR-004): delegate to workspace service (BE-A03)
    throw new NotImplementedError("Workspace update");
  }

  @Delete(":id")
  remove(@Param("id", new ParseUUIDPipe()) _id: string): never {
    // TODO(OR-004): delegate to workspace service (BE-A03)
    throw new NotImplementedError("Workspace deletion");
  }
}
