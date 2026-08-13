import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { NotImplementedError } from "../common/errors/typed-errors";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../middleware/current-user.decorator";
import type { RequestUser } from "../middleware/auth.types";

export const createWorkspaceSchema = z.object({
  name: z.string().min(3).max(64),
  description: z.string().max(500).optional(),
  environment: z.enum(["development", "staging", "production"]).default("development"),
});

export const updateWorkspaceSchema = createWorkspaceSchema.partial();

export type CreateWorkspaceDto = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceDto = z.infer<typeof updateWorkspaceSchema>;

@Controller("workspaces")
export class WorkspacesController {
  @Get()
  list(@CurrentUser() _user: RequestUser): never {
    // TODO(OR-004): delegate to workspace service (BE-A03)
    throw new NotImplementedError("Workspace listing");
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createWorkspaceSchema)) _dto: CreateWorkspaceDto,
  ): never {
    // TODO(OR-004): delegate to workspace service (BE-A03)
    throw new NotImplementedError("Workspace creation");
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
