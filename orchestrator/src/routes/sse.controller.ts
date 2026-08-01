import { Controller, Param, ParseUUIDPipe, Sse } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { Observable, interval, map } from "rxjs";

@Controller("workspaces")
export class SseController {
  @Sse(":wid/events")
  events(@Param("wid", new ParseUUIDPipe()) workspaceId: string): Observable<MessageEvent> {
    // TODO(OR-020): replay missed events from the outbox, then stream live events.
    // Until then, emit a keep-alive heartbeat so connections stay open.
    return interval(15_000).pipe(
      map(
        (n): MessageEvent => ({
          id: String(n),
          data: JSON.stringify({ type: "keepalive", workspaceId }),
        }),
      ),
    );
  }
}
