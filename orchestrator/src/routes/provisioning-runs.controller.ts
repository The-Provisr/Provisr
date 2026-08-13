import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../middleware/current-user.decorator";
import type { RequestUser } from "../middleware/auth.types";
import { requestStatuses } from "@provisr/shared-contracts";
import { RunsService } from "../state-machine/runs.service";

export const createRunSchema = z.object({
  sessionId: z.string().uuid(),
  prompt: z.string().min(1).max(20000),
});

export const confirmRunSchema = z.object({
  manifestVersion: z.string().min(1),
  planVersion: z.string().min(1),
});

export const clarifyRunSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
});

export type CreateRunDto = z.infer<typeof createRunSchema>;
export type ConfirmRunDto = z.infer<typeof confirmRunSchema>;
export type ClarifyRunDto = z.infer<typeof clarifyRunSchema>;

const sessionIdQuerySchema = z.string().uuid().optional();
const runStatusQuerySchema = z.enum(requestStatuses).optional();
const workspaceIdQuerySchema = z.string().uuid();

@Controller("runs")
export class ProvisioningRunsController {
  constructor(private readonly runsService: RunsService) {}

  @Post()
  create(
    @Query("workspaceId", new ZodValidationPipe(workspaceIdQuerySchema)) workspaceId: string,
    @Body(new ZodValidationPipe(createRunSchema)) dto: CreateRunDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.runsService.createRun(dto.sessionId, workspaceId, user.userId, dto.prompt);
  }

  @Get()
  list(
    @Query("workspaceId", new ZodValidationPipe(workspaceIdQuerySchema)) workspaceId: string,
    @Query("sessionId", new ZodValidationPipe(sessionIdQuerySchema)) sessionId: string | undefined,
    @Query("status", new ZodValidationPipe(runStatusQuerySchema)) status: string | undefined,
    @CurrentUser() _user: RequestUser,
  ) {
    return this.runsService.listRuns(workspaceId, sessionId, status);
  }

  @Get(":id")
  get(
    @Query("workspaceId", new ZodValidationPipe(workspaceIdQuerySchema)) workspaceId: string,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    return this.runsService.getRun(id, workspaceId);
  }

  @Post(":id/cancel")
  cancel(
    @Query("workspaceId", new ZodValidationPipe(workspaceIdQuerySchema)) workspaceId: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.runsService.cancelRun(id, workspaceId, user.userId);
  }

  @Post(":id/confirm")
  async confirm(
    @Query("workspaceId", new ZodValidationPipe(workspaceIdQuerySchema)) workspaceId: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(confirmRunSchema)) _dto: ConfirmRunDto,
    @CurrentUser() user: RequestUser
  ) {
    const run = await this.runsService.getRun(id, workspaceId);
    return this.runsService.transitionState(id, workspaceId, run.stateVersion, 'pending_approval', user.userId);
  }

  @Post(":id/clarify")
  async clarify(
    @Query("workspaceId", new ZodValidationPipe(workspaceIdQuerySchema)) workspaceId: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(clarifyRunSchema)) _dto: ClarifyRunDto,
    @CurrentUser() user: RequestUser
  ) {
    const run = await this.runsService.getRun(id, workspaceId);
    // Move from clarification to pending_agent
    return this.runsService.transitionState(id, workspaceId, run.stateVersion, 'pending_agent', user.userId);
  }
}
