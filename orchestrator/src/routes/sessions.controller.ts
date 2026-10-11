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

export const createSessionSchema = z
  .object({
    workspaceId: z.string().uuid(),
    title: z.string().min(1).max(200).optional(),
  })
  .strict();

export type CreateSessionDto = z.infer<typeof createSessionSchema>;

const workspaceIdQuerySchema = z.string().uuid();
const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

@Controller("sessions")
export class SessionsController {
  constructor(private readonly chat: ChatPersistenceService) {}

  @Get()
  list(
    @Query("workspaceId", new ZodValidationPipe(workspaceIdQuerySchema))
    workspaceId: string,
    @Query(new ZodValidationPipe(paginationSchema))
    pagination: { limit: number; offset: number },
    @CurrentUser() user: RequestUser,
  ) {
    return this.chat.listSessions(workspaceId, user.userId, pagination.limit, pagination.offset);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createSessionSchema)) dto: CreateSessionDto, @CurrentUser() user: RequestUser) {
    return this.chat.createSession({
      workspaceId: dto.workspaceId,
      userId: user.userId,
      ...(dto.title === undefined ? {} : { title: dto.title }),
    });
  }

  @Get(":id/messages")
  messages(@Param("id", new ParseUUIDPipe()) id: string, @Query("workspaceId", new ZodValidationPipe(workspaceIdQuerySchema)) workspaceId: string, @CurrentUser() user: RequestUser) {
    return this.chat.listMessages(id, workspaceId, user.userId);
  }

  @Get(":id")
  async get(@Param("id", new ParseUUIDPipe()) id: string, @Query("workspaceId", new ZodValidationPipe(workspaceIdQuerySchema)) workspaceId: string, @CurrentUser() user: RequestUser) {
    const session = await this.chat.getSession(id, workspaceId, user.userId);
    const messages = await this.chat.getMessagePreview(id, workspaceId, user.userId);
    return { ...session, messagePreview: messages };
  }

  @Delete(":id")
  async remove(@Param("id", new ParseUUIDPipe()) id: string, @Query("workspaceId", new ZodValidationPipe(workspaceIdQuerySchema)) workspaceId: string, @CurrentUser() user: RequestUser) {
    await this.chat.deleteSession(id, workspaceId, user.userId);
    return { deleted: true };
  }
}
