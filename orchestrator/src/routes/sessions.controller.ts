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
import { ChatPersistenceService } from "../services/chat-persistence.service";
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
  constructor(private readonly chat: ChatPersistenceService) {}

  @Get()
  list(
    @Query("workspaceId", new ZodValidationPipe(workspaceIdQuerySchema))
    _workspaceId: string,
    @CurrentUser() _user: RequestUser,
  ) {
    return this.chat.listSessions(_workspaceId, _user.userId);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createSessionSchema)) _dto: CreateSessionDto, @CurrentUser() user: RequestUser) {
    return this.chat.createSession({
      workspaceId: _dto.workspaceId,
      userId: user.userId,
      ...(_dto.title === undefined ? {} : { title: _dto.title }),
    });
  }

  @Get(":id")
  get(@Param("id", new ParseUUIDPipe()) _id: string, @Query("workspaceId", new ZodValidationPipe(workspaceIdQuerySchema)) workspaceId: string, @CurrentUser() user: RequestUser) {
    return this.chat.getSession(_id, workspaceId, user.userId);
  }

  @Delete(":id")
  async remove(@Param("id", new ParseUUIDPipe()) _id: string, @Query("workspaceId", new ZodValidationPipe(workspaceIdQuerySchema)) workspaceId: string, @CurrentUser() user: RequestUser) {
    await this.chat.archiveSession(_id, workspaceId, user.userId);
    return { archived: true };
  }
}
