import { BadRequestException, Controller, ForbiddenException, Headers, Param, ParseUUIDPipe, Sse } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { Observable, timer, exhaustMap, mergeMap } from "rxjs";
import { z } from "zod";
import { DbService } from "../db/db.service";
import { CurrentUser } from "../middleware/current-user.decorator";
import type { RequestUser } from "../middleware/auth.types";

@Controller("workspaces")
export class SseController {
  constructor(private readonly db: DbService) {}

  @Sse(":wid/events")
  async events(@Param("wid", new ParseUUIDPipe()) workspaceId: string,
    @Headers("last-event-id") lastEventId: string | undefined,
    @CurrentUser() user: RequestUser): Promise<Observable<MessageEvent>> {
    const membership = await this.db.query(`SELECT 1 FROM provisr_identity.memberships WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, user.userId]);
    if (!membership.rows[0]) throw new ForbiddenException("Workspace membership required");
    let cursor = "0";
    if (lastEventId) {
      if (!z.string().uuid().safeParse(lastEventId).success) throw new BadRequestException("Invalid event cursor");
      const result = await this.db.query<{ stream_sequence: string }>(`SELECT stream_sequence FROM provisr_events.sse_events WHERE event_id = $1 AND workspace_id = $2`, [lastEventId, workspaceId]);
      if (!result.rows[0]) throw new BadRequestException("Unknown event cursor");
      cursor = result.rows[0].stream_sequence;
    }
    return timer(0, 1000).pipe(exhaustMap(async () => {
      const result = await this.db.query<{ event_id: string; event_type: string; payload: Record<string, unknown>; stream_sequence: string }>(
        `SELECT event_id, event_type, payload, stream_sequence FROM provisr_events.sse_events
         WHERE workspace_id = $1 AND stream_sequence > $2 ORDER BY stream_sequence LIMIT 250`, [workspaceId, cursor]);
      const messages = result.rows.map(row => ({ id: row.event_id, type: row.event_type, data: row.payload }));
      const tail = result.rows.at(-1);
      if (tail) cursor = tail.stream_sequence;
      // A heartbeat carries no event id, preserving the browser's replay cursor.
      return messages.length ? messages : [{ type: "keepalive", data: { workspaceId } }];
    }), mergeMap(messages => messages));
  }
}
