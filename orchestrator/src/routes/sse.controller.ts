import { Controller, Param, ParseUUIDPipe, Query, Sse } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { concatMap, from, map, mergeMap, Observable, timer } from "rxjs";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../middleware/current-user.decorator";
import type { RequestUser } from "../middleware/auth.types";
import { ChatEventsService } from "../services/chat-events.service";

const afterSchema = z.coerce.number().int().min(0).default(0);

@Controller("workspaces")
export class SseController {
  constructor(private readonly eventService: ChatEventsService) {}

  @Sse(":wid/events")
  events(
    @Param("wid", new ParseUUIDPipe()) workspaceId: string,
    @Query("after", new ZodValidationPipe(afterSchema)) after: number,
    @CurrentUser() user: RequestUser,
  ): Observable<MessageEvent> {
    let cursor = after;
    return timer(0, 1000).pipe(
      concatMap(() => from(this.eventService.listWorkspaceEvents({ workspaceId, userId: user.userId, after: cursor }))),
      mergeMap((items) => from(items)),
      map((event): MessageEvent => {
        cursor = Math.max(cursor, event.sequence);
        return { id: String(event.sequence), type: event.eventType, data: event.payload };
      }),
    );
  }
}
