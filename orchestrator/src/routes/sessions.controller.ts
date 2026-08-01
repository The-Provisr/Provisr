import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { NotImplementedError, ValidationError } from "../common/errors/typed-errors";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../middleware/current-user.decorator";
import type { RequestUser } from "../middleware/auth.types";

export const createSessionSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
});

export type CreateSessionDto = z.infer<typeof createSessionSchema>;

const workspaceIdQuerySchema = z.string().uuid();

@Controller("sessions")
export class SessionsController {
  @Get()
  list(
    @Query("workspaceId") workspaceId: string,
    @CurrentUser() _user: RequestUser,
  ): never {
    const parsed = workspaceIdQuerySchema.safeParse(workspaceId);
    if (!parsed.success) {
      throw new ValidationError("workspaceId must be a valid UUID");
    }
    // TODO(OR-004): delegate to session service
    throw new NotImplementedError("Session listing");
  }

  @Post()
  create(@Body(new ZodValidationPipe(createSessionSchema)) _dto: CreateSessionDto): never {
    // TODO(OR-004): delegate to session service
    throw new NotImplementedError("Session creation");
  }

  @Get(":id")
  get(@Param("id", new ParseUUIDPipe()) _id: string): never {
    // TODO(OR-004): delegate to session service
    throw new NotImplementedError("Session retrieval");
  }

  @Delete(":id")
  remove(@Param("id", new ParseUUIDPipe()) _id: string): never {
    // TODO(OR-004): delegate to session service
    throw new NotImplementedError("Session deletion");
  }
}
