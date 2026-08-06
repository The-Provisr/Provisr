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
import { NotImplementedError } from "../common/errors/typed-errors";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../middleware/current-user.decorator";
import type { RequestUser } from "../middleware/auth.types";
import { requestStatuses } from "@provisr/shared-contracts";

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

@Controller("runs")
export class ProvisioningRunsController {
  @Post()
  create(@Body(new ZodValidationPipe(createRunSchema)) _dto: CreateRunDto): never {
    // TODO(OR-005): create run via workflow state machine
    throw new NotImplementedError("Run creation");
  }

  @Get()
  list(
    @Query("sessionId", new ZodValidationPipe(sessionIdQuerySchema))
    _sessionId: string | undefined,
    @Query("status", new ZodValidationPipe(runStatusQuerySchema))
    _status: string | undefined,
    @CurrentUser() _user: RequestUser,
  ): never {
    // TODO(OR-005): list runs filtered by sessionId/status
    throw new NotImplementedError("Run listing");
  }

  @Get(":id")
  get(@Param("id", new ParseUUIDPipe()) _id: string): never {
    // TODO(OR-005): return run detail + state
    throw new NotImplementedError("Run retrieval");
  }

  @Post(":id/cancel")
  cancel(@Param("id", new ParseUUIDPipe()) _id: string): never {
    // TODO(OR-005): cancel run before execution starts
    throw new NotImplementedError("Run cancellation");
  }

  @Post(":id/confirm")
  confirm(
    @Param("id", new ParseUUIDPipe()) _id: string,
    @Body(new ZodValidationPipe(confirmRunSchema)) _dto: ConfirmRunDto,
  ): never {
    // TODO(OR-005): bind confirmation to manifestVersion + planVersion (OR-016)
    throw new NotImplementedError("Run confirmation");
  }

  @Post(":id/clarify")
  clarify(
    @Param("id", new ParseUUIDPipe()) _id: string,
    @Body(new ZodValidationPipe(clarifyRunSchema)) _dto: ClarifyRunDto,
  ): never {
    // TODO(OR-005): store answers and resume the run (OR-010)
    throw new NotImplementedError("Clarification submission");
  }
}
